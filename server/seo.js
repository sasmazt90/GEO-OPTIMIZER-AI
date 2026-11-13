// SEO suite routes: Search Console, rank tracking, keyword opportunities, page
// comparison, Core Web Vitals, site crawl, schema validation, audit history.
import crypto from 'node:crypto'
import { z } from 'zod'
import { comparePages, profilePage } from './compare.js'
import { pageRows, processCrawlBatch, seedCrawl } from './crawl.js'
import { GscError, buildKeywordTrends, buildOpportunities, buildPerformance, dateRanges, filterGroups, keywordRegexes } from './gsc.js'
import { assertPublicUrl, normalizeUrl } from './net.js'
import { consume } from './plans.js'
import { RenderUnavailableError } from './render.js'
import { blocksFromInput, jsonLdBlocksFromHtml, validateBlocks } from './schema.js'
import { MigrationPendingError } from './store.js'
import { VitalsError } from './vitals.js'

const siteUrl = z.string().trim().min(4).max(300)
const days = z.union([z.literal(7), z.literal(28), z.literal(90)]).default(28)
const gscQuerySchema = z.object({ siteUrl, days, country: z.string().trim().regex(/^[a-zA-Z]{3}$/).or(z.literal('')).default(''), device: z.enum(['', 'desktop', 'mobile', 'tablet']).default('') })
const keywordsSchema = z.object({ siteUrl, queries: z.array(z.string().trim().min(1).max(200)).min(1).max(100) })
const vitalsSchema = z.object({ url: z.string().trim().min(3).max(500), strategy: z.enum(['mobile', 'desktop', 'both']).default('mobile') })
const compareSchema = z.object({ url: z.string().trim().min(3).max(500), competitors: z.array(z.string().trim().min(3).max(500)).min(1).max(3), query: z.string().trim().max(200).default('') })
const crawlSchema = z.object({ url: z.string().trim().min(3).max(500), maxPages: z.number().int().min(1).max(5000).default(100) })
const schemaSchema = z.object({ url: z.string().trim().max(500).default(''), code: z.string().max(200_000).default('') })

// Maps module errors to HTTP responses. Returns true when the error was handled.
export function handleSeoError(error, res) {
  if (error instanceof GscError) return Boolean(res.status(error.status).json({ error: error.message, code: error.code }))
  if (error instanceof VitalsError) return Boolean(res.status(error.status).json({ error: error.message }))
  if (error instanceof RenderUnavailableError) return Boolean(res.status(503).json({ error: error.message }))
  return false
}

export function compareAudits(before, after) {
  const previous = new Map(before.checks.map((item) => [item.id, item]))
  const rank = { fail: 0, warn: 1, info: 2, pass: 3 }
  const changes = []
  for (const item of after.checks) {
    const old = previous.get(item.id)
    previous.delete(item.id)
    if (!old) changes.push({ id: item.id, label: item.label, category: item.category, from: null, to: item.status, direction: 'new' })
    else if (old.status !== item.status) changes.push({ id: item.id, label: item.label, category: item.category, from: old.status, to: item.status, direction: rank[item.status] > rank[old.status] ? 'improved' : 'regressed', detail: item.detail || '' })
  }
  for (const old of previous.values()) changes.push({ id: old.id, label: old.label, category: old.category, from: old.status, to: null, direction: 'removed' })
  const order = { regressed: 0, improved: 1, new: 2, removed: 3 }
  return {
    before: { id: before.id, url: before.url, score: before.score, counts: before.counts, createdAt: before.createdAt, rendered: before.rendered },
    after: { id: after.id, url: after.url, score: after.score, counts: after.counts, createdAt: after.createdAt, rendered: after.rendered },
    scoreChange: after.score - before.score,
    improved: changes.filter((item) => item.direction === 'improved').length,
    regressed: changes.filter((item) => item.direction === 'regressed').length,
    unchanged: after.checks.length - changes.filter((item) => item.direction !== 'removed').length,
    changes: changes.sort((a, b) => order[a.direction] - order[b.direction]),
  }
}

