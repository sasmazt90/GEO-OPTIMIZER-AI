import { useState } from 'react'
import { Check, CreditCard, Loader2 } from 'lucide-react'
import { api } from '../api.js'
import { Notice } from './shared.jsx'

function Meter({ label, used, limit }) {
  const share = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
  return (
    <div className="meter">
      <div><span>{label}</span><strong>{used.toLocaleString()} / {limit.toLocaleString()}</strong></div>
      <div className={`bar wide${share >= 90 ? ' bar-warn' : ''}`}><i style={{ width: `${share}%` }} /></div>
    </div>
  )
}

export default function Plans({ account }) {
  const [interval, setIntervalValue] = useState('month')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  if (!account) return null

  async function go(path, body, key) {
    setBusy(key)
    setError('')
    try {
      const { url } = await api('POST', path, body)
      window.location.assign(url)
    } catch (caught) {
      setError(caught.message)
      setBusy('')
    }
  }

  return (
    <section className="panel account-panel">
      <div className="account-head"><div><h2>Plan and usage</h2><p>You are on the <strong>{account.planLabel}</strong> plan. Allowances reset on {account.resetsOn}.</p></div>
        {account.billing.hasCustomer && account.billing.enabled && (
          <button className="ghost-button" onClick={() => go('/api/billing/portal', null, 'portal')} disabled={Boolean(busy)}>{busy === 'portal' ? <Loader2 className="spin" size={16} /> : <CreditCard size={16} />}Manage billing</button>
        )}
      </div>
      {account.billing.status === 'past_due' && <Notice kind="warn">Your last payment failed. Update your payment method under “Manage billing” to keep your plan.</Notice>}
      {account.billing.flag === 'suspended' && <Notice kind="error">Paid features are paused because a payment was disputed. Contact support to resolve it.</Notice>}
      {!account.metered && <Notice kind="info">Usage metering starts after the next database update.</Notice>}
      <div className="meters">
        <Meter label="Live answer credits" used={account.usage.probe} limit={account.limits.probes} />
        <Meter label="Analyses" used={account.usage.analysis} limit={account.limits.analyses} />
        <Meter label="Audits" used={account.usage.audit} limit={account.limits.audits} />
      </div>

      <div className="interval-toggle" role="group" aria-label="Billing interval">
        <button className={interval === 'month' ? 'active' : ''} onClick={() => setIntervalValue('month')}>Monthly</button>
        <button className={interval === 'year' ? 'active' : ''} onClick={() => setIntervalValue('year')}>Yearly · 2 months free</button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="plan-grid">
        {account.plans.map((plan) => {
          const current = plan.id === account.plan
          const price = plan.price[interval]
          return (
            <div className={`plan-card${current ? ' current' : ''}`} key={plan.id}>
              <h3>{plan.label}</h3>
              <p className="plan-price">{price ? <>€{interval === 'year' ? Math.round(price / 12) : price}<small>/month{interval === 'year' ? `, billed €${price} yearly` : ''}</small></> : <>€0<small>forever</small></>}</p>
              <ul>
                <li><Check size={15} />{plan.probes.toLocaleString()} live answer credits / month</li>
                <li><Check size={15} />{plan.analyses.toLocaleString()} analyses, {plan.audits.toLocaleString()} audits</li>
                <li><Check size={15} />{plan.projects} project{plan.projects > 1 ? 's' : ''}, {plan.promptsPerProject} prompts each</li>
                <li><Check size={15} />Up to {plan.maxSamples} answers per prompt and model</li>
                <li><Check size={15} />{plan.auditPages ? `Audit up to ${plan.auditPages} extra pages per run` : 'Single-page audits'}</li>
              </ul>
              {current ? <span className="pill pill-ok">Current plan</span>
                : plan.price.month === 0 ? <span className="muted">Included</span>
                  : !account.billing.enabled ? <span className="muted">Online checkout opens soon</span>
                    : <button className="primary-button" disabled={Boolean(busy)} onClick={() => go('/api/billing/checkout', { plan: plan.id, interval }, plan.id)}>{busy === plan.id ? <Loader2 className="spin" size={16} /> : null}{account.plan === 'free' ? `Upgrade to ${plan.label}` : `Switch to ${plan.label}`}</button>}
            </div>
          )
        })}
      </div>
      <p className="panel-note">Prices exclude VAT where applicable. Cancel any time in the billing portal; your plan stays active until the end of the paid period.</p>
    </section>
  )
}
