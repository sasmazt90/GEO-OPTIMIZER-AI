import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runAudit } from '../server/audit.js'
import { extractPage } from '../server/html.js'
import { collectCitations } from '../server/llm.js'
import { buildTasks, summarize } from '../server/measure.js'
import { analyzeAnswer, domainOf, findName, normalizeText, wilson } from '../server/mentions.js'
import { BlockedUrlError, assertPublicUrl, createSafeFetch, guardedLookup, isBlockedIp } from '../server/net.js'
import { evaluateRobots, parseRobots } from '../server/robots.js'
import { SITE, fakeFetchImpl } from './helpers.js'

test('isBlockedIp blocks private, loopback, link-local and mapped addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', 'not-an-ip']) {
    assert.equal(isBlockedIp(ip), true, ip)
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isBlockedIp(ip), false, ip)
  }
})

test('assertPublicUrl rejects internal targets and odd schemes', () => {
  for (const url of ['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://intranet/', 'ftp://example.com/',
    'file:///etc/passwd', 'http://example.com:8080/', 'http://user:pass@example.com/', 'http://db.internal/', 'http://2130706433/', 'http://0x7f.1/', '']) {
    assert.throws(() => assertPublicUrl(url), BlockedUrlError, url)
  }
  assert.equal(assertPublicUrl('example.com/path').href, 'https://example.com/path')
  assert.equal(assertPublicUrl('http://example.com:80/').hostname, 'example.com')
})

test('guardedLookup refuses hosts that resolve to loopback', async () => {
  const error = await new Promise((resolve) => guardedLookup('localhost', { all: true }, (err) => resolve(err)))
  assert.ok(error instanceof BlockedUrlError)
})

test('safeFetch follows redirects only to public URLs', async () => {
  const site = {
    'https://a.com/': { redirect: 'https://acme.com/' },
    'https://evil.com/': { redirect: 'http://169.254.169.254/latest/meta-data/' },
    ...SITE,
  }
  const safeFetch = createSafeFetch({ fetchImpl: fakeFetchImpl(site) })
  const ok = await safeFetch('https://a.com/')
  assert.equal(ok.status, 200)
  assert.equal(ok.url, 'https://acme.com/')
  assert.equal(ok.redirects.length, 1)
  await assert.rejects(() => safeFetch('https://evil.com/'), BlockedUrlError)
})

test('safeFetch truncates oversized bodies', async () => {
  const safeFetch = createSafeFetch({ fetchImpl: async () => new Response('x'.repeat(5000)) })
  const result = await safeFetch('https://big.com/', { maxBytes: 1000 })
  assert.equal(result.text.length, 1000)
  assert.equal(result.truncated, true)
})

test('robots.txt: specific group beats wildcard, longest rule wins, wildcards work', () => {
  const robots = parseRobots(`
# comment
User-agent: *
Disallow: /private/
Allow: /private/public-page
Disallow: /*.pdf$

User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: PerplexityBot
Disallow:

Sitemap: https://x.com/sitemap.xml`)
  assert.deepEqual(robots.sitemaps, ['https://x.com/sitemap.xml'])
  assert.equal(evaluateRobots(robots, 'GPTBot', '/').allowed, false)
  assert.equal(evaluateRobots(robots, 'CCBot', '/anything').allowed, false)
  assert.equal(evaluateRobots(robots, 'PerplexityBot', '/private/x').allowed, true)
  assert.equal(evaluateRobots(robots, 'ClaudeBot', '/').allowed, true)
  assert.equal(evaluateRobots(robots, 'ClaudeBot', '/private/x').allowed, false)
  assert.equal(evaluateRobots(robots, 'ClaudeBot', '/private/public-page').allowed, true)
  assert.equal(evaluateRobots(robots, 'ClaudeBot', '/files/a.pdf').allowed, false)
  assert.equal(evaluateRobots(robots, 'ClaudeBot', '/files/a.pdf?x=1').allowed, true)
  assert.equal(evaluateRobots(parseRobots(''), 'GPTBot', '/').matched, 'none')
})

test('extractPage reads JSON-LD, headings and crawler-visible text', () => {
  const facts = extractPage(SITE['https://acme.com/'].body, 'https://acme.com/')
  assert.equal(facts.title, 'Acme CRM for mid-market sales teams')
  assert.deepEqual(facts.h1, ['CRM for mid-market sales teams'])
  assert.equal(facts.jsonLd.blocks, 1)
  assert.equal(facts.jsonLd.invalid, 0)
  assert.ok(facts.jsonLd.types.includes('Organization'))
  assert.ok(facts.jsonLd.types.includes('SoftwareApplication'))
  assert.equal(facts.jsonLd.sameAs.length, 2)
  assert.equal(facts.jsonLd.hasBreadcrumb, true)
  assert.ok(facts.wordCount > 300)
  assert.ok(facts.questionHeadings >= 2)
  assert.equal(facts.hasFaqHeading, true)
  assert.equal(facts.internalLinks, 4)
  assert.ok(!facts.text.includes('schema.org'), 'script content must not leak into text')
  const broken = extractPage('<script type="application/ld+json">{oops</script><p>x</p>', 'https://x.com/')
  assert.equal(broken.jsonLd.invalid, 1)
})

