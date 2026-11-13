import assert from 'node:assert/strict'
import { test } from 'node:test'
import Stripe from 'stripe'
import { createBilling } from '../server/billing.js'
import { PLANS, currentPeriod, maxMonthlyCost } from '../server/plans.js'
import { fakeLlm, startApp } from './helpers.js'

test('requires authentication', async () => {
  const ctx = await startApp()
  try {
    assert.equal((await ctx.api('GET', '/api/projects', null, { 'x-test-anon': '1' })).status, 401)
    assert.equal((await ctx.api('GET', '/api/health')).body.version, 2)
    assert.equal((await ctx.api('GET', '/api/nope')).status, 404)
  } finally {
    await ctx.close()
  }
})

test('SSRF: internal targets are rejected on every URL-taking endpoint', async () => {
  const ctx = await startApp()
  try {
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:8787/api/health', 'http://[::1]/']) {
      assert.equal((await ctx.api('POST', '/api/audit', { url })).status, 400, `audit ${url}`)
      assert.equal((await ctx.api('POST', '/api/crawl', { url })).status, 400, `crawl ${url}`)
    }
    assert.equal(ctx.fetchLog.length, 0, 'no outbound request may be made for blocked URLs')
    const check = await ctx.api('POST', '/api/generate', { tool: 'check', input: { url: 'http://10.0.0.5/admin' } })
    assert.equal(check.status, 200)
    assert.equal(ctx.fetchLog.length, 0)
  } finally {
    await ctx.close()
  }
})

test('site audit returns a deterministic score and bot matrix', async () => {
  const ctx = await startApp()
  try {
    const first = await ctx.api('POST', '/api/audit', { url: 'acme.com' })
    assert.equal(first.status, 200)
    assert.ok(first.body.score >= 85)
    assert.equal(first.body.bots.find((bot) => bot.name === 'GPTBot').robots, 'disallowed')
    assert.equal(first.body.pages.length, 0, 'free plan audits a single page')
    const again = await ctx.api('POST', '/api/audit', { url: 'acme.com' })
    assert.equal(again.body.score, first.body.score)
    assert.equal(ctx.llm.calls.chat, 0, 'audit must not call a model')
    const crawl = await ctx.api('POST', '/api/crawl', { url: 'https://acme.com/' })
    const gptbot = crawl.body.rows.find((row) => row.name === 'GPTBot')
    assert.equal(gptbot.status, 'Blocked')
    assert.equal(gptbot.robots, 'Disallowed')
    assert.equal(crawl.body.rows.find((row) => row.name === 'PerplexityBot').status, 'Allowed')
  } finally {
    await ctx.close()
  }
})

test('content check uses the rule-based score, not the model score', async () => {
  const ctx = await startApp()
  try {
    const result = await ctx.api('POST', '/api/generate', { tool: 'check', input: { url: 'https://acme.com/' } })
    assert.equal(result.status, 200)
    assert.equal(result.body.measured, true)
    assert.notEqual(result.body.score, 55, 'model returned 55; the rule-based score must win')
    assert.ok(result.body.sections.some((section) => section.title === 'Rule-based checks'))
  } finally {
    await ctx.close()
  }
})

test('visibility and benchmark report counted results', async () => {
  const ctx = await startApp()
  try {
    const visibility = await ctx.api('POST', '/api/generate', { tool: 'visibility', input: { brand: 'Acme', prompt: 'best crm', models: ['ChatGPT', 'Claude', 'Google AI Overview'] } })
    assert.equal(visibility.status, 200)
    assert.equal(visibility.body.score, 50, '3 of 6 answers mention the brand')
    assert.equal(visibility.body.models.find((row) => row.model === 'ChatGPT').confidence, '3 of 3 answers')
    assert.equal(visibility.body.models.find((row) => row.model === 'Claude').presence, 'Not visible')
    assert.equal(visibility.body.models.find((row) => row.model === 'Google AI Overview').presence, 'Not measurable')

    const benchmark = await ctx.api('POST', '/api/generate', { tool: 'benchmark', input: { prompt: 'best crm' } })
    assert.equal(benchmark.status, 200)
    const brands = benchmark.body.brands
    assert.equal(brands[0].brand, 'Salesforce')
    assert.equal(brands[0].sentiment, '12 of 12 answers')
    assert.equal(brands[0].share, '100%')
    assert.ok(!brands.some((row) => row.brand === 'NotInAnyAnswer'), 'a name the extractor proposes but no answer contains must not appear')
    for (const row of brands) assert.match(row.sentiment, /^\d+ of 12 answers$/)
    assert.equal(await ctx.store.getUsageCount(ctx.user.id, currentPeriod(), 'probe'), 18)
  } finally {
    await ctx.close()
  }
})

