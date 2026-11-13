import { useState } from 'react'
import { Gauge, Loader2 } from 'lucide-react'
import { api } from '../api.js'
import { Field, Kpi, Notice, Select } from './shared.jsx'
import { fmt } from './util.js'

const RATING = { good: ['Good', 'pill-ok'], 'needs-improvement': ['Needs improvement', 'pill-warn'], poor: ['Poor', 'pill-bad'], none: ['No data', ''] }
const ASSESSMENT = { passed: ['Passed', 'pill-ok'], failed: ['Failed', 'pill-bad'], 'no-data': ['Not enough real-user data', ''] }
const ORDER = ['lcp', 'inp', 'cls', 'fcp', 'ttfb']
const TARGET = { lcp: '2.5 s or less', inp: '200 ms or less', cls: '0.1 or less', fcp: '1.8 s or less', ttfb: '0.8 s or less' }
const show = (id, value) => (value === null || value === undefined ? '–' : id === 'cls' ? Number(value).toFixed(2) : value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`)

function Rating({ rating }) {
  const [label, tone] = RATING[rating] || RATING.none
  return <span className={`pill ${tone}`}>{label}</span>
}

function FieldTable({ metrics }) {
  return (
    <div className="table-wrap"><table className="compact-table">
      <thead><tr><th>Metric</th><th>75th percentile</th><th>Rating</th><th>Target</th><th>Share of visits: good / needs improvement / poor</th></tr></thead>
      <tbody>
        {ORDER.filter((id) => metrics[id]).map((id) => {
          const metric = metrics[id]
          return (
            <tr key={id}>
              <td><strong>{metric.label}</strong>{['lcp', 'inp', 'cls'].includes(id) && <span className="pill">Core</span>}</td>
              <td>{show(id, metric.p75)}</td><td><Rating rating={metric.rating} /></td><td>{TARGET[id]}</td>
              <td>{metric.distribution ? <><div className="sentiment-bar" role="img" aria-label={`${metric.distribution.good}% good, ${metric.distribution.needsImprovement}% needs improvement, ${metric.distribution.poor}% poor`}><i className="pos" style={{ width: `${metric.distribution.good}%` }} /><i className="mid" style={{ width: `${metric.distribution.needsImprovement}%` }} /><i className="neg" style={{ width: `${metric.distribution.poor}%` }} /></div><small className="muted">{metric.distribution.good}% / {metric.distribution.needsImprovement}% / {metric.distribution.poor}%</small></> : '–'}</td>
            </tr>
          )
        })}
      </tbody>
    </table></div>
  )
}

function Result({ result }) {
  const [label, tone] = ASSESSMENT[result.field.assessment]
  return (
    <>
      <section className="panel">
        <div className="category-head"><h3 className="panel-title">{result.strategy === 'mobile' ? 'Mobile' : 'Desktop'}: real-user data</h3><span className={`pill ${tone}`}>Core Web Vitals: {label}</span></div>
        {result.field.available ? (
          <>
            {result.field.scope === 'origin' && <Notice kind="warn">This URL does not have enough Chrome traffic of its own, so Google reports the figures for the whole site.</Notice>}
            <FieldTable metrics={result.field.metrics} />
          </>
        ) : <p className="panel-note">Google has no real-user data for this page: it needs more visits from Chrome users over 28 days. Use the lab test below as a guide.</p>}
        {result.field.available && result.field.scope === 'page' && result.origin.available && <p className="panel-note">Whole site: Core Web Vitals {ASSESSMENT[result.origin.assessment][0].toLowerCase()} (LCP {show('lcp', result.origin.metrics.lcp?.p75)}, INP {show('inp', result.origin.metrics.inp?.p75)}, CLS {show('cls', result.origin.metrics.cls?.p75)}).</p>}
      </section>
      <section className="panel">
        <h3 className="panel-title">{result.strategy === 'mobile' ? 'Mobile' : 'Desktop'}: lab test</h3>
        <div className="kpi-row">
          <Kpi label="Performance score" value={result.lab.performanceScore ?? '–'} note="Lighthouse, 0 to 100" />
          <Kpi label="LCP" value={show('lcp', result.lab.lcp)} note={<Rating rating={result.lab.ratings.lcp} />} />
          <Kpi label="CLS" value={show('cls', result.lab.cls)} note={<Rating rating={result.lab.ratings.cls} />} />
          <Kpi label="Total blocking time" value={show('tbt', result.lab.tbt)} note="Lab stand-in for INP" />
        </div>
        {result.runWarnings.map((warning) => <Notice kind="warn" key={warning}>{warning}</Notice>)}
        {result.improvements.length > 0 ? (
          <div className="table-wrap"><table className="compact-table">
            <thead><tr><th>What to improve</th><th>Estimated saving</th><th>Detail</th></tr></thead>
            <tbody>{result.improvements.map((item) => <tr key={item.id}><td><strong>{item.title}</strong></td><td>{fmt(item.savingsMs)} ms{item.savingsBytes ? `, ${fmt(Math.round(item.savingsBytes / 1024))} KB` : ''}</td><td className="wrap-cell">{item.displayValue}</td></tr>)}</tbody>
          </table></div>
        ) : <p className="panel-note">Lighthouse reported no improvement with a measurable time saving.</p>}
        <p className="panel-note">Tested URL: {result.testedUrl}. Lighthouse {result.lighthouseVersion}. Savings are Lighthouse estimates.</p>
      </section>
    </>
  )
}

export default function WebVitals({ onRunComplete }) {
  const [url, setUrl] = useState('')
  const [strategy, setStrategy] = useState('mobile')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  async function run(event) {
    event.preventDefault()
    if (!url.trim()) return setError('Enter a page URL.')
    setLoading(true)
    setError('')
    setData(null)
    try {
      setData(await api('POST', '/api/vitals', { url: url.trim(), strategy }))
      await onRunComplete?.()
    } catch (caught) {
      setError(caught.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="tool-head"><div><h2>Core Web Vitals</h2><span>Real-user and lab performance from Google</span></div></div>
      <form className="panel form-panel full" onSubmit={run}>
        <div className="two-col">
          <Field label="Page URL" required><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" inputMode="url" /></Field>
          <Field label="Device"><Select value={strategy} onChange={setStrategy} options={[{ value: 'mobile', label: 'Mobile' }, { value: 'desktop', label: 'Desktop' }, { value: 'both', label: 'Mobile and desktop (2 credits)' }]} /></Field>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="form-footer">
          <p>Runs Google PageSpeed Insights. A test takes 10 to 40 seconds.</p>
          <button className="primary-button" disabled={loading}>{loading ? <Loader2 className="spin" size={17} /> : <Gauge size={17} />}{loading ? 'Testing…' : 'Test page'}</button>
        </div>
      </form>
      {data && (
        <div className="audit">
          {data.failed.map((item) => <Notice kind="warn" key={item.strategy}>{item.strategy === 'mobile' ? 'Mobile' : 'Desktop'} test failed: {item.error}</Notice>)}
          {data.results.map((result) => <Result key={result.strategy} result={result} />)}
          <p className="panel-note">{data.method}</p>
        </div>
      )}
    </>
  )
}
