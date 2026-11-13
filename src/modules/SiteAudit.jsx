import { useEffect, useState } from 'react'
import { Download, GitCompareArrows, Loader2, ScanSearch, Wand2 } from 'lucide-react'
import { api } from '../api.js'
import { Delta, Field, Kpi, Notice, ScoreRing, Select, Spark, StatusIcon } from './shared.jsx'
import { downloadCsv, hostOf } from './util.js'

const purposeLabel = { search: 'Search index', user: 'Live answer fetch', training: 'Model training' }

function exportAudit(result) {
  const rows = [['Category', 'Check', 'Status', 'Detail', 'Recommended fix']]
  result.categories.forEach((category) => category.checks.forEach((item) => rows.push([category.label, item.label, item.status, item.detail, item.fix])))
  if (result.rendering?.ok) result.rendering.category.checks.forEach((item) => rows.push([result.rendering.category.label, item.label, item.status, item.detail, item.fix]))
  rows.push([], ['Crawler', 'Operator', 'Purpose', 'robots.txt', 'HTTP status'])
  result.bots.forEach((bot) => rows.push([bot.name, bot.operator, purposeLabel[bot.purpose], bot.robots, bot.http ?? 'n/a']))
  downloadCsv(`site-audit-${new URL(result.url).hostname}-${result.fetchedAt.slice(0, 10)}.csv`, rows)
}

const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// Earlier audits of the same site, with a check-by-check comparison of any two.
function AuditHistory({ host, currentId }) {
  const [audits, setAudits] = useState(null)
  const [pair, setPair] = useState({ a: '', b: '' })
  const [diff, setDiff] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    api('GET', `/api/audits?host=${encodeURIComponent(host)}`).then((data) => {
      if (!alive) return
      setAudits(data.audits)
      const latest = data.audits.find((item) => item.id === currentId) || data.audits[0]
      const earlier = data.audits.find((item) => item.id !== latest?.id && item.url === latest?.url) || data.audits.find((item) => item.id !== latest?.id)
      if (latest && earlier) setPair({ a: earlier.id, b: latest.id })
    }).catch(() => { if (alive) setAudits([]) })
    return () => { alive = false }
  }, [host, currentId])

  async function compare() {
    setError('')
    try {
      setDiff(await api('GET', `/api/audits/compare?a=${pair.a}&b=${pair.b}`))
    } catch (caught) {
      setError(caught.message)
    }
  }

  if (!audits || audits.length < 2) {
    return audits ? <section className="panel"><h3 className="panel-title">Audit history</h3><p className="panel-note">This is the first saved audit for {host}. Run it again after making changes to compare the results check by check.</p></section> : null
  }
  const options = audits.map((item) => ({ value: item.id, label: `${when(item.createdAt)} · ${item.score}/100 · ${item.url.replace(/^https?:\/\/[^/]+/, '') || '/'}` }))
  const samePage = audits.filter((item) => item.url === audits[0].url).slice(0, 20).reverse()
  return (
    <section className="panel">
      <h3 className="panel-title">Audit history for {host}</h3>
      <div className="history-head">
        <div><span className="muted">Score over the last {samePage.length} audits of this URL</span><br /><Spark values={samePage.map((item) => item.score)} label={`Audit score history, latest ${samePage.at(-1).score}`} /></div>
        <p className="panel-note">{audits.length} saved audit{audits.length > 1 ? 's' : ''} for this site.</p>
      </div>
      <div className="two-col">
        <Field label="Compare"><Select value={pair.a} onChange={(value) => { setPair({ ...pair, a: value }); setDiff(null) }} options={options} /></Field>
        <Field label="With"><Select value={pair.b} onChange={(value) => { setPair({ ...pair, b: value }); setDiff(null) }} options={options} /></Field>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <button type="button" className="ghost-button small" onClick={compare} disabled={!pair.a || !pair.b || pair.a === pair.b}><GitCompareArrows size={16} />Compare audits</button>
      {diff && (
        <div className="brief">
          <div className="kpi-row">
            <Kpi label="Score" value={`${diff.before.score} → ${diff.after.score}`} note={<Delta value={diff.scoreChange} />} />
            <Kpi label="Checks improved" value={diff.improved} />
            <Kpi label="Checks regressed" value={diff.regressed} />
            <Kpi label="Unchanged" value={diff.unchanged} />
          </div>
          {diff.before.url !== diff.after.url && <Notice kind="warn">These audits are of different URLs, so differences may come from the pages rather than from changes over time.</Notice>}
          {diff.changes.length ? (
            <ul className="check-rows">
              {diff.changes.map((change) => (
                <li key={change.id}><StatusIcon status={change.to || 'info'} /><div><strong>{change.label}</strong> <span className={`pill ${change.direction === 'improved' ? 'pill-ok' : change.direction === 'regressed' ? 'pill-bad' : ''}`}>{change.direction === 'new' ? 'new check' : change.direction === 'removed' ? 'not in the newer audit' : `${change.from} → ${change.to}`}</span>{change.detail && <p>{change.detail}</p>}</div></li>
              ))}
            </ul>
          ) : <p className="panel-note">Every check has the same result in both audits.</p>}
        </div>
      )}
    </section>
  )
}

