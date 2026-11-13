import { useCallback, useEffect, useState } from 'react'
import { Download, Link2, Loader2, Plus, RefreshCw, Trash2, Unplug } from 'lucide-react'
import { api } from '../api.js'
import { Delta, Field, Kpi, Notice, Select, Spark, Tabs } from './shared.jsx'
import { downloadCsv, fmt } from './util.js'

const RANGES = [{ value: '7', label: 'Last 7 days' }, { value: '28', label: 'Last 28 days' }, { value: '90', label: 'Last 3 months' }]
const TABS = [{ id: 'performance', label: 'Performance' }, { id: 'rankings', label: 'Rank tracking' }, { id: 'opportunities', label: 'Keyword opportunities' }]
const REASONS = {
  denied: 'Access was not granted on the Google screen.',
  state: 'The sign-in could not be verified. Start the connection again from this page.',
  scope_missing: 'Search Console access was not ticked on the Google consent screen.',
  no_refresh_token: 'Google did not return a long-lived token. Remove the app at myaccount.google.com/permissions and connect again.',
  migration: 'The database update for this feature has not been applied yet.',
  not_configured: 'Search Console is not set up on this server yet.',
}
const pct = (value) => `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
const pathOf = (url) => {
  try {
    const parsed = new URL(url)
    return parsed.pathname + parsed.search
  } catch {
    return url
  }
}

function DailyChart({ daily }) {
  if (daily.length < 2) return <p className="panel-note">Not enough days with data to draw a trend.</p>
  const width = 640
  const height = 150
  const pad = 30
  const max = Math.max(1, ...daily.map((point) => point.clicks))
  const x = (index) => pad + (index * (width - pad * 2)) / (daily.length - 1)
  const y = (value) => height - pad - (value / max) * (height - pad * 2)
  return (
    <svg className="trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Daily clicks from ${daily[0].date} to ${daily.at(-1).date}, peak ${max}`}>
      {[0, max].map((tick) => <g key={tick}><line x1={pad} x2={width - pad} y1={y(tick)} y2={y(tick)} className="trend-grid" /><text x={2} y={y(tick) + 4} className="trend-label">{fmt(tick)}</text></g>)}
      <polyline points={daily.map((point, index) => `${x(index)},${y(point.clicks)}`).join(' ')} className="trend-line" />
      <text x={pad} y={height - 6} className="trend-label">{daily[0].date}</text>
      <text x={width - pad} y={height - 6} textAnchor="end" className="trend-label">{daily.at(-1).date}</text>
    </svg>
  )
}

function QueryTable({ rows, first, limit = 25 }) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, limit)
  if (!rows.length) return <p className="panel-note">No rows in this period.</p>
  return (
    <>
      <div className="table-wrap">
        <table className="compact-table">
          <thead><tr><th>{first}</th><th>Clicks</th><th>Change</th><th>Impressions</th><th>CTR</th><th>Position</th><th>Change</th></tr></thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.key}>
                <td className="wrap-cell">{first === 'Page' ? pathOf(row.key) : row.key}</td><td>{fmt(row.clicks)}</td><td><Delta value={row.clicksChange} /></td>
                <td>{fmt(row.impressions)}</td><td>{pct(row.ctr)}</td><td>{row.position}</td><td><Delta value={row.positionChange} digits={1} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <button type="button" className="link-button" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}
    </>
  )
}

function Performance({ data }) {
  const { current, previous, hasPrevious } = data.totals
  const change = (key, digits = 0) => (hasPrevious ? <Delta value={key === 'position' ? Math.round((previous.position - current.position) * 10) / 10 : Math.round((current[key] - previous[key]) * 100) / 100} digits={digits} /> : null)
  return (
    <>
      <section className="panel">
        <div className="category-head"><h3 className="panel-title">Search performance</h3>
          <button type="button" className="ghost-button small" onClick={() => downloadCsv(`search-queries-${data.ranges.current.endDate}.csv`, [['Query', 'Clicks', 'Clicks change', 'Impressions', 'CTR %', 'Position', 'Position change'], ...data.queries.map((row) => [row.key, row.clicks, row.clicksChange ?? '', row.impressions, row.ctr, row.position, row.positionChange ?? ''])])}><Download size={16} />Export queries</button>
        </div>
        <div className="kpi-row">
          <Kpi label="Clicks" value={fmt(current.clicks)} note={change('clicks')} />
          <Kpi label="Impressions" value={fmt(current.impressions)} note={change('impressions')} />
          <Kpi label="Average CTR" value={pct(current.ctr)} note={change('ctr', 2)} />
          <Kpi label="Average position" value={current.position ?? '–'} note={change('position', 1)} />
        </div>
        <DailyChart daily={data.daily} />
        <p className="panel-note">{data.method}</p>
      </section>
      <section className="panel"><h3 className="panel-title">Top queries</h3><QueryTable rows={data.queries} first="Query" /></section>
      <section className="panel"><h3 className="panel-title">Top pages</h3><QueryTable rows={data.pages} first="Page" /></section>
    </>
  )
}