export function registerSeoRoutes(app, { store, fetcher, requireAuth, gsc, tokenBox, vitals, config }) {
  const appUrl = config.appUrl
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: Boolean(config.isProduction), maxAge: 10 * 60 * 1000, path: '/' }
  const gscReady = () => Boolean(gsc?.enabled && tokenBox)

  // ---------- Search Console ----------
  async function connection(req) {
    if (!gscReady()) throw new GscError('Search Console is not configured on this server yet.', 503, 'not_configured')
    const saved = await store.getGscConnection(req.user.id)
    if (!saved) throw new GscError('Connect Google Search Console first.', 409, 'not_connected')
    try {
      return { ...saved, token: tokenBox.open(saved.refreshToken) }
    } catch {
      throw new GscError('The stored Search Console connection can no longer be read. Connect again.', 401, 'reconnect')
    }
  }
  const run = async (req, body) => {
    const link = await connection(req)
    try {
      return await body(link.token)
    } catch (error) {
      if (error instanceof GscError && error.code === 'reconnect') await store.deleteGscConnection(req.user.id).catch(() => {})
      throw error
    }
  }

  app.get('/api/gsc/status', requireAuth, async (req, res) => {
    if (!gscReady()) return res.json({ configured: false, connected: false })
    const saved = await store.getGscConnection(req.user.id).catch((error) => (error instanceof MigrationPendingError ? error : Promise.reject(error)))
    if (saved instanceof MigrationPendingError) return res.json({ configured: true, connected: false, migration: true })
    res.json({ configured: true, connected: Boolean(saved), email: saved?.email || '', connectedAt: saved?.createdAt || null, keywordLimit: req.limits.keywords })
  })

  app.get('/api/gsc/connect', requireAuth, (req, res) => {
    if (!gscReady()) return res.status(503).json({ error: 'Search Console is not configured on this server yet.', code: 'not_configured' })
    const state = crypto.randomBytes(24).toString('base64url')
    res.cookie('gsc_state', state, cookieOptions)
    res.json({ url: gsc.authUrl(state) })
  })

  app.get('/api/gsc/callback', requireAuth, async (req, res) => {
    const done = (status, reason = '') => res.redirect(`${appUrl}/?gsc=${status}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`)
    const expected = req.cookies.gsc_state
    res.clearCookie('gsc_state', { path: '/' })
    if (!gscReady()) return done('error', 'not_configured')
    if (req.query.error) return done('error', req.query.error === 'access_denied' ? 'denied' : 'oauth_failed')
    const state = String(req.query.state || '')
    if (!expected || state.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected))) return done('error', 'state')
    try {
      const { refreshToken, email } = await gsc.exchange(String(req.query.code || ''))
      await store.saveGscConnection(req.user.id, { email, refreshToken: tokenBox.seal(refreshToken) })
      done('connected')
    } catch (error) {
      if (!(error instanceof GscError) && !(error instanceof MigrationPendingError)) console.error('gsc callback', error?.message)
      done('error', error instanceof MigrationPendingError ? 'migration' : error.code || 'oauth_failed')
    }
  })

  app.delete('/api/gsc', requireAuth, async (req, res) => {
    const saved = await store.getGscConnection(req.user.id)
    if (saved && gscReady()) {
      try {
        await gsc.revoke(tokenBox.open(saved.refreshToken))
      } catch {
        // The local connection is removed even if Google cannot be reached.
      }
    }
    await store.deleteGscConnection(req.user.id)
    res.json({ ok: true })
  })

  app.get('/api/gsc/sites', requireAuth, async (req, res) => {
    res.json({ sites: await run(req, (token) => gsc.sites(token)) })
  })

  app.post('/api/gsc/performance', requireAuth, async (req, res) => {
    const parsed = gscQuerySchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Choose a Search Console property and a date range.' })
    const { siteUrl: site, days: span, country, device } = parsed.data
    const ranges = dateRanges(span)
    const groups = filterGroups({ country, device })
    const ask = (token, range, dimensions, rowLimit) => gsc.query(token, site, { ...range, dimensions, rowLimit, dimensionFilterGroups: groups })
    const data = await run(req, async (token) => {
      const [totals, previousTotals, daily, queries, previousQueries, pages, previousPages] = await Promise.all([
        ask(token, ranges.current, [], 1), ask(token, ranges.previous, [], 1), ask(token, ranges.current, ['date'], 100),
        ask(token, ranges.current, ['query'], 1000), ask(token, ranges.previous, ['query'], 1000),
        ask(token, ranges.current, ['page'], 250), ask(token, ranges.previous, ['page'], 250),
      ])
      return buildPerformance({ ranges, totals, previousTotals, daily, queries, previousQueries, pages, previousPages })
    })
    res.json({ siteUrl: site, days: span, country, device, ...data })
  })

  app.post('/api/gsc/opportunities', requireAuth, async (req, res) => {
    const parsed = gscQuerySchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Choose a Search Console property and a date range.' })
    const { siteUrl: site, days: span, country, device } = parsed.data
    const ranges = dateRanges(span)
    const rows = await run(req, (token) => gsc.query(token, site, { ...ranges.current, dimensions: ['query', 'page'], rowLimit: 5000, dimensionFilterGroups: filterGroups({ country, device }) }))
    res.json({ siteUrl: site, days: span, range: ranges.current, truncated: rows.length >= 5000, ...buildOpportunities(rows) })
  })

  app.get('/api/gsc/keywords', requireAuth, async (req, res) => {
    const parsed = siteUrl.safeParse(req.query.siteUrl)
    if (!parsed.success) return res.status(400).json({ error: 'Choose a Search Console property.' })
    res.json({ keywords: await store.listKeywords(req.user.id, parsed.data), limit: req.limits.keywords })
  })

  app.post('/api/gsc/keywords', requireAuth, async (req, res) => {
    const parsed = keywordsSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Enter at least one keyword (max 200 characters each).' })
    const existing = await store.listKeywords(req.user.id, parsed.data.siteUrl)
    const known = new Set(existing.map((item) => item.query))
    const fresh = [...new Set(parsed.data.queries.map((query) => query.toLowerCase().replace(/\s+/g, ' ')))].filter((query) => !known.has(query))
    if ((await store.countKeywords(req.user.id)) + fresh.length > req.limits.keywords) {
      return res.status(403).json({ error: `Your ${req.limits.label} plan tracks up to ${req.limits.keywords} keywords.`, upgrade: true })
    }
    if (fresh.length) await store.addKeywords(req.user.id, parsed.data.siteUrl, fresh)
    res.status(201).json({ keywords: await store.listKeywords(req.user.id, parsed.data.siteUrl), limit: req.limits.keywords })
  })

  app.delete('/api/gsc/keywords/:id', requireAuth, async (req, res) => {
    await store.deleteKeyword(req.user.id, req.params.id)
    res.json({ ok: true })
  })

  app.post('/api/gsc/keyword-trends', requireAuth, async (req, res) => {
    const parsed = gscQuerySchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Choose a Search Console property and a date range.' })
    const { siteUrl: site, days: span, country, device } = parsed.data
    const keywords = await store.listKeywords(req.user.id, site)
    const ranges = dateRanges(span)
    if (!keywords.length) return res.json({ siteUrl: site, days: span, range: ranges.current, keywords: [] })
    const rows = await run(req, async (token) => (await Promise.all(keywordRegexes(keywords.map((item) => item.query)).map((queryRegex) => (
      gsc.query(token, site, { ...ranges.current, dimensions: ['date', 'query'], rowLimit: 25000, dimensionFilterGroups: filterGroups({ country, device, queryRegex }) })
    )))).flat())
    res.json({ siteUrl: site, days: span, range: ranges.current, keywords: buildKeywordTrends(keywords, rows, ranges) })
  })

  // ---------- page comparison ----------
  app.post('/api/compare-pages', requireAuth, async (req, res) => {
    const parsed = compareSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Enter your page URL and one to three competitor URLs.' })
    const urls = [parsed.data.url, ...parsed.data.competitors].map((url) => normalizeUrl(url))
    urls.forEach((url) => assertPublicUrl(url))
    await consume(store, req.user.id, req.plan, 'audit', urls.length)
    const [own, ...competitors] = await Promise.all(urls.map((url) => profilePage(fetcher, url, parsed.data.query).catch((error) => ({ url, ok: false, error: error.message }))))
    const result = { query: parsed.data.query, own, competitors, ...comparePages(own, competitors), fetchedAt: new Date().toISOString(), method: 'Read from the raw HTML of each page as a non-rendering crawler receives it. Gaps are listed only where the counted values differ; no ranking factor weights are assumed.' }
    await store.saveRun(req.user.id, 'compare', { url: parsed.data.url, competitors: parsed.data.competitors }, { title: own.url, score: own.ok ? own.score : 0, summary: `${result.gaps.length} gap(s) against ${competitors.filter((page) => page.ok).length} page(s).` })
    res.json(result)
  })

  // ---------- Core Web Vitals ----------
  app.post('/api/vitals', requireAuth, async (req, res) => {
    const parsed = vitalsSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Enter a valid page URL.' })
    const target = assertPublicUrl(normalizeUrl(parsed.data.url))
    const strategies = parsed.data.strategy === 'both' ? ['mobile', 'desktop'] : [parsed.data.strategy]
    await consume(store, req.user.id, req.plan, 'audit', strategies.length)
    const settled = await Promise.allSettled(strategies.map((strategy) => vitals.run(target.href, strategy)))
    const results = settled.filter((entry) => entry.status === 'fulfilled').map((entry) => entry.value)
    if (!results.length) throw settled[0].reason
    const failed = settled.map((entry, index) => (entry.status === 'rejected' ? { strategy: strategies[index], error: entry.reason?.message || 'Test failed.' } : null)).filter(Boolean)
    const first = results[0]
    await store.saveRun(req.user.id, 'vitals', { url: parsed.data.url, strategy: parsed.data.strategy }, { title: target.href, score: first.lab.performanceScore ?? 0, summary: `Core Web Vitals (${first.strategy}): ${first.field.assessment}.` })
    res.json({ url: target.href, results, failed, method: 'Field data: 75th percentile of real Chrome users over the last 28 days (Chrome UX Report). Lab data: one Lighthouse run on Google\'s servers, which varies between runs. Both come from the PageSpeed Insights API.' })
  })

  // ---------- site crawl ----------
  const crawlPublic = (crawl) => crawl && ({ id: crawl.id, startUrl: crawl.startUrl, host: crawl.host, status: crawl.status, maxPages: crawl.config?.maxPages ?? null, sitemapCount: crawl.config?.sitemapCount ?? null, summary: crawl.summary, createdAt: crawl.createdAt, completedAt: crawl.completedAt })

  app.get('/api/crawls', requireAuth, async (req, res) => {
    res.json({ crawls: (await store.listCrawls(req.user.id, 20)).map(crawlPublic), maxPages: req.limits.crawlPages, monthlyPages: req.limits.crawlPagesMonthly })
  })

  app.post('/api/crawls', requireAuth, async (req, res) => {
    const parsed = crawlSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Enter a valid website URL.' })
    const start = assertPublicUrl(normalizeUrl(parsed.data.url))
    const maxPages = Math.min(parsed.data.maxPages, req.limits.crawlPages)
    await consume(store, req.user.id, req.plan, 'crawl', 0) // fails early when the monthly allowance is already used up
    const seed = await seedCrawl(fetcher, start.href, maxPages)
    if (!seed.startOk) return res.status(400).json({ error: `The start page could not be fetched (${seed.startError}).` })
    const crawl = await store.createCrawl(req.user.id, { startUrl: seed.start, host: seed.host, config: { maxPages, robotsText: seed.robotsText, sitemapCount: seed.sitemapCount } }, seed.seeds)
    res.status(201).json({ crawl: crawlPublic(crawl), queued: seed.seeds.length })
  })

  app.get('/api/crawls/:id', requireAuth, async (req, res) => {
    const crawl = await store.getCrawl(req.user.id, req.params.id)
    if (!crawl) return res.status(404).json({ error: 'Crawl not found' })
    const pages = req.query.pages === '1' ? pageRows(await store.listCrawlPages(crawl.id)) : undefined
    res.json({ crawl: crawlPublic(crawl), pages })
  })

  app.post('/api/crawls/:id/step', requireAuth, async (req, res) => {
    const crawl = await store.getCrawl(req.user.id, req.params.id)
    if (!crawl) return res.status(404).json({ error: 'Crawl not found' })
    if (crawl.status !== 'running') return res.json({ status: crawl.status, done: crawl.summary?.pagesCrawled || 0, total: crawl.summary?.pagesCrawled || 0, summary: crawl.summary })
    res.json(await processCrawlBatch({ store, fetcher, crawl, batchSize: config.crawlBatchSize || 8, reserve: (amount) => consume(store, req.user.id, req.plan, 'crawl', amount) }))
  })

  app.delete('/api/crawls/:id', requireAuth, async (req, res) => {
    await store.deleteCrawl(req.user.id, req.params.id)
    res.json({ ok: true })
  })

  // ---------- schema validation ----------
  app.post('/api/schema/validate', requireAuth, async (req, res) => {
    const parsed = schemaSchema.safeParse(req.body)
    if (!parsed.success || (!parsed.data.url && !parsed.data.code.trim())) return res.status(400).json({ error: 'Enter a page URL or paste JSON-LD.' })
    if (!parsed.data.url) return res.json({ source: 'code', ...validateBlocks(blocksFromInput(parsed.data.code)) })
    const target = assertPublicUrl(normalizeUrl(parsed.data.url))
    await consume(store, req.user.id, req.plan, 'audit', 1)
    const fetched = await fetcher(target.href, { timeoutMs: 12000 })
    if (!fetched.ok) return res.status(400).json({ error: `The page could not be fetched (${fetched.error || `HTTP ${fetched.status}`}).` })
    const blocks = jsonLdBlocksFromHtml(fetched.text)
    res.json({ source: 'url', url: fetched.url, raw: blocks.map((block) => block.trim().slice(0, 20_000)), ...validateBlocks(blocks) })
  })

  // ---------- audit history ----------
  app.get('/api/audits', requireAuth, async (req, res) => {
    const host = String(req.query.host || '').toLowerCase().replace(/^www\./, '').slice(0, 200)
    try {
      res.json({ audits: await store.listAudits(req.user.id, { host, limit: 100 }) })
    } catch (error) {
      if (error instanceof MigrationPendingError) return res.json({ audits: [], migration: true })
      throw error
    }
  })

  app.get('/api/audits/compare', requireAuth, async (req, res) => {
    const [before, after] = await Promise.all([store.getAudit(req.user.id, String(req.query.a || '')), store.getAudit(req.user.id, String(req.query.b || ''))])
    if (!before || !after) return res.status(404).json({ error: 'Audit not found' })
    const [older, newer] = before.createdAt <= after.createdAt ? [before, after] : [after, before]
    res.json(compareAudits(older, newer))
  })
}
