// Technical SEO + GEO readiness audit. Every check and the score are computed
// in code from fetched evidence, so the same page always gets the same score.
import { extractPage } from './html.js'
import { AI_BOTS, evaluateRobots, parseRobots } from './robots.js'

const PASS = 'pass'
const WARN = 'warn'
const FAIL = 'fail'
const INFO = 'info'

function check(id, label, weight, status, detail, fix = '') {
  return { id, label, weight, status, detail, fix: status === PASS || status === INFO ? '' : fix }
}

function scoreOf(checks) {
  const scored = checks.filter((item) => item.status !== INFO && item.weight > 0)
  const total = scored.reduce((sum, item) => sum + item.weight, 0)
  if (!total) return null
  const earned = scored.reduce((sum, item) => sum + item.weight * (item.status === PASS ? 1 : item.status === WARN ? 0.5 : 0), 0)
  return Math.round((earned / total) * 100)
}

function sameUrl(a, b) {
  const norm = (value) => {
    try {
      const url = new URL(value)
      return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}${url.search}`
    } catch {
      return value
    }
  }
  return norm(a) === norm(b)
}

export function pageChecks(fetched, facts) {
  const indexability = []
  const onPage = []
  const structured = []
  const content = []

  const noindex = /noindex/.test(facts.robotsMeta) || /noindex/i.test(fetched.headers?.['x-robots-tag'] || '')
  indexability.push(check('noindex', 'Page is indexable', 10, noindex ? FAIL : PASS,
    noindex ? 'A noindex directive is present (meta robots or X-Robots-Tag).' : 'No noindex directive found.',
    'Remove the noindex directive if this page should appear in search and AI answers.'))
  indexability.push(check('canonical', 'Canonical URL', 4,
    !facts.canonical ? WARN : sameUrl(facts.canonical, fetched.url) ? PASS : WARN,
    !facts.canonical ? 'No canonical link element.' : sameUrl(facts.canonical, fetched.url) ? `Self-referencing canonical: ${facts.canonical}` : `Canonical points to a different URL: ${facts.canonical}`,
    !facts.canonical ? 'Add a self-referencing <link rel="canonical">.' : 'Confirm the canonical target is intended; otherwise this page will be consolidated into it.'))
  indexability.push(check('lang', 'Language declared', 2, facts.lang ? PASS : WARN,
    facts.lang ? `html lang="${facts.lang}"` : 'The <html> element has no lang attribute.',
    'Set the lang attribute on <html> so engines can match the page to the right market.'))
  if (facts.hreflang.length) {
    const hasDefault = facts.hreflang.some((entry) => entry.lang.toLowerCase() === 'x-default')
    indexability.push(check('hreflang', 'hreflang annotations', 1, hasDefault ? PASS : WARN,
      `${facts.hreflang.length} hreflang alternates (${facts.hreflang.map((entry) => entry.lang).slice(0, 8).join(', ')}).`,
      'Add an x-default hreflang alternate.'))
  }

  const titleOk = facts.titleLength >= 15 && facts.titleLength <= 65
  onPage.push(check('title', 'Title tag', 5, !facts.title ? FAIL : titleOk ? PASS : WARN,
    facts.title ? `"${facts.title}" (${facts.titleLength} characters)` : 'No <title> element.',
    !facts.title ? 'Add a descriptive, unique <title>.' : 'Keep the title between 15 and 65 characters so it is not truncated.'))
  const descLength = facts.metaDescription.length
  onPage.push(check('meta_description', 'Meta description', 4, !descLength ? FAIL : descLength >= 50 && descLength <= 165 ? PASS : WARN,
    descLength ? `${descLength} characters.` : 'No meta description.',
    !descLength ? 'Add a meta description that states what the page answers.' : 'Aim for 50 to 165 characters.'))
  onPage.push(check('h1', 'Single H1', 4, facts.h1.length === 1 ? PASS : facts.h1.length === 0 ? FAIL : WARN,
    facts.h1.length === 1 ? `H1: "${facts.h1[0]}"` : facts.h1.length === 0 ? 'No H1 heading in the HTML.' : `${facts.h1.length} H1 headings found.`,
    facts.h1.length === 0 ? 'Add one H1 that names the page topic.' : 'Use a single H1 and demote the others to H2.'))
  let skipped = 0
  facts.headings.forEach((heading, index) => {
    if (index > 0 && heading.level - facts.headings[index - 1].level > 1) skipped += 1
  })
  onPage.push(check('heading_order', 'Heading hierarchy', 2, facts.headings.length < 2 ? WARN : skipped === 0 ? PASS : WARN,
    facts.headings.length < 2 ? `Only ${facts.headings.length} heading(s) found.` : skipped === 0 ? `${facts.headings.length} headings in a consistent order.` : `${skipped} place(s) where a heading level is skipped.`,
    facts.headings.length < 2 ? 'Break the content into sections with H2/H3 headings.' : 'Do not jump levels (for example H2 straight to H4).'))
  const altShare = facts.images ? (facts.images - facts.imagesMissingAlt) / facts.images : 1
  onPage.push(check('image_alt', 'Image alt text', 2, altShare >= 0.9 ? PASS : altShare >= 0.6 ? WARN : FAIL,
    facts.images ? `${facts.images - facts.imagesMissingAlt} of ${facts.images} images have alt text.` : 'No images on the page.',
    'Add descriptive alt text to content images.'))
  const ogOk = Boolean(facts.og.title && facts.og.description && facts.og.image)
  onPage.push(check('open_graph', 'Open Graph tags', 2, ogOk ? PASS : facts.og.title ? WARN : FAIL,
    ogOk ? 'og:title, og:description and og:image are set.' : `Missing: ${['title', 'description', 'image'].filter((key) => !facts.og[key]).map((key) => `og:${key}`).join(', ')}.`,
    'Set og:title, og:description and og:image for link previews.'))
  onPage.push(check('viewport', 'Mobile viewport', 2, facts.viewport ? PASS : FAIL,
    facts.viewport ? `viewport: ${facts.viewport}` : 'No viewport meta tag.', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.'))
  onPage.push(check('internal_links', 'Internal links', 2, facts.internalLinks >= 3 ? PASS : facts.internalLinks > 0 ? WARN : FAIL,
    `${facts.internalLinks} internal and ${facts.externalLinks} external links in the HTML.`,
    'Link to related pages so crawlers can discover and connect your content.'))

  const ld = facts.jsonLd
  structured.push(check('json_ld', 'JSON-LD structured data', 6, ld.blocks === 0 ? FAIL : ld.invalid ? WARN : PASS,
    ld.blocks === 0 ? 'No JSON-LD blocks found.' : `${ld.blocks} block(s), ${ld.invalid} with invalid JSON. Types: ${ld.types.join(', ') || 'none'}.`,
    ld.blocks === 0 ? 'Add JSON-LD describing the organization and this page.' : 'Fix the JSON syntax errors; invalid blocks are ignored by parsers.'))
  structured.push(check('entity', 'Organization entity with sameAs', 4, ld.hasOrganization && ld.sameAs.length >= 2 ? PASS : ld.hasOrganization ? WARN : FAIL,
    ld.hasOrganization ? `Organization "${ld.organizationName || 'unnamed'}" with ${ld.sameAs.length} sameAs link(s).` : 'No Organization (or similar) entity in structured data.',
    ld.hasOrganization ? 'Add sameAs links to official profiles (Wikipedia/Wikidata, LinkedIn, Crunchbase, social) so engines can reconcile the entity.' : 'Add Organization schema with name, url, logo and sameAs links.'))
  structured.push(check('content_schema', 'Page-type schema', 3, ld.contentTypes.length ? PASS : WARN,
    ld.contentTypes.length ? `Page-type schema present: ${ld.contentTypes.join(', ')}.` : 'No page-type schema (Article, Product, FAQPage, Service...).',
    'Mark up the main content with the matching schema type.'))
  structured.push(check('breadcrumb', 'Breadcrumb schema', 1, ld.hasBreadcrumb ? PASS : WARN,
    ld.hasBreadcrumb ? 'BreadcrumbList present.' : 'No BreadcrumbList.', 'Add BreadcrumbList so engines understand where the page sits.'))

  content.push(check('server_text', 'Content readable without JavaScript', 8, facts.wordCount >= 150 ? PASS : facts.wordCount >= 40 ? WARN : FAIL,
    `${facts.wordCount} words of text in the raw HTML.`,
    'Most AI crawlers do not run JavaScript. Server-render or pre-render the main content.'))
  content.push(check('depth', 'Content depth', 2, facts.mainWordCount >= 300 ? PASS : facts.mainWordCount >= 120 ? WARN : FAIL,
    `${facts.mainWordCount} words in the main content area.`, 'Cover the topic in enough depth to be quotable (300+ words for key pages).'))
  const firstOk = facts.firstParagraphWords >= 15 && facts.firstParagraphWords <= 90
  content.push(check('answer_first', 'Answer-first opening', 3, firstOk ? PASS : facts.firstParagraphWords ? WARN : FAIL,
    facts.firstParagraphWords ? `Opening paragraph has ${facts.firstParagraphWords} words.` : 'No opening paragraph found in the main content.',
    'Open with a 15 to 90 word paragraph that answers the page question directly.'))
  content.push(check('questions', 'Question-style headings or FAQ', 3, facts.questionHeadings >= 2 || facts.hasFaqHeading || ld.hasFaq ? PASS : facts.questionHeadings === 1 ? WARN : FAIL,
    `${facts.questionHeadings} question-style heading(s); FAQ section: ${facts.hasFaqHeading || ld.hasFaq ? 'yes' : 'no'}.`,
    'Phrase section headings as the questions people ask, or add an FAQ block.'))
  content.push(check('lists_tables', 'Lists or tables', 2, facts.listItems >= 3 || facts.tables > 0 ? PASS : WARN,
    `${facts.listItems} list item(s), ${facts.tables} table(s).`, 'Use lists and comparison tables; they are easy for answer engines to extract.'))
  content.push(check('freshness', 'Visible publish or update date', 2, facts.dates.length ? PASS : WARN,
    facts.dates.length ? `Dates found: ${facts.dates.slice(0, 3).join(', ')}.` : 'No machine-readable date (time element, article meta or dateModified).',
    'Expose datePublished/dateModified in markup.'))
  content.push(check('author', 'Author or publisher attribution', 2, facts.author ? PASS : WARN,
    facts.author ? `Attribution: ${facts.author}.` : 'No author or publisher attribution found.', 'Name the author or publishing organization in markup.'))

  return [
    { id: 'indexability', label: 'Indexability', checks: indexability },
    { id: 'onpage', label: 'On-page SEO', checks: onPage },
    { id: 'structured', label: 'Structured data', checks: structured },
    { id: 'content', label: 'Content extractability (GEO)', checks: content },
  ]
}

function finalize(categories) {
  const withScores = categories.map((category) => ({ ...category, score: scoreOf(category.checks) }))
  const all = withScores.flatMap((category) => category.checks)
  return { categories: withScores, score: scoreOf(all) ?? 0, all }
}

async function probeBots(fetcher, url) {
  return Promise.all(AI_BOTS.map(async (bot) => {
    if (!bot.ua) return { name: bot.name, http: null }
    const response = await fetcher(url, { headers: { 'User-Agent': bot.ua }, timeoutMs: 8000, maxBytes: 20_000 })
    return { name: bot.name, http: response.status || 'ERR' }
  }))
}

export async function auditPage(url, { fetcher }) {
  const fetched = await fetcher(url, { timeoutMs: 12000 })
  if (!fetched.ok) return { url: fetched.url, status: fetched.status, error: fetched.error || `HTTP ${fetched.status}`, score: 0, categories: [] }
  const facts = extractPage(fetched.text, fetched.url)
  const { categories, score } = finalize(pageChecks(fetched, facts))
  return { url: fetched.url, status: fetched.status, score, categories, title: facts.title, wordCount: facts.wordCount }
}

export async function runAudit(inputUrl, { fetcher, extraPages = 0 } = {}) {
  const fetched = await fetcher(inputUrl, { timeoutMs: 12000 })
  const origin = new URL(fetched.url).origin
  const path = new URL(fetched.url).pathname || '/'

  const [robotsRes, llmsRes, botHttp] = await Promise.all([
    fetcher(`${origin}/robots.txt`, { timeoutMs: 8000, maxBytes: 300_000 }),
    fetcher(`${origin}/llms.txt`, { timeoutMs: 8000, maxBytes: 100_000 }),
    probeBots(fetcher, fetched.url),
  ])
  const robotsFound = robotsRes.ok && !/<html/i.test(robotsRes.text.slice(0, 500))
  const robots = parseRobots(robotsFound ? robotsRes.text : '')
  const sitemapUrl = robots.sitemaps[0] || `${origin}/sitemap.xml`
  const sitemapRes = await fetcher(sitemapUrl, { timeoutMs: 8000, maxBytes: 2_000_000 })
  const sitemapLocs = sitemapRes.ok ? [...sitemapRes.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((match) => match[1].replace(/&amp;/g, '&')) : []
  const sitemapFound = sitemapRes.ok && sitemapLocs.length > 0
  const llmsFound = llmsRes.ok && /text\/(plain|markdown)/i.test(llmsRes.contentType) && llmsRes.text.trim().length > 0

  const bots = AI_BOTS.map((bot) => {
    const verdict = evaluateRobots(robots, bot.name, path)
    const http = botHttp.find((entry) => entry.name === bot.name)?.http ?? null
    return { name: bot.name, operator: bot.operator, purpose: bot.purpose, robots: verdict.allowed ? 'allowed' : 'disallowed', rule: verdict.rule, matched: verdict.matched, http }
  })

  const access = []
  access.push(check('http', 'Page responds with 200', 10, fetched.ok ? PASS : FAIL,
    fetched.ok ? `HTTP ${fetched.status} in ${fetched.ms} ms.` : `Request failed: ${fetched.error || `HTTP ${fetched.status}`}.`,
    'The page must return HTTP 200 to crawlers.'))
  access.push(check('https', 'Served over HTTPS', 4, fetched.url.startsWith('https://') ? PASS : FAIL, `Final URL: ${fetched.url}`, 'Serve the site over HTTPS and redirect HTTP to it.'))
  access.push(check('redirects', 'Redirect chain', 2, fetched.redirects.length <= 1 ? PASS : WARN,
    fetched.redirects.length ? `${fetched.redirects.length} redirect(s): ${fetched.redirects.map((hop) => hop.status).join(' -> ')}.` : 'No redirects.',
    'Link directly to the final URL; long chains waste crawl budget.'))
  access.push(check('robots_txt', 'robots.txt present', 3, robotsFound ? PASS : WARN,
    robotsFound ? `${robots.groups.length} user-agent group(s), ${robots.sitemaps.length} sitemap reference(s).` : 'No valid robots.txt at the site root.',
    'Publish a robots.txt that states crawler rules and references the sitemap.'))
  const retrieval = bots.filter((bot) => bot.purpose !== 'training')
  const blockedRetrieval = retrieval.filter((bot) => bot.robots === 'disallowed')
  access.push(check('ai_search_bots', 'Search and AI answer crawlers allowed in robots.txt', 10, blockedRetrieval.length === 0 ? PASS : FAIL,
    blockedRetrieval.length === 0 ? `All ${retrieval.length} search/answer crawlers may fetch this URL.` : `Disallowed: ${blockedRetrieval.map((bot) => bot.name).join(', ')}.`,
    'Allow search and answer crawlers (OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot, Googlebot, Bingbot) if you want to be cited.'))
  const httpBlocked = retrieval.filter((bot) => bot.http !== null && bot.http !== 200)
  access.push(check('bot_http', 'Crawlers are not blocked at the server', 6, httpBlocked.length === 0 ? PASS : httpBlocked.length <= 2 ? WARN : FAIL,
    httpBlocked.length === 0 ? 'Requests with search/answer crawler user-agents returned HTTP 200.' : `Non-200 responses: ${httpBlocked.map((bot) => `${bot.name} (${bot.http})`).join(', ')}.`,
    'Check firewall, CDN and bot-protection rules; they are blocking crawler user-agents. Note: this test spoofs the user-agent from a non-crawler IP, so verify against server logs.'))
  const blockedTraining = bots.filter((bot) => bot.purpose === 'training' && bot.robots === 'disallowed')
  access.push(check('ai_training_bots', 'Model-training crawlers', 0, INFO,
    blockedTraining.length ? `Opted out of training crawlers: ${blockedTraining.map((bot) => bot.name).join(', ')}.` : 'Training crawlers (GPTBot, ClaudeBot, Google-Extended, CCBot...) are allowed.'))
  access.push(check('sitemap', 'XML sitemap', 4, sitemapFound ? PASS : FAIL,
    sitemapFound ? `${sitemapLocs.length} URL(s) in ${sitemapUrl}.` : `No sitemap found at ${sitemapUrl}.`, 'Publish an XML sitemap and reference it from robots.txt.'))
  access.push(check('llms_txt', 'llms.txt', 1, llmsFound ? PASS : WARN,
    llmsFound ? 'llms.txt is published.' : 'No llms.txt at the site root (an emerging, optional convention).', 'Optionally publish /llms.txt with a short map of your key pages.'))

  const performance = []
  performance.push(check('ttfb', 'Server response time', 3, !fetched.ok ? FAIL : fetched.ms < 1200 ? PASS : fetched.ms < 3000 ? WARN : FAIL,
    `${fetched.ms} ms to fetch the HTML (including redirects).`, 'Slow responses reduce crawl coverage and can time out answer-engine fetchers.'))
  performance.push(check('html_size', 'HTML size', 1, fetched.bytes < 500_000 ? PASS : WARN, `${Math.round(fetched.bytes / 1024)} KB of HTML.`, 'Trim inline scripts and markup; some fetchers truncate large documents.'))

  const facts = fetched.ok ? extractPage(fetched.text, fetched.url) : null
  const pageCategories = facts ? pageChecks(fetched, facts) : []
  const { categories, score, all } = finalize([
    { id: 'access', label: 'Crawlability and AI access', checks: access },
    ...pageCategories,
    { id: 'performance', label: 'Performance', checks: performance },
  ])

  let pages = []
  if (extraPages > 0 && sitemapFound) {
    const candidates = sitemapLocs.filter((loc) => !/\.xml(\?|$)/i.test(loc) && !sameUrl(loc, fetched.url)).slice(0, extraPages)
    pages = await Promise.all(candidates.map((loc) => auditPage(loc, { fetcher }).catch((error) => ({ url: loc, error: error.message, score: 0, categories: [] }))))
  }

  const failed = all.filter((item) => item.status === FAIL).sort((a, b) => b.weight - a.weight)
  const warned = all.filter((item) => item.status === WARN).sort((a, b) => b.weight - a.weight)
  const topFixes = [...failed, ...warned].slice(0, 8).map((item) => ({ label: item.label, status: item.status, fix: item.fix, detail: item.detail }))
  const counts = { pass: all.filter((item) => item.status === PASS).length, warn: warned.length, fail: failed.length }

  return {
    url: fetched.url,
    requestedUrl: inputUrl,
    fetchedAt: new Date().toISOString(),
    status: fetched.status,
    score,
    counts,
    summary: `${counts.pass} checks passed, ${counts.warn} need attention and ${counts.fail} failed.`,
    categories,
    topFixes,
    bots,
    robotsTxt: { found: robotsFound, groups: robots.groups.length, sitemaps: robots.sitemaps },
    sitemap: { found: sitemapFound, url: sitemapUrl, urls: sitemapLocs.length },
    llmsTxt: { found: llmsFound },
    page: facts ? {
      title: facts.title, metaDescription: facts.metaDescription, canonical: facts.canonical, lang: facts.lang, h1: facts.h1,
      wordCount: facts.wordCount, schemaTypes: facts.jsonLd.types, sameAs: facts.jsonLd.sameAs, headings: facts.headings.slice(0, 30),
    } : null,
    pages,
    method: 'Deterministic checks on the raw HTML, robots.txt, sitemap and live crawler user-agent requests. No AI model is involved in the score.',
  }
}
