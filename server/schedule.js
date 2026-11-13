// Scheduled visibility measurements. A daily cron starts the runs that are due,
// processes them in batches within its time budget, and emails the result.
import crypto from 'node:crypto'
import { z } from 'zod'
import { buildTasks, processBatch } from './measure.js'
import { GROUNDED_MULTIPLIER, PLANS, QuotaError, consume, resolvePlan } from './plans.js'
import { MigrationPendingError } from './store.js'

const DAY = 86_400_000
// Two hours of slack so a cron that fires a little earlier than yesterday does not skip a day.
const SLACK = 2 * 3_600_000

export const allowedFrequencies = (plan) => (plan === 'free' ? ['weekly'] : ['daily', 'weekly'])
export const nextRun = (frequency, from = new Date()) => new Date(from.getTime() + (frequency === 'daily' ? DAY : 7 * DAY) - SLACK).toISOString()
export const runCredits = (prompts, surfaces, samples, grounded) => prompts * surfaces * samples * (grounded ? GROUNDED_MULTIPLIER : 1)

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const pp = (value) => `${value > 0 ? '+' : ''}${Math.round(value * 10) / 10} pp`

// Compares a finished measurement with the previous one. All figures are the counted rates.
export function compareRuns(summary, previous) {
  const now = summary.visibility
  if (!previous) return { first: true, change: null, significant: false, gained: [], lost: [] }
  const before = previous.visibility
  const beforeByPrompt = new Map((previous.byPrompt || []).map((row) => [row.promptId, row]))
  const gained = []
  const lost = []
  for (const row of summary.byPrompt || []) {
    const old = beforeByPrompt.get(row.promptId)
    if (!old) continue
    if (old.rate === 0 && row.rate > 0) gained.push(row.prompt)
    if (old.rate > 0 && row.rate === 0) lost.push(row.prompt)
  }
  return {
    first: false,
    change: Math.round((now.rate - before.rate) * 10) / 10,
    previousRate: before.rate,
    // The two 95% intervals do not overlap, so the change is unlikely to be sampling noise.
    significant: now.low > before.high || now.high < before.low,
    gained, lost,
  }
}

export function shouldNotify(schedule, comparison) {
  if (schedule.notify === 'off') return false
  if (schedule.notify === 'every' || comparison.first) return true
  return Math.abs(comparison.change) >= schedule.threshold || comparison.gained.length > 0 || comparison.lost.length > 0
}

