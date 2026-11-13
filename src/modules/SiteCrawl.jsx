import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, Network, Trash2 } from 'lucide-react'
import { api } from '../api.js'
import { Field, Kpi, Notice, ScoreRing, Select, StatusIcon } from './shared.jsx'
import { downloadCsv, fmt } from './util.js'

const pathOf = (url) => {
  try {
    const parsed = new URL(url)
    return parsed.pathname + parsed.search
  } catch {
    return url
  }
}

function UrlList({ title, note, urls, total }) {
  if (!urls.length) return null
  return (
    <section className="panel">
      <h3 className="panel-title">{title} <span className="pill">{fmt(total ?? urls.length)}</span></h3>
      {note && <p className="panel-note">{note}</p>}
      <div className="paths url-list">{urls.map((url) => <div key={typeof url === 'string' ? url : url.key}>{typeof url === 'string' ? pathOf(url) : url.text}</div>)}</div>
      {total > urls.length && <p className="panel-note">Showing the first {urls.length}. The page export contains all of them.</p>}
    </section>
  )
}

function Summary({ crawl, onExport, exporting }) {
  const summary = crawl.summary
  return (
    <div className="audit">
      <section className="panel audit-head">
        <ScoreRing score={summary.score} label="Avg. page score" />
        <div>
          <p className="eyeline">Site crawl · {new Date(crawl.completedAt || crawl.createdAt).toLocaleDateString('en-GB')}</p>
          <h3>{crawl.host}</h3>
          <p className="result-summary">{fmt(summary.pagesCrawled)} URLs crawled, {fmt(summary.htmlPages)} HTML pages scored. {summary.method}</p>
          {summary.stopped && <Notice kind="warn">The crawl stopped early: {summary.stopped}</Notice>}
          {summary.limitReached && !summary.stopped && <Notice kind="info">The crawl reached the page limit of {fmt(crawl.maxPages)}; the site may have more pages.</Notice>}
          <div className="kpi-row">
            <Kpi label="Broken URLs" value={fmt(summary.brokenCount)} />
            <Kpi label="Redirects" value={fmt(summary.redirectedCount)} />
            <Kpi label="Non-indexable" value={fmt(summary.noindexCount)} />
            <Kpi label="Avg. response" value={`${fmt(summary.avgMs)} ms`} />
          </div>
          <button type="button" className="ghost-button small" onClick={onExport} disabled={exporting}>{exporting ? <Loader2 className="spin" size={16} /> : <Download size={16} />}Export all pages (CSV)</button>
        </div>
      </section>

      <section className="panel">
        <h3 className="panel-title">Issues by number of pages</h3>
        {summary.issues.length ? (
          <ul className="check-rows">
            {summary.issues.map((issue) => (
              <li key={issue.id}><StatusIcon status={issue.status} /><div><strong>{issue.label}</strong> <span className="pill">{fmt(issue.pages)} page{issue.pages > 1 ? 's' : ''}</span><p>{issue.examples.map(pathOf).join(' · ')}</p></div></li>
            ))}
          </ul>
        ) : <p className="panel-note">No failed or flagged checks on the crawled pages.</p>}
      </section>

      {summary.broken.length > 0 && (
        <section className="panel">
          <h3 className="panel-title">Broken and blocked URLs <span className="pill pill-bad">{fmt(summary.brokenCount)}</span></h3>
          <div className="table-wrap"><table className="compact-table">
            <thead><tr><th>URL</th><th>Result</th><th>Found on</th></tr></thead>
            <tbody>{summary.broken.map((item) => <tr key={item.url}><td className="wrap-cell">{pathOf(item.url)}</td><td>{item.error}</td><td className="wrap-cell">{item.linkedFrom ? pathOf(item.linkedFrom) : '–'}</td></tr>)}</tbody>
          </table></div>
        </section>
      )}

      {summary.lowest.length > 0 && (
        <section className="panel">
          <h3 className="panel-title">Lowest-scoring pages</h3>
          <div className="table-wrap"><table className="compact-table">
            <thead><tr><th>Page</th><th>Score</th><th>Top issue</th></tr></thead>
            <tbody>{summary.lowest.map((page) => <tr key={page.url}><td className="wrap-cell">{pathOf(page.url)}<br /><small className="muted">{page.title}</small></td><td><strong>{page.score}</strong></td><td>{page.topIssue || 'No failed checks'}</td></tr>)}</tbody>
          </table></div>
        </section>
      )}

      <div className="split">
        <section className="panel">
          <h3 className="panel-title">Duplicate titles</h3>
          {summary.duplicateTitles.length ? <ul className="check-rows">{summary.duplicateTitles.map((group) => <li key={group.value}><span /><div><strong>{group.value}</strong> <span className="pill">{group.count} pages</span><p>{group.urls.map(pathOf).join(' · ')}</p></div></li>)}</ul> : <p className="panel-note">Every crawled page has its own title.</p>}
        </section>
        <section className="panel">
          <h3 className="panel-title">Duplicate meta descriptions</h3>
          {summary.duplicateDescriptions.length ? <ul className="check-rows">{summary.duplicateDescriptions.map((group) => <li key={group.value}><span /><div><strong>{group.value.slice(0, 110)}</strong> <span className="pill">{group.count} pages</span><p>{group.urls.map(pathOf).join(' · ')}</p></div></li>)}</ul> : <p className="panel-note">No meta description is used on more than one page.</p>}
        </section>
      </div>

      <UrlList title="Sitemap URLs with no internal link" note="Listed in the XML sitemap, but no crawled page links to them." urls={summary.orphans} total={summary.orphanCount} />
      <UrlList title="Thin pages" note="Indexable pages with fewer than 200 words in the raw HTML." urls={summary.thin.map((page) => ({ key: page.url, text: `${pathOf(page.url)} (${page.words} words)` }))} total={summary.thinCount} />
      <UrlList title="Non-indexable pages" note="Pages with a noindex directive." urls={summary.noindex} total={summary.noindexCount} />
      <UrlList title="Redirecting URLs" note="Internal links or sitemap entries that redirect. Link to the final URL instead." urls={summary.redirected.map((item) => ({ key: item.from, text: `${pathOf(item.from)} → ${pathOf(item.to)}` }))} total={summary.redirectedCount} />
      <UrlList title="Slow responses" note="HTML took 1.2 seconds or longer to arrive." urls={summary.slow.map((page) => ({ key: page.url, text: `${pathOf(page.url)} (${fmt(page.ms)} ms)` }))} />

      <section className="panel">
        <h3 className="panel-title">Crawl facts</h3>
        <p className="panel-note">Status codes: {summary.statusCodes.map((entry) => `${entry.code} × ${fmt(entry.count)}`).join(', ') || 'none'}. Click depth: {summary.depth.map((entry) => `level ${entry.depth} × ${fmt(entry.count)}`).join(', ') || 'none'}. Sitemap: {fmt(summary.sitemap.urls)} URLs found{summary.notInSitemap ? `; ${fmt(summary.notInSitemap)} indexable crawled pages are not in it` : ''}.</p>
      </section>
    </div>
  )
}

