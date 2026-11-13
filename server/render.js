// JavaScript-rendered audit: loads the page in headless Chromium and compares
// the rendered DOM with the raw HTML a non-rendering crawler receives.
import dns from 'node:dns/promises'
import { extractPage } from './html.js'
import { BlockedUrlError, assertPublicUrl, isBlockedIp } from './net.js'

const RENDER_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 GEOOptimizerAI/2.0'

export class RenderUnavailableError extends Error {
  constructor(message = 'JavaScript rendering is not available on this server right now.') {
    super(message)
    this.name = 'RenderUnavailableError'
  }
}

// Serverless: the Chromium build from @sparticuz/chromium. Elsewhere: Playwright's own browser.
async function defaultLaunch() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const [{ default: chromium }, { chromium: playwright }] = await Promise.all([import('@sparticuz/chromium'), import('playwright-core')])
    return playwright.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true })
  }
  const { chromium: playwright } = await import('playwright')
  return playwright.launch({ headless: true })
}

// Every request the page makes is checked, so a public page cannot make the browser reach private addresses.
function createHostGuard(lookup = dns.lookup) {
  const cache = new Map()
  return async function assertPublicHost(url) {
    const target = assertPublicUrl(url)
    if (cache.has(target.hostname)) {
      if (!cache.get(target.hostname)) throw new BlockedUrlError('Blocked address')
      return
    }
    const ok = await lookup(target.hostname, { all: true })
      .then((addresses) => addresses.length > 0 && addresses.every((entry) => !isBlockedIp(entry.address)))
      .catch(() => false)
    cache.set(target.hostname, ok)
    if (!ok) throw new BlockedUrlError('Blocked address')
  }
}

export function createRenderer({ launch = defaultLaunch, lookup } = {}) {
  return {
    async render(url, { timeoutMs = 20000 } = {}) {
      const assertPublicHost = createHostGuard(lookup)
      await assertPublicHost(url)
      let browser
      try {
        browser = await launch()
      } catch (error) {
        console.error('render launch', error?.message)
        throw new RenderUnavailableError()
      }
      const started = Date.now()
      const info = { requests: 0, failedRequests: [], blockedRequests: 0, consoleErrors: [] }
      try {
        const context = await browser.newContext({ userAgent: RENDER_UA, viewport: { width: 412, height: 915 }, serviceWorkers: 'block', bypassCSP: false })
        const page = await context.newPage()
        await page.route('**/*', async (route) => {
          const request = route.request()
          const target = request.url()
          if (/^(data|blob|about):/i.test(target)) return route.continue()
          try {
            await assertPublicHost(target)
          } catch {
            info.blockedRequests += 1
            return route.abort('blockedbyclient')
          }
          if (['image', 'media', 'font'].includes(request.resourceType())) return route.abort()
          info.requests += 1
          return route.continue()
        })
        page.on('console', (message) => {
          if (message.type() === 'error' && info.consoleErrors.length < 8) info.consoleErrors.push(message.text().slice(0, 200))
        })
        page.on('pageerror', (error) => {
          if (info.consoleErrors.length < 8) info.consoleErrors.push(String(error.message).slice(0, 200))
        })
        page.on('requestfailed', (request) => {
          const reason = request.failure()?.errorText || ''
          if (!/ERR_ABORTED|ERR_BLOCKED_BY_CLIENT|ERR_FAILED/i.test(reason) && info.failedRequests.length < 8) info.failedRequests.push(`${request.url().slice(0, 140)} (${reason})`)
        })
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
        await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {})
        const html = await page.content()
        return { ok: true, status: response?.status() || 0, url: page.url(), html, ms: Date.now() - started, ...info }
      } catch (error) {
        return { ok: false, status: 0, url, html: '', ms: Date.now() - started, error: /Timeout/i.test(error?.message || '') ? 'The page did not finish loading in the browser in time.' : 'The page could not be loaded in the browser.', ...info }
      } finally {
        await browser.close().catch(() => {})
      }
    },
  }
}

const check = (id, label, weight, status, detail, fix = '') => ({ id, label, weight, status, detail, fix: status === 'pass' || status === 'info' ? '' : fix })
const same = (a, b) => String(a || '').trim() === String(b || '').trim()

