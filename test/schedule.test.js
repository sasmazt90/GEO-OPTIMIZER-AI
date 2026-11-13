import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMailer } from '../server/mail.js'
import { PLANS, currentPeriod } from '../server/plans.js'
import { buildReportEmail, compareRuns, nextRun, runCron, shouldNotify } from '../server/schedule.js'
import { startApp } from './helpers.js'

function fakeMailer({ fail = false } = {}) {
  const sent = []
  return { sent, mailer: createMailer({ user: 'alerts@sasmaz.example', transport: { sendMail: async (message) => { if (fail) throw Object.assign(new Error('auth'), { responseCode: 535 }); sent.push(message); return {} } } }) }
}

async function setup(options = {}) {
  const mail = fakeMailer(options.mail)
  const ctx = await startApp({ plan: options.plan || 'pro', extras: { mailer: mail.mailer }, config: { cronSecret: 'cron-secret', cronBudgetMs: 20_000, ...options.config } })
  const project = (await ctx.api('POST', '/api/projects', { name: 'Acme tracking', brand: 'Acme', domain: 'acme.com', competitors: [{ name: 'Salesforce' }] })).body.project
  await ctx.api('POST', `/api/projects/${project.id}/prompts`, { prompts: [{ text: 'best crm for sales teams' }, { text: 'crm with forecasting' }] })
  return { ctx, project, mail }
}
const cron = (ctx, secret = 'cron-secret') => ctx.api('GET', '/api/cron/daily', null, { Authorization: `Bearer ${secret}` })

test('run comparison: change, significance and prompt-level gains and losses', () => {
  const run = (rate, low, high, prompts) => ({ visibility: { rate, low, high }, byPrompt: prompts.map(([promptId, value]) => ({ promptId, prompt: `prompt ${promptId}`, rate: value })) })
  const comparison = compareRuns(run(60, 45, 73, [['a', 100], ['b', 0], ['c', 50]]), run(20, 10, 35, [['a', 0], ['b', 40], ['c', 50]]))
  assert.deepEqual(comparison, { first: false, change: 40, previousRate: 20, significant: true, gained: ['prompt a'], lost: ['prompt b'] })
  assert.equal(compareRuns(run(30, 15, 50, []), run(25, 12, 45, [])).significant, false, 'overlapping intervals are not called significant')
  assert.equal(compareRuns(run(30, 15, 50, []), null).first, true)
  assert.equal(shouldNotify({ notify: 'change', threshold: 5 }, { first: false, change: 3, gained: [], lost: [] }), false)
  assert.equal(shouldNotify({ notify: 'change', threshold: 5 }, { first: false, change: -5, gained: [], lost: [] }), true)
  assert.equal(shouldNotify({ notify: 'change', threshold: 5 }, { first: false, change: 0, gained: ['x'], lost: [] }), true)
  assert.equal(shouldNotify({ notify: 'off', threshold: 5 }, { first: true }), false)
  assert.equal(shouldNotify({ notify: 'every', threshold: 5 }, { first: false, change: 0, gained: [], lost: [] }), true)
  assert.equal(new Date(nextRun('daily', new Date('2026-11-13T05:10:00Z'))).toISOString(), '2026-11-14T03:10:00.000Z')
})

test('report email states the counted figures and escapes project text', () => {
  const summary = { answers: 24, failed: 1, visibility: { rate: 41.7, low: 24.5, high: 61.2 }, shareOfVoice: 22, avgPosition: 2.1, bySurface: [{ surface: 'ChatGPT', rate: 100, answers: 6 }], brands: [{ name: 'Acme', answers: 10, own: true }], byPrompt: [] }
  const email = buildReportEmail({ project: { name: '<b>Acme</b> & co', brand: 'Acme' }, summary, comparison: { first: false, change: -8.3, previousRate: 50, significant: false, gained: [], lost: ['best crm'] }, appUrl: 'https://app.example' })
  assert.equal(email.subject, '<b>Acme</b> & co: AI visibility 41.7% (-8.3 pp)')
  assert.match(email.text, /41\.7% \(95% interval 24\.5–61\.2%\), -8\.3 pp vs the previous run \(50%\)/)
  assert.match(email.text, /within the margin of error/)
  assert.match(email.text, /No longer mentioned for\n- best crm/)
  assert.ok(email.html.includes('&lt;b&gt;Acme&lt;/b&gt; &amp; co') && !email.html.includes('<b>Acme</b>'))
})

