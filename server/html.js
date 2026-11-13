// Deterministic extraction of page facts from raw HTML (what a crawler that
// does not execute JavaScript receives).
import * as cheerio from 'cheerio'

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function countWords(text) {
  return text ? text.split(/\s+/).filter(Boolean).length : 0
}

function collectTypes(node, types, entities) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectTypes(item, types, entities))
    return
  }
  if (!node || typeof node !== 'object') return
  const nodeTypes = [].concat(node['@type'] || []).map(String)
  nodeTypes.forEach((type) => types.add(type))
  if (nodeTypes.length) entities.push({ types: nodeTypes, node })
  Object.values(node).forEach((value) => {
    if (value && typeof value === 'object') collectTypes(value, types, entities)
  })
}

export function extractJsonLd($) {
  const types = new Set()
  const entities = []
  let blocks = 0
  let invalid = 0
  $('script[type="application/ld+json"]').each((_, element) => {
    blocks += 1
    const raw = $(element).contents().text().trim()
    try {
      collectTypes(JSON.parse(raw), types, entities)
    } catch {
      invalid += 1
    }
  })
  const pick = (...names) => entities.filter((entity) => entity.types.some((type) => names.includes(type)))
  const organizations = pick('Organization', 'Corporation', 'LocalBusiness', 'Brand', 'OnlineBusiness', 'Person', 'MedicalOrganization', 'NGO', 'EducationalOrganization')
  const sameAs = [...new Set(organizations.flatMap((entity) => [].concat(entity.node.sameAs || [])).map(String))]
  const dated = entities.map((entity) => entity.node.dateModified || entity.node.datePublished).filter(Boolean).map(String)
  const authored = entities.some((entity) => entity.node.author || entity.node.publisher)
  return {
    blocks,
    invalid,
    types: [...types].sort(),
    hasOrganization: organizations.length > 0,
    organizationName: clean(organizations[0]?.node?.name),
    sameAs,
    hasWebSite: types.has('WebSite'),
    hasFaq: types.has('FAQPage'),
    hasBreadcrumb: types.has('BreadcrumbList'),
    contentTypes: ['Article', 'NewsArticle', 'BlogPosting', 'TechArticle', 'Product', 'Service', 'SoftwareApplication', 'FAQPage', 'HowTo', 'WebPage', 'AboutPage', 'CollectionPage', 'ItemList', 'Event', 'Course', 'Recipe', 'MedicalWebPage']
      .filter((type) => types.has(type)),
    dates: dated,
    hasAuthor: authored,
  }
}