test('benchmark fails cleanly without probes instead of inventing numbers', async () => {
  const ctx = await startApp({ llm: fakeLlm({ canProbe: false }) })
  try {
    const result = await ctx.api('POST', '/api/generate', { tool: 'benchmark', input: { prompt: 'best crm' } })
    assert.equal(result.status, 503)
  } finally {
    await ctx.close()
  }
})

test('tracking: project, prompts, measurement steps and summary', async () => {
  const ctx = await startApp({ llm: fakeLlm({ failSurface: 'Gemini' }) })
  try {
    const created = await ctx.api('POST', '/api/projects', { name: 'Acme', brand: 'Acme', domain: 'https://www.acme.com/x', competitors: [{ name: 'Salesforce' }] })
    assert.equal(created.status, 201)
    const project = created.body.project
    assert.equal(project.domain, 'acme.com')
    assert.equal((await ctx.api('POST', '/api/projects', { name: 'Second', brand: 'B' })).status, 403, 'free plan allows one project')

    const suggested = await ctx.api('POST', `/api/projects/${project.id}/prompts/suggest`)
    assert.equal(suggested.body.prompts.length, 10)
    const added = await ctx.api('POST', `/api/projects/${project.id}/prompts`, { prompts: [{ text: 'best crm for mid-market' }, { text: 'Best CRM for mid-market' }, { text: 'salesforce alternatives' }] })
    assert.equal(added.body.prompts.length, 2, 'duplicates are ignored')
    assert.equal((await ctx.api('POST', `/api/projects/${project.id}/prompts`, { prompts: Array.from({ length: 9 }, (_, index) => ({ text: `q${index}` })) })).status, 403)

    const started = await ctx.api('POST', `/api/projects/${project.id}/measurements`, { surfaces: ['ChatGPT', 'Gemini', 'Perplexity', 'Bogus'], samples: 5 })
    assert.equal(started.status, 201)
    const measurement = started.body.measurement
    assert.equal(measurement.total, 2 * 3 * 3, 'samples capped at 3 on free; unknown surface dropped')

    let progress
    let steps = 0
    do {
      progress = (await ctx.api('POST', `/api/measurements/${measurement.id}/step`)).body
      steps += 1
    } while (progress.status === 'running' && steps < 20)
    assert.equal(progress.status, 'completed')
    assert.equal(steps, 4, '18 samples in batches of 5')
    const summary = progress.summary
    assert.equal(summary.answers, 12)
    assert.equal(summary.failed, 6)
    assert.equal(summary.bySurface.find((row) => row.surface === 'ChatGPT').rate, 100)
    assert.equal(summary.brands[0].name, 'Salesforce')
    assert.equal(summary.brands[0].answers, 12)
    assert.ok(summary.citedDomains.some((row) => row.domain === 'g2.com'))
    assert.ok(summary.citation.answersWithSources === 6)
    assert.equal(summary.byPrompt.length, 2)

    assert.ok(summary.perception.classified > 0 && summary.perception.classified <= 12)
    assert.equal(summary.perception.positive + summary.perception.neutral + summary.perception.negative, summary.perception.classified)
    assert.ok(Array.isArray(summary.citationGap))

    const pasted = await ctx.api('POST', `/api/projects/${project.id}/analyze-answer`, { text: 'For CRM, HubSpot and Salesforce lead; Acme is a newer option.', sources: 'https://www.g2.com/x\nacme.com/pricing' })
    assert.equal(pasted.status, 200)
    assert.equal(pasted.body.brandMentioned, true)
    assert.equal(pasted.body.brandPosition, 3)
    assert.equal(pasted.body.ownCited, true)
    assert.equal((await ctx.api('POST', `/api/projects/${project.id}/analyze-answer`, { text: 'short' })).status, 400)
    const brief = await ctx.api('POST', `/api/projects/${project.id}/brief`, { prompt: 'best crm for mid-market' })
    assert.equal(brief.status, 200)
    assert.ok(brief.body.sections.length > 0)

    const again = await ctx.api('POST', `/api/measurements/${measurement.id}/step`)
    assert.equal(again.body.status, 'completed')
    const detail = await ctx.api('GET', `/api/measurements/${measurement.id}?samples=1`)
    assert.equal(detail.body.samples.length, 18)
    const list = await ctx.api('GET', `/api/projects/${project.id}`)
    assert.equal(list.body.measurements[0].summary.answers, 12)
    assert.equal((await ctx.api('GET', '/api/measurements/does-not-exist')).status, 404)
  } finally {
    await ctx.close()
  }
})

