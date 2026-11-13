import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Loader2, Play, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { api } from '../api.js'
import { Field, Kpi, Notice, Select } from './shared.jsx'
import { COUNTRIES, LANGUAGES, downloadCsv } from './util.js'

const emptyProject = { name: '', brand: '', aliases: '', domain: '', competitors: '', country: 'Worldwide', language: 'English' }
const splitList = (value) => String(value || '').split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)
const toPayload = (form) => ({
  name: form.name.trim() || form.brand.trim(),
  brand: form.brand.trim(),
  aliases: splitList(form.aliases).slice(0, 8),
  domain: form.domain.trim(),
  competitors: splitList(form.competitors).slice(0, 15).map((name) => ({ name, aliases: [] })),
  country: form.country,
  language: form.language,
})
const toForm = (project) => ({
  name: project.name, brand: project.brand, aliases: (project.aliases || []).join(', '), domain: project.domain || '',
  competitors: (project.competitors || []).map((entry) => entry.name).join(', '), country: project.country, language: project.language,
})
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

function ProjectForm({ initial, onSave, onCancel, saving, submitLabel }) {
  const [form, setForm] = useState(initial)
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value })
  return (
    <form className="panel form-panel full" onSubmit={(event) => { event.preventDefault(); onSave(toPayload(form)) }}>
      <div className="two-col">
        <Field label="Brand name" required hint="Counted when it appears in an answer."><input value={form.brand} onChange={set('brand')} placeholder="e.g. Bioderma" required maxLength={80} /></Field>
        <Field label="Website" hint="Used to detect when your own site is cited."><input value={form.domain} onChange={set('domain')} placeholder="example.com" /></Field>
        <Field label="Other spellings" hint="Comma-separated: product names, abbreviations."><input value={form.aliases} onChange={set('aliases')} placeholder="e.g. Sensibio, Atoderm" /></Field>
        <Field label="Competitors to track" hint="Comma-separated. Other brands in the answers are discovered automatically."><input value={form.competitors} onChange={set('competitors')} placeholder="e.g. La Roche-Posay, Avène" /></Field>
        <Field label="Country"><Select value={form.country} onChange={(country) => setForm({ ...form, country })} options={COUNTRIES} /></Field>
        <Field label="Answer language"><Select value={form.language} onChange={(language) => setForm({ ...form, language })} options={LANGUAGES} /></Field>
      </div>
      <div className="form-footer">
        <p>Prompts are asked for this country and language.</p>
        <div className="button-row">
          {onCancel && <button type="button" className="ghost-button" onClick={onCancel}>Cancel</button>}
          <button className="primary-button" disabled={saving}>{saving ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}{submitLabel}</button>
        </div>
      </div>
    </form>
  )
}

function Trend({ measurements }) {
  const points = measurements.filter((item) => item.status === 'completed' && item.summary).slice(0, 20).reverse()
  if (points.length < 2) return <p className="panel-note">Run the measurement again on another day to see the trend.</p>
  const width = 640
  const height = 160
  const pad = 28
  const x = (index) => pad + (index * (width - pad * 2)) / (points.length - 1)
  const y = (rate) => height - pad - (rate / 100) * (height - pad * 2)
  const line = points.map((item, index) => `${x(index)},${y(item.summary.visibility.rate)}`).join(' ')
  const band = [...points.map((item, index) => `${x(index)},${y(item.summary.visibility.high)}`), ...points.map((item, index) => `${x(index)},${y(item.summary.visibility.low)}`).reverse()].join(' ')
  return (
    <svg className="trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Visibility rate over ${points.length} measurements, latest ${points.at(-1).summary.visibility.rate} percent`}>
      {[0, 50, 100].map((tick) => <g key={tick}><line x1={pad} x2={width - pad} y1={y(tick)} y2={y(tick)} className="trend-grid" /><text x={4} y={y(tick) + 4} className="trend-label">{tick}%</text></g>)}
      <polygon points={band} className="trend-band" />
      <polyline points={line} className="trend-line" />
      {points.map((item, index) => <g key={item.id}><circle cx={x(index)} cy={y(item.summary.visibility.rate)} r="4" className="trend-dot" /><text x={x(index)} y={height - 6} textAnchor="middle" className="trend-label">{day(item.createdAt)}</text></g>)}
    </svg>
  )
}