function Movers({ title, rows, note }) {
  return (
    <section className="panel">
      <h3 className="panel-title">{title}</h3>
      {rows.length ? (
        <div className="table-wrap"><table className="compact-table">
          <thead><tr><th>Query</th><th>Position</th><th>Before</th><th>Change</th><th>Clicks</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.key}><td className="wrap-cell">{row.key}</td><td>{row.position}</td><td>{row.previousPosition ?? '–'}</td><td>{row.positionChange === undefined ? '–' : <Delta value={row.positionChange} digits={1} />}</td><td>{fmt(row.clicks)}</td></tr>)}</tbody>
        </table></div>
      ) : <p className="panel-note">{note}</p>}
    </section>
  )
}

function Keywords({ site, days }) {
  const [state, setState] = useState({ loading: true, keywords: [], error: '' })
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try {
      const data = await api('POST', '/api/gsc/keyword-trends', { siteUrl: site, days })
      setState({ loading: false, keywords: data.keywords, error: '' })
    } catch (error) {
      setState({ loading: false, keywords: [], error: error.message })
    }
  }, [site, days])
  useEffect(() => {
    let alive = true
    api('POST', '/api/gsc/keyword-trends', { siteUrl: site, days })
      .then((data) => { if (alive) setState({ loading: false, keywords: data.keywords, error: '' }) })
      .catch((error) => { if (alive) setState({ loading: false, keywords: [], error: error.message }) })
    return () => { alive = false }
  }, [site, days])

  async function add(event) {
    event.preventDefault()
    const queries = draft.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)
    if (!queries.length) return
    setBusy(true)
    try {
      await api('POST', '/api/gsc/keywords', { siteUrl: site, queries })
      setDraft('')
      await load()
    } catch (error) {
      setState((current) => ({ ...current, error: error.message }))
    } finally {
      setBusy(false)
    }
  }
  async function remove(id) {
    await api('DELETE', `/api/gsc/keywords/${id}`).catch(() => {})
    await load()
  }

  return (
    <section className="panel">
      <h3 className="panel-title">Tracked keywords</h3>
      <p className="panel-note">Daily average position for the keywords you choose, straight from Search Console. A keyword shows no data on days it had no impressions.</p>
      <form className="inline-form" onSubmit={add}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add keywords, separated by commas" aria-label="Keywords to track" />
        <button className="ghost-button" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}Track</button>
      </form>
      {state.error && <Notice kind="error">{state.error}</Notice>}
      {state.loading ? <p className="panel-note"><Loader2 className="spin" size={14} /> Loading positions…</p> : state.keywords.length > 0 && (
        <div className="table-wrap"><table className="compact-table">
          <thead><tr><th>Keyword</th><th>Avg. position</th><th>Change</th><th>Best</th><th>Trend</th><th>Clicks</th><th>Impressions</th><th /></tr></thead>
          <tbody>
            {state.keywords.map((keyword) => (
              <tr key={keyword.id}>
                <td className="wrap-cell"><strong>{keyword.query}</strong></td>
                <td>{keyword.position ?? <span className="muted">no impressions</span>}</td>
                <td>{keyword.change === null ? <span className="muted">–</span> : <Delta value={keyword.change} digits={1} />}</td>
                <td>{keyword.best ?? '–'}</td>
                <td><Spark values={keyword.series.map((point) => point.position)} invert label={`Position trend for ${keyword.query}`} /></td>
                <td>{fmt(keyword.clicks)}</td><td>{fmt(keyword.impressions)}</td>
                <td><button type="button" className="icon-button small" aria-label={`Stop tracking ${keyword.query}`} onClick={() => remove(keyword.id)}><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </section>
  )
}

function Rankings({ data, site, days }) {
  const { rankings } = data
  return (
    <>
      <Keywords site={site} days={days} />
      <section className="panel">
        <h3 className="panel-title">Ranking distribution</h3>
        <div className="table-wrap"><table className="compact-table">
          <thead><tr><th>Position</th><th>Queries now</th><th>Previous period</th><th>Change</th></tr></thead>
          <tbody>{rankings.distribution.map((row) => <tr key={row.label}><td><strong>{row.label}</strong></td><td>{fmt(row.current)}</td><td>{fmt(row.previous)}</td><td><Delta value={row.current - row.previous} /></td></tr>)}</tbody>
        </table></div>
        <p className="panel-note">Counted from the top 1,000 queries by clicks in each period.</p>
      </section>
      <div className="split">
        <Movers title="Biggest gains" rows={rankings.improved} note="No query moved up by a full position." />
        <Movers title="Biggest drops" rows={rankings.declined} note="No query moved down by a full position." />
      </div>
      <div className="split">
        <Movers title="New queries" rows={rankings.newQueries.map((row) => ({ ...row, positionChange: undefined }))} note="No new queries in this period." />
        <Movers title="Queries no longer ranking" rows={rankings.lostQueries.map((row) => ({ ...row, previousPosition: row.position, position: '–', positionChange: undefined }))} note="No queries dropped out." />
      </div>
    </>
  )
}

function Opportunities({ site, days }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' })
  useEffect(() => {
    let alive = true
    api('POST', '/api/gsc/opportunities', { siteUrl: site, days })
      .then((data) => { if (alive) setState({ loading: false, data, error: '' }) })
      .catch((error) => { if (alive) setState({ loading: false, data: null, error: error.message }) })
    return () => { alive = false }
  }, [site, days])
  if (state.loading) return <section className="panel"><p className="panel-note"><Loader2 className="spin" size={14} /> Reading query and page data…</p></section>
  if (state.error) return <Notice kind="error">{state.error}</Notice>
  const data = state.data
  const exportAll = () => downloadCsv(`keyword-opportunities-${data.range.endDate}.csv`, [
    ['Type', 'Query', 'Page', 'Impressions', 'Clicks', 'CTR %', 'Position', 'Note'],
    ...data.striking.map((row) => ['Striking distance', row.query, row.page, row.impressions, row.clicks, row.ctr, row.position, '']),
    ...data.lowCtr.map((row) => ['Low CTR', row.query, row.page, row.impressions, row.clicks, row.ctr, row.position, `Site median at this position ${row.benchmarkCtr}%`]),
    ...data.cannibalization.flatMap((row) => row.pages.map((page) => ['Competing pages', row.query, page.page, page.impressions, page.clicks, '', page.position, ''])),
    ...data.questions.map((row) => ['Question', row.query, row.page, row.impressions, row.clicks, row.ctr, row.position, '']),
  ])
  return (
    <>
      <section className="panel">
        <div className="category-head"><h3 className="panel-title">Keyword opportunities</h3><button type="button" className="ghost-button small" onClick={exportAll}><Download size={16} />Export CSV</button></div>
        <div className="kpi-row">
          <Kpi label="Striking distance" value={data.striking.length} note="Position 4 to 20" />
          <Kpi label="Low CTR" value={data.lowCtr.length} note="Below half your own median" />
          <Kpi label="Competing pages" value={data.cannibalization.length} note="Two or more URLs per query" />
          <Kpi label="Question queries" value={data.questions.length} note="Answer-engine candidates" />
        </div>
        <p className="panel-note">{data.method} {fmt(data.analysed.queries)} queries analysed{data.truncated ? ' (the 5,000 highest-traffic query and page pairs)' : ''}.</p>
      </section>
      <section className="panel">
        <h3 className="panel-title">Striking distance: close to the top results</h3>
        {data.striking.length ? <div className="table-wrap"><table className="compact-table">
          <thead><tr><th>Query</th><th>Position</th><th>Impressions</th><th>Clicks</th><th>CTR</th><th>Ranking page</th></tr></thead>
          <tbody>{data.striking.map((row) => <tr key={row.query}><td className="wrap-cell"><strong>{row.query}</strong></td><td>{row.position}</td><td>{fmt(row.impressions)}</td><td>{fmt(row.clicks)}</td><td>{pct(row.ctr)}</td><td className="wrap-cell">{pathOf(row.page)}{row.pageCount > 1 && <span className="pill">+{row.pageCount - 1}</span>}</td></tr>)}</tbody>
        </table></div> : <p className="panel-note">No queries between position 4 and 20 with at least 10 impressions.</p>}
      </section>
      <section className="panel">
        <h3 className="panel-title">Low click-through rate for the position</h3>
        {data.lowCtr.length ? <div className="table-wrap"><table className="compact-table">
          <thead><tr><th>Query</th><th>Position</th><th>CTR</th><th>Your median here</th><th>Impressions</th><th>Clicks left on the table</th></tr></thead>
          <tbody>{data.lowCtr.map((row) => <tr key={row.query}><td className="wrap-cell"><strong>{row.query}</strong><br /><small className="muted">{pathOf(row.page)}</small></td><td>{row.position}</td><td>{pct(row.ctr)}</td><td>{pct(row.benchmarkCtr)}</td><td>{fmt(row.impressions)}</td><td>{fmt(row.missedClicks)}</td></tr>)}</tbody>
        </table></div> : <p className="panel-note">{data.ctrBenchmarks.length ? 'No query falls below half of your own median CTR for its position.' : 'Not enough comparable queries to set a CTR benchmark from your own data yet.'}</p>}
      </section>
      <section className="panel">
        <h3 className="panel-title">Pages competing for the same query</h3>
        {data.cannibalization.length ? <ul className="check-rows">{data.cannibalization.map((row) => (
          <li key={row.query}><span /><div><strong>{row.query}</strong> <span className="muted">{fmt(row.impressions)} impressions</span>
            {row.pages.map((page) => <p key={page.page}>{pathOf(page.page)}: position {page.position}, {fmt(page.impressions)} impressions, {fmt(page.clicks)} clicks</p>)}</div></li>
        ))}</ul> : <p className="panel-note">No query has two pages that each take at least 10% of its impressions.</p>}
      </section>
      <section className="panel">
        <h3 className="panel-title">Question queries</h3>
        <p className="panel-note">Questions people already search and find you for. They are good prompts to add to Visibility Tracking and to answer directly on the ranking page.</p>
        {data.questions.length ? <div className="table-wrap"><table className="compact-table">
          <thead><tr><th>Question</th><th>Position</th><th>Impressions</th><th>Clicks</th><th>Ranking page</th></tr></thead>
          <tbody>{data.questions.map((row) => <tr key={row.query}><td className="wrap-cell"><strong>{row.query}</strong></td><td>{row.position}</td><td>{fmt(row.impressions)}</td><td>{fmt(row.clicks)}</td><td className="wrap-cell">{pathOf(row.page)}</td></tr>)}</tbody>
        </table></div> : <p className="panel-note">No question-style queries in this period.</p>}
      </section>
    </>
  )
}

export default function SearchConsole({ notice }) {
  const [status, setStatus] = useState(null)
  const [sites, setSites] = useState([])
  const [site, setSite] = useState('')
  const [days, setDays] = useState(28)
  const [tab, setTab] = useState('performance')
  const [performance, setPerformance] = useState({ loading: false, data: null, error: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    api('GET', '/api/gsc/status').then(async (data) => {
      if (!alive) return
      setStatus(data)
      if (!data.connected) return
      const list = (await api('GET', '/api/gsc/sites')).sites
      if (!alive) return
      setSites(list)
      setSite((current) => current || list[0]?.siteUrl || '')
    }).catch((caught) => {
      if (!alive) return
      setError(caught.message)
      if (caught.data?.code === 'reconnect') setStatus((current) => ({ ...(current || { configured: true }), connected: false }))
    })
    return () => { alive = false }
  }, [reload])

  useEffect(() => {
    if (!site) return undefined
    let alive = true
    api('POST', '/api/gsc/performance', { siteUrl: site, days })
      .then((data) => { if (alive) setPerformance({ loading: false, data, error: '' }) })
      .catch((caught) => { if (alive) setPerformance({ loading: false, data: null, error: caught.message }) })
    return () => { alive = false }
  }, [site, days, reload])

  async function connect() {
    setBusy(true)
    setError('')
    try {
      window.location.assign((await api('GET', '/api/gsc/connect')).url)
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
  }
  async function disconnect() {
    setBusy(true)
    await api('DELETE', '/api/gsc').catch(() => {})
    setSites([])
    setSite('')
    setPerformance({ loading: false, data: null, error: '' })
    setBusy(false)
    setReload((value) => value + 1)
  }
  const choose = (setter) => (value) => {
    setPerformance({ loading: true, data: null, error: '' })
    setter(value)
  }

  if (!status) return <section className="panel"><p className="panel-note">{error || <><Loader2 className="spin" size={14} /> Checking the Search Console connection…</>}</p></section>
  const failure = notice?.status === 'error' ? (REASONS[notice.reason] || 'Google sign-in did not complete. Try again.') : ''

  if (!status.connected) {
    return (
      <>
        <div className="tool-head"><div><h2>Google Search Console</h2><span>Clicks, rankings and keyword opportunities from Google's own data</span></div></div>
        <section className="panel form-panel full">
          {failure && <Notice kind="error">{failure}</Notice>}
          {error && <Notice kind="error">{error}</Notice>}
          {status.migration && <Notice kind="warn">The database update for this feature has not been applied yet.</Notice>}
          {!status.configured ? <Notice kind="warn">Search Console is not set up on this server yet. It needs a Google OAuth client (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).</Notice> : (
            <>
              <p className="result-summary">Connect the Google account that has access to your Search Console property. Access is read-only: this app can read search performance data and cannot change anything in your account. You can disconnect at any time.</p>
              <div className="form-footer">
                <p>Performance, rank tracking and keyword opportunities all use this one connection. No third-party keyword database is involved.</p>
                <button className="primary-button" onClick={connect} disabled={busy}>{busy ? <Loader2 className="spin" size={17} /> : <Link2 size={17} />}Connect Search Console</button>
              </div>
            </>
          )}
        </section>
      </>
    )
  }

  return (
    <>
      <div className="tool-head">
        <div><h2>Google Search Console</h2><span>Connected as {status.email || 'your Google account'}</span></div>
        <div className="button-row">
          <button className="ghost-button" onClick={() => { setPerformance({ loading: true, data: null, error: '' }); setReload((value) => value + 1) }}><RefreshCw size={16} />Refresh</button>
          <button className="ghost-button" onClick={disconnect} disabled={busy}><Unplug size={16} />Disconnect</button>
        </div>
      </div>
      {notice?.status === 'connected' && <Notice kind="success">Search Console is connected.</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {!sites.length ? <Notice kind="warn">This Google account has no verified Search Console properties. Verify your site in Search Console, then refresh.</Notice> : (
        <>
          <section className="panel form-panel full">
            <div className="two-col">
              <Field label="Property"><Select value={site} onChange={choose(setSite)} options={sites.map((entry) => ({ value: entry.siteUrl, label: entry.siteUrl.replace(/^sc-domain:/, '') + (entry.type === 'domain' ? ' (domain)' : '') }))} /></Field>
              <Field label="Period"><Select value={String(days)} onChange={(value) => choose(setDays)(Number(value))} options={RANGES} /></Field>
            </div>
            <Tabs value={tab} onChange={setTab} options={TABS} label="Search Console views" />
          </section>
          {performance.error && <Notice kind="error">{performance.error}</Notice>}
          {(performance.loading || (!performance.data && !performance.error)) && <section className="panel"><p className="panel-note"><Loader2 className="spin" size={14} /> Loading Search Console data…</p></section>}
          {performance.data && tab === 'performance' && <Performance data={performance.data} />}
          {performance.data && tab === 'rankings' && <Rankings data={performance.data} site={site} days={days} />}
          {tab === 'opportunities' && site && <Opportunities key={`${site}-${days}`} site={site} days={days} />}
        </>
      )}
    </>
  )
}