test('audit is deterministic and flags real problems', async () => {
  const fetcher = createSafeFetch({ fetchImpl: fakeFetchImpl() })
  const first = await runAudit('https://acme.com/', { fetcher, extraPages: 3 })
  const second = await runAudit('https://acme.com/', { fetcher, extraPages: 3 })
  assert.equal(first.score, second.score)
  assert.ok(first.score >= 85, `good page scored ${first.score}`)
  const gptbot = first.bots.find((bot) => bot.name === 'GPTBot')
  assert.equal(gptbot.robots, 'disallowed')
  assert.equal(first.bots.find((bot) => bot.name === 'OAI-SearchBot').robots, 'allowed')
  const find = (result, id) => result.categories.flatMap((category) => category.checks).find((item) => item.id === id)
  assert.equal(find(first, 'ai_search_bots').status, 'pass', 'blocking a training bot must not fail the search-bot check')
  assert.equal(find(first, 'json_ld').status, 'pass')
  assert.equal(find(first, 'sitemap').status, 'pass')
  assert.equal(first.pages.length, 1)
  assert.ok(first.pages[0].score < 50, 'JS-only page should score low')

  const bad = await runAudit('https://blocked.com/', { fetcher })
  assert.ok(bad.score < 40, `bad page scored ${bad.score}`)
  assert.equal(find(bad, 'noindex').status, 'fail')
  assert.equal(find(bad, 'ai_search_bots').status, 'fail')
  assert.equal(find(bad, 'server_text').status, 'fail')
  assert.ok(bad.topFixes.length > 0)
})

test('mention detection handles punctuation, diacritics, suffixes and substrings', () => {
  const n = normalizeText
  assert.notEqual(findName(n('We like L\'Oréal and Nivea.'), 'L\'Oreal'), -1)
  assert.notEqual(findName(n('Bioderma\'nın ürünleri iyi'), 'Bioderma'), -1)
  assert.notEqual(findName(n('Try Stripe\'s API'), 'Stripe'), -1)
  assert.equal(findName(n('Use pineapple slices'), 'Apple'), -1)
  assert.equal(findName(n('Notional value'), 'Notion'), -1)
  assert.notEqual(findName(n('**HubSpot** (hubspot.com)'), 'HubSpot'), -1)
  assert.equal(domainOf('https://www.Acme.com/x'), 'acme.com')
})

test('analyzeAnswer ranks by first mention and detects own-domain citations', () => {
  const result = analyzeAnswer({
    answer: 'Top picks: Salesforce, then Acme, then HubSpot. See https://blog.acme.com/guide.',
    citations: ['https://www.g2.com/crm'],
    brand: 'Acme', domain: 'acme.com', competitors: [{ name: 'HubSpot', aliases: [] }, { name: 'Salesforce', aliases: ['SFDC'] }, { name: 'Zoho', aliases: [] }],
  })
  assert.equal(result.brandMentioned, true)
  assert.equal(result.brandPosition, 2)
  assert.deepEqual(result.mentions.map((mention) => mention.name), ['Salesforce', 'Acme', 'HubSpot'])
  assert.equal(result.ownCited, true)
  assert.deepEqual(result.citedDomains.sort(), ['blog.acme.com', 'g2.com'])
})

test('wilson interval is sane', () => {
  assert.deepEqual(wilson(0, 0), { rate: 0, low: 0, high: 0 })
  const half = wilson(5, 10)
  assert.equal(half.rate, 50)
  assert.ok(half.low > 20 && half.low < 30 && half.high > 70 && half.high < 80)
  assert.equal(wilson(10, 10).high, 100)
})

test('summarize counts exactly and never invents shares', () => {
  const project = { brand: 'Acme', aliases: [], domain: 'acme.com', competitors: [{ name: 'Salesforce', aliases: [] }] }
  const mk = (surface, answer, citations = [], status = 'done') => ({ status, surface, promptId: 'p1', promptText: 'best crm', answer, citations, model: 'm' })
  const samples = [
    mk('ChatGPT', 'Salesforce and Acme'),
    mk('ChatGPT', 'Salesforce only'),
    mk('Perplexity', 'Acme is great', ['https://acme.com/x']),
    mk('Perplexity', 'HubSpot', ['https://hubspot.com/']),
    mk('Claude', '', [], 'error'),
  ]
  const summary = summarize(samples, project, ['HubSpot', 'Ghost'])
  assert.equal(summary.answers, 4)
  assert.equal(summary.failed, 1)
  assert.equal(summary.visibility.rate, 50)
  assert.equal(summary.brands.find((entry) => entry.name === 'Salesforce').answers, 2)
  assert.equal(summary.brands.find((entry) => entry.name === 'HubSpot').answers, 1)
  assert.equal(summary.brands.find((entry) => entry.name === 'Ghost'), undefined)
  assert.equal(summary.brands.reduce((sum, entry) => sum + entry.answers, 0), 5)
  assert.equal(summary.citation.answersWithSources, 2)
  assert.equal(summary.citation.ownCited, 1)
  assert.equal(summary.bySurface.find((row) => row.surface === 'ChatGPT').rate, 50)
  assert.equal(summarize([], project).visibility.rate, 0)
  assert.equal(buildTasks([{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }], ['ChatGPT', 'Claude'], 3).length, 12)
})

test('collectCitations reads every provider shape', () => {
  const urls = collectCitations({
    citations: ['https://a.com', { url: 'https://b.com' }],
    search_results: [{ url: 'https://c.com' }],
    choices: [{ message: { annotations: [{ type: 'url_citation', url_citation: { url: 'https://d.com' } }, { type: 'url_citation', url: 'https://a.com' }] } }],
  })
  assert.deepEqual(urls.sort(), ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com'])
})
