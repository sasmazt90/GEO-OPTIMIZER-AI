import { useState } from 'react'
import { Braces, CheckCheck, Copy, Loader2 } from 'lucide-react'
import { api } from '../api.js'
import { Field, Kpi, Notice, Select, StatusIcon, Tabs } from './shared.jsx'
import { TEMPLATES, asScriptTag, buildJsonLd } from './schemaTemplates.js'

function Report({ report }) {
  return (
    <div className="audit">
      <section className="panel">
        <h3 className="panel-title">{report.source === 'url' ? report.url : 'Validation result'}</h3>
        <div className="kpi-row">
          <Kpi label="JSON-LD blocks" value={report.blocks} />
          <Kpi label="Valid" value={report.counts.pass} />
          <Kpi label="With warnings" value={report.counts.warn} />
          <Kpi label="With errors" value={report.counts.fail} />
        </div>
        {report.source === 'url' && report.blocks === 0 && <Notice kind="warn">No JSON-LD was found in the raw HTML of this page. If your markup is added by JavaScript, crawlers that do not render will not see it.</Notice>}
        {report.features.length > 0 && <p className="panel-note">Markup without errors for: {report.features.join(', ')}.</p>}
        <p className="panel-note">{report.method}</p>
      </section>
      {report.parseErrors.map((item) => <Notice kind="error" key={`${item.block}-${item.message}`}>Block {item.block}: {item.message}</Notice>)}
      {report.items.map((item, index) => (
        <section className="panel" key={`${item.block}-${item.type}-${index}`}>
          <div className="category-head"><h3 className="panel-title"><StatusIcon status={item.status} /> {item.type}{item.name ? `: ${item.name}` : ''}</h3><span className="category-score">Block {item.block} · {item.properties} properties</span></div>
          {item.note && <p className="panel-note">{item.note}</p>}
          {!item.errors.length && !item.warnings.length && <p className="panel-note">No issues found.</p>}
          <ul className="check-rows">
            {item.errors.map((message) => <li key={message}><StatusIcon status="fail" /><div><p>{message}</p></div></li>)}
            {item.warnings.map((message) => <li key={message}><StatusIcon status="warn" /><div><p>{message}</p></div></li>)}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Validator({ onRunComplete }) {
  const [url, setUrl] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')

  async function run(event) {
    event.preventDefault()
    if (!url.trim() && !code.trim()) return setError('Enter a page URL or paste JSON-LD.')
    setLoading(true)
    setError('')
    setReport(null)
    try {
      setReport(await api('POST', '/api/schema/validate', url.trim() ? { url: url.trim() } : { code }))
      if (url.trim()) await onRunComplete?.()
    } catch (caught) {
      setError(caught.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <form className="panel form-panel full" onSubmit={run}>
        <Field label="Page URL" hint="Reads the JSON-LD in the page's raw HTML. Uses one audit credit."><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/product" inputMode="url" /></Field>
        <Field label="Or paste JSON-LD" hint="Raw JSON-LD or the full <script> tags. Pasted code is checked for free."><textarea className="large code-input" value={code} onChange={(event) => setCode(event.target.value)} placeholder={'{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "Acme"\n}'} spellCheck={false} disabled={Boolean(url.trim())} /></Field>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="form-footer">
          <p>Checks syntax, value formats and the properties Google documents for each type.</p>
          <button className="primary-button" disabled={loading}>{loading ? <Loader2 className="spin" size={17} /> : <CheckCheck size={17} />}{loading ? 'Validating…' : 'Validate'}</button>
        </div>
      </form>
      {report && <Report report={report} />}
    </>
  )
}

function Generator() {
  const [typeId, setTypeId] = useState(TEMPLATES[0].id)
  const [values, setValues] = useState({})
  const [copied, setCopied] = useState(false)
  const [report, setReport] = useState(null)
  const [checking, setChecking] = useState(false)
  const template = TEMPLATES.find((item) => item.id === typeId)
  const current = values[typeId] || {}
  const json = buildJsonLd(template, current)
  const output = asScriptTag(json)
  const set = (key) => (event) => {
    setReport(null)
    setValues((all) => ({ ...all, [typeId]: { ...all[typeId], [key]: event.target.value } }))
  }

  async function copy() {
    await navigator.clipboard?.writeText(output).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  async function check() {
    setChecking(true)
    try {
      setReport(await api('POST', '/api/schema/validate', { code: json }))
    } catch (caught) {
      setReport({ failed: caught.message })
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <div className="split">
        <section className="panel">
          <Field label="Schema type"><Select value={typeId} onChange={(value) => { setTypeId(value); setReport(null) }} options={TEMPLATES.map((item) => ({ value: item.id, label: item.label }))} /></Field>
          {template.fields.map(([key, label, placeholder, kind]) => (
            <Field label={label} key={`${typeId}-${key}`}>
              {kind === 'textarea' ? <textarea value={current[key] || ''} onChange={set(key)} placeholder={placeholder} /> : <input value={current[key] || ''} onChange={set(key)} placeholder={placeholder} />}
            </Field>
          ))}
        </section>
        <section className="panel">
          <div className="category-head"><h3 className="panel-title">JSON-LD</h3>
            <div className="button-row">
              <button type="button" className="ghost-button small" onClick={check} disabled={checking}>{checking ? <Loader2 className="spin" size={16} /> : <CheckCheck size={16} />}Validate</button>
              <button type="button" className="ghost-button small" onClick={copy}><Copy size={16} />{copied ? 'Copied' : 'Copy'}</button>
            </div>
          </div>
          <pre className="code-output" aria-label="Generated JSON-LD">{output}</pre>
          <p className="panel-note">Paste this into the page's HTML, ideally in the server response. Only describe content that is visible on the page.</p>
        </section>
      </div>
      {report?.failed && <Notice kind="error">{report.failed}</Notice>}
      {report && !report.failed && <Report report={report} />}
    </>
  )
}

export default function SchemaMarkup({ onRunComplete }) {
  const [tab, setTab] = useState('validate')
  return (
    <>
      <div className="tool-head"><div><h2>Schema markup</h2><span><Braces size={14} /> Validate and generate JSON-LD</span></div></div>
      <Tabs value={tab} onChange={setTab} options={[{ id: 'validate', label: 'Validate' }, { id: 'generate', label: 'Generate' }]} label="Schema tools" />
      {tab === 'validate' ? <Validator onRunComplete={onRunComplete} /> : <Generator />}
    </>
  )
}
