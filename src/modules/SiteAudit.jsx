import { useState } from 'react'
import { Download, Loader2, ScanSearch, Wand2 } from 'lucide-react'
import { api } from '../api.js'
import { Field, Kpi, Notice, ScoreRing, Select, StatusIcon } from './shared.jsx'
import { downloadCsv } from './util.js'

const purposeLabel = { search: 'Search index', user: 'Live answer fetch', training: 'Model training' }

function exportAudit(result) {
  const rows = [['Category', 'Check', 'Status', 'Detail', 'Recommended fix']]
  result.categories.forEach((category) => category.checks.forEach((item) => rows.push([category.label, item.label, item.status, item.detail, item.fix])))
  rows.push([], ['Crawler', 'Operator', 'Purpose', 'robots.txt', 'HTTP status'])
  result.bots.forEach((bot) => rows.push([bot.name, bot.operator, purposeLabel[bot.purpose], bot.robots, bot.http ?? 'n/a']))
  downloadCsv(`site-audit-${new URL(result.url).hostname}-${result.fetchedAt.slice(0, 10)}.csv`, rows)
}

export default function SiteAudit({ account, onRunComplete }) {
  const [url, setUrl] = useState('')
  const [pages, setPages] = useState(0)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const maxPages = account?.limits?.auditPages || 0

  async function run(event) {
    event?.preventDefault()
    if (!url.trim()) return setError('Enter a website URL.')
    setLoading(true)
    setError('')
    setResult(null)
    try {
      setResult(await api('POST', '/api/audit', { url: url.trim(), pages: Math.min(pages, maxPages) }))
      await onRunComplete?.()
    } catch (runError) {
      setError(runError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="tool-head">
        <div><h2>Technical SEO and AI readiness audit</h2><span>Rule-based, reproducible score</span></div>
        {result && <button className="ghost-button" onClick={() => { setResult(null); setUrl('') }}>New audit</button>}
      </div>

      {!result && (
        <form className="panel form-panel full" onSubmit={run}>
          <div className={maxPages ? 'two-col' : ''}>
            <Field label="Page URL" required hint="The audit fetches the page the way a crawler does: no JavaScript is executed.">
              <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" inputMode="url" />
            </Field>
            {maxPages > 0 && (
              <Field label="Also sample pages from the sitemap">
                <Select value={String(pages)} onChange={(value) => setPages(Number(value))} options={[0, ...Array.from({ length: maxPages }, (_, index) => index + 1)].map((count) => ({ value: String(count), label: count ? `${count} more page${count > 1 ? 's' : ''}` : 'This page only' }))} />
              </Field>
            )}
          </div>
          {error && <Notice kind="error">{error}</Notice>}
          <div className="form-footer">
            <p>Checks crawl access for 14 search and AI crawlers, indexability, on-page SEO, structured data and how extractable the content is for answer engines.</p>
            <button className="primary-button" disabled={loading}>{loading ? <Loader2 className="spin" size={17} /> : <ScanSearch size={17} />}{loading ? 'Auditing…' : 'Run audit'}</button>
          </div>
        </form>
      )}

      {result && (
        <div className="audit">
          <section className="panel audit-head">
            <ScoreRing score={result.score} label="Audit score" />
            <div>
              <p className="eyeline">Audit result</p>
              <h3>{result.url}</h3>
              <p className="result-summary">{result.summary} {result.method}</p>
              <div className="kpi-row">
                <Kpi label="Passed" value={result.counts.pass} />
                <Kpi label="Needs attention" value={result.counts.warn} />
                <Kpi label="Failed" value={result.counts.fail} />
                <Kpi label="Words in raw HTML" value={result.page?.wordCount ?? 0} />
              </div>
              <button type="button" className="ghost-button small" onClick={() => exportAudit(result)}><Download size={16} />Export CSV</button>
            </div>
          </section>

          {result.topFixes.length > 0 && (
            <section className="panel">
              <h3 className="panel-title">Fix these first</h3>
              <ol className="fix-list">
                {result.topFixes.map((item) => (
                  <li key={item.label}><StatusIcon status={item.status} /><div><strong>{item.label}</strong><p>{item.fix}</p><small>{item.detail}</small></div></li>
                ))}
              </ol>
            </section>
          )}

          <section className="panel">
            <h3 className="panel-title">Crawler access</h3>
            <p className="panel-note">robots.txt is evaluated per crawler for this URL. HTTP status is a live request with that crawler's user-agent from our server, so confirm blocks against your logs.</p>
            <div className="table-wrap">
              <table className="compact-table">
                <thead><tr><th>Crawler</th><th>Operator</th><th>Used for</th><th>robots.txt</th><th>HTTP</th></tr></thead>
                <tbody>
                  {result.bots.map((bot) => (
                    <tr key={bot.name}>
                      <td><strong>{bot.name}</strong></td><td>{bot.operator}</td><td>{purposeLabel[bot.purpose]}</td>
                      <td><span className={`pill ${bot.robots === 'allowed' ? 'pill-ok' : 'pill-bad'}`}>{bot.robots === 'allowed' ? 'Allowed' : 'Disallowed'}</span>{bot.rule && <small className="rule"> {bot.rule}</small>}</td>
                      <td>{bot.http === null ? <span className="muted">not requested</span> : <span className={`pill ${bot.http === 200 ? 'pill-ok' : 'pill-bad'}`}>{bot.http}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {result.categories.map((category) => (
            <section className="panel" key={category.id}>
              <div className="category-head"><h3 className="panel-title">{category.label}</h3>{category.score !== null && <span className="category-score">{category.score}/100</span>}</div>
              <ul className="check-rows">
                {category.checks.map((item) => (
                  <li key={item.id}><StatusIcon status={item.status} /><div><strong>{item.label}</strong><p>{item.detail}</p>{item.fix && <p className="fix">{item.fix}</p>}</div></li>
                ))}
              </ul>
            </section>
          ))}

          {result.pages.length > 0 && (
            <section className="panel">
              <h3 className="panel-title">Sampled pages from the sitemap</h3>
              <div className="table-wrap">
                <table className="compact-table">
                  <thead><tr><th>Page</th><th>Score</th><th>Top issue</th></tr></thead>
                  <tbody>
                    {result.pages.map((page) => {
                      const worst = page.categories.flatMap((category) => category.checks).filter((item) => item.status === 'fail').sort((a, b) => b.weight - a.weight)[0]
                      return <tr key={page.url}><td>{page.url}</td><td><strong>{page.error ? '–' : page.score}</strong></td><td>{page.error || worst?.label || 'No failed checks'}</td></tr>
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <div className="result-actions"><button className="primary-button" onClick={() => { setResult(null) }}><Wand2 size={17} />Audit another page</button></div>
        </div>
      )}
    </>
  )
}