export function extractPage(html, pageUrl) {
  const source = String(html || '')
  const $ = cheerio.load(source)
  const jsonLd = extractJsonLd($)
  let base
  try {
    base = new URL(pageUrl)
  } catch {
    base = null
  }

  const meta = (selector) => clean($(selector).first().attr('content'))
  const title = clean($('head > title').first().text() || $('title').first().text())
  const canonicalRaw = clean($('link[rel="canonical"]').first().attr('href'))
  const canonical = (() => {
    try {
      return canonicalRaw ? new URL(canonicalRaw, base || undefined).href : ''
    } catch {
      return canonicalRaw
    }
  })()

  const hreflang = []
  $('link[rel="alternate"][hreflang]').each((_, element) => {
    hreflang.push({ lang: clean($(element).attr('hreflang')), href: clean($(element).attr('href')) })
  })

  let images = 0
  let imagesMissingAlt = 0
  $('img').each((_, element) => {
    images += 1
    const alt = $(element).attr('alt')
    if (alt === undefined || (alt.trim() === '' && $(element).attr('role') !== 'presentation' && $(element).attr('aria-hidden') !== 'true')) imagesMissingAlt += 1
  })

  let internalLinks = 0
  let externalLinks = 0
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href') || ''
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) return
    try {
      const target = new URL(href, base || undefined)
      if (base && target.hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '')) internalLinks += 1
      else externalLinks += 1
    } catch {
      // ignore malformed links
    }
  })

  const headings = []
  $('h1, h2, h3, h4, h5, h6').each((_, element) => {
    const text = clean($(element).text())
    if (text) headings.push({ level: Number(element.tagName.slice(1)), text: text.slice(0, 160) })
  })

  const timeElements = $('time[datetime]').map((_, element) => clean($(element).attr('datetime'))).get().filter(Boolean)
  const metaDates = [meta('meta[property="article:modified_time"]'), meta('meta[property="article:published_time"]'), meta('meta[name="last-modified"]')].filter(Boolean)
  const metaAuthor = meta('meta[name="author"]')
  const listCount = $('ul li, ol li').length
  const tableCount = $('table').length

  // Text a non-rendering crawler can read: drop non-content elements first.
  const $text = cheerio.load(source)
  $text('script, style, noscript, template, svg, iframe, head').remove()
  const bodyText = clean($text('body').text() || $text.root().text())
  const $main = cheerio.load(source)
  $main('script, style, noscript, template, svg, iframe, nav, header, footer, aside, form').remove()
  const mainRoot = $main('main, article, [role="main"]').first()
  const mainText = clean((mainRoot.length ? mainRoot : $main('body')).text())
  let firstParagraph = ''
  ;(mainRoot.length ? mainRoot : $main('body')).find('p').each((_, element) => {
    const text = clean($main(element).text())
    if (!firstParagraph && countWords(text) >= 8) firstParagraph = text
  })

  const questionHeadings = headings.filter((heading) => /\?\s*$/.test(heading.text) || /^(what|how|why|when|where|who|which|can|does|do|is|are|should|was|wie|warum|wann|wo|wer|welche|kann|ist|sind|ne |nasıl|neden|ne zaman|nerede|kim|hangi|comment|pourquoi|quand|qu[eé]|c[oó]mo|por qu[eé]|cu[aá]ndo)\b/i.test(heading.text)).length
  const hasFaqHeading = headings.some((heading) => /\b(faq|frequently asked|häufig gestellte|sık sorulan|questions fréquentes|preguntas frecuentes)\b/i.test(heading.text))

  return {
    title,
    titleLength: title.length,
    metaDescription: meta('meta[name="description"]'),
    canonical,
    robotsMeta: clean([meta('meta[name="robots"]'), meta('meta[name="googlebot"]')].filter(Boolean).join(', ')).toLowerCase(),
    lang: clean($('html').attr('lang')),
    viewport: meta('meta[name="viewport"]'),
    og: { title: meta('meta[property="og:title"]'), description: meta('meta[property="og:description"]'), image: meta('meta[property="og:image"]') },
    twitterCard: meta('meta[name="twitter:card"]'),
    hreflang,
    headings,
    h1: headings.filter((heading) => heading.level === 1).map((heading) => heading.text),
    questionHeadings,
    hasFaqHeading,
    images,
    imagesMissingAlt,
    internalLinks,
    externalLinks,
    listItems: listCount,
    tables: tableCount,
    wordCount: countWords(bodyText),
    mainWordCount: countWords(mainText),
    firstParagraph: firstParagraph.slice(0, 600),
    firstParagraphWords: countWords(firstParagraph),
    dates: [...new Set([...timeElements, ...metaDates, ...jsonLd.dates])].slice(0, 6),
    author: metaAuthor || (jsonLd.hasAuthor ? 'structured data' : ''),
    jsonLd,
    htmlBytes: Buffer.byteLength(source),
    text: mainText || bodyText,
  }
}

// Compact, evidence-only view of a page for LLM grounding.
export function pageEvidence(fetched, facts) {
  return {
    url: fetched.url,
    status: fetched.status,
    ok: fetched.ok,
    error: fetched.error,
    title: facts?.title || '',
    metaDescription: facts?.metaDescription || '',
    lang: facts?.lang || '',
    h1: facts?.h1 || [],
    headings: (facts?.headings || []).slice(0, 40).map((heading) => `h${heading.level}: ${heading.text}`),
    wordCount: facts?.wordCount || 0,
    structuredData: facts ? {
      jsonLdBlocks: facts.jsonLd.blocks,
      invalidBlocks: facts.jsonLd.invalid,
      types: facts.jsonLd.types,
      organizationName: facts.jsonLd.organizationName,
      sameAs: facts.jsonLd.sameAs.slice(0, 12),
    } : null,
    dates: facts?.dates || [],
    author: facts?.author || '',
    textSample: (facts?.text || '').slice(0, 12000),
  }
}