test('monthly allowance is enforced and grounded probes cost more', async () => {
  const ctx = await startApp()
  try {
    const project = (await ctx.api('POST', '/api/projects', { name: 'Acme', brand: 'Acme' })).body.project
    await ctx.api('POST', `/api/projects/${project.id}/prompts`, { prompts: Array.from({ length: 5 }, (_, index) => ({ text: `question ${index}` })) })
    // 5 prompts x 4 surfaces x 3 samples = 60 = the whole free allowance.
    assert.equal((await ctx.api('POST', `/api/projects/${project.id}/measurements`, { surfaces: ['ChatGPT', 'Claude', 'Gemini', 'Perplexity'], samples: 3, grounded: true })).status, 429, 'grounded run needs 240 credits')
    assert.equal((await ctx.api('POST', `/api/projects/${project.id}/measurements`, { surfaces: ['ChatGPT', 'Claude', 'Gemini', 'Perplexity'], samples: 3 })).status, 201)
    const blocked = await ctx.api('POST', `/api/projects/${project.id}/measurements`, { surfaces: ['ChatGPT'], samples: 1 })
    assert.equal(blocked.status, 429)
    assert.equal(blocked.body.quota, true)
    const account = await ctx.api('GET', '/api/account')
    assert.equal(account.body.usage.probe, 60)
    assert.equal(account.body.limits.probes, 60)
  } finally {
    await ctx.close()
  }
})

test('unit economics: every paid plan stays profitable at 100% usage', () => {
  const usdPerEur = 1 // conservative: treat costs as EUR 1:1 although EUR is worth more
  for (const plan of ['pro', 'agency']) {
    const cost = maxMonthlyCost(plan) * usdPerEur
    for (const [interval, months] of [['month', 1], ['year', 12]]) {
      const revenue = PLANS[plan].price[interval] / months
      const fees = revenue * 0.035 + 0.25 // card fee upper bound incl. Billing
      const margin = (revenue - fees - cost) / revenue
      assert.ok(margin >= 0.4, `${plan}/${interval} worst-case margin ${Math.round(margin * 100)}%`)
    }
  }
  assert.ok(maxMonthlyCost('free') <= 0.6)
})

