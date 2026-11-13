import { AlertTriangle, CheckCircle2, ChevronDown, Info, XCircle } from 'lucide-react'

export function Field({ label, children, hint, required }) {
  return (
    <label className="field">
      <span>{label} {required && <b>Required</b>}</span>
      {children}
      {hint && <em>{hint}</em>}
    </label>
  )
}

export function Select({ value, onChange, options }) {
  return (
    <div className="select-wrap">
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (typeof option === 'string'
          ? <option key={option}>{option}</option>
          : <option key={option.value} value={option.value}>{option.label}</option>))}
      </select>
      <ChevronDown size={18} />
    </div>
  )
}

export function ScoreRing({ score, label }) {
  const value = Number.isFinite(Number(score)) ? Number(score) : 0
  return (
    <div className="score-ring" style={{ '--score': `${value}%` }}>
      <div className="score-content"><strong>{value}</strong><small>{label}</small></div>
    </div>
  )
}

export function StatusIcon({ status }) {
  if (status === 'pass') return <CheckCircle2 size={17} className="st-pass" aria-label="Passed" />
  if (status === 'warn') return <AlertTriangle size={17} className="st-warn" aria-label="Needs attention" />
  if (status === 'fail') return <XCircle size={17} className="st-fail" aria-label="Failed" />
  return <Info size={17} className="st-info" aria-label="Information" />
}

export function Kpi({ label, value, note }) {
  return <div className="kpi"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>
}

export function Notice({ kind = 'info', children }) {
  return <p className={`notice notice-${kind}`}>{children}</p>
}

export function Tabs({ value, onChange, options, label }) {
  return (
    <div className="interval-toggle tabs" role="group" aria-label={label}>
      {options.map((option) => <button type="button" key={option.id} className={value === option.id ? 'active' : ''} onClick={() => onChange(option.id)}>{option.label}</button>)}
    </div>
  )
}

// Small line chart. Set invert for metrics where a lower value is better (rank position).
export function Spark({ values, invert = false, label }) {
  const points = values.filter((value) => value !== null && value !== undefined)
  if (points.length < 2) return <span className="muted">–</span>
  const min = Math.min(...points)
  const max = Math.max(...points)
  const y = (value) => {
    const share = max === min ? 0.5 : (value - min) / (max - min)
    return 3 + (invert ? share : 1 - share) * 22
  }
  return <svg className="spark" viewBox="0 0 120 28" role="img" aria-label={label}><polyline points={points.map((value, index) => `${(index * 120) / (points.length - 1)},${y(value)}`).join(' ')} /></svg>
}

export function Delta({ value, digits = 0, suffix = '' }) {
  if (value === null || value === undefined) return <span className="muted">new</span>
  if (!value) return <span className="muted">0</span>
  return <span className={value > 0 ? 'delta-up' : 'delta-down'}>{value > 0 ? '▲' : '▼'} {Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: digits })}{suffix}</span>
}
