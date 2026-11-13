import { useState } from 'react'
import { Download, FileUp, Loader2 } from 'lucide-react'
import { addLogLine, createLogStats, finishLogStats } from './logParser.js'
import { Kpi, Notice } from './shared.jsx'
import { downloadCsv } from './util.js'

const MAX_BYTES = 2 * 1024 * 1024 * 1024

async function readLog(file, stats, onProgress) {
  const source = /\.gz$/i.test(file.name) && 'DecompressionStream' in window ? file.stream().pipeThrough(new DecompressionStream('gzip')) : file.stream()
  const reader = source.pipeThrough(new TextDecoderStream()).getReader()
  let rest = ''
  let read = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    read += value.length
    const lines = (rest + value).split('\n')
    rest = lines.pop()
    for (const line of lines) addLogLine(stats, line)
    onProgress(Math.min(99, Math.round((read / file.size) * 100)))
  }
  addLogLine(stats, rest)
}

function Spark({ values }) {
  const max = Math.max(1, ...values)
  const width = 120
  const step = values.length > 1 ? width / (values.length - 1) : width
  const points = values.map((value, index) => `${index * step},${26 - (value / max) * 24}`).join(' ')
  return <svg className="spark" viewBox={`0 0 ${width} 28`} aria-hidden="true"><polyline points={values.length > 1 ? points : `0,14 ${width},14`} /></svg>
}

export default function BotTraffic() {
  const [result, setResult] = useState(null)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')

  async function onFiles(event) {
    const files = [...event.target.files]
    event.target.value = ''
    if (!files.length) return
    if (files.some((file) => file.size > MAX_BYTES)) return setError('Each file can be up to 2 GB.')
    setError('')
    setResult(null)
    const stats = createLogStats()
    try {
      for (const [index, file] of files.entries()) {
        await readLog(file, stats, (percent) => setProgress({ file: file.name, index: index + 1, total: files.length, percent }))
      }
      const summary = finishLogStats(stats)
      if (!summary.lines) setError('The file is empty or not a text log.')
      else setResult(summary)
    } catch {
      setError('This file could not be read. Upload a plain-text or .gz access log.')
    } finally {
      setProgress(null)
    }
  }

  function exportCsv() {
    const rows = [['Crawler', 'Operator', 'Used for', 'Requests', 'First seen', 'Last seen', 'Error rate %', 'Top paths']]
    result.bots.forEach((bot) => rows.push([bot.name, bot.operator, bot.purpose, bot.hits, bot.first, bot.last, bot.errorRate, bot.topPaths.map((entry) => `${entry.path} (${entry.count})`).join(' | ')]))
    downloadCsv(`ai-bot-traffic-${result.from || 'log'}-${result.to || ''}.csv`, rows)
  }

  const retrieval = result?.bots.filter((bot) => bot.purpose === 'Live answer fetch').reduce((sum, bot) => sum + bot.hits, 0) || 0

  return (
    <>
      <div className="tool-head"><div><h2>Which AI crawlers actually visit your site?</h2><span>Read from your own access logs</span></div></div>
      <section className="panel form-panel full">
        <label className="dropzone">
          {progress ? <Loader2 className="spin" size={26} /> : <FileUp size={26} />}
          <strong>{progress ? `Reading ${progress.file} (${progress.index} of ${progress.total}): ${progress.percent}%` : 'Choose access log files'}</strong>
          <span>Apache or nginx access logs, or JSON-lines logs from a CDN. Plain text or .gz, several files at once.</span>
          <input type="file" multiple accept=".log,.txt,.gz,.json,.jsonl,text/plain,application/gzip" onChange={onFiles} disabled={Boolean(progress)} />
        </label>
        <p className="panel-note">Files are analysed in your browser. Nothing is uploaded to our servers, and no IP addresses are stored.</p>
        {error && <Notice kind="error">{error}</Notice>}
      </section>

      {result && (
        <>
          <section className="panel">
            <div className="category-head"><h3 className="panel-title">{result.from ? `${result.from} to ${result.to}` : 'Log summary'}</h3><button className="ghost-button small" onClick={exportCsv}><Download size={16} />Export CSV</button></div>
            <div className="kpi-row">
              <Kpi label="Log lines read" value={result.lines.toLocaleString()} />
              <Kpi label="AI and search crawler requests" value={result.botHits.toLocaleString()} note={`${result.lines ? Math.round((result.botHits / result.lines) * 1000) / 10 : 0}% of all requests`} />
              <Kpi label="Crawlers seen" value={result.bots.length} note={`of ${result.bots.length + result.missing.length} known`} />
              <Kpi label="Live answer fetches" value={retrieval.toLocaleString()} note="a user's assistant opened your page" />
            </div>
            <p className="panel-note">Crawlers are identified by user-agent. A user-agent can be spoofed, so treat unusual volumes with care and verify against the operators' published IP ranges.</p>
          </section>

          <section className="panel">
            <h3 className="panel-title">Crawlers that visited</h3>
            {result.bots.length ? (
              <div className="table-wrap">
                <table className="compact-table">
                  <thead><tr><th>Crawler</th><th>Used for</th><th>Requests</th><th>Trend</th><th>Last seen</th><th>Errors</th><th>Most requested pages</th></tr></thead>
                  <tbody>
                    {result.bots.map((bot) => (
                      <tr key={bot.name}>
                        <td><strong>{bot.name}</strong><small className="rule"> {bot.operator}</small></td>
                        <td>{bot.purpose}</td>
                        <td>{bot.hits.toLocaleString()}</td>
                        <td><Spark values={bot.daily} /></td>
                        <td>{bot.last || '–'}</td>
                        <td><span className={`pill ${bot.errorRate > 10 ? 'pill-bad' : 'pill-ok'}`}>{bot.errorRate}%</span></td>
                        <td className="paths">{bot.topPaths.slice(0, 3).map((entry) => <div key={entry.path}>{entry.path} <small className="rule">×{entry.count}</small></div>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="panel-note">No known AI or search crawler appears in these logs.</p>}
          </section>

          {result.missing.length > 0 && (
            <section className="panel">
              <h3 className="panel-title">Not seen in this period</h3>
              <p className="panel-note">If a search or answer crawler is missing, check robots.txt and bot-protection rules with the Crawler Access check.</p>
              <div className="chip-row">{result.missing.map((bot) => <span className="pill" key={bot.name}>{bot.name} · {bot.purpose}</span>)}</div>
            </section>
          )}
        </>
      )}
    </>
  )
}