test('schedule settings: plan rules, validation and test email', async () => {
  const { ctx, project, mail } = await setup({ plan: 'free' })
  try {
    const initial = await ctx.api('GET', `/api/projects/${project.id}/schedule`)
    assert.deepEqual([initial.body.schedule, initial.body.allowed, initial.body.emailEnabled, initial.body.cronEnabled], [null, ['weekly'], true, true])
    assert.equal((await ctx.api('PUT', `/api/projects/${project.id}/schedule`, { frequency: 'daily', surfaces: ['ChatGPT'] })).status, 403)
    assert.equal((await ctx.api('PUT', `/api/projects/${project.id}/schedule`, { frequency: 'weekly', surfaces: ['Nope'] })).status, 400)
    assert.equal((await ctx.api('PUT', '/api/projects/missing/schedule', { frequency: 'weekly', surfaces: ['ChatGPT'] })).status, 404)
    const saved = await ctx.api('PUT', `/api/projects/${project.id}/schedule`, { frequency: 'weekly', surfaces: ['ChatGPT', 'Nope'], samples: 5 })
    assert.deepEqual([saved.body.schedule.surfaces, saved.body.schedule.samples], [['ChatGPT'], PLANS.free.maxSamples])
    assert.ok(saved.body.schedule.nextRunAt)
    const off = await ctx.api('PUT', `/api/projects/${project.id}/schedule`, { frequency: 'off' })
    assert.equal(off.body.schedule.nextRunAt, null)

    assert.equal((await ctx.api('POST', '/api/mail/test')).body.to, 'owner@example.com')
    assert.equal(mail.sent[0].from, 'GEO Optimizer AI <alerts@sasmaz.example>')
    await ctx.api('POST', '/api/mail/test')
    await ctx.api('POST', '/api/mail/test')
    assert.equal((await ctx.api('POST', '/api/mail/test')).status, 429)
  } finally {
    await ctx.close()
  }
})

test('cron: requires the secret, runs due schedules, emails the result and re-schedules', async () => {
  const { ctx, project, mail } = await setup()
  try {
    assert.equal((await ctx.api('GET', '/api/cron/daily')).status, 401)
    assert.equal((await cron(ctx, 'wrong-secret')).status, 401)
    await ctx.api('PUT', `/api/projects/${project.id}/schedule`, { frequency: 'daily', surfaces: ['ChatGPT', 'Claude'], samples: 2, notify: 'change', threshold: 5 })

    const first = await cron(ctx)
    assert.deepEqual([first.body.started, first.body.completed, first.body.emailed, first.body.remaining], [1, 1, 1, 0])
    assert.equal(ctx.store.state.usage.get(`user-1|${currentPeriod()}|probe`), 8, '2 prompts x 2 models x 2 answers')
    assert.equal(mail.sent.length, 1, 'the first scheduled run is always reported')
    assert.equal(mail.sent[0].to, 'owner@example.com')
    assert.match(mail.sent[0].subject, /^Acme tracking: AI visibility 50%$/)
    const measurement = ctx.store.state.measurements[0]
    assert.deepEqual([measurement.status, measurement.config.scheduled], ['completed', true])
    const schedule = ctx.store.state.schedules.get(project.id)
    assert.equal(schedule.measurementId, null)
    assert.match(schedule.lastStatus, /Completed: 50% visibility\. Email sent\./)
    assert.ok(new Date(schedule.nextRunAt) > new Date(Date.now() + 20 * 3_600_000))

    const again = await cron(ctx)
    assert.equal(again.body.started, 0, 'not due again on the same day')

    schedule.nextRunAt = new Date(Date.now() - 1000).toISOString()
    const second = await cron(ctx)
    assert.deepEqual([second.body.started, second.body.completed, second.body.emailed], [1, 1, 0], 'no email when visibility did not change')
    assert.match(ctx.store.state.schedules.get(project.id).lastStatus, /^Completed: 50% visibility\.$/)
    assert.equal((await ctx.api('GET', `/api/projects/${project.id}/schedule`)).body.schedule.running, false)
  } finally {
    await ctx.close()
  }
})