export function buildReportEmail({ project, summary, comparison, appUrl }) {
  const rate = summary.visibility
  const changeText = comparison.first ? 'first scheduled measurement' : `${pp(comparison.change)} vs the previous run (${comparison.previousRate}%)`
  const noise = comparison.first ? '' : comparison.significant ? 'The change is larger than the margin of error of both runs.' : 'The change is within the margin of error of the two runs, so treat it as a signal to watch rather than a confirmed shift.'
  const lines = [
    `AI visibility for ${project.brand}: ${rate.rate}% (95% interval ${rate.low}–${rate.high}%), ${changeText}.`,
    noise,
    `Counted from ${summary.answers} live answers${summary.failed ? ` (${summary.failed} requests failed)` : ''}. Share of voice ${summary.shareOfVoice}%${summary.avgPosition ? `, average position ${summary.avgPosition}` : ''}.`,
  ].filter(Boolean)
  const models = (summary.bySurface || []).map((row) => `${row.surface}: ${row.rate}% of ${row.answers} answers`)
  const brands = (summary.brands || []).slice(0, 5).map((row) => `${row.name}: ${row.answers} answers${row.own ? ' (you)' : ''}`)
  const section = (title, items) => (items.length ? `\n${title}\n${items.map((item) => `- ${item}`).join('\n')}` : '')
  const text = `${lines.join('\n')}\n${section('By model', models)}${section('Now mentioned for', comparison.gained)}${section('No longer mentioned for', comparison.lost)}${section('Brands named most often', brands)}\n\nOpen the project: ${appUrl}\n\nYou receive this because scheduled measurements are switched on for "${project.name}". Change or stop them under Visibility Tracking > Schedule.`
  const list = (title, items) => (items.length ? `<h3 style="margin:18px 0 6px;font-size:14px;color:#0f172a">${esc(title)}</h3><ul style="margin:0;padding-left:18px">${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : '')
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#334155;max-width:600px">
<p style="margin:0 0 4px;color:#0f766e;font-weight:bold">${esc(project.name)}</p>
<p style="margin:0;font-size:30px;font-weight:bold;color:#0f172a">${rate.rate}% <span style="font-size:14px;font-weight:normal;color:#64748b">AI visibility · ${esc(changeText)}</span></p>
${lines.map((line) => `<p style="margin:10px 0 0">${esc(line)}</p>`).join('')}
${list('By model', models)}${list('Now mentioned for', comparison.gained)}${list('No longer mentioned for', comparison.lost)}${list('Brands named most often', brands)}
<p style="margin:22px 0"><a href="${esc(appUrl)}" style="background:#0f766e;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold">Open the project</a></p>
<p style="margin:0;font-size:12px;color:#64748b">You receive this because scheduled measurements are switched on for "${esc(project.name)}". Change or stop them under Visibility Tracking &gt; Schedule.</p></div>`
  const subject = `${project.name}: AI visibility ${rate.rate}%${comparison.first ? '' : ` (${pp(comparison.change)})`}`
  return { subject, text, html }
}

async function notify(mailer, to, message) {
  if (!mailer?.enabled || !to) return false
  try {
    await mailer.send({ to, ...message })
    return true
  } catch (error) {
    console.error('schedule mail', error?.message)
    return false
  }
}

// One cron pass. Returns counts and whether unfinished work remains.
export async function runCron({ store, llm, mailer, adminEmails = [], appUrl, budgetMs = 45_000, batchSize = 6, now = new Date() }) {
  const deadline = Date.now() + budgetMs
  const report = { started: 0, skipped: 0, completed: 0, emailed: 0, remaining: 0 }

  for (const schedule of await store.listDueSchedules(now.toISOString(), 25)) {
    const [project, profile] = await Promise.all([store.getProject(schedule.userId, schedule.projectId), store.getProfile(schedule.userId)])
    if (!project || !profile) {
      await store.updateSchedule(schedule.projectId, { frequency: 'off', lastStatus: 'Project no longer exists.' })
      continue
    }
    const plan = resolvePlan(profile, { email: profile.email }, adminEmails)
    // After a downgrade a daily schedule continues at the frequency the plan allows.
    const frequency = allowedFrequencies(plan).includes(schedule.frequency) ? schedule.frequency : 'weekly'
    const next = { nextRunAt: nextRun(frequency, now), lastRunAt: now.toISOString() }
    const prompts = await store.listPrompts(schedule.userId, project.id)
    const surfaces = schedule.surfaces.filter((surface) => llm.surfaces().includes(surface))
    if (!prompts.length || !surfaces.length || !llm.canProbe()) {
      report.skipped += 1
      await store.updateSchedule(project.id, { ...next, lastStatus: !prompts.length ? 'Skipped: the project has no prompts.' : 'Skipped: no model available.' })
      continue
    }
    const samples = Math.min(schedule.samples, PLANS[plan].maxSamples)
    const tasks = buildTasks(prompts, surfaces, samples)
    try {
      await consume(store, schedule.userId, plan, 'probe', tasks.length * (schedule.grounded ? GROUNDED_MULTIPLIER : 1))
    } catch (error) {
      if (!(error instanceof QuotaError)) throw error
      report.skipped += 1
      // Email once when the allowance runs out, not on every skipped run.
      if (schedule.notify !== 'off' && !schedule.lastStatus.startsWith('Skipped: allowance')) {
        const sent = await notify(mailer, profile.email, { subject: `${project.name}: scheduled measurement skipped`, text: `The scheduled AI visibility measurement for "${project.name}" did not run. ${error.message}\n\nOpen the app: ${appUrl}`, html: `<p>The scheduled AI visibility measurement for "${esc(project.name)}" did not run.</p><p>${esc(error.message)}</p><p><a href="${esc(appUrl)}">Open the app</a></p>` })
        if (sent) report.emailed += 1
      }
      await store.updateSchedule(project.id, { ...next, lastStatus: 'Skipped: allowance used up for this month.' })
      continue
    }
    const measurement = await store.createMeasurement(schedule.userId, project.id, { surfaces, samples, grounded: schedule.grounded, prompts: prompts.length, scheduled: true }, tasks)
    await store.updateSchedule(project.id, { ...next, measurementId: measurement.id, lastStatus: 'Running.' })
    report.started += 1
  }

  let active = await store.listActiveSchedules(50)
  while (active.length && Date.now() < deadline) {
    const still = []
    for (const schedule of active) {
      if (Date.now() >= deadline) {
        still.push(schedule)
        continue
      }
      const [measurement, project] = await Promise.all([store.getMeasurement(schedule.userId, schedule.measurementId), store.getProject(schedule.userId, schedule.projectId)])
      if (!measurement || !project) {
        await store.updateSchedule(schedule.projectId, { measurementId: null, lastStatus: 'The run could not be found.' })
        continue
      }
      const progress = measurement.status === 'running' ? await processBatch({ store, llm, measurement, project, batchSize }) : { status: measurement.status, summary: measurement.summary }
      if (progress.status === 'running') {
        still.push(schedule)
        continue
      }
      report.completed += 1
      if (progress.status !== 'completed' || !progress.summary) {
        await store.updateSchedule(schedule.projectId, { measurementId: null, lastStatus: 'The last run failed: no model answered.' })
        continue
      }
      const previous = (await store.listMeasurements(schedule.userId, project.id, 10)).find((item) => item.id !== measurement.id && item.status === 'completed' && item.summary)
      const comparison = compareRuns(progress.summary, previous?.summary || null)
      let status = `Completed: ${progress.summary.visibility.rate}% visibility.`
      if (shouldNotify(schedule, comparison)) {
        const profile = await store.getProfile(schedule.userId)
        const sent = await notify(mailer, profile?.email, buildReportEmail({ project, summary: progress.summary, comparison, appUrl }))
        if (sent) report.emailed += 1
        status += sent ? ' Email sent.' : mailer?.enabled ? ' Email could not be sent.' : ''
      }
      await store.updateSchedule(schedule.projectId, { measurementId: null, lastStatus: status })
    }
    active = still
  }
  report.remaining = active.length
  return report
}

const scheduleSchema = z.object({
  frequency: z.enum(['off', 'daily', 'weekly']),
  surfaces: z.array(z.string().max(40)).max(8).default([]),
  samples: z.number().int().min(1).max(5).default(1),
  grounded: z.boolean().default(false),
  notify: z.enum(['every', 'change', 'off']).default('change'),
  threshold: z.number().int().min(1).max(50).default(5),
})

export function registerScheduleRoutes(app, { store, llm, mailer, requireAuth, config }) {
  const { appUrl, cronSecret = '', adminEmails = [] } = config
  const testSent = new Map()
  const view = (schedule) => schedule && ({ frequency: schedule.frequency, surfaces: schedule.surfaces, samples: schedule.samples, grounded: schedule.grounded, notify: schedule.notify, threshold: schedule.threshold, nextRunAt: schedule.nextRunAt, lastRunAt: schedule.lastRunAt, running: Boolean(schedule.measurementId), lastStatus: schedule.lastStatus })

  app.get('/api/projects/:id/schedule', requireAuth, async (req, res) => {
    const base = { allowed: allowedFrequencies(req.plan), emailEnabled: Boolean(mailer?.enabled), cronEnabled: Boolean(cronSecret), email: req.user.email }
    try {
      res.json({ ...base, schedule: view(await store.getSchedule(req.user.id, req.params.id)) })
    } catch (error) {
      if (!(error instanceof MigrationPendingError)) throw error
      res.json({ ...base, schedule: null, migration: true })
    }
  })

  app.put('/api/projects/:id/schedule', requireAuth, async (req, res) => {
    const parsed = scheduleSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Choose a frequency and at least one AI model.' })
    const project = await store.getProject(req.user.id, req.params.id)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    const data = parsed.data
    if (data.frequency !== 'off') {
      if (!allowedFrequencies(req.plan).includes(data.frequency)) return res.status(403).json({ error: `Daily measurements are part of the paid plans. The ${req.limits.label} plan runs weekly.`, upgrade: true })
      data.surfaces = data.surfaces.filter((surface) => llm.surfaces().includes(surface))
      if (!data.surfaces.length) return res.status(400).json({ error: 'Choose a frequency and at least one AI model.' })
      data.samples = Math.min(data.samples, req.limits.maxSamples)
    }
    const existing = await store.getSchedule(req.user.id, project.id)
    // The first run happens at the next daily pass; later changes keep the planned time unless the frequency changed.
    const nextRunAt = data.frequency === 'off' ? null : existing?.frequency === data.frequency && existing.nextRunAt ? existing.nextRunAt : new Date().toISOString()
    res.json({ schedule: view(await store.saveSchedule(req.user.id, project.id, { ...data, nextRunAt })) })
  })

  app.post('/api/mail/test', requireAuth, async (req, res) => {
    if (!mailer?.enabled) return res.status(503).json({ error: 'Email is not configured on this server yet.' })
    const recent = (testSent.get(req.user.id) || []).filter((time) => time > Date.now() - 3_600_000)
    if (recent.length >= 3) return res.status(429).json({ error: 'You can send three test emails per hour.' })
    testSent.set(req.user.id, [...recent, Date.now()])
    try {
      await mailer.send({ to: req.user.email, subject: 'GEO Optimizer AI: test email', text: `This is a test email from GEO Optimizer AI. Scheduled measurement reports will arrive at this address.\n\n${appUrl}`, html: `<p>This is a test email from GEO Optimizer AI. Scheduled measurement reports will arrive at this address.</p><p><a href="${esc(appUrl)}">Open the app</a></p>` })
      res.json({ ok: true, to: req.user.email })
    } catch (error) {
      console.error('mail test', error?.message)
      // SMTP response codes are safe to show and tell the owner what to fix.
      res.status(502).json({ error: `The mail server did not accept the message${error?.responseCode ? ` (SMTP ${error.responseCode})` : error?.code ? ` (${error.code})` : ''}. Check the SMTP settings.` })
    }
  })

  // Called by the Vercel cron with "Authorization: Bearer CRON_SECRET".
  app.get('/api/cron/daily', async (req, res) => {
    if (!cronSecret) return res.status(503).json({ error: 'Scheduled runs are not configured' })
    const given = Buffer.from(String(req.headers.authorization || ''))
    const expected = Buffer.from(`Bearer ${cronSecret}`)
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return res.status(401).json({ error: 'Unauthorized' })
    let report
    try {
      report = await runCron({ store, llm, mailer, adminEmails, appUrl, budgetMs: config.cronBudgetMs ?? 45_000, batchSize: config.batchSize || 6 })
    } catch (error) {
      if (error instanceof MigrationPendingError) return res.json({ ok: true, migration: true })
      throw error
    }
    const depth = Number(req.query.depth) || 0
    // Unfinished runs continue in a fresh invocation; the chain is capped.
    if (report.remaining > 0 && depth < 40 && config.selfUrl) {
      await fetch(`${config.selfUrl}/api/cron/daily?depth=${depth + 1}`, { headers: { Authorization: `Bearer ${cronSecret}` }, signal: AbortSignal.timeout(2500) }).catch(() => {})
    }
    res.json({ ok: true, depth, ...report })
  })
}
