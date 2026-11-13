// Core Web Vitals from the PageSpeed Insights API: real-user field data from
// the Chrome UX Report plus a Lighthouse lab run. Numbers are passed through
// as Google reports them; nothing is estimated here.
const PSI_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

export class VitalsError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.name = 'VitalsError'
    this.status = status
  }
}

// Google's published thresholds: [good up to, poor above].
export const THRESHOLDS = {
  lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25], fcp: [1800, 3000], ttfb: [800, 1800],
}
const FIELD_KEYS = {
  lcp: 'LARGEST_CONTENTFUL_PAINT_MS', inp: 'INTERACTION_TO_NEXT_PAINT', cls: 'CUMULATIVE_LAYOUT_SHIFT_SCORE',
  fcp: 'FIRST_CONTENTFUL_PAINT_MS', ttfb: 'EXPERIMENTAL_TIME_TO_FIRST_BYTE',
}
const LABELS = { lcp: 'Largest Contentful Paint', inp: 'Interaction to Next Paint', cls: 'Cumulative Layout Shift', fcp: 'First Contentful Paint', ttfb: 'Time to First Byte' }

export function rate(id, value) {
  if (value === null || value === undefined) return 'none'
  const [good, poor] = THRESHOLDS[id]
  return value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor'
}

function fieldMetrics(experience) {
  const metrics = experience?.metrics || {}
  const result = {}
  for (const [id, key] of Object.entries(FIELD_KEYS)) {
    const entry = metrics[key]
    if (!entry || entry.percentile === undefined) continue
    // CrUX reports CLS multiplied by 100.
    const value = id === 'cls' ? entry.percentile / 100 : entry.percentile
    const shares = (entry.distributions || []).map((bucket) => Math.round((bucket.proportion || 0) * 100))
    result[id] = { id, label: LABELS[id], p75: value, rating: rate(id, value), distribution: shares.length === 3 ? { good: shares[0], needsImprovement: shares[1], poor: shares[2] } : null }
  }
  return result
}

function assess(metrics) {
  const core = ['lcp', 'inp', 'cls'].map((id) => metrics[id]).filter(Boolean)
  if (!metrics.lcp || !metrics.cls) return 'no-data'
  return core.every((entry) => entry.rating === 'good') ? 'passed' : 'failed'
}

export function parsePsi(data, strategy) {
  const lighthouse = data.lighthouseResult || {}
  const audits = lighthouse.audits || {}
  const numeric = (id) => (audits[id]?.numericValue ?? null)
  const pageField = fieldMetrics(data.loadingExperience)
  const originField = fieldMetrics(data.originLoadingExperience)
  // origin_fallback means Google had no page-level data and returned the whole origin instead.
  const pageIsOrigin = Boolean(data.loadingExperience?.origin_fallback)
  const lab = {
    performanceScore: lighthouse.categories?.performance?.score === undefined || lighthouse.categories?.performance?.score === null ? null : Math.round(lighthouse.categories.performance.score * 100),
    lcp: numeric('largest-contentful-paint'), fcp: numeric('first-contentful-paint'), cls: numeric('cumulative-layout-shift'),
    tbt: numeric('total-blocking-time'), speedIndex: numeric('speed-index'), ttfb: numeric('server-response-time'),
  }
  const savingsOf = (audit) => {
    const fromMetrics = Object.values(audit.metricSavings || {}).filter((value) => typeof value === 'number')
    return Math.round(Math.max(audit.details?.overallSavingsMs || 0, ...fromMetrics, 0))
  }
  const improvements = Object.values(audits)
    .filter((audit) => audit && typeof audit.score === 'number' && audit.score < 0.9 && savingsOf(audit) > 0)
    .map((audit) => ({ id: audit.id, title: audit.title, displayValue: audit.displayValue || '', savingsMs: savingsOf(audit), savingsBytes: Math.round(audit.details?.overallSavingsBytes || 0) }))
    .sort((a, b) => b.savingsMs - a.savingsMs).slice(0, 10)
  return {
    strategy,
    testedUrl: lighthouse.finalDisplayedUrl || lighthouse.finalUrl || data.id || '',
    fetchedAt: data.analysisUTCTimestamp || lighthouse.fetchTime || new Date().toISOString(),
    field: { scope: pageIsOrigin ? 'origin' : 'page', available: Object.keys(pageField).length > 0, assessment: assess(pageField), metrics: pageField },
    origin: { available: Object.keys(originField).length > 0, assessment: assess(originField), metrics: originField },
    lab: { ...lab, ratings: { lcp: rate('lcp', lab.lcp), cls: rate('cls', lab.cls), fcp: rate('fcp', lab.fcp) } },
    improvements,
    lighthouseVersion: lighthouse.lighthouseVersion || '',
    runWarnings: (lighthouse.runWarnings || []).slice(0, 3).map(String),
  }
}

export function createVitals({ apiKey = '', fetchImpl = fetch, timeoutMs = 50_000 } = {}) {
  return {
    hasKey: Boolean(apiKey),
    async run(url, strategy = 'mobile') {
      const params = new URLSearchParams({ url, strategy, category: 'performance' })
      if (apiKey) params.set('key', apiKey)
      let response
      try {
        response = await fetchImpl(`${PSI_URL}?${params}`, { signal: AbortSignal.timeout(timeoutMs) })
      } catch (error) {
        throw new VitalsError(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'PageSpeed Insights took too long to test this page. Try again.' : 'PageSpeed Insights could not be reached.', 504)
      }
      const data = await response.json().catch(() => ({}))
      if (response.status === 429) throw new VitalsError('The PageSpeed Insights quota is used up for now. Try again in a few minutes.', 429)
      if (!response.ok) {
        const reason = String(data?.error?.message || '').replace(/\s+/g, ' ').slice(0, 220)
        throw new VitalsError(reason ? `PageSpeed Insights could not test this page: ${reason}` : 'PageSpeed Insights could not test this page.', response.status === 400 ? 400 : 502)
      }
      return parsePsi(data, strategy)
    },
  }
}
