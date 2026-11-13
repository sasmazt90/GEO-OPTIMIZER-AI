import { useEffect, useState } from 'react'
import { CalendarClock, Loader2, Mail } from 'lucide-react'
import { api } from '../api.js'
import { Field, Notice, Select } from './shared.jsx'

const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const FREQUENCY = { off: 'Off', weekly: 'Every week', daily: 'Every day' }

// Automatic measurements for one project, with an email when the result is in.
export default function Schedule({ projectId, account, promptCount }) {
  const [info, setInfo] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState(null)

  useEffect(() => {
    let alive = true
    api('GET', `/api/projects/${projectId}/schedule`).then((data) => {
      if (!alive) return
      setInfo(data)
      setForm(data.schedule
        ? { frequency: data.schedule.frequency, surfaces: data.schedule.surfaces, samples: data.schedule.samples, grounded: data.schedule.grounded, notify: data.schedule.notify, threshold: data.schedule.threshold }
        : { frequency: 'off', surfaces: account?.surfaces || [], samples: 1, grounded: false, notify: 'change', threshold: 5 })
    }).catch((error) => { if (alive) setMessage({ kind: 'error', text: error.message }) })
    return () => { alive = false }
  }, [projectId, account?.surfaces])

  if (!info || !form) return message ? <Notice kind={message.kind}>{message.text}</Notice> : null
  const set = (patch) => { setForm({ ...form, ...patch }); setMessage(null) }
  const multiplier = form.grounded ? account?.groundedMultiplier || 4 : 1
  const perRun = promptCount * form.surfaces.length * form.samples * multiplier
  const perMonth = perRun * (form.frequency === 'daily' ? 30 : form.frequency === 'weekly' ? 4.35 : 0)
  const allowance = account?.unlimited ? 0 : account?.limits?.probes || 0
  const schedule = info.schedule

  async function save() {
    setBusy('save')
    try {
      const data = await api('PUT', `/api/projects/${projectId}/schedule`, form)
      setInfo({ ...info, schedule: data.schedule })
      setMessage({ kind: 'success', text: form.frequency === 'off' ? 'Scheduled measurements are switched off.' : 'Schedule saved. The first run starts with the next daily pass (around 05:00 UTC).' })
    } catch (error) {
      setMessage({ kind: 'error', text: error.message })
    } finally {
      setBusy('')
    }
  }
  async function testEmail() {
    setBusy('mail')
    try {
      const data = await api('POST', '/api/mail/test')
      setMessage({ kind: 'success', text: `Test email sent to ${data.to}.` })
    } catch (error) {
      setMessage({ kind: 'error', text: error.message })
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="panel">
      <div className="category-head"><h3 className="panel-title"><CalendarClock size={18} /> Schedule</h3>{schedule && schedule.frequency !== 'off' && <span className="category-score">{schedule.running ? 'Running now' : schedule.nextRunAt ? `Next run after ${when(schedule.nextRunAt)}` : ''}</span>}</div>
      <p className="panel-note">Measure this project automatically and get the result by email. Runs start once a day and use answer credits like a manual run.</p>
      {info.migration && <Notice kind="warn">The database update for scheduled measurements has not been applied yet.</Notice>}
      {!info.cronEnabled && <Notice kind="warn">Scheduled runs are not switched on for this server yet (CRON_SECRET is missing). You can save a schedule; it starts once that is set.</Notice>}
      <div className="two-col">
        <Field label="Frequency" hint={info.allowed.includes('daily') ? '' : 'Daily measurements are part of the paid plans.'}>
          <Select value={form.frequency} onChange={(frequency) => set({ frequency })} options={['off', ...info.allowed].map((value) => ({ value, label: FREQUENCY[value] }))} />
        </Field>
        <Field label="Answers per prompt and model">
          <Select value={String(form.samples)} onChange={(value) => set({ samples: Number(value) })} options={Array.from({ length: account?.limits?.maxSamples || 3 }, (_, index) => String(index + 1))} />
        </Field>
      </div>
      {form.frequency !== 'off' && (
        <>
          <div className="field"><span>AI models</span>
            <div className="check-list compact model-list">
              {(account?.surfaces || []).map((surface) => (
                <label key={surface}><input type="checkbox" checked={form.surfaces.includes(surface)} onChange={() => set({ surfaces: form.surfaces.includes(surface) ? form.surfaces.filter((item) => item !== surface) : [...form.surfaces, surface] })} />{surface}</label>
              ))}
            </div>
          </div>
          <label className="checkbox-line"><input type="checkbox" checked={form.grounded} onChange={(event) => set({ grounded: event.target.checked })} />Web-grounded answers with sources ({account?.groundedMultiplier || 4}× credits)</label>
          <div className="two-col">
            <Field label="Email me" hint={info.emailEnabled ? `Sent to ${info.email}.` : 'Email is not configured on this server yet; runs still happen and appear here.'}>
              <Select value={form.notify} onChange={(notify) => set({ notify })} options={[{ value: 'change', label: 'When visibility changes' }, { value: 'every', label: 'After every run' }, { value: 'off', label: 'Never' }]} />
            </Field>
            {form.notify === 'change' && (
              <Field label="Change that triggers an email" hint="Also sent when a prompt gains or loses its only mentions.">
                <Select value={String(form.threshold)} onChange={(value) => set({ threshold: Number(value) })} options={[2, 5, 10, 15, 20].map((value) => ({ value: String(value), label: `${value} percentage points or more` }))} />
              </Field>
            )}
          </div>
          <p className="panel-note">Each run uses <strong>{perRun.toLocaleString('en-US')}</strong> answer credits, about <strong>{Math.round(perMonth).toLocaleString('en-US')}</strong> per month{allowance > 0 ? ` of your ${allowance.toLocaleString('en-US')}` : ''}.</p>
          {allowance > 0 && perMonth > allowance && <Notice kind="warn">This schedule needs more credits per month than your plan includes. Runs are skipped once the allowance is used up. Reduce models, answers or frequency, or upgrade.</Notice>}
          {!promptCount && <Notice kind="warn">Add prompts first: a run without prompts is skipped.</Notice>}
        </>
      )}
      {schedule?.lastStatus && <p className="panel-note">Last run{schedule.lastRunAt ? ` (${when(schedule.lastRunAt)})` : ''}: {schedule.lastStatus}</p>}
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <div className="button-row">
        <button type="button" className="primary-button" onClick={save} disabled={Boolean(busy) || (form.frequency !== 'off' && !form.surfaces.length)}>{busy === 'save' ? <Loader2 className="spin" size={17} /> : <CalendarClock size={17} />}Save schedule</button>
        {info.emailEnabled && <button type="button" className="ghost-button" onClick={testEmail} disabled={Boolean(busy)}>{busy === 'mail' ? <Loader2 className="spin" size={16} /> : <Mail size={16} />}Send test email</button>}
      </div>
    </section>
  )
}