export default function SiteAudit({ account, onRunComplete }) {
  const [url, setUrl] = useState('')
  const [pages, setPages] = useState(0)
  const [render, setRender] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const maxPages = account?.limits?.auditPages || 0
  const canRender = Boolean(account?.features?.render)

  async function run(event) {
    event?.preventDefault()
    if (!url.trim()) return setError('Enter a website URL.')
    setLoading(true)
    setError('')
    setResult(null)
    try {
      setResult(await api('POST', '/api/audit', { url: url.trim(), pages: Math.min(pages, maxPages), render: render && canRender }))
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
          {canRender && (
            <label className="check-option">
              <input type="checkbox" checked={render} onChange={(event) => setRender(event.target.checked)} />
              <span><strong>Also render the page with JavaScript</strong><br />Loads the page in headless Chromium and shows what only exists after scripts run. Takes longer and uses two audit credits.</span>
            </label>
          )}
          {error && <Notice kind="error">{error}</Notice>}
          <div className="form-footer">
            <p>Checks crawl access for 14 search and AI crawlers, indexability, on-page SEO, structured data and how extractable the content is for answer engines.</p>
            <button className="primary-button" disabled={loading}>{loading ? <Loader2 className="spin" size={17} /> : <ScanSearch size={17} />}{loading ? (render && canRender ? 'Auditing and rendering…' : 'Auditing…') : 'Run audit'}</button>
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

          {result.rendering && !result.rendering.ok && <Notice kind="warn">JavaScript rendering did not complete: {result.rendering.error} The rest of the audit is unaffected.</Notice>}
          {result.rendering?.ok && (
            <section className="panel">
              <div className="category-head"><h3 className="panel-title">{result.rendering.category.label}</h3><span className="category-score">{result.rendering.score}/100</span></div>
              <div className="kpi-row">
                <Kpi label="Words without JavaScript" value={result.rendering.raw.words} />
                <Kpi label="Words after rendering" value={result.rendering.rendered.words} />
                <Kpi label="Text in raw HTML" value={`${result.rendering.contentShare}%`} />
                <Kpi label="Links raw / rendered" value={`${result.rendering.raw.internalLinks} / ${result.rendering.rendered.internalLinks}`} />
              </div>
              <ul className="check-rows">
                {result.rendering.category.checks.map((item) => (
                  <li key={item.id}><StatusIcon status={item.status} /><div><strong>{item.label}</strong><p>{item.detail}</p>{item.fix && <p className="fix">{item.fix}</p>}</div></li>
                ))}
              </ul>
              <p className="panel-note">{result.rendering.method} This section has its own score and does not change the audit score above.</p>
            </section>
          )}

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
          <AuditHistory host={hostOf(result.url)} currentId={result.auditId} />
          <div className="result-actions"><button className="primary-button" onClick={() => { setResult(null) }}><Wand2 size={17} />Audit another page</button></div>
        </div>
      )}
    </>
  )
}
