import { useState } from 'react'
import { Columns3, Loader2 } from 'lucide-react'
import { api } from '../api.js'
import { Field, Notice } from './shared.jsx'
import { fmt } from './util.js'

const ROWS = [
  ['On-page audit score', (page) => `${page.score}/100`],
  ['Title', (page) => page.title || '–'],
  ['Title length', (page) => `${page.titleLength} characters`],
  ['Meta description', (page) => (page.descriptionLength ? `${page.descriptionLength} characters` : 'missing')],
  ['H1', (page) => page.h1 || '–'],
  ['Words in raw HTML', (page) => fmt(page.words)],
  ['H2 / H3 headings', (page) => `${page.h2Count} / ${page.h3Count}`],
  ['Question-style headings', (page) => page.questionHeadings],
  ['FAQ section', (page) => (page.hasFaq ? 'Yes' : 'No')],
  ['List items / tables', (page) => `${page.listItems} / ${page.tables}`],
  ['Internal / external links', (page) => `${page.internalLinks} / ${page.externalLinks}`],
  ['Structured data', (page) => page.schemaTypes.join(', ') || 'none'],
  ['Author named', (page) => (page.author ? 'Yes' : 'No')],
  ['Latest date on page', (page) => page.lastDate || 'none'],
  ['Response time / size', (page) => `${fmt(page.ms)} ms / ${fmt(page.kb)} KB`],
]

export default function PageCompare({ onRunComplete }) {
  const [form, setForm] = useState({ url: '', competitors: '', query: '' })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  async function run(event) {
    event.preventDefault()
    const competitors = form.competitors.split(/[\n,\s]+/).map((item) => item.trim()).filter(Boolean)
    if (!form.url.trim() || !competitors.length) return setError('Enter your page and at least one competitor page.')
    if (competitors.length > 3) return setError('Compare against up to three competitor pages at a time.')
    setLoading(true)
    setError('')
    try {
      setResult(await api('POST', '/api/compare-pages', { url: form.url.trim(), competitors, query: form.query.trim() }))
      await onRunComplete?.()
    } catch (caught) {
      setError(caught.message)
    } finally {
      setLoading(false)
    }
  }

  const pages = result ? [result.own, ...result.competitors] : []
  const ok = pages.filter((page) => page.ok)
  return (
    <>
      <div className="tool-head">
        <div><h2>Page comparison</h2><span>Your page against the pages that outrank it</span></div>
        {result && <button className="ghost-button" onClick={() => setResult(null)}>New comparison</button>}
      </div>
      {!result && (
        <form className="panel form-panel full" onSubmit={run}>
          <div className="two-col">
            <Field label="Your page" required><input value={form.url} onChange={set('url')} placeholder="https://example.com/your-page" inputMode="url" /></Field>
            <Field label="Target query" hint="Optional. Checks where the query terms appear on each page."><input value={form.query} onChange={set('query')} placeholder="best crm for small teams" /></Field>
          </div>
          <Field label="Competitor pages" required hint="One to three URLs, one per line. Use the pages that rank above yours for the query."><textarea value={form.competitors} onChange={set('competitors')} placeholder={'https://competitor-a.com/page\nhttps://competitor-b.com/page'} /></Field>
          {error && <Notice kind="error">{error}</Notice>}
          <div className="form-footer">
            <p>Each page is fetched the way a crawler receives it and uses one audit credit.</p>
            <button className="primary-button" disabled={loading}>{loading ? <Loader2 className="spin" size={17} /> : <Columns3 size={17} />}{loading ? 'Comparing…' : 'Compare pages'}</button>
          </div>
        </form>
      )}
      {result && (
        <div className="audit">
          {pages.filter((page) => !page.ok).map((page) => <Notice kind="warn" key={page.url}>{page.url} could not be fetched ({page.error}).</Notice>)}
          {result.own.ok && (
            <section className="panel">
              <h3 className="panel-title">Where your page is behind</h3>
              {result.gaps.length ? (
                <ul className="check-rows">{result.gaps.map((gap) => <li key={gap.metric}><span className="st-warn">●</span><div><strong>{gap.metric}</strong><p>{gap.detail}</p></div></li>)}</ul>
              ) : <p className="panel-note">No measured gap against the compared pages.</p>}
              {result.strengths.length > 0 && <p className="panel-note">Where you lead: {result.strengths.map((item) => item.metric.toLowerCase()).join(', ')}.</p>}
              <p className="panel-note">{result.method}</p>
            </section>
          )}
          {ok.length > 0 && (
            <section className="panel">
              <h3 className="panel-title">Side by side</h3>
              <div className="table-wrap">
                <table className="compact-table compare-table">
                  <thead><tr><th>Metric</th>{ok.map((page, index) => <th key={page.url}>{page.host}{index === 0 && result.own.ok && <span className="pill pill-ok">You</span>}</th>)}</tr></thead>
                  <tbody>
                    {ROWS.map(([label, value]) => <tr key={label}><td><strong>{label}</strong></td>{ok.map((page, index) => <td key={page.url} className={index === 0 && result.own.ok ? 'own-cell wrap-cell' : 'wrap-cell'}>{value(page)}</td>)}</tr>)}
                    {result.query && ok[0].query && [['in title', 'inTitle'], ['in H1', 'inH1'], ['in H2 headings', 'inHeadings'], ['in first paragraph', 'inIntro']].map(([label, key]) => (
                      <tr key={key}><td><strong>Query terms {label}</strong></td>{ok.map((page) => <td key={page.url}>{page.query[key]} of {page.query.terms}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {result.missingTopics.length > 0 && (
            <section className="panel">
              <h3 className="panel-title">Sections competitors cover that your headings do not</h3>
              <p className="panel-note">Competitor H2 headings that share no word with your H1 or H2 headings. Review them as topic ideas; not every one will fit your page.</p>
              <ul className="check-rows">{result.missingTopics.map((topic) => <li key={`${topic.host}-${topic.heading}`}><span /><div><strong>{topic.heading}</strong><p>{topic.host}</p></div></li>)}</ul>
            </section>
          )}
        </div>
      )}
    </>
  )
}
