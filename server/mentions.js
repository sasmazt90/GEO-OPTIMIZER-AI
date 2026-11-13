// Deterministic brand-mention and citation analysis of model answers.

export function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// First position of a whole-token match of `name` in normalized text, or -1.
export function findName(normalizedAnswer, name) {
  const needle = normalizeText(name)
  if (!needle || needle.length < 2) return -1
  const haystack = ` ${normalizedAnswer} `
  const index = haystack.indexOf(` ${needle} `)
  if (index !== -1) return index
  // Allow simple suffixes ("Stripe's", "Biodermas", Turkish "Bioderma'nın").
  const loose = new RegExp(` ${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|nin|nun|in|un|da|de|dan|den|yi|yu|ya|ye)? `).exec(haystack)
  return loose ? loose.index : -1
}

export function domainOf(value) {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function extractUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || []
  return [...new Set(matches.map((url) => url.replace(/[.,;:!?]+$/, '')))]
}

function sameSite(domain, ownDomain) {
  return Boolean(domain && ownDomain) && (domain === ownDomain || domain.endsWith(`.${ownDomain}`))
}

// entities: [{ name, aliases: [] }] — the tracked brand first, then competitors.
export function analyzeAnswer({ answer, citations = [], brand, aliases = [], domain = '', competitors = [], extraNames = [] }) {
  const normalized = normalizeText(answer)
  const ownDomain = domainOf(domain)
  const locate = (names) => names.map((name) => findName(normalized, name)).filter((index) => index !== -1).sort((a, b) => a - b)[0] ?? -1

  const brandIndex = locate([brand, ...aliases])
  const tracked = competitors.map((competitor) => ({ name: competitor.name, index: locate([competitor.name, ...(competitor.aliases || [])]) }))
  const trackedKeys = new Set([brand, ...competitors.map((competitor) => competitor.name)].map(normalizeText))
  const discovered = extraNames
    .filter((name) => !trackedKeys.has(normalizeText(name)))
    .map((name) => ({ name, index: locate([name]) }))

  const mentions = [
    ...(brandIndex !== -1 ? [{ name: brand, index: brandIndex, own: true }] : []),
    ...tracked.filter((entry) => entry.index !== -1).map((entry) => ({ ...entry, own: false })),
    ...discovered.filter((entry) => entry.index !== -1).map((entry) => ({ ...entry, own: false })),
  ].sort((a, b) => a.index - b.index)

  const urls = [...new Set([...citations, ...extractUrls(answer)])]
  const citedDomains = [...new Set(urls.map(domainOf).filter(Boolean))]
  return {
    brandMentioned: brandIndex !== -1,
    brandPosition: brandIndex !== -1 ? mentions.findIndex((entry) => entry.own) + 1 : null,
    mentions: mentions.map(({ name, own }, order) => ({ name, own, position: order + 1 })),
    citations: urls.slice(0, 30),
    citedDomains,
    ownCited: citedDomains.some((cited) => sameSite(cited, ownDomain)),
  }
}

// Wilson score interval (95%) for a proportion; honest error bars on small samples.
export function wilson(successes, total) {
  if (!total) return { rate: 0, low: 0, high: 0 }
  const z = 1.96
  const p = successes / total
  const denominator = 1 + (z * z) / total
  const centre = p + (z * z) / (2 * total)
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)
  const round = (value) => Math.round(Math.max(0, Math.min(1, value)) * 1000) / 10
  return { rate: round(p), low: round((centre - margin) / denominator), high: round((centre + margin) / denominator) }
}
