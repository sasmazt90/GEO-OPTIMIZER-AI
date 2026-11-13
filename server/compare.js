// Side-by-side comparison of one page against competitor pages. All values are
// read from the fetched HTML; gaps are stated only where the numbers differ.
import { pageChecks } from './audit.js'
import { extractPage } from './html.js'

const tokens = (text) => String(text || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((word) => word.length > 2)

function scoreOf(fetched, facts) {
  const checks = pageChecks(fetched, facts).flatMap((category) => category.checks).filter((item) => item.status !== 'info' && item.weight > 0)
  const total = checks.reduce((sum, item) => sum + item.weight, 0)
  const earned = checks.reduce((sum, item) => sum + item.weight * (item.status === 'pass' ? 1 : item.status === 'warn' ? 0.5 : 0), 0)
  return total ? Math.round((earned / total) * 100) : 0
}

function newestDate(dates) {
  const parsed = dates.map((value) => new Date(value)).filter((date) => !Number.isNaN(date.getTime())).sort((a, b) => b - a)
  return parsed[0] ? parsed[0].toISOString().slice(0, 10) : ''
}

export async function profilePage(fetcher, url, query = '') {
  const fetched = await fetcher(url, { timeoutMs: 12000 })
  if (!fetched.ok) return { url: fetched.url, ok: false, error: fetched.error || `HTTP ${fetched.status}` }
  const facts = extractPage(fetched.text, fetched.url)
  const terms = [...new Set(tokens(query))]
  const inText = (text) => (terms.length ? terms.filter((term) => tokens(text).includes(term)).length : null)
  const h2 = facts.headings.filter((heading) => heading.level === 2).map((heading) => heading.text)
  return {
    url: fetched.url, ok: true, host: new URL(fetched.url).hostname.replace(/^www\./, ''),
    score: scoreOf(fetched, facts), title: facts.title, titleLength: facts.titleLength, descriptionLength: facts.metaDescription.length,
    h1: facts.h1[0] || '', words: facts.wordCount, mainWords: facts.mainWordCount,
    h2Count: h2.length, h3Count: facts.headings.filter((heading) => heading.level === 3).length, h2,
    questionHeadings: facts.questionHeadings, hasFaq: facts.hasFaqHeading || facts.jsonLd.types.includes('FAQPage'),
    listItems: facts.listItems, tables: facts.tables, images: facts.images, internalLinks: facts.internalLinks, externalLinks: facts.externalLinks,
    schemaTypes: facts.jsonLd.types, author: Boolean(facts.author), lastDate: newestDate(facts.dates), ms: fetched.ms, kb: Math.round(fetched.bytes / 1024),
    query: terms.length ? { terms: terms.length, inTitle: inText(facts.title), inH1: inText(facts.h1.join(' ')), inHeadings: inText(h2.join(' ')), inIntro: inText(facts.firstParagraph), mentions: terms.reduce((sum, term) => sum + tokens(facts.text).filter((word) => word === term).length, 0) } : null,
  }
}

export function comparePages(own, competitors) {
  const others = competitors.filter((page) => page.ok)
  if (!own.ok || !others.length) return { gaps: [], strengths: [], missingTopics: [] }
  const gaps = []
  const strengths = []
  const numeric = [
    ['words', 'Text length', 'words', 0.7], ['h2Count', 'H2 sections', 'sections', 0.7], ['questionHeadings', 'Question-style headings', 'headings', 0.5],
    ['listItems', 'List items', 'items', 0.5], ['tables', 'Tables', 'tables', 0.5], ['internalLinks', 'Internal links', 'links', 0.5], ['externalLinks', 'External references', 'links', 0.5], ['score', 'On-page audit score', 'points', 0.9],
  ]
  for (const [key, label, unit, ratio] of numeric) {
    const best = [...others].sort((a, b) => b[key] - a[key])[0]
    const median = [...others].map((page) => page[key]).sort((a, b) => a - b)[Math.floor(others.length / 2)]
    if (best[key] > 0 && own[key] < median * ratio) gaps.push({ metric: label, own: own[key], best: best[key], bestHost: best.host, detail: `${own[key]} ${unit} on your page; ${best.host} has ${best[key]}.` })
    else if (own[key] > 0 && own[key] >= best[key]) strengths.push({ metric: label, own: own[key], detail: `${own[key]} ${unit}: at least as many as every compared page.` })
  }
  const schemaMissing = [...new Set(others.flatMap((page) => page.schemaTypes))].filter((type) => !own.schemaTypes.includes(type))
  if (schemaMissing.length) gaps.push({ metric: 'Structured data types', own: own.schemaTypes.length, best: schemaMissing.length, detail: `Competitors use ${schemaMissing.slice(0, 8).join(', ')}; your page does not.` })
  if (!own.hasFaq && others.some((page) => page.hasFaq)) gaps.push({ metric: 'FAQ section', own: 0, best: 1, detail: `${others.filter((page) => page.hasFaq).map((page) => page.host).join(', ')} include an FAQ section; your page does not.` })
  if (!own.author && others.some((page) => page.author)) gaps.push({ metric: 'Author', own: 0, best: 1, detail: 'At least one competitor names an author; your page does not.' })
  const freshest = [...others].filter((page) => page.lastDate).sort((a, b) => b.lastDate.localeCompare(a.lastDate))[0]
  if (freshest && (!own.lastDate || own.lastDate < freshest.lastDate)) gaps.push({ metric: 'Freshness', own: own.lastDate || 'no date', best: freshest.lastDate, detail: `${freshest.host} shows a date of ${freshest.lastDate}; your page shows ${own.lastDate || 'no machine-readable date'}.` })
  if (own.query) {
    for (const [key, label] of [['inTitle', 'title'], ['inH1', 'H1'], ['inIntro', 'first paragraph']]) {
      const best = Math.max(...others.map((page) => page.query?.[key] ?? 0))
      if (own.query[key] < best) gaps.push({ metric: `Query terms in ${label}`, own: own.query[key], best, detail: `${own.query[key]} of ${own.query.terms} query terms in your ${label}; the best competitor has ${best}.` })
    }
  }
  // Topics: competitor H2 headings that share no meaningful word with any of your headings.
  const ownWords = new Set(tokens([own.h1, ...own.h2].join(' ')))
  const seen = new Set()
  const missingTopics = []
  for (const page of others) {
    for (const heading of page.h2) {
      const words = tokens(heading)
      const key = words.join(' ')
      if (words.length < 2 || seen.has(key) || words.some((word) => ownWords.has(word))) continue
      seen.add(key)
      missingTopics.push({ heading, host: page.host })
    }
  }
  return { gaps, strengths, missingTopics: missingTopics.slice(0, 30) }
}
