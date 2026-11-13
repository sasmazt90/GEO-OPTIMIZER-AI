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
