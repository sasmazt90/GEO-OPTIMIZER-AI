// Plans, monthly allowances and the unit economics behind them.
//
// Usage is metered per user per calendar month (UTC). Allowances are sized so
// that a subscriber who uses 100% of the allowance still leaves a positive
// margin after model costs and payment fees (see docs/PRICING.md).

// Planning costs in USD per unit, deliberately above the measured average.
export const UNIT_COST = {
  probe: 0.008, // one live model answer (blended across models, incl. brand extraction)
  groundedProbe: 0.032, // the same with live web search (search results are billed per request)
  analysis: 0.003, // one structured analysis call
  audit: 0, // rule-based, no model cost
}

// A web-grounded probe consumes this many probe credits.
export const GROUNDED_MULTIPLIER = 4

export const PLANS = {
  free: { label: 'Free', price: { month: 0, year: 0 }, probes: 60, analyses: 30, audits: 20, projects: 1, promptsPerProject: 10, maxSamples: 3, auditPages: 0, crawlPages: 25, crawlPagesMonthly: 100, keywords: 10 },
  pro: { label: 'Pro', price: { month: 49, year: 490 }, probes: 2500, analyses: 500, audits: 500, projects: 10, promptsPerProject: 50, maxSamples: 5, auditPages: 5, crawlPages: 500, crawlPagesMonthly: 5000, keywords: 100 },
  agency: { label: 'Agency', price: { month: 149, year: 1490 }, probes: 7000, analyses: 2000, audits: 3000, projects: 50, promptsPerProject: 200, maxSamples: 5, auditPages: 10, crawlPages: 2000, crawlPagesMonthly: 20000, keywords: 500 },
}

export const PAID_PLANS = ['pro', 'agency']
export const USAGE_KINDS = { analysis: 'analyses', probe: 'probes', audit: 'audits', crawl: 'crawlPagesMonthly' }

export function lookupKey(plan, interval) {
  return `geo_${plan}_${interval === 'year' ? 'yearly' : 'monthly'}`
}

export function planFromLookupKey(key) {
  const match = /^geo_(pro|agency)_(monthly|yearly)$/.exec(String(key || ''))
  return match ? match[1] : null
}

export function resolvePlan(profile, user, adminEmails = []) {
  if (user?.email && adminEmails.includes(user.email.toLowerCase())) return 'agency'
  if (profile?.billing_flag === 'suspended') return 'free'
  return PLANS[profile?.plan] ? profile.plan : 'free'
}

// First day of the current UTC month, the metering period key.
export function currentPeriod(now = new Date()) {
  return `${now.toISOString().slice(0, 7)}-01`
}

export function nextReset(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
}

export class QuotaError extends Error {
  constructor(kind, limit, plan) {
    const noun = { probe: 'live model answers', analysis: 'analyses', audit: 'audits', crawl: 'crawled pages' }[kind] || kind
    super(`You have used this month's ${noun} on the ${PLANS[plan].label} plan (${limit}). ${plan === 'agency' ? 'The allowance' : 'Upgrade for more, or the allowance'} resets on ${nextReset()}.`)
    this.name = 'QuotaError'
    this.kind = kind
    this.limit = limit
  }
}

// Reserves `amount` units; throws QuotaError when the plan allowance would be
// exceeded. If metering storage is not migrated yet the store returns null and
// the call passes.
export async function consume(store, userId, plan, kind, amount = 1) {
  const limit = PLANS[plan][USAGE_KINDS[kind]]
  const period = currentPeriod()
  const used = await store.getUsageCount(userId, period, kind)
  if (used !== null && used + amount > limit) throw new QuotaError(kind, limit, plan)
  await store.incrementUsage(userId, period, kind, amount)
}

// Worst-case monthly model cost of a plan if the whole allowance is used.
export function maxMonthlyCost(plan) {
  const limits = PLANS[plan]
  return Math.round((limits.probes * UNIT_COST.probe + limits.analyses * UNIT_COST.analysis) * 100) / 100
}
