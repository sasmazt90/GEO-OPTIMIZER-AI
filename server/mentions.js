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

// Short raw-text windows around the first brand mention, for perception analysis.
export function brandExcerpts(answers, names, { limit = 40, radius = 320 } = {}) {
  const needles = names.map((name) => String(name || '').toLowerCase()).filter((name) => name.length >= 2)
  const excerpts = []
  for (const answer of answers) {
    const text = String(answer || '')
    const lower = text.toLowerCase()
    const index = needles.map((needle) => lower.indexOf(needle)).filter((position) => position !== -1).sort((a, b) => a - b)[0]
    if (index === undefined) continue
    excerpts.push(text.slice(Math.max(0, index - radius), index + radius).replace(/\s+/g, ' ').trim())
    if (excerpts.length >= limit) break
  }
  return excerpts
}

// Tallies model-assigned labels in code so totals always add up.
export function tallyPerception(items, total) {
  const counts = { positive: 0, neutral: 0, negative: 0 }
  const attributes = new Map()
  let classified = 0
  for (const item of Array.isArray(items) ? items.slice(0, total) : []) {
    const sentiment = String(item?.sentiment || '').toLowerCase()
    if (!(sentiment in counts)) continue
    counts[sentiment] += 1
    classified += 1
    for (const raw of Array.isArray(item.attributes) ? item.attributes.slice(0, 4) : []) {
      const label = String(raw).trim().toLowerCase().slice(0, 40)
      if (label) attributes.set(label, (attributes.get(label) || 0) + 1)
    }
  }
  if (!classified) return null
  return {
    classified,
    ...counts,
    attributes: [...attributes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, count]) => ({ label, count })),
    method: 'Sentiment and attributes are assigned by a model to each answer that names the brand; the totals are counted in code.',
  }
}