function Results({ measurement, project }) {
  const summary = measurement.summary
  if (!summary) return null
  const exportCsv = async () => {
    const detail = await api('GET', `/api/measurements/${measurement.id}?samples=1`)
    const rows = [['Prompt', 'Model surface', 'Model', 'Sample', 'Status', 'Answer', 'Cited URLs']]
    detail.samples.forEach((sample) => rows.push([sample.promptText, sample.surface, sample.model, sample.sampleIndex + 1, sample.status, sample.answer || sample.error, (sample.citations || []).join(' ')]))
    downloadCsv(`ai-visibility-${project.brand}-${measurement.createdAt.slice(0, 10)}.csv`, rows)
  }
  return (
    <>
      <section className="panel">
        <div className="category-head"><h3 className="panel-title">Measured on {new Date(measurement.createdAt).toLocaleString()}</h3><button className="ghost-button small" onClick={exportCsv}><Download size={16} />Export answers (CSV)</button></div>
        <div className="kpi-row">
          <Kpi label="Visibility rate" value={`${summary.visibility.rate}%`} note={`95% interval ${summary.visibility.low}–${summary.visibility.high}%`} />
          <Kpi label="Share of voice" value={`${summary.shareOfVoice}%`} note="of all brand mentions" />
          <Kpi label="Average position" value={summary.avgPosition ?? '–'} note="when mentioned" />
          <Kpi label="Own site cited" value={summary.citation.rate === null ? '–' : `${summary.citation.rate}%`} note={summary.citation.answersWithSources ? `of ${summary.citation.answersWithSources} answers with sources` : 'no answers returned sources'} />
        </div>
        <p className="panel-note">{summary.answers} live answers collected{summary.failed ? `, ${summary.failed} requests failed` : ''}. {summary.method}</p>
      </section>

      <section className="panel">
        <h3 className="panel-title">Brands named in the answers</h3>
        <div className="table-wrap">
          <table className="compact-table">
            <thead><tr><th>#</th><th>Brand</th><th>Answers naming it</th><th>Mention rate</th><th>Share of voice</th><th>Avg. position</th></tr></thead>
            <tbody>
              {summary.brands.slice(0, 15).map((entry) => (
                <tr key={entry.name} className={entry.own ? 'own-row' : ''}>
                  <td>{entry.rank}</td><td><strong>{entry.name}</strong>{entry.own && <span className="pill pill-ok">You</span>}{!entry.tracked && <span className="pill">Discovered</span>}</td>
                  <td>{entry.answers} of {summary.answers}</td><td><div className="bar"><i style={{ width: `${entry.mentionRate}%` }} /></div>{entry.mentionRate}%</td><td>{entry.shareOfVoice}%</td><td>{entry.avgPosition}</td>
                </tr>
              ))}
              {!summary.brands.length && <tr><td colSpan={6}>No brands were named in the collected answers.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="split">
        <section className="panel">
          <h3 className="panel-title">By AI model</h3>
          <table className="compact-table">
            <thead><tr><th>Surface</th><th>Visibility</th><th>Answers</th></tr></thead>
            <tbody>{summary.bySurface.map((row) => <tr key={row.surface}><td><strong>{row.surface}</strong><small className="rule"> {row.model}</small></td><td><div className="bar"><i style={{ width: `${row.rate}%` }} /></div>{row.rate}%</td><td>{row.answers}</td></tr>)}</tbody>
          </table>
        </section>
        <section className="panel">
          <h3 className="panel-title">Most cited sources</h3>
          {summary.citedDomains.length ? (
            <table className="compact-table">
              <thead><tr><th>Domain</th><th>Answers citing it</th></tr></thead>
              <tbody>{summary.citedDomains.slice(0, 8).map((row) => <tr key={row.domain}><td>{row.domain}</td><td>{row.answers} ({row.share}%)</td></tr>)}</tbody>
            </table>
          ) : <p className="panel-note">No sources were returned. Turn on web-grounded answers, or include Perplexity, to see which sites the models cite.</p>}
        </section>
      </div>

      <section className="panel">
        <h3 className="panel-title">By prompt (weakest first)</h3>
        <div className="table-wrap">
          <table className="compact-table">
            <thead><tr><th>Prompt</th><th>Visibility</th><th>Avg. position</th><th>Named most often</th></tr></thead>
            <tbody>{summary.byPrompt.map((row) => <tr key={row.promptId}><td>{row.prompt}</td><td><div className="bar"><i style={{ width: `${row.rate}%` }} /></div>{row.rate}%</td><td>{row.avgPosition ?? '–'}</td><td>{row.topBrands.slice(0, 3).map((brand) => brand.name).join(', ') || '–'}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </>
  )
}

export default function Tracking({ account, onUsage }) {
  const [projects, setProjects] = useState(null)
  const [activeId, setActiveId] = useState('')
  const [detail, setDetail] = useState(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [promptText, setPromptText] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [surfaces, setSurfaces] = useState(account?.surfaces || [])
  const [samples, setSamples] = useState(Math.min(3, account?.limits?.maxSamples || 3))
  const [grounded, setGrounded] = useState(false)
  const [progress, setProgress] = useState(null)
  const cancelled = useRef(false)

  const fail = (caught) => setError(caught.message)
  const loadDetail = useCallback(async (id) => {
    setDetail(await api('GET', `/api/projects/${id}`))
  }, [])

  useEffect(() => {
    cancelled.current = false
    api('GET', '/api/projects').then((data) => {
      setProjects(data.projects)
      if (data.projects[0]) setActiveId(data.projects[0].id)
    }).catch(fail)
    return () => { cancelled.current = true }
  }, [])

  useEffect(() => {
    if (!activeId) return undefined
    let alive = true
    api('GET', `/api/projects/${activeId}`).then((data) => { if (alive) setDetail(data) }).catch(fail)
    return () => { alive = false }
  }, [activeId])

  async function createProject(payload) {
    setSaving(true)
    setError('')
    try {
      const { project } = await api('POST', '/api/projects', payload)
      setProjects([...(projects || []), project])
      setActiveId(project.id)
      setCreating(false)
    } catch (caught) { fail(caught) } finally { setSaving(false) }
  }

  async function saveProject(payload) {
    setSaving(true)
    setError('')
    try {
      const { project } = await api('PUT', `/api/projects/${activeId}`, payload)
      setProjects(projects.map((item) => (item.id === project.id ? project : item)))
      setDetail({ ...detail, project })
      setEditing(false)
    } catch (caught) { fail(caught) } finally { setSaving(false) }
  }

  async function removeProject() {
    if (!window.confirm(`Delete "${detail.project.name}" with its prompts and measurements?`)) return
    await api('DELETE', `/api/projects/${activeId}`).catch(fail)
    const rest = projects.filter((item) => item.id !== activeId)
    setProjects(rest)
    setActiveId(rest[0]?.id || '')
  }

  async function addPrompts(list) {
    setError('')
    try {
      const data = await api('POST', `/api/projects/${activeId}/prompts`, { prompts: list })
      setDetail({ ...detail, prompts: data.prompts })
      setPromptText('')
    } catch (caught) { fail(caught) }
  }

  async function suggest() {
    setSuggesting(true)
    setError('')
    try {
      const data = await api('POST', `/api/projects/${activeId}/prompts/suggest`)
      const room = detail.promptLimit - detail.prompts.length
      if (room <= 0) throw new Error('Your plan\'s prompt limit is reached. Remove a prompt or upgrade.')
      await addPrompts(data.prompts.slice(0, room))
      onUsage?.()
    } catch (caught) { fail(caught) } finally { setSuggesting(false) }
  }

  async function removePrompt(id) {
    await api('DELETE', `/api/prompts/${id}`).catch(fail)
    setDetail({ ...detail, prompts: detail.prompts.filter((prompt) => prompt.id !== id) })
  }

  async function runMeasurement() {
    setError('')
    try {
      const { measurement } = await api('POST', `/api/projects/${activeId}/measurements`, { surfaces, samples, grounded })
      setProgress({ done: 0, total: measurement.total })
      let state = { status: 'running', remaining: measurement.total }
      let failures = 0
      while (state.status === 'running' && !cancelled.current) {
        try {
          state = await api('POST', `/api/measurements/${measurement.id}/step`)
          failures = 0
          setProgress({ done: measurement.total - state.remaining, total: measurement.total })
        } catch (caught) {
          failures += 1
          if (failures >= 4) throw caught
          await new Promise((resolve) => setTimeout(resolve, 1500 * failures))
        }
      }
      if (state.status === 'failed') setError('No answers could be collected. Please try again in a few minutes.')
      await loadDetail(activeId)
    } catch (caught) { fail(caught) } finally {
      setProgress(null)
      onUsage?.()
    }
  }

  if (projects === null) return <div className="panel processing-panel"><Loader2 className="spin" size={28} /></div>

  if (creating || !projects.length) {
    return (
      <>
        <div className="tool-head"><div><h2>{projects.length ? 'New project' : 'Set up your first project'}</h2><span>One brand, one market</span></div></div>
        {error && <Notice kind="error">{error}</Notice>}
        <ProjectForm initial={emptyProject} onSave={createProject} onCancel={projects.length ? () => setCreating(false) : null} saving={saving} submitLabel="Create project" />
        <div className="how"><strong>How tracking works</strong><ol><li>Add the questions your buyers ask AI assistants.</li><li>Each question is asked on each selected model several times, live.</li><li>We count how often your brand is named, where it ranks among the brands in the answer, and which sites are cited. Nothing is estimated.</li></ol></div>
      </>
    )
  }

  if (!detail || detail.project.id !== activeId) return <div className="panel processing-panel"><Loader2 className="spin" size={28} /></div>
  const { project, prompts, measurements, promptLimit } = detail
  const latest = measurements.find((item) => item.status === 'completed' && item.summary)
  const credits = prompts.length * surfaces.length * samples * (grounded ? account?.groundedMultiplier || 4 : 1)
  const remaining = account ? account.limits.probes - account.usage.probe : null
  const canRun = prompts.length > 0 && surfaces.length > 0 && !progress && (remaining === null || credits <= remaining)

  return (
    <>
      <div className="tool-head">
        <div className="project-switch">
          <Select value={activeId} onChange={setActiveId} options={projects.map((item) => ({ value: item.id, label: item.name }))} />
          <span>{project.brand} · {project.country} · {project.language}{project.domain ? ` · ${project.domain}` : ''}</span>
        </div>
        <div className="button-row">
          <button className="ghost-button" onClick={() => setEditing(!editing)}>{editing ? 'Close' : 'Edit'}</button>
          <button className="ghost-button" onClick={() => { setError(''); setCreating(true) }}><Plus size={16} />New project</button>
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {account && !account.probes && <Notice kind="warn">Live model probes are not configured on this server yet, so measurements cannot run.</Notice>}

      {editing && (
        <>
          <ProjectForm initial={toForm(project)} onSave={saveProject} onCancel={() => setEditing(false)} saving={saving} submitLabel="Save changes" />
          <button className="text-button danger" onClick={removeProject}><Trash2 size={15} />Delete this project</button>
        </>
      )}

      <div className="split">
        <section className="panel">
          <div className="category-head"><h3 className="panel-title">Tracked prompts</h3><span className="category-score">{prompts.length} / {promptLimit}</span></div>
          <ul className="prompt-list">
            {prompts.map((prompt) => <li key={prompt.id}><span>{prompt.text}</span><button className="icon-button small" onClick={() => removePrompt(prompt.id)} aria-label={`Remove prompt: ${prompt.text}`}><X size={15} /></button></li>)}
            {!prompts.length && <li className="muted">No prompts yet. Add the questions buyers ask, without your brand name in them.</li>}
          </ul>
          <form onSubmit={(event) => { event.preventDefault(); const list = splitList(promptText).map((text) => ({ text })); if (list.length) addPrompts(list) }}>
            <Field label="Add prompts" hint="One per line."><textarea value={promptText} onChange={(event) => setPromptText(event.target.value)} placeholder={'e.g. best moisturizer for sensitive skin\nwhich sunscreen do dermatologists recommend'} /></Field>
            <div className="button-row">
              <button className="primary-button" disabled={!promptText.trim()}><Plus size={17} />Add</button>
              <button type="button" className="ghost-button" onClick={suggest} disabled={suggesting}>{suggesting ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}Suggest 10 prompts</button>
            </div>
          </form>
        </section>

        <section className="panel">
          <h3 className="panel-title">Run a measurement</h3>
          <div className="field"><span>AI models</span>
            <div className="check-list compact model-list">
              {(account?.surfaces || []).map((surface) => (
                <label key={surface}><input type="checkbox" checked={surfaces.includes(surface)} onChange={() => setSurfaces(surfaces.includes(surface) ? surfaces.filter((item) => item !== surface) : [...surfaces, surface])} />{surface}</label>
              ))}
            </div>
          </div>
          <Field label="Answers per prompt and model" hint="Answers vary between runs; more samples give a tighter interval.">
            <Select value={String(samples)} onChange={(value) => setSamples(Number(value))} options={Array.from({ length: account?.limits?.maxSamples || 3 }, (_, index) => String(index + 1))} />
          </Field>
          <label className="checkbox-line"><input type="checkbox" checked={grounded} onChange={(event) => setGrounded(event.target.checked)} />Web-grounded answers with sources ({account?.groundedMultiplier || 4}× credits)</label>
          <p className="panel-note">This run collects {prompts.length * surfaces.length * samples} answers and uses <strong>{credits}</strong> answer credits{remaining !== null && <> of {Math.max(0, remaining)} left this month</>}.</p>
          {remaining !== null && credits > remaining && <Notice kind="warn">Not enough credits left this month. Reduce models or samples, or upgrade your plan.</Notice>}
          {progress ? (
            <div className="progress" role="status" aria-live="polite">
              <div className="bar wide"><i style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /></div>
              <span><Loader2 className="spin" size={15} /> Collecting live answers: {progress.done} of {progress.total}. Keep this tab open.</span>
            </div>
          ) : (
            <button className="primary-button" onClick={runMeasurement} disabled={!canRun}><Play size={17} />Measure visibility</button>
          )}
        </section>
      </div>

      {latest ? (
        <>
          <section className="panel"><h3 className="panel-title">Visibility over time</h3><Trend measurements={measurements} /></section>
          <Results measurement={latest} project={project} />
        </>
      ) : (
        <section className="panel empty-result"><p className="eyeline">Result</p><strong>No measurement yet</strong><p>Add prompts, then run a measurement to see how often {project.brand} is named in live AI answers.</p></section>
      )}
    </>
  )
}
