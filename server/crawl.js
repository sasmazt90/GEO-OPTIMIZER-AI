// Full-site crawl. A crawl is a queue of URLs stored in the database and
// processed in small batches (POST /api/crawls/:id/step) so it fits serverless
// time limits. Every figure in the summary is counted from the fetched pages.
import * as cheerio from 'cheerio'
import { pageChecks } from './audit.js'
import { extractPage } from './html.js'
import { evaluateRobots, parseRobots } from './robots.js'

const SKIP_EXTENSIONS = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|rss|atom|zip|gz|rar|7z|mp3|mp4|mov|avi|webm|woff2?|ttf|eot|docx?|xlsx?|pptx?|csv|txt|exe|dmg|apk)$/i
const TRACKING_PARAMS = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_cid|mc_eid|_ga|ref|srsltid)$/i
const CRAWLER_NAME = 'GEOOptimizerAI'
const bareHost = (host) => host.toLowerCase().replace(/^www\./, '')

export function normalizeCrawlUrl(value, base) {
  let url
  try {
    url = new URL(value, base)
  } catch {
    return null
  }
  if (!/^https?:$/.test(url.protocol)) return null
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key)
  url.searchParams.sort()
  if (SKIP_EXTENSIONS.test(url.pathname)) return null
  return url.href
}