function fakeStripe() {
  const real = new Stripe('sk_test_dummy')
  const state = { customers: [], subscriptions: [], sessions: [], prices: [{ id: 'price_pro_m', lookup_key: 'geo_pro_monthly' }, { id: 'price_agency_y', lookup_key: 'geo_agency_yearly' }] }
  return {
    state,
    webhooks: real.webhooks,
    customers: { create: async (params) => { const customer = { id: `cus_${state.customers.length + 1}`, ...params }; state.customers.push(customer); return customer } },
    prices: { list: async ({ lookup_keys: keys }) => ({ data: state.prices.filter((price) => keys.includes(price.lookup_key)) }) },
    subscriptions: { list: async ({ customer }) => ({ data: state.subscriptions.filter((subscription) => subscription.customer === customer) }) },
    charges: { retrieve: async (id) => ({ id, customer: 'cus_1' }) },
    checkout: { sessions: { create: async (params) => { state.sessions.push(params); return { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' } } } },
    billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/p/session/1' }) } },
  }
}

test('billing: checkout, webhook-driven plan changes, dispute suspension', async () => {
  const stripe = fakeStripe()
  const secret = 'whsec_test_secret'
  const ctx = await startApp()
  const billing = createBilling({ stripe, store: ctx.store, appUrl: 'https://app.test', webhookSecret: secret })
  await ctx.close()

  // Reuse the store and user, but serve an app wired with billing.
  const { createApp } = await import('../server/app.js')
  const { createSafeFetch } = await import('../server/net.js')
  const { fakeFetchImpl } = await import('./helpers.js')
  const user = ctx.user
  const server = await new Promise((resolve) => {
    const instance = createApp({
      store: ctx.store, llm: fakeLlm(), billing, fetcher: createSafeFetch({ fetchImpl: fakeFetchImpl() }), authenticate: async () => user, config: { rateLimit: false, isProduction: false },
    }).listen(0, '127.0.0.1', () => resolve(instance))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const post = async (path, body) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
    return { status: response.status, body: await response.json() }
  }
  const webhook = async (event, { sign = true } = {}) => {
    const payload = JSON.stringify(event)
    const header = sign ? stripe.webhooks.generateTestHeaderString({ payload, secret }) : 't=1,v1=bad'
    const response = await fetch(`${base}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload })
    return response.status
  }
  const plan = async () => (await (await fetch(`${base}/api/account`)).json()).plan

  try {
    assert.equal((await post('/api/billing/checkout', { plan: 'enterprise' })).status, 400)
    assert.equal((await post('/api/billing/portal')).status, 400, 'no customer yet')
    const checkout = await post('/api/billing/checkout', { plan: 'pro', interval: 'month' })
    assert.equal(checkout.status, 200)
    assert.match(checkout.body.url, /^https:\/\/checkout\.stripe\.com\//)
    const session = stripe.state.sessions[0]
    assert.equal(session.mode, 'subscription')
    assert.equal(session.line_items[0].price, 'price_pro_m')
    assert.equal(session.payment_method_types, undefined, 'payment methods must stay dynamic')
    assert.equal(session.automatic_tax, undefined, 'tax stays off until a registration exists')
    assert.equal(stripe.state.customers.length, 1)
    assert.equal(await plan(), 'free', 'returning from checkout alone grants nothing')

    assert.equal(await webhook({ id: 'evt_0', type: 'customer.subscription.created', data: { object: { customer: 'cus_1' } } }, { sign: false }), 400)
    assert.equal(await plan(), 'free')

    // Unpaid async session: no access.
    assert.equal(await webhook({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { mode: 'subscription', customer: 'cus_1', payment_status: 'unpaid' } } }), 200)
    assert.equal(await plan(), 'free')

    stripe.state.subscriptions.push({ id: 'sub_1', customer: 'cus_1', status: 'active', items: { data: [{ price: { lookup_key: 'geo_pro_monthly' } }] } })
    assert.equal(await webhook({ id: 'evt_2', type: 'checkout.session.completed', data: { object: { mode: 'subscription', customer: 'cus_1', payment_status: 'paid' } } }), 200)
    assert.equal(await plan(), 'pro')
    assert.equal((await post('/api/billing/checkout', { plan: 'agency' })).body.portal, true, 'existing subscribers are sent to the portal')

    stripe.state.subscriptions[0].status = 'past_due'
    await webhook({ id: 'evt_3', type: 'invoice.payment_failed', data: { object: { customer: 'cus_1' } } })
    assert.equal(await plan(), 'pro', 'access continues while Stripe retries')

    await webhook({ id: 'evt_4', type: 'charge.dispute.created', data: { object: { id: 'dp_1', charge: 'ch_1' } } })
    assert.equal(await plan(), 'free', 'a dispute suspends access')
    await webhook({ id: 'evt_5', type: 'checkout.session.completed', data: { object: { mode: 'subscription', customer: 'cus_1', payment_status: 'paid' } } })
    stripe.state.subscriptions[0].status = 'canceled'
    await webhook({ id: 'evt_6', type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1' } } })
    assert.equal(await plan(), 'free')
    assert.equal(await webhook({ id: 'evt_7', type: 'customer.subscription.updated', data: { object: { customer: 'cus_unknown' } } }), 200, 'unknown customers are ignored, not retried forever')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