// Compares what a non-rendering crawler gets (raw) with the DOM after JavaScript ran (rendered).
export function compareRender(rawFacts, rendered) {
  const after = extractPage(rendered.html, rendered.url)
  const checks = []
  const share = after.wordCount ? Math.round((Math.min(rawFacts.wordCount, after.wordCount) / after.wordCount) * 100) : 100
  checks.push(check('js_content', 'Content available without JavaScript', 10, share >= 80 ? 'pass' : share >= 50 ? 'warn' : 'fail',
    `${rawFacts.wordCount} words in the raw HTML, ${after.wordCount} after rendering: ${share}% of the rendered text is in the raw HTML.`,
    'Server-render or pre-render the main content. Crawlers that do not run JavaScript only receive the raw HTML.'))
  checks.push(check('js_title', 'Title is the same before and after rendering', 3, same(rawFacts.title, after.title) ? 'pass' : rawFacts.title ? 'warn' : 'fail',
    same(rawFacts.title, after.title) ? `"${after.title.slice(0, 120)}"` : `Raw: "${rawFacts.title.slice(0, 100) || 'none'}". Rendered: "${after.title.slice(0, 100) || 'none'}".`,
    'Put the final title in the server response instead of setting it with JavaScript.'))
  checks.push(check('js_description', 'Meta description is in the raw HTML', 2, same(rawFacts.metaDescription, after.metaDescription) ? 'pass' : 'warn',
    same(rawFacts.metaDescription, after.metaDescription) ? (after.metaDescription ? 'Identical before and after rendering.' : 'No meta description in either version.') : `Raw: ${rawFacts.metaDescription ? 'present' : 'missing'}. Rendered: ${after.metaDescription ? 'present' : 'missing'}; the text differs.`,
    'Output the meta description on the server.'))
  const rawNoindex = /noindex/.test(rawFacts.robotsMeta)
  const afterNoindex = /noindex/.test(after.robotsMeta)
  checks.push(check('js_robots', 'Indexing directives do not change with JavaScript', 6, rawNoindex === afterNoindex ? 'pass' : 'fail',
    rawNoindex === afterNoindex ? `Meta robots is "${after.robotsMeta || 'not set'}" in both versions.` : `Raw HTML: ${rawNoindex ? 'noindex' : 'indexable'}. After rendering: ${afterNoindex ? 'noindex' : 'indexable'}.`,
    'Set meta robots on the server. Conflicting directives are resolved unpredictably.'))
  checks.push(check('js_canonical', 'Canonical does not change with JavaScript', 4, same(rawFacts.canonical, after.canonical) ? 'pass' : 'warn',
    same(rawFacts.canonical, after.canonical) ? (after.canonical || 'No canonical in either version.') : `Raw: ${rawFacts.canonical || 'none'}. Rendered: ${after.canonical || 'none'}.`,
    'Output one canonical URL in the server response.'))
  const h1Same = same(rawFacts.h1[0], after.h1[0])
  checks.push(check('js_h1', 'Main heading is in the raw HTML', 3, h1Same ? 'pass' : rawFacts.h1.length ? 'warn' : 'fail',
    h1Same ? (after.h1[0] ? `"${after.h1[0].slice(0, 120)}"` : 'No H1 in either version.') : `Raw: "${(rawFacts.h1[0] || 'none').slice(0, 100)}". Rendered: "${(after.h1[0] || 'none').slice(0, 100)}".`,
    'Render the H1 on the server.'))
  const linkShare = after.internalLinks ? Math.round((Math.min(rawFacts.internalLinks, after.internalLinks) / after.internalLinks) * 100) : 100
  checks.push(check('js_links', 'Internal links are in the raw HTML', 4, linkShare >= 80 ? 'pass' : linkShare >= 40 ? 'warn' : 'fail',
    `${rawFacts.internalLinks} internal links in the raw HTML, ${after.internalLinks} after rendering.`,
    'Use real <a href> links in the server response so crawlers can discover pages without running JavaScript.'))
  const addedTypes = after.jsonLd.types.filter((type) => !rawFacts.jsonLd.types.includes(type))
  checks.push(check('js_schema', 'Structured data is in the raw HTML', 4, addedTypes.length ? 'warn' : 'pass',
    addedTypes.length ? `Only present after rendering: ${addedTypes.join(', ')}.` : after.jsonLd.types.length ? `All ${after.jsonLd.types.length} JSON-LD type(s) are in the raw HTML.` : 'No JSON-LD in either version.',
    'Inject JSON-LD on the server; markup added by JavaScript is invisible to crawlers that do not render.'))
  checks.push(check('js_errors', 'JavaScript runs without errors', 2, rendered.consoleErrors.length ? 'warn' : 'pass',
    rendered.consoleErrors.length ? `${rendered.consoleErrors.length} error(s): ${rendered.consoleErrors.slice(0, 3).join(' | ')}` : 'No console errors while loading.',
    'Fix script errors; a failed script can leave the page partly rendered for crawlers that do run JavaScript.'))
  checks.push(check('js_requests', 'Render cost', 0, 'info', `${rendered.requests} script, style and data requests, ${rendered.ms} ms to render in headless Chromium (images and fonts skipped).${rendered.failedRequests.length ? ` Failed: ${rendered.failedRequests.slice(0, 3).join('; ')}.` : ''}`))

  const scored = checks.filter((item) => item.weight > 0)
  const total = scored.reduce((sum, item) => sum + item.weight, 0)
  const earned = scored.reduce((sum, item) => sum + item.weight * (item.status === 'pass' ? 1 : item.status === 'warn' ? 0.5 : 0), 0)
  return {
    ok: true,
    score: Math.round((earned / total) * 100),
    contentShare: share,
    raw: { words: rawFacts.wordCount, internalLinks: rawFacts.internalLinks, headings: rawFacts.headings.length, schemaTypes: rawFacts.jsonLd.types },
    rendered: { words: after.wordCount, internalLinks: after.internalLinks, headings: after.headings.length, schemaTypes: after.jsonLd.types, url: rendered.url, status: rendered.status, ms: rendered.ms },
    category: { id: 'javascript', label: 'JavaScript rendering', checks, score: Math.round((earned / total) * 100) },
    method: 'The page was loaded in headless Chromium with a mobile viewport and compared with the raw HTML response. Images and fonts are not downloaded.',
  }
}