export default function SiteCrawl({ account, onUsage }) {
  const [url, setUrl] = useState('')
  const [limits, setLimits] = useState({ maxPages: account?.limits?.crawlPages || 25, monthlyPages: account?.limits?.crawlPagesMonthly || 100 })
  const [maxPages, setMaxPages] = useState(0)
  const [history, setHistory] = useState([])
  const [progress, setProgress] = useState(null)
  const [crawl, setCrawl] = useState(null)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    api('GET', '/api/crawls').then((data) => {
      setHistory(data.crawls)
      setLimits({ maxPages: data.maxPages, monthlyPages: data.monthlyPages })
    }).catch((caught) => setError(caught.message))
    return () => { cancelled.current = true }
  }, [])

  const sizes = [25, 100, 250, 500, 1000, 2000].filter((size) => size <= limits.maxPages)
  const chosen = maxPages || sizes.at(-1) || limits.maxPages

  async function drive(id, total) {
    setProgress({ done: 0, total })
    let state = { status: 'running' }
    while (state.status === 'running' && !cancelled.current) {
      state = await api('POST', `/api/crawls/${id}/step`)
      if (state.status === 'running') setProgress({ done: state.done, total: state.total })
    }
    if (cancelled.current) return
    const detail = await api('GET', `/api/crawls/${id}`)
    setCrawl(detail.crawl)
    setHistory((current) => [detail.crawl, ...current.filter((item) => item.id !== id)])
    setProgress(null)
    await onUsage?.()
  }

  async function start(event) {
    event.preventDefault()
    if (!url.trim()) return setError('Enter a website URL.')
    setError('')
    setCrawl(null)
    setProgress({ done: 0, total: 0 })
    try {
      const created = await api('POST', '/api/crawls', { url: url.trim(), maxPages: chosen })
      await drive(created.crawl.id, created.queued)
    } catch (caught) {
      setError(caught.message)
      setProgress(null)
    }
  }

  async function open(item) {
    setError('')
    if (item.status === 'running') {
      try {
        await drive(item.id, 0)
      } catch (caught) {
        setError(caught.message)
        setProgress(null)
      }
      return
    }
    setCrawl(item)
  }

  async function remove(id) {
    await api('DELETE', `/api/crawls/${id}`).catch(() => {})
    setHistory((current) => current.filter((item) => item.id !== id))
    if (crawl?.id === id) setCrawl(null)
  }

  async function exportPages() {
    setExporting(true)
    try {
      const { pages } = await api('GET', `/api/crawls/${crawl.id}?pages=1`)
      downloadCsv(`site-crawl-${crawl.host}-${(crawl.completedAt || crawl.createdAt).slice(0, 10)}.csv`, [
        ['URL', 'HTTP', 'Score', 'Title', 'Meta description', 'H1', 'Words', 'Depth', 'Response ms', 'Noindex', 'Canonical', 'Found via', 'Issues', 'Error'],
        ...pages.map((page) => [page.url, page.http, page.score ?? '', page.title, page.description, page.h1, page.words ?? '', page.depth, page.ms, page.noindex ? 'yes' : '', page.canonical, page.source, page.issues.join('; '), page.error]),
      ])
    } catch (caught) {
      setError(caught.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="tool-head">
        <div><h2>Full site crawl</h2><span>Every page, counted</span></div>
        {crawl && <button className="ghost-button" onClick={() => setCrawl(null)}>New crawl</button>}
      </div>

      {!crawl && (
        <form className="panel form-panel full" onSubmit={start}>
          <div className="two-col">
            <Field label="Website" required hint="The crawl starts here and from the XML sitemap, then follows internal links."><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" inputMode="url" disabled={Boolean(progress)} /></Field>
            <Field label="Page limit" hint={`Your plan crawls up to ${fmt(limits.maxPages)} pages per crawl and ${fmt(limits.monthlyPages)} per month.`}>
              <Select value={String(chosen)} onChange={(value) => setMaxPages(Number(value))} options={(sizes.length ? sizes : [limits.maxPages]).map((size) => ({ value: String(size), label: `Up to ${fmt(size)} pages` }))} />
            </Field>
          </div>
          {error && <Notice kind="error">{error}</Notice>}
          {progress ? (
            <div className="progress" role="status" aria-live="polite">
              <div className="bar wide"><i style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 3}%` }} /></div>
              <span><Loader2 className="spin" size={15} /> {progress.total ? `Crawled ${fmt(progress.done)} of ${fmt(progress.total)} URLs found so far.` : 'Reading robots.txt and the sitemap…'} Keep this tab open.</span>
            </div>
          ) : (
            <div className="form-footer">
              <p>Pages are fetched without JavaScript and robots.txt is respected. Each crawled URL counts toward the monthly page allowance.</p>
              <button className="primary-button"><Network size={17} />Start crawl</button>
            </div>
          )}
        </form>
      )}

      {crawl?.summary && <Summary crawl={crawl} onExport={exportPages} exporting={exporting} />}
      {crawl && error && <Notice kind="error">{error}</Notice>}

      {!crawl && !progress && history.length > 0 && (
        <section className="panel">
          <h3 className="panel-title">Previous crawls</h3>
          <div className="table-wrap"><table className="compact-table">
            <thead><tr><th>Site</th><th>Date</th><th>Pages</th><th>Avg. score</th><th>Broken</th><th /></tr></thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id}>
                  <td><button type="button" className="link-button" onClick={() => open(item)}>{item.host}</button>{item.status === 'running' && <span className="pill">unfinished: click to resume</span>}</td>
                  <td>{new Date(item.createdAt).toLocaleDateString('en-GB')}</td>
                  <td>{item.summary ? fmt(item.summary.pagesCrawled) : '–'}</td><td>{item.summary ? item.summary.score : '–'}</td><td>{item.summary ? fmt(item.summary.brokenCount) : '–'}</td>
                  <td><button type="button" className="icon-button small" aria-label={`Delete crawl of ${item.host}`} onClick={() => remove(item.id)}><Trash2 size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}
    </>
  )
}