test('cron: a run that does not fit the time budget continues in the next pass', async () => {
  const { ctx, project } = await setup({ config: { cronBudgetMs: 0, batchSize: 2 } })
  try {
    await ctx.api('PUT', `/api/projects/${project.id}/schedule`, { frequency: 'weekly', surfaces: ['ChatGPT', 'Claude', 'Gemini'], samples: 1, notify: 'off' })
    const first = await cron(ctx)
    assert.deepEqual([first.body.started, first.body.completed, first.body.remaining], [1, 0, 1])
    assert.equal((await ctx.api('GET', `/api/projects/${project.id}/schedule`)).body.schedule.running, true)
    const report = await runCron({ store: ctx.store, llm: ctx.llm, mailer: null, appUrl: 'https://app.example', budgetMs: 20_000, batchSize: 2 })
    assert.deepEqual([report.started, report.completed, report.remaining, report.emailed], [0, 1, 0, 0])
    assert.equal(ctx.store.state.usage.get(`user-1|${currentPeriod()}|probe`), 6, 'credits are charged once, not per pass')
  } finally {
    await ctx.close()
  }
})

test('cron: skips with one email when the allowance is used up, and survives a failing mail server', async () => {
  const { ctx, project, mail } = await setup({ plan: 'free' })
  try {
    await ctx.api('PUT', `/api/projects/${project.id}/schedule`, { frequency: 'weekly', surfaces: ['ChatGPT'], samples: 1, notify: 'every' })
    ctx.store.state.usage.set(`user-1|${currentPeriod()}|probe`, PLANS.free.probes)
    const first = await cron(ctx)
    assert.deepEqual([first.body.started, first.body.skipped, first.body.emailed], [0, 1, 1])
    assert.match(mail.sent[0].subject, /scheduled measurement skipped/)
    ctx.store.state.schedules.get(project.id).nextRunAt = new Date(Date.now() - 1000).toISOString()
    const second = await cron(ctx)
    assert.deepEqual([second.body.skipped, second.body.emailed], [1, 0], 'the skip is reported once')
    assert.equal(ctx.store.state.measurements.length, 0)
  } finally {
    await ctx.close()
  }
  const broken = await setup({ mail: { fail: true } })
  try {
    await broken.ctx.api('PUT', `/api/projects/${broken.project.id}/schedule`, { frequency: 'daily', surfaces: ['ChatGPT'], samples: 1, notify: 'every' })
    const result = await cron(broken.ctx)
    assert.deepEqual([result.status, result.body.completed, result.body.emailed], [200, 1, 0])
    assert.match(broken.ctx.store.state.schedules.get(broken.project.id).lastStatus, /Email could not be sent/)
    const testMail = await broken.ctx.api('POST', '/api/mail/test')
    assert.equal(testMail.status, 502)
    assert.match(testMail.body.error, /SMTP 535/)
  } finally {
    await broken.ctx.close()
  }
})

test('cron and email report as not configured without their settings', async () => {
  const ctx = await startApp()
  try {
    assert.equal((await ctx.api('GET', '/api/cron/daily', null, { Authorization: 'Bearer ' })).status, 503)
    assert.equal((await ctx.api('POST', '/api/mail/test')).status, 503)
    const health = (await ctx.api('GET', '/api/health')).body
    assert.deepEqual([health.email, health.schedules], [false, false])
  } finally {
    await ctx.close()
  }
})