export function extractLinks(html, pageUrl) {
  const $ = cheerio.load(String(html || ''))
  const host = bareHost(new URL(pageUrl).hostname)
  const internal = new Set()
  let external = 0
  let nofollow = 0
  $('a[href]').each((_, element) => {
    const href = ($(element).attr('href') || '').trim()
    if (!href || /^(#|mailto:|tel:|javascript:|data:)/i.test(href)) return
    const normalized = normalizeCrawlUrl(href, pageUrl)
    if (!normalized) return
    if (bareHost(new URL(normalized).hostname) !== host) return void (external += 1)
    if (/\bnofollow\b/i.test($(element).attr('rel') || '')) nofollow += 1
    internal.add(normalized)
  })
  return { internal: [...internal], external, nofollow }
}

// Compact per-page record kept in the database.
export function pageRecord(fetched, depth) {
  const base = { url: fetched.url, http: fetched.status, ms: fetched.ms, bytes: fetched.bytes, depth, redirectedFrom: fetched.redirects?.[0]?.from || '', redirects: fetched.redirects?.length || 0 }
  if (!fetched.ok) return { ...base, ok: false, error: fetched.error || `HTTP ${fetched.status}`, links: [] }
  if (!/html/i.test(fetched.contentType || 'text/html')) return { ...base, ok: true, html: false, links: [] }
  const facts = extractPage(fetched.text, fetched.url)
  const checks = pageChecks(fetched, facts).flatMap((category) => category.checks)
  const scored = checks.filter((item) => item.status !== 'info' && item.weight > 0)
  const total = scored.reduce((sum, item) => sum + item.weight, 0)
  const earned = scored.reduce((sum, item) => sum + item.weight * (item.status === 'pass' ? 1 : item.status === 'warn' ? 0.5 : 0), 0)
  const links = extractLinks(fetched.text, fetched.url)
  return {
    ...base, ok: true, html: true,
    title: facts.title.slice(0, 200), description: facts.metaDescription.slice(0, 320), h1: (facts.h1[0] || '').slice(0, 200), h1Count: facts.h1.length,
    canonical: facts.canonical, noindex: /noindex/.test(facts.robotsMeta) || /noindex/i.test(fetched.headers?.['x-robots-tag'] || ''),
    words: facts.wordCount, schemaTypes: facts.jsonLd.types.slice(0, 12), imagesMissingAlt: facts.imagesMissingAlt,
    score: total ? Math.round((earned / total) * 100) : 0,
    failed: checks.filter((item) => item.status === 'fail').map((item) => item.id),
    warned: checks.filter((item) => item.status === 'warn').map((item) => item.id),
    labels: Object.fromEntries(checks.filter((item) => item.status === 'fail' || item.status === 'warn').map((item) => [item.id, item.label])),
    links: links.internal.slice(0, 400), internalLinks: links.internal.length, externalLinks: links.external,
  }
}

// Reads robots.txt and the sitemap, and returns the URLs the crawl starts from.
export async function seedCrawl(fetcher, startUrl, maxPages) {
  const first = await fetcher(startUrl, { timeoutMs: 12000 })
  const start = normalizeCrawlUrl(first.url) || first.url
  const origin = new URL(start).origin
  const host = bareHost(new URL(start).hostname)
  const robotsRes = await fetcher(`${origin}/robots.txt`, { timeoutMs: 8000, maxBytes: 300_000 })
  const robotsText = robotsRes.ok && !/<html/i.test(robotsRes.text.slice(0, 500)) ? robotsRes.text.slice(0, 60_000) : ''
  const robots = parseRobots(robotsText)
  const sitemapUrls = new Set()
  const queue = [...(robots.sitemaps.length ? robots.sitemaps : [`${origin}/sitemap.xml`])].slice(0, 3)
  // Follows sitemap index files one level deep, up to five sitemap files in total.
  for (let fetched = 0; queue.length && fetched < 5 && sitemapUrls.size < maxPages * 4; fetched += 1) {
    const response = await fetcher(queue.shift(), { timeoutMs: 8000, maxBytes: 3_000_000 }).catch(() => null)
    if (!response?.ok) continue
    const locs = [...response.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((match) => match[1].replace(/&amp;/g, '&'))
    for (const loc of locs) {
      if (/\.xml(\.gz)?(\?|$)/i.test(loc)) {
        if (/<sitemapindex/i.test(response.text) && queue.length < 8) queue.push(loc)
        continue
      }
      const normalized = normalizeCrawlUrl(loc)
      if (normalized && bareHost(new URL(normalized).hostname) === host) sitemapUrls.add(normalized)
    }
  }
  const seeds = [{ url: start, depth: 0, source: 'start' }]
  for (const url of sitemapUrls) {
    if (seeds.length >= maxPages) break
    if (url !== start) seeds.push({ url, depth: 1, source: 'sitemap' })
  }
  return { start, host, robotsText, sitemapCount: sitemapUrls.size, seeds, startOk: first.ok, startError: first.ok ? '' : first.error || `HTTP ${first.status}` }
}

export const allowedByRobots = (robots, url) => evaluateRobots(robots, CRAWLER_NAME, new URL(url).pathname + new URL(url).search).allowed

function duplicates(pages, key) {
  const groups = new Map()
  for (const page of pages) {
    const value = (page[key] || '').trim().toLowerCase()
    if (value) groups.set(value, [...(groups.get(value) || []), page.url])
  }
  return [...groups].filter(([, urls]) => urls.length > 1).map(([value, urls]) => ({ value, count: urls.length, urls: urls.slice(0, 5) })).sort((a, b) => b.count - a.count).slice(0, 25)
}

// rows: [{ url, depth, source, status, foundOn, linked, result }]
export function summarizeCrawl(rows, { sitemapCount = 0, maxPages = 0, stopped = '' } = {}) {
  const done = rows.filter((row) => row.status === 'done' && row.result)
  const pages = done.map((row) => ({ ...row.result, requestedUrl: row.url, source: row.source, foundOn: row.foundOn || '', linked: Boolean(row.linked) }))
  const html = pages.filter((page) => page.ok && page.html)
  const broken = pages.filter((page) => !page.ok)
  const issues = new Map()
  for (const page of html) {
    for (const [ids, status] of [[page.failed, 'fail'], [page.warned, 'warn']]) {
      for (const id of ids || []) {
        const entry = issues.get(id) || { id, label: page.labels?.[id] || id, status, pages: 0, examples: [] }
        if (status === 'fail') entry.status = 'fail'
        entry.pages += 1
        if (entry.examples.length < 5) entry.examples.push(page.url)
        issues.set(id, entry)
      }
    }
  }
  const crawledUrls = new Set(pages.map((page) => page.requestedUrl))
  // A sitemap URL is an orphan when no crawled page linked to it.
  const orphans = html.filter((page) => page.source === 'sitemap' && !page.linked).map((page) => page.url)
  const average = (values) => (values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0)
  const depths = new Map()
  for (const page of pages) depths.set(page.depth, (depths.get(page.depth) || 0) + 1)

  return {
    pagesCrawled: pages.length,
    htmlPages: html.length,
    pending: rows.filter((row) => row.status === 'pending' || row.status === 'running').length,
    skipped: rows.filter((row) => row.status === 'skipped').length,
    score: average(html.map((page) => page.score)),
    statusCodes: [...pages.reduce((map, page) => map.set(page.http || 0, (map.get(page.http || 0) || 0) + 1), new Map())].map(([code, count]) => ({ code: code || 'no response', count })).sort((a, b) => b.count - a.count),
    broken: broken.slice(0, 50).map((page) => ({ url: page.requestedUrl, http: page.http || 0, error: page.error, linkedFrom: page.foundOn || (page.source === 'sitemap' ? 'XML sitemap' : '') })),
    brokenCount: broken.length,
    redirected: pages.filter((page) => page.redirects > 0).slice(0, 50).map((page) => ({ from: page.requestedUrl, to: page.url, hops: page.redirects })),
    redirectedCount: pages.filter((page) => page.redirects > 0).length,
    noindex: html.filter((page) => page.noindex).map((page) => page.url).slice(0, 50),
    noindexCount: html.filter((page) => page.noindex).length,
    canonicalised: html.filter((page) => page.canonical && normalizeCrawlUrl(page.canonical) !== normalizeCrawlUrl(page.url)).slice(0, 50).map((page) => ({ url: page.url, canonical: page.canonical })),
    issues: [...issues.values()].sort((a, b) => (a.status === b.status ? b.pages - a.pages : a.status === 'fail' ? -1 : 1)),
    duplicateTitles: duplicates(html, 'title'),
    duplicateDescriptions: duplicates(html, 'description'),
    thin: html.filter((page) => page.words < 200 && !page.noindex).sort((a, b) => a.words - b.words).slice(0, 30).map((page) => ({ url: page.url, words: page.words })),
    thinCount: html.filter((page) => page.words < 200 && !page.noindex).length,
    slow: [...pages].filter((page) => page.ok && page.ms >= 1200).sort((a, b) => b.ms - a.ms).slice(0, 20).map((page) => ({ url: page.url, ms: page.ms })),
    orphans: orphans.slice(0, 50),
    orphanCount: orphans.length,
    depth: [...depths].sort((a, b) => a[0] - b[0]).map(([depth, count]) => ({ depth, count })),
    avgMs: average(pages.filter((page) => page.ok).map((page) => page.ms)),
    sitemap: { urls: sitemapCount, crawled: pages.filter((page) => page.source === 'sitemap').length },
    notInSitemap: sitemapCount ? html.filter((page) => page.source === 'link' && !page.noindex).length : 0,
    lowest: [...html].sort((a, b) => a.score - b.score).slice(0, 20).map((page) => ({ url: page.url, score: page.score, title: page.title, topIssue: page.labels?.[page.failed?.[0]] || page.labels?.[page.warned?.[0]] || '' })),
    limitReached: maxPages > 0 && crawledUrls.size >= maxPages,
    stopped,
    method: 'Counted from pages fetched without JavaScript, starting at the given URL and the XML sitemap and following internal links. robots.txt rules for all crawlers are respected. Each page is scored with the same rule-based on-page checks as the site audit.',
  }
}

export function pageRows(rows) {
  return rows.filter((row) => row.status === 'done' && row.result).map((row) => {
    const page = row.result
    return { url: page.url, requestedUrl: row.url, http: page.http, score: page.score ?? null, title: page.title || '', description: page.description || '', h1: page.h1 || '', words: page.words ?? null, depth: page.depth, ms: page.ms, noindex: Boolean(page.noindex), canonical: page.canonical || '', source: row.source, issues: [...(page.failed || []), ...(page.warned || [])].map((id) => page.labels?.[id] || id), error: page.error || '' }
  })
}

// Processes one batch. Returns { status, done, total, summary? }.
export async function processCrawlBatch({ store, fetcher, crawl, batchSize = 8, reserve }) {
  const maxPages = crawl.config.maxPages
  const robots = parseRobots(crawl.config.robotsText || '')
  const batch = await store.claimCrawlPages(crawl.id, batchSize)
  let stopped = ''
  if (batch.length) {
    try {
      await reserve(batch.length)
    } catch (error) {
      stopped = error.message
      await store.skipCrawlPages(crawl.id)
    }
  }
  if (batch.length && !stopped) {
    const discovered = new Map()
    await Promise.all(batch.map(async (row) => {
      if (!allowedByRobots(robots, row.url)) {
        return store.updateCrawlPage(row.id, { status: 'done', result: { url: row.url, http: 0, ok: false, error: 'Blocked by robots.txt', depth: row.depth, ms: 0, bytes: 0, redirects: 0 } })
      }
      let result
      try {
        result = pageRecord(await fetcher(row.url, { timeoutMs: 9000, maxBytes: 1_200_000 }), row.depth)
      } catch (error) {
        result = { url: row.url, http: 0, ok: false, error: error.message, depth: row.depth, ms: 0, bytes: 0, redirects: 0, links: [] }
      }
      const { links = [], ...stored } = result
      for (const link of links) if (!discovered.has(link) && bareHost(new URL(link).hostname) === crawl.host) discovered.set(link, { url: link, depth: row.depth + 1, foundOn: result.url })
      await store.updateCrawlPage(row.id, { status: 'done', result: stored })
    }))
    if (discovered.size) await store.discoverCrawlPages(crawl.id, crawl.userId, [...discovered.values()], maxPages)
  }
  const [total, pending] = await Promise.all([store.countCrawlPages(crawl.id), store.countCrawlPages(crawl.id, ['pending', 'running'])])
  if (pending > 0 && !stopped) return { status: 'running', done: total - pending, total }
  const summary = summarizeCrawl(await store.listCrawlPages(crawl.id), { sitemapCount: crawl.config.sitemapCount, maxPages, stopped })
  await store.updateCrawl(crawl.id, { status: 'completed', summary, completedAt: new Date().toISOString() })
  return { status: 'completed', done: summary.pagesCrawled, total, summary }
}
