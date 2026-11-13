import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import { comparePages } from '../server/compare.js'
import { extractLinks, normalizeCrawlUrl, summarizeCrawl } from '../server/crawl.js'
import { buildKeywordTrends, buildOpportunities, createGsc, createTokenBox, dateRanges, keywordRegexes } from '../server/gsc.js'
import { extractPage } from '../server/html.js'
import { PLANS } from '../server/plans.js'
import { compareRender, createRenderer } from '../server/render.js'
import { blocksFromInput, validateBlocks } from '../server/schema.js'
import { compareAudits } from '../server/seo.js'
import { createVitals, parsePsi, rate } from '../server/vitals.js'
import { PSI_SAMPLE, fakeGoogle, startApp } from './helpers.js'

const gscExtras = (google = fakeGoogle()) => ({
  google,
  extras: { gsc: createGsc({ clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost/api/gsc/callback', fetchImpl: google.fetchImpl }), tokenBox: createTokenBox('test-secret') },
})

async function connect(ctx) {
  const start = await ctx.api('GET', '/api/gsc/connect')
  const state = new URL(start.body.url).searchParams.get('state')
  const cookie = start.headers.get('set-cookie').split(';')[0]
  return ctx.api('GET', `/api/gsc/callback?code=good-code&state=${state}`, null, { Cookie: cookie })
}

test('token box encrypts and round-trips refresh tokens', () => {
  const box = createTokenBox('secret-a')
  const sealed = box.seal('1//refresh-token')
  assert.ok(!sealed.includes('refresh-token'))
  assert.notEqual(sealed, box.seal('1//refresh-token'), 'a fresh IV is used every time')
  assert.equal(box.open(sealed), '1//refresh-token')
  assert.throws(() => createTokenBox('secret-b').open(sealed))
  assert.equal(createTokenBox(''), null)
})

test('search console date ranges exclude the last two days and do not overlap', () => {
  const ranges = dateRanges(28, new Date('2026-11-13T15:00:00Z'))
  assert.deepEqual(ranges.current, { startDate: '2026-10-15', endDate: '2026-11-11' })
  assert.deepEqual(ranges.previous, { startDate: '2026-09-17', endDate: '2026-10-14' })
})

test('keyword opportunities are derived from search console rows only', () => {
  const row = (query, page, clicks, impressions, position) => ({ keys: [query, page], clicks, impressions, ctr: clicks / impressions, position })
  const filler = Array.from({ length: 6 }, (_, index) => row(`filler ${index}`, '/a', 12, 100, 5))
  const result = buildOpportunities([
    row('crm for sales teams', '/a', 12, 800, 6.8), row('crm for sales teams', '/b', 8, 400, 8),
    row('what is a crm', '/blog', 4, 800, 15), row('crm pricing', '/pricing', 1, 500, 5.2), row('acme', '/a', 90, 100, 1), ...filler,
  ])
  assert.deepEqual(result.striking.map((item) => item.query).slice(0, 3), ['crm for sales teams', 'what is a crm', 'crm pricing'])
  const merged = result.striking[0]
  assert.equal(merged.impressions, 1200)
  assert.equal(merged.position, 7.2, 'position is impression-weighted across pages')
  assert.deepEqual(result.ctrBenchmarks, [{ position: 5, ctr: 12 }], 'benchmark needs five comparable queries at a position')
  assert.equal(result.lowCtr.length, 1)
  assert.deepEqual({ query: result.lowCtr[0].query, missed: result.lowCtr[0].missedClicks }, { query: 'crm pricing', missed: 59 })
  assert.equal(result.cannibalization.length, 1)
  assert.equal(result.cannibalization[0].pages.length, 2)
  assert.deepEqual(result.questions.map((item) => item.query), ['what is a crm'])
})

test('tracked keyword filters are escaped and chunked', () => {
  assert.deepEqual(keywordRegexes(['c++ crm (free)', 'a|b']), ['^(c\\+\\+ crm \\(free\\)|a\\|b)$'])
  assert.equal(keywordRegexes(Array.from({ length: 50 }, (_, index) => `keyword number ${index}`), 200).length > 1, true)
  const trends = buildKeywordTrends([{ id: 'k1', query: 'acme crm' }, { id: 'k2', query: 'never seen' }], ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((date, index) => ({ keys: [date, 'acme crm'], clicks: 5, impressions: 50, position: 4 - index })), dateRanges(28))
  assert.equal(trends[0].change, 2, 'average position moved from 3.5 to 1.5')
  assert.equal(trends[0].best, 1)
  assert.equal(trends[1].position, null)
  assert.equal(trends[1].daysWithData, 0)
})

test('search console: connect, list sites, performance, opportunities, keywords, disconnect', async () => {
  const { google, extras } = gscExtras()
  const ctx = await startApp({ extras })
  try {
    assert.deepEqual((await ctx.api('GET', '/api/gsc/status')).body.connected, false)
    assert.equal((await ctx.api('GET', '/api/gsc/sites')).status, 409)
    const forged = await ctx.api('GET', '/api/gsc/callback?code=good-code&state=forged', null, { Cookie: 'gsc_state=other' })
    assert.match(forged.headers.get('location'), /gsc=error&reason=state/)
    assert.equal(ctx.store.state.gsc.size, 0)

    const callback = await connect(ctx)
    assert.equal(callback.status, 302)
    assert.match(callback.headers.get('location'), /gsc=connected/)
    const stored = ctx.store.state.gsc.get(ctx.user.id)
    assert.ok(stored.refreshToken.startsWith('v1.') && !stored.refreshToken.includes('rt-1'), 'refresh token is encrypted at rest')
    const status = (await ctx.api('GET', '/api/gsc/status')).body
    assert.equal(status.email, 'owner@gmail.example')
    assert.equal(JSON.stringify(status).includes('rt-1'), false)

    const sites = await ctx.api('GET', '/api/gsc/sites')
    assert.deepEqual(sites.body.sites.map((site) => site.siteUrl), ['sc-domain:acme.com'], 'unverified properties are hidden')

    const performance = await ctx.api('POST', '/api/gsc/performance', { siteUrl: 'sc-domain:acme.com', days: 28, country: 'deu' })
    assert.equal(performance.status, 200)
    assert.equal(performance.body.totals.current.clicks, 120)
    assert.equal(performance.body.totals.previous.clicks, 80)
    const moved = performance.body.queries.find((row) => row.key === 'crm for sales teams')
    assert.equal(moved.positionChange, 5.2, 'moving from 12.4 to 7.2 is +5.2')
    assert.equal(performance.body.rankings.improved[0].key, 'crm for sales teams')
    assert.deepEqual(performance.body.rankings.newQueries.map((row) => row.key), ['what is a crm'])
    assert.deepEqual(performance.body.rankings.lostQueries.map((row) => row.key), ['old query'])
    const sent = google.calls.find((call) => call.url.includes('searchAnalytics'))
    assert.equal(sent.auth, 'Bearer at-2')
    assert.deepEqual(sent.body.dimensionFilterGroups[0].filters[0], { dimension: 'country', operator: 'equals', expression: 'deu' })
    assert.match(sent.url, /sites\/sc-domain%3Aacme\.com\/searchAnalytics/)

    const opportunities = await ctx.api('POST', '/api/gsc/opportunities', { siteUrl: 'sc-domain:acme.com', days: 90 })
    assert.equal(opportunities.body.striking[0].query, 'crm for sales teams')
    assert.equal(opportunities.body.cannibalization.length, 1)

    const added = await ctx.api('POST', '/api/gsc/keywords', { siteUrl: 'sc-domain:acme.com', queries: ['Acme CRM', 'acme  crm', 'never seen'] })
    assert.deepEqual(added.body.keywords.map((item) => item.query), ['acme crm', 'never seen'], 'keywords are normalised and de-duplicated')
    const tooMany = await ctx.api('POST', '/api/gsc/keywords', { siteUrl: 'sc-domain:acme.com', queries: Array.from({ length: 9 }, (_, index) => `kw ${index}`) })
    assert.equal(tooMany.status, 403, 'free plan tracks 10 keywords')
    const trends = await ctx.api('POST', '/api/gsc/keyword-trends', { siteUrl: 'sc-domain:acme.com', days: 28 })
    assert.equal(trends.body.keywords[0].series.length, 4)
    assert.equal(trends.body.keywords[1].daysWithData, 0)
    await ctx.api('DELETE', `/api/gsc/keywords/${added.body.keywords[0].id}`)
    assert.equal((await ctx.api('GET', '/api/gsc/keywords?siteUrl=sc-domain:acme.com')).body.keywords.length, 1)

    assert.equal((await ctx.api('DELETE', '/api/gsc')).status, 200)
    assert.ok(google.calls.some((call) => call.url.includes('/revoke')))
    assert.equal((await ctx.api('GET', '/api/gsc/status')).body.connected, false)
  } finally {
    await ctx.close()
  }
})

test('search console: a revoked grant removes the connection and asks to reconnect', async () => {
  const good = gscExtras()
  const ctx = await startApp({ extras: good.extras })
  try {
    await connect(ctx)
    const revoked = createGsc({ clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost/cb', fetchImpl: fakeGoogle({ revoked: true }).fetchImpl })
    Object.assign(good.extras.gsc, { sites: revoked.sites, query: revoked.query })
    const response = await ctx.api('GET', '/api/gsc/sites')
    assert.equal(response.status, 401)
    assert.equal(response.body.code, 'reconnect')
    assert.equal(ctx.store.state.gsc.size, 0)
  } finally {
    await ctx.close()
  }
})

test('search console is reported as not configured without credentials', async () => {
  const ctx = await startApp()
  try {
    assert.deepEqual((await ctx.api('GET', '/api/gsc/status')).body, { configured: false, connected: false })
    assert.equal((await ctx.api('GET', '/api/gsc/connect')).status, 503)
  } finally {
    await ctx.close()
  }
})

test('core web vitals: parses field and lab data and rates against thresholds', async () => {
  const parsed = parsePsi(PSI_SAMPLE, 'mobile')
  assert.equal(parsed.field.metrics.cls.p75, 0.04, 'CrUX CLS is divided by 100')
  assert.equal(parsed.field.metrics.inp.rating, 'needs-improvement')
  assert.equal(parsed.field.assessment, 'failed', 'INP above 200 ms fails the assessment')
  assert.equal(parsed.origin.assessment, 'passed')
  assert.equal(parsed.lab.performanceScore, 72)
  assert.deepEqual(parsed.improvements.map((item) => [item.id, item.savingsMs]), [['render-blocking-resources', 620], ['unused-javascript', 300]])
  assert.equal(parsePsi({ lighthouseResult: {} }, 'mobile').field.assessment, 'no-data')
  assert.deepEqual([rate('lcp', 2500), rate('lcp', 2501), rate('cls', 0.3), rate('inp', null)], ['good', 'needs-improvement', 'poor', 'none'])

  const urls = []
  const vitals = createVitals({ apiKey: 'k', fetchImpl: async (url) => { urls.push(url); return url.includes('strategy=desktop') ? new Response(JSON.stringify({ error: { message: 'Lighthouse returned error: NO_FCP' } }), { status: 500 }) : new Response(JSON.stringify(PSI_SAMPLE)) } })
  const ctx = await startApp({ extras: { vitals } })
  try {
    const response = await ctx.api('POST', '/api/vitals', { url: 'acme.com', strategy: 'both' })
    assert.equal(response.status, 200)
    assert.equal(response.body.results.length, 1)
    assert.match(response.body.failed[0].error, /NO_FCP/)
    assert.match(urls[0], /url=https%3A%2F%2Facme\.com%2F&strategy=mobile&category=performance&key=k/)
    assert.equal((await ctx.api('POST', '/api/vitals', { url: 'http://127.0.0.1/' })).status, 400)
    assert.equal(ctx.store.state.usage.get(`user-1|${new Date().toISOString().slice(0, 7)}-01|audit`), 2)
  } finally {
    await ctx.close()
  }
})

test('schema validator: required, recommended, nested and format rules', () => {
  const result = validateBlocks([
    JSON.stringify({ '@context': 'https://schema.org', '@graph': [
      { '@type': 'Organization', name: 'Acme', url: 'https://acme.com', logo: '/logo.png' },
      { '@type': 'Product', name: 'Acme CRM', offers: { '@type': 'Offer', price: '49' } },
      { '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'What is it?', acceptedAnswer: { '@type': 'Answer', text: 'A CRM.' } }, { '@type': 'Question', name: 'Price?' }] },
      { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home' }, { '@type': 'ListItem', position: 2, name: 'Pricing' }] },
      { '@type': 'Article', headline: 'Hello', datePublished: '13/11/2026', image: 'https://acme.com/a.png', dateModified: '2026-11-13T10:00:00+01:00', author: { '@type': 'Person' } },
      { '@type': 'Thing', name: 'Unknown thing' },
    ] }),
    '{"@type": "Organization", "name": "No context"}',
    '{ not json',
  ])
  const byType = Object.fromEntries(result.items.map((item) => [item.type + (item.name === 'No context' ? '!' : ''), item]))
  assert.equal(byType.Organization.status, 'warn')
  assert.ok(byType.Organization.warnings.some((message) => /"logo" should be an absolute URL/.test(message)))
  assert.deepEqual(byType.Product.errors, ['Missing required property "offers.priceCurrency".'])
  assert.deepEqual(byType.FAQPage.errors, ['mainEntity[1] has no "acceptedAnswer".'])
  assert.deepEqual(byType.BreadcrumbList.errors, ['itemListElement[0] is missing "item" (the URL); only the last breadcrumb may omit it.'])
  assert.ok(byType.Article.errors.some((message) => /"datePublished" is not an ISO 8601 date/.test(message)))
  assert.ok(byType.Article.warnings.includes('"author" should have a "name".'))
  assert.equal(byType.Thing.known, false)
  assert.equal(byType.Thing.status, 'pass')
  assert.deepEqual(byType['Organization!'].errors, ['"@context" must be "https://schema.org".'])
  assert.equal(result.parseErrors.length, 1)
  assert.equal(result.counts.fail, 6)
  assert.deepEqual(blocksFromInput('<script type="application/ld+json">{"a":1}</script><script type="application/ld+json">{"b":2}</script>'), ['{"a":1}', '{"b":2}'])
})

test('schema validation endpoint: pasted code is free, a URL costs one audit', async () => {
  const ctx = await startApp()
  try {
    const pasted = await ctx.api('POST', '/api/schema/validate', { code: '{"@context":"https://schema.org","@type":"WebSite","name":"Acme","url":"https://acme.com"}' })
    assert.equal(pasted.body.items[0].status, 'warn')
    assert.equal(ctx.store.state.usage.size, 0)
    const fromUrl = await ctx.api('POST', '/api/schema/validate', { url: 'acme.com' })
    assert.deepEqual(fromUrl.body.types, ['Organization', 'SoftwareApplication', 'BreadcrumbList'])
    assert.equal(fromUrl.body.raw.length, 1)
    assert.equal(ctx.store.state.usage.size, 1)
    assert.equal((await ctx.api('POST', '/api/schema/validate', {})).status, 400)
    assert.equal((await ctx.api('POST', '/api/schema/validate', { url: 'http://10.0.0.1/' })).status, 400)
  } finally {
    await ctx.close()
  }
})

test('crawl helpers: url normalisation and link extraction', () => {
  assert.equal(normalizeCrawlUrl('/a?utm_source=x&b=2&a=1#top', 'https://acme.com/'), 'https://acme.com/a?a=1&b=2')
  assert.equal(normalizeCrawlUrl('/file.pdf', 'https://acme.com/'), null)
  assert.equal(normalizeCrawlUrl('mailto:a@b.c', 'https://acme.com/'), null)
  const links = extractLinks('<a href="/a">a</a><a href="https://www.acme.com/b#x" rel="nofollow">b</a><a href="https://other.com/">o</a><a href="/a">dup</a><a href="tel:1">t</a>', 'https://acme.com/')
  assert.deepEqual(links, { internal: ['https://acme.com/a', 'https://www.acme.com/b'], external: 1, nofollow: 1 })
})

const page = (path, body, head = '') => ({ body: `<html lang="en"><head><title>${path} title for the page</title>${head}</head><body><main><h1>${path}</h1>${body}</main></body></html>` })
const CRAWL_SITE = {
  'https://shop-demo.com/': page('home', '<a href="/a">A</a><a href="/b?utm_source=x">B</a><a href="/missing">gone</a><a href="/private/x">private</a><a href="https://elsewhere-demo.com/">ext</a>'),
  'https://shop-demo.com/robots.txt': { body: 'User-agent: *\nDisallow: /private/\nSitemap: https://shop-demo.com/sitemap.xml\n', type: 'text/plain' },
  'https://shop-demo.com/sitemap.xml': { body: '<urlset><url><loc>https://shop-demo.com/</loc></url><url><loc>https://shop-demo.com/a</loc></url><url><loc>https://shop-demo.com/orphan</loc></url></urlset>', type: 'application/xml' },
  'https://shop-demo.com/a': page('a', '<a href="/b">B</a><a href="/c">C</a>', '<meta name="description" content="Same description">'),
  'https://shop-demo.com/b': page('b', '<a href="/">home</a>', '<meta name="description" content="Same description"><meta name="robots" content="noindex">'),
  'https://shop-demo.com/c': { redirect: 'https://shop-demo.com/a' },
  'https://shop-demo.com/orphan': page('orphan', '<p>nothing links here</p>'),
}

async function runCrawl(ctx, id) {
  for (let step = 0; step < 30; step += 1) {
    const state = await ctx.api('POST', `/api/crawls/${id}/step`)
    if (state.body.status !== 'running') return state.body
  }
  throw new Error('crawl did not finish')
}

test('site crawl: follows links, respects robots.txt and counts issues', async () => {
  const ctx = await startApp({ site: CRAWL_SITE, config: { crawlBatchSize: 3 } })
  try {
    const created = await ctx.api('POST', '/api/crawls', { url: 'shop-demo.com', maxPages: 500 })
    assert.equal(created.status, 201)
    assert.equal(created.body.crawl.maxPages, 25, 'capped at the free plan limit')
    assert.equal(created.body.queued, 3)
    assert.equal(JSON.stringify(created.body).includes('Disallow'), false, 'robots.txt text is not sent to the client')
    const final = await runCrawl(ctx, created.body.crawl.id)
    const summary = final.summary
    assert.equal(final.status, 'completed')
    assert.equal(summary.pagesCrawled, 7)
    assert.deepEqual(summary.broken.map((item) => [item.url, item.error, item.linkedFrom]).sort(), [
      ['https://shop-demo.com/missing', 'HTTP 404', 'https://shop-demo.com/'],
      ['https://shop-demo.com/private/x', 'Blocked by robots.txt', 'https://shop-demo.com/'],
    ])
    assert.equal(ctx.fetchLog.some((entry) => entry.url.includes('/private/')), false, 'disallowed URLs are never requested')
    assert.equal(ctx.fetchLog.some((entry) => entry.url.includes('elsewhere-demo.com')), false, 'external links are not followed')
    assert.deepEqual(summary.redirected, [{ from: 'https://shop-demo.com/c', to: 'https://shop-demo.com/a', hops: 1 }])
    assert.deepEqual(summary.noindex, ['https://shop-demo.com/b'])
    assert.deepEqual(summary.orphans, ['https://shop-demo.com/orphan'])
    assert.equal(summary.duplicateDescriptions[0].count, 3, 'a, b and the redirect target share one description')
    assert.ok(summary.issues.find((issue) => issue.id === 'meta_description' || /description/i.test(issue.label)))
    assert.equal(summary.sitemap.urls, 3)
    assert.equal(ctx.store.state.usage.get(`user-1|${new Date().toISOString().slice(0, 7)}-01|crawl`), 7)

    const detail = await ctx.api('GET', `/api/crawls/${created.body.crawl.id}?pages=1`)
    assert.equal(detail.body.pages.length, 7)
    assert.equal(detail.body.pages.find((row) => row.url === 'https://shop-demo.com/b').noindex, true)
    assert.equal((await ctx.api('GET', '/api/crawls')).body.crawls[0].status, 'completed')
    assert.equal((await ctx.api('POST', '/api/crawls', { url: 'http://192.168.1.1/' })).status, 400)
    await ctx.api('DELETE', `/api/crawls/${created.body.crawl.id}`)
    assert.equal((await ctx.api('GET', `/api/crawls/${created.body.crawl.id}`)).status, 404)
  } finally {
    await ctx.close()
  }
})

test('site crawl: stops at the page limit and at the monthly allowance', async () => {
  const many = { ...CRAWL_SITE, 'https://shop-demo.com/': page('home', Array.from({ length: 60 }, (_, index) => `<a href="/p${index}">p</a>`).join('')) }
  const ctx = await startApp({ site: many })
  try {
    const created = await ctx.api('POST', '/api/crawls', { url: 'shop-demo.com' })
    const final = await runCrawl(ctx, created.body.crawl.id)
    assert.equal(final.summary.pagesCrawled, 25)
    assert.equal(final.summary.limitReached, true)

    ctx.store.state.usage.set(`user-1|${new Date().toISOString().slice(0, 7)}-01|crawl`, PLANS.free.crawlPagesMonthly - 2)
    const second = await ctx.api('POST', '/api/crawls', { url: 'shop-demo.com' })
    const stopped = await runCrawl(ctx, second.body.crawl.id)
    assert.match(stopped.summary.stopped, /crawled pages/)
    assert.equal(stopped.summary.pagesCrawled, 0)
    assert.ok(stopped.summary.skipped > 0)
  } finally {
    await ctx.close()
  }
})

test('crawl summary handles an empty crawl', () => {
  const summary = summarizeCrawl([], {})
  assert.equal(summary.pagesCrawled, 0)
  assert.equal(summary.score, 0)
})

test('page comparison lists only measured gaps', async () => {
  const site = {
    'https://mine-demo.com/': page('CRM', '<h2>Features</h2><p>short</p>'),
    'https://rival-demo.com/': { body: `<html lang="en"><head><title>Best CRM pricing guide</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}</script></head><body><main><h1>CRM pricing</h1><p>${'long text about pricing '.repeat(200)}</p><h2>Pricing tiers explained</h2><h2>Features</h2><h2>What does onboarding cost?</h2><table><tr><td>1</td></tr></table><time datetime="2026-10-01">Oct</time></main></body></html>` },
    'https://down-demo.com/': { body: 'nope', status: 500 },
  }
  const ctx = await startApp({ site })
  try {
    const response = await ctx.api('POST', '/api/compare-pages', { url: 'mine-demo.com', competitors: ['rival-demo.com', 'down-demo.com'], query: 'crm pricing' })
    assert.equal(response.status, 200)
    assert.equal(response.body.competitors[1].ok, false)
    const metrics = response.body.gaps.map((gap) => gap.metric)
    for (const expected of ['Text length', 'Structured data types', 'FAQ section', 'Freshness', 'Query terms in title']) assert.ok(metrics.includes(expected), expected)
    assert.deepEqual(response.body.missingTopics.map((topic) => topic.heading), ['Pricing tiers explained', 'What does onboarding cost?'])
    assert.equal(response.body.own.query.inTitle, 1)
    assert.equal(ctx.store.state.usage.get(`user-1|${new Date().toISOString().slice(0, 7)}-01|audit`), 3)
    assert.equal((await ctx.api('POST', '/api/compare-pages', { url: 'mine-demo.com', competitors: ['http://localhost/'] })).status, 400)
  } finally {
    await ctx.close()
  }
  assert.deepEqual(comparePages({ ok: false }, []), { gaps: [], strengths: [], missingTopics: [] })
})

test('render comparison flags content that only exists after JavaScript', () => {
  const raw = extractPage('<html><head><title>App</title></head><body><div id="root"></div></body></html>', 'https://spa-demo.com/')
  const renderedHtml = `<html><head><title>Acme pricing</title><meta name="robots" content="noindex"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"x"}</script></head><body><main><h1>Pricing</h1><p>${'word '.repeat(300)}</p><a href="/a">a</a><a href="/b">b</a></main></body></html>`
  const result = compareRender(raw, { html: renderedHtml, url: 'https://spa-demo.com/', status: 200, ms: 900, requests: 12, failedRequests: [], consoleErrors: ['boom'] })
  const status = Object.fromEntries(result.category.checks.map((item) => [item.id, item.status]))
  assert.deepEqual(status, { js_content: 'fail', js_title: 'warn', js_description: 'pass', js_robots: 'fail', js_canonical: 'pass', js_h1: 'fail', js_links: 'fail', js_schema: 'warn', js_errors: 'warn', js_requests: 'info' })
  assert.equal(result.contentShare, 0)
  const same = compareRender(raw, { html: '<html><head><title>App</title></head><body><div id="root"></div></body></html>', url: 'https://spa-demo.com/', status: 200, ms: 1, requests: 1, failedRequests: [], consoleErrors: [] })
  assert.equal(same.score, 100)
})

test('rendered audit: headless Chromium runs the page script and blocks private addresses', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') return res.setHeader('content-type', 'text/javascript').end('document.title = "Rendered title"; document.querySelector("#root").innerHTML = "<h1>Hello</h1><p>" + "rendered words ".repeat(120) + "</p>"; fetch("http://169.254.169.254/latest/meta-data/").catch(() => {});')
    res.setHeader('content-type', 'text/html').end('<html><head><title>Shell</title></head><body><div id="root"></div><script src="/app.js"></script><img src="http://10.0.0.1/pixel.png"></body></html>')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const { chromium } = await import('playwright')
  let browserAvailable = true
  const renderer = createRenderer({
    // spa-demo.com resolves publicly for the guard and is mapped to the local test server inside Chromium.
    launch: () => chromium.launch({ args: [`--host-resolver-rules=MAP spa-demo.com 127.0.0.1:${port}`] }),
    lookup: async (host) => (host === 'spa-demo.com' ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '10.0.0.1', family: 4 }]),
  })
  try {
    await chromium.launch().then((browser) => browser.close())
  } catch {
    browserAvailable = false
  }
  if (!browserAvailable) return server.close()
  try {
    const rendered = await renderer.render('http://spa-demo.com/')
    assert.equal(rendered.ok, true)
    assert.match(rendered.html, /Rendered title/)
    assert.ok(rendered.blockedRequests >= 2, 'the metadata request and the private image are blocked')
    const result = compareRender(extractPage('<html><head><title>Shell</title></head><body><div id="root"></div></body></html>', 'http://spa-demo.com/'), rendered)
    assert.equal(result.category.checks.find((item) => item.id === 'js_content').status, 'fail')
    assert.equal(result.rendered.words > 200, true)
    await assert.rejects(() => renderer.render('http://127.0.0.1/'), /not publicly reachable/)
  } finally {
    server.close()
  }
})

test('audit: optional rendering, saved history and comparison', async () => {
  const renderer = { render: async (url) => ({ ok: true, url, status: 200, ms: 500, requests: 3, failedRequests: [], consoleErrors: [], blockedRequests: 0, html: '<html lang="en"><head><title>Pricing</title></head><body><main><h1>Pricing</h1><p>' + 'plan '.repeat(400) + '</p></main></body></html>' }) }
  const site = { ...CRAWL_SITE, 'https://acme.com/pricing': { body: '<html><head><title>Pricing</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>' } }
  const ctx = await startApp({ site, extras: { renderer } })
  try {
    const first = await ctx.api('POST', '/api/audit', { url: 'acme.com/pricing', render: true })
    assert.equal(first.status, 200)
    assert.equal(first.body.rendering.ok, true)
    assert.equal(first.body.rendering.category.checks[0].status, 'fail')
    assert.ok(first.body.auditId)
    assert.equal(ctx.store.state.usage.get(`user-1|${new Date().toISOString().slice(0, 7)}-01|audit`), 2, 'a rendered audit costs two credits')

    site['https://acme.com/pricing'] = { body: '<html lang="en"><head><title>Acme pricing plans and what they include</title><meta name="description" content="' + 'Pricing for every plan. '.repeat(5) + '"></head><body><main><h1>Pricing</h1><p>' + 'plan '.repeat(400) + '</p></main></body></html>' }
    const second = await ctx.api('POST', '/api/audit', { url: 'acme.com/pricing' })
    assert.equal(second.body.rendering, undefined)
    assert.ok(second.body.score > first.body.score)

    const history = await ctx.api('GET', '/api/audits?host=www.acme.com')
    assert.equal(history.body.audits.length, 2)
    assert.equal(history.body.audits[0].id, second.body.auditId, 'newest first')
    assert.equal(history.body.audits[0].checks, undefined)
    const diff = await ctx.api('GET', `/api/audits/compare?a=${second.body.auditId}&b=${first.body.auditId}`)
    assert.equal(diff.body.before.id, first.body.auditId, 'ordered by time regardless of parameter order')
    assert.equal(diff.body.scoreChange, second.body.score - first.body.score)
    assert.ok(diff.body.changes.some((change) => change.id === 'title' && change.direction === 'improved'))
    assert.ok(diff.body.changes.some((change) => change.id === 'js_content' && change.direction === 'removed'))
    assert.equal((await ctx.api('GET', '/api/audits/compare?a=x&b=y')).status, 404)
  } finally {
    await ctx.close()
  }
  const diff = compareAudits({ id: 'a', checks: [{ id: 'x', label: 'X', status: 'pass' }], score: 90 }, { id: 'b', checks: [{ id: 'x', label: 'X', status: 'fail' }], score: 70 })
  assert.deepEqual([diff.regressed, diff.improved, diff.scoreChange], [1, 0, -20])
})

test('audit without a renderer ignores the render flag and charges one credit', async () => {
  const ctx = await startApp()
  try {
    const response = await ctx.api('POST', '/api/audit', { url: 'acme.com', render: true })
    assert.equal(response.body.rendering, undefined)
    assert.equal(ctx.store.state.usage.get(`user-1|${new Date().toISOString().slice(0, 7)}-01|audit`), 1)
  } finally {
    await ctx.close()
  }
})
