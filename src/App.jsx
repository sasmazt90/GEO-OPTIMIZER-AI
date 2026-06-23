import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  FilePenLine,
  History,
  LayoutTemplate,
  Loader2,
  LogOut,
  Menu,
  UserRound,
  Search,
  ShieldCheck,
  Wand2,
  X,
} from 'lucide-react'
import './App.css'

const languages = ['English', 'Turkish', 'German', 'French', 'Spanish', 'Italian', 'Portuguese']
const countries = ['Worldwide', 'United States', 'United Kingdom', 'Turkey', 'Germany', 'France', 'Spain', 'Canada']

const tools = [
  { id: 'brand', label: 'AI Brand Entity', icon: ShieldCheck, tag: 'Entity confidence' },
  { id: 'crawler', label: 'AI Search Crawler Simulation', icon: Bot, tag: 'Crawler access' },
  { id: 'fanout', label: 'Query Fan Out Analysis', icon: Search, tag: 'Query expansion' },
  { id: 'research', label: 'AI Prompt Research', icon: BrainCircuit, tag: 'Prompt universe' },
  { id: 'landing', label: 'GEO Landing Page Creator', icon: LayoutTemplate, tag: 'Landing brief' },
  { id: 'content', label: 'GEO Content Creator', icon: FilePenLine, tag: 'Content draft' },
  { id: 'check', label: 'GEO Content Check', icon: FileCheck2, tag: 'Compliance scan' },
  { id: 'benchmark', label: 'Benchmark', icon: BarChart3, tag: 'Top brands' },
]

const promptModes = ['Your brand', 'SEO keywords', 'A website', 'Advanced', 'Query Fan Out']
const crawlers = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'Googlebot', 'GoogleOther', 'PerplexityBot', 'ClaudeBot', 'Grok']
const fanoutModeHelp = {
  'Your brand': 'Enter your brand or branded search prompt',
  'SEO keywords': 'Enter SEO keywords, one per line or comma-separated',
  'A website': 'Enter a website URL to infer likely AI search prompts',
  Advanced: 'Enter a detailed market, persona, competitor, or topic brief',
  'Query Fan Out': 'Enter the source query you want expanded',
}
const resultPlaceholders = {
  brand: 'Enter a brand, domain, country, and language to check entity clarity across AI answer surfaces.',
  fanout: 'Enter a prompt and select a mode to see how AI search systems may expand it into related sub-queries.',
  research: 'Complete the research inputs to generate a monitoring prompt set for brand, competitor, persona, topic, and SEO visibility.',
  landing: 'Fill in the landing page brief to generate an answer-first GEO page structure.',
  content: 'Provide a prompt or URLs to create GEO-ready content or a content brief.',
  check: 'Paste content or add a URL to receive a GEO compliance review.',
  benchmark: 'Enter a prompt, country, and language to rank likely visible brands.',
}

async function callApi(payload) {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || 'Analysis is temporarily unavailable. Please try again shortly.')
  }
  return response.json()
}

function App() {
  const [activeTool, setActiveTool] = useState('brand')
  const [mobileNav, setMobileNav] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [legalPage, setLegalPage] = useState('')
  const [accountPage, setAccountPage] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [runs, setRuns] = useState([])
  const [recoveryToken, setRecoveryToken] = useState('')
  const active = tools.find((tool) => tool.id === activeTool)

  async function loadRuns() {
    const response = await fetch('/api/runs', { credentials: 'include' })
    if (response.ok) {
      const data = await response.json()
      setRuns(data.runs || [])
    }
  }

  useEffect(() => {
    async function loadSession() {
      try {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
        const type = hash.get('type')
        const accessToken = hash.get('access_token')
        const refreshToken = hash.get('refresh_token')
        if (type === 'recovery' && accessToken) {
          setRecoveryToken(accessToken)
          window.history.replaceState({}, document.title, '/auth/callback')
          return
        }
        if (accessToken) {
          const callbackResponse = await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ accessToken, refreshToken }),
          })
          if (callbackResponse.ok) {
            const data = await callbackResponse.json()
            setUser(data.user)
            await loadRuns()
            window.history.replaceState({}, document.title, '/')
            return
          }
        }
        const response = await fetch('/api/auth/me', { credentials: 'include' })
        if (response.ok) {
          const data = await response.json()
          setUser(data.user)
          await loadRuns()
        }
      } finally {
        setAuthLoading(false)
      }
    }
    loadSession()
  }, [])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    setUser(null)
    setRuns([])
    setAccountPage(false)
  }

  if (authLoading) return <LoadingScreen />

  if (legalPage) {
    return (
      <div className="app-shell">
        <AppHeader user={user} logout={logout} onMenu={() => setMobileNav(true)} onProfile={() => { setLegalPage(''); setAccountPage(true) }} />
        <LegalPage page={legalPage} onBack={() => setLegalPage('')} />
        <Footer onLegal={setLegalPage} />
      </div>
    )
  }

  if (recoveryToken) {
    return (
      <div className="app-shell">
        <AuthScreen recoveryToken={recoveryToken} onPasswordUpdated={() => setRecoveryToken('')} />
        <Footer onLegal={setLegalPage} />
      </div>
    )
  }
  if (!user) {
    return (
      <div className="app-shell">
        <AuthScreen onAuthed={(nextUser) => { setUser(nextUser); loadRuns() }} />
        <Footer onLegal={setLegalPage} />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <AppHeader user={user} logout={logout} onMenu={() => setMobileNav(true)} onProfile={() => setAccountPage(true)} />

      {mobileNav && (
        <div className="mobile-drawer">
          <div className="drawer-panel">
            <div className="drawer-head">
              <strong>Tools</strong>
              <button className="icon-button" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18} /></button>
            </div>
            {tools.map((tool) => (
              <button
                key={tool.id}
                className={tool.id === activeTool ? 'drawer-item active' : 'drawer-item'}
                onClick={() => {
                  setActiveTool(tool.id)
                  setAccountPage(false)
                  setMobileNav(false)
                }}
              >
                <tool.icon size={18} />
                <span>{tool.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <main className={navCollapsed ? 'workspace nav-collapsed' : 'workspace'}>
        <aside className={navCollapsed ? 'side-rail collapsed' : 'side-rail'}>
          <button className="collapse-button" onClick={() => setNavCollapsed(!navCollapsed)} aria-label={navCollapsed ? 'Expand menu' : 'Collapse menu'}>
            {navCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
          <nav className="side-nav" aria-label="Tools">
            {tools.map((tool) => (
              <button key={tool.id} className={!accountPage && tool.id === activeTool ? 'side-nav-item active' : 'side-nav-item'} onClick={() => { setActiveTool(tool.id); setAccountPage(false) }} title={tool.label}>
                <tool.icon size={18} />
                <span>{tool.label}</span>
              </button>
            ))}
          </nav>
          <div className="recent-runs">
            <div><History size={15} /><strong>Recent runs</strong></div>
            {runs.length === 0 && <p>No saved runs yet.</p>}
            {runs.slice(0, 5).map((run) => (
              <button key={run.id} onClick={() => { setActiveTool(run.type === 'crawler' ? 'crawler' : run.type); setAccountPage(false) }}>
                <span>{run.type}</span>
                <small>{new Date(run.createdAt).toLocaleDateString()}</small>
              </button>
            ))}
          </div>
        </aside>
        <section className="tool-surface">
          <div className="current-tool">
            <h1>{accountPage ? 'Account Settings' : active.label}</h1>
            <p>{accountPage ? 'Manage your profile and sign-in details' : active.tag}</p>
          </div>
          {accountPage ? (
            <AccountSettings user={user} onBack={() => setAccountPage(false)} onUpdated={setUser} />
          ) : (
            <ToolRouter activeTool={activeTool} onRunComplete={loadRuns} />
          )}
        </section>
      </main>
      <Footer onLegal={setLegalPage} />
    </div>
  )
}

function AppHeader({ user, logout, onMenu, onProfile }) {
  return (
    <header className="topbar">
      <button className="icon-button mobile-only" onClick={onMenu} aria-label="Open navigation">
        <Menu size={20} />
      </button>
      <div className="brand-mark" aria-label="GEO OPTIMIZER AI">
        <GeoLogo />
        <div>
          <strong>GEO OPTIMIZER AI</strong>
          <small>AI visibility workspace</small>
        </div>
      </div>
      {user && (
        <div className="account-chip">
          <button className="profile-button" onClick={onProfile} aria-label="Open profile settings">
            <UserRound size={17} />
            <span>{user.name}</span>
          </button>
          <button className="icon-button" onClick={logout} aria-label="Sign out"><LogOut size={17} /></button>
        </div>
      )}
    </header>
  )
}

function GeoLogo() {
  return (
    <span className="brand-icon" aria-hidden="true">
      <svg viewBox="0 0 44 44" role="img" focusable="false">
        <path className="logo-orbit" d="M22 7.5c8.01 0 14.5 6.49 14.5 14.5S30.01 36.5 22 36.5 7.5 30.01 7.5 22 13.99 7.5 22 7.5Z" />
        <path className="logo-axis" d="M22 10.5v23M10.5 22h23" />
        <path className="logo-signal" d="M14.5 28.5c3.1-5.8 7.9-9.5 15-12.8M17 14.5c5.8 2.6 9.5 7.2 12.4 14.7" />
        <circle className="logo-node primary" cx="22" cy="22" r="3.6" />
        <circle className="logo-node" cx="30.8" cy="15" r="2.3" />
        <circle className="logo-node" cx="14.2" cy="28.8" r="2.3" />
      </svg>
    </span>
  )
}

function Footer({ onLegal }) {
  return (
    <footer className="site-footer">
      <span>Copyright {new Date().getFullYear()} SASMAZ DIGITAL SOLUTIONS</span>
      <button onClick={() => onLegal('imprint')}>Imprint</button>
      <button onClick={() => onLegal('privacy')}>Privacy Policy</button>
      <button onClick={() => onLegal('terms')}>Terms</button>
      <button onClick={() => onLegal('cookies')}>Cookie Notice</button>
    </footer>
  )
}

function LegalPage({ page, onBack }) {
  const content = legalContent[page] || legalContent.imprint
  return (
    <main className="legal-page">
      <button className="ghost-button" onClick={onBack}>Back to app</button>
      <h1>{content.title}</h1>
      {content.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.body.map((line) => <p key={line}>{line}</p>)}
        </section>
      ))}
    </main>
  )
}

function AccountSettings({ user, onBack, onUpdated }) {
  const [name, setName] = useState(user.name || '')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function saveProfile(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Profile could not be updated.')
      onUpdated(data.user)
      setMessage('Profile updated.')
    } catch (profileError) {
      setError(profileError.message)
    } finally {
      setSaving(false)
    }
  }

  async function sendReset() {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: user.email }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Reset email could not be sent.')
      setMessage('Password reset email sent.')
    } catch (resetError) {
      setError(resetError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel account-panel">
      <div className="account-head">
        <div>
          <p className="eyeline">Profile</p>
          <h2>Your account</h2>
        </div>
        <button className="ghost-button" onClick={onBack}>Back to tools</button>
      </div>
      <form onSubmit={saveProfile} className="account-form">
        <Field label="Name" required><input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Email"><input value={user.email} readOnly /></Field>
        {message && <p className="auth-success">{message}</p>}
        {error && <p className="auth-error">{error}</p>}
        <div className="account-actions">
          <button className="primary-button" disabled={saving}>{saving ? <Loader2 className="spin" size={17} /> : <UserRound size={17} />}Save Profile</button>
          <button type="button" className="ghost-button" onClick={sendReset} disabled={saving}>Send Password Reset</button>
        </div>
      </form>
    </section>
  )
}

function LoadingScreen() {
  return <div className="auth-shell"><div className="auth-card compact"><Loader2 className="spin" size={22} /><strong>Loading GEO OPTIMIZER AI</strong></div></div>
}

function AuthScreen({ onAuthed, recoveryToken, onPasswordUpdated }) {
  const [mode, setMode] = useState(recoveryToken ? 'reset' : 'login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    try {
      let endpoint = '/api/auth/login'
      let body = form
      if (mode === 'register') endpoint = '/api/auth/register'
      if (mode === 'forgot') {
        endpoint = '/api/auth/reset-password'
        body = { email: form.email }
      }
      if (mode === 'reset') {
        endpoint = '/api/auth/update-password'
        body = { accessToken: recoveryToken, password: form.password }
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Authentication failed')
      if (data.pendingConfirmation || mode === 'forgot') {
        setMessage(data.message || 'Check your email for the next step.')
        return
      }
      if (mode === 'reset') {
        setMessage(data.message || 'Password updated. Please sign in again.')
        setMode('login')
        onPasswordUpdated?.()
        return
      }
      onAuthed?.(data.user)
    } catch (authError) {
      setError(authError.message)
    } finally {
      setLoading(false)
    }
  }

  async function resendConfirmation() {
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/auth/resend-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: form.email }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not resend confirmation email')
      setMessage(data.message || 'Confirmation email sent.')
    } catch (authError) {
      setError(authError.message)
    } finally {
      setLoading(false)
    }
  }

  const title = {
    login: 'Sign in to your workspace',
    register: 'Create your account',
    forgot: 'Reset your password',
    reset: 'Choose a new password',
  }[mode]

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">
          <GeoLogo />
        <div><strong>GEO OPTIMIZER AI</strong><small>AI visibility workspace</small></div>
        </div>
        <h1>{title}</h1>
        <p>{mode === 'forgot' || mode === 'reset' ? 'Enter your email to receive a secure recovery link.' : 'Create, analyze, and monitor your AI search visibility.'}</p>
        <form onSubmit={submit}>
          {mode === 'register' && <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" /></Field>}
          {mode !== 'reset' && <Field label="Email" required><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.com" /></Field>}
          {mode !== 'forgot' && <Field label={mode === 'reset' ? 'New password' : 'Password'} required><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" /></Field>}
          {error && <p className="auth-error">{error}</p>}
          {message && <p className="auth-success">{message}</p>}
          <button className="primary-button" disabled={loading}>{loading ? <Loader2 className="spin" size={17} /> : <ShieldCheck size={17} />}{mode === 'login' ? 'Sign In' : mode === 'register' ? 'Create Account' : mode === 'forgot' ? 'Send Reset Email' : 'Update Password'}</button>
        </form>
        {mode === 'login' && <button className="text-button" onClick={() => setMode('register')}>Create a new account</button>}
        {mode === 'login' && <button className="text-button secondary" onClick={() => setMode('forgot')}>Forgot password?</button>}
        {mode === 'register' && <button className="text-button" onClick={() => setMode('login')}>I already have an account</button>}
        {mode === 'register' && <button className="text-button secondary" disabled={!form.email || loading} onClick={resendConfirmation}>Resend confirmation email</button>}
        {(mode === 'forgot' || mode === 'reset') && <button className="text-button" onClick={() => { setMode('login'); onPasswordUpdated?.() }}>Back to sign in</button>}
      </section>
    </main>
  )
}

function ToolRouter({ activeTool, onRunComplete }) {
  if (activeTool === 'brand') return <BrandEntity onRunComplete={onRunComplete} />
  if (activeTool === 'crawler') return <CrawlerSimulation onRunComplete={onRunComplete} />
  if (activeTool === 'fanout') return <FanOut onRunComplete={onRunComplete} />
  if (activeTool === 'research') return <PromptResearch onRunComplete={onRunComplete} />
  if (activeTool === 'landing') return <LandingCreator onRunComplete={onRunComplete} />
  if (activeTool === 'content') return <ContentCreator onRunComplete={onRunComplete} />
  if (activeTool === 'check') return <ContentCheck onRunComplete={onRunComplete} />
  return <Benchmark onRunComplete={onRunComplete} />
}

function Field({ label, children, hint, required }) {
  return (
    <label className="field">
      <span>{label} {required && <b>Required</b>}</span>
      {children}
      {hint && <em>{hint}</em>}
    </label>
  )
}

function SelectField({ value, onChange, options }) {
  return (
    <div className="select-wrap">
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
      <ChevronDown size={18} />
    </div>
  )
}

function ToolFrame({ toolId, title, badge, children, result, loading, error, onRun, action = 'Start Analysis' }) {
  return (
    <>
      <div className="tool-head">
        <div>
          <h2>{title}</h2>
          <span>{badge}</span>
        </div>
        <button className="ghost-button">Reset</button>
      </div>
      <div className="panel-grid">
        <section className="panel form-panel">{children}
          <div className="form-footer">
            <p>Results are saved to your workspace.</p>
            <button className="primary-button" onClick={onRun} disabled={loading}>
              {loading ? <Loader2 className="spin" size={17} /> : <Wand2 size={17} />}
              {action}
            </button>
          </div>
        </section>
        <ResultPanel toolId={toolId} result={result} loading={loading} error={error} />
      </div>
      <HowItWorks />
    </>
  )
}

function ResultPanel({ toolId, result, loading, error }) {
  if (!result && !loading && !error) return <EmptyResult toolId={toolId} />
  const data = result || {}
  return (
    <section className={`panel result-panel result-${toolId}`}>
      <div className="result-top">
        <p className="eyeline">Result</p>
        <strong>{data.title || 'Analysis result'}</strong>
      </div>
      {toolId !== 'fanout' && toolId !== 'research' && toolId !== 'landing' && toolId !== 'content' && <ScoreBlock score={data.score} loading={loading} label={toolId === 'check' ? 'Compliance Score' : 'Confidence Score'} />}
      {error ? (
        <p className="result-error">{error}</p>
      ) : (
        <p className="result-summary">{loading ? 'Running live analysis and preparing structured recommendations.' : data.summary}</p>
      )}
      <ToolSpecificResult toolId={toolId} data={data} />
    </section>
  )
}

function EmptyResult({ toolId }) {
  return (
    <section className="panel result-panel empty-result">
      <p className="eyeline">Result</p>
      <strong>No analysis yet</strong>
      <p>{resultPlaceholders[toolId] || 'Run an analysis to generate results.'}</p>
    </section>
  )
}

function ScoreBlock({ score, loading, label }) {
  const safeScore = Number.isFinite(Number(score)) ? Number(score) : 0
  return (
    <div className="score-ring" style={{ '--score': `${safeScore}%` }}>
      <div className="score-content">
        <strong>{loading ? '...' : safeScore}</strong>
        <small>{label}</small>
      </div>
    </div>
  )
}

function ToolSpecificResult({ toolId, data }) {
  const metrics = Array.isArray(data.metrics) && data.metrics.length ? data.metrics : inferredMetrics(toolId, data)
  const sections = Array.isArray(data.sections) ? data.sections : []
  const bullets = Array.isArray(data.bullets) ? data.bullets : []

  if (toolId === 'fanout') {
    const queries = Array.isArray(data.queries) ? data.queries : bullets.map((query) => ({ query, intent: 'Related search path' }))
    return (
      <>
        <MetricGrid metrics={metrics} />
        <ResultSection title="Generated Query Fan-Out">
          <div className="query-list">
            {queries.slice(0, 8).map((item, index) => (
              <div className="query-row" key={`${item.query || item}-${index}`}>
                <strong>{item.query || item}</strong>
                <span>{item.intent || item.reason || 'Related query'}</span>
              </div>
            ))}
          </div>
        </ResultSection>
        <ResultSections sections={sections} />
      </>
    )
  }

  if (toolId === 'research') {
    return (
      <>
        <MetricGrid metrics={metrics} />
        <ResultSections sections={sections.length ? sections : [{ title: 'Prompt Buckets', items: bullets }]} />
      </>
    )
  }

  if (toolId === 'landing') {
    return (
      <>
        <MetricGrid metrics={metrics} />
        <ResultSections sections={sections.length ? sections : [{ title: 'Recommended Page Blocks', items: bullets }]} />
      </>
    )
  }

  if (toolId === 'content') {
    return (
      <>
        <MetricGrid metrics={metrics} />
        <ResultSections sections={sections.length ? sections : [{ title: 'Content Outline', items: bullets }]} />
      </>
    )
  }

  if (toolId === 'benchmark') {
    return (
      <>
        <MetricGrid metrics={metrics} />
        <ul className="recommendations">{bullets.map((item) => <li key={item}><CheckCircle2 size={16} />{item}</li>)}</ul>
      </>
    )
  }

  return (
    <>
      <MetricGrid metrics={metrics} />
      <ResultSections sections={sections} />
      <ul className="recommendations">{bullets.map((item) => <li key={item}><CheckCircle2 size={16} />{item}</li>)}</ul>
    </>
  )
}

function inferredMetrics(toolId, data) {
  const score = Number(data.score) || 0
  if (toolId === 'brand') return [{ label: 'Entity Signals', value: score >= 80 ? 'Strong' : score >= 60 ? 'Medium' : 'Weak' }, { label: 'Market Context', value: data.context || 'Needs review' }]
  if (toolId === 'check') return [{ label: 'Answerability', value: score >= 80 ? 'High' : 'Needs work' }, { label: 'Fix Priority', value: score >= 75 ? 'Medium' : 'High' }]
  if (toolId === 'benchmark') return [{ label: 'Brands Ranked', value: '10' }, { label: 'Market Lens', value: 'AI visibility' }]
  return [{ label: 'Output Depth', value: data.depth || 'Structured' }, { label: 'Next Step', value: 'Review' }]
}

function MetricGrid({ metrics }) {
  if (!metrics.length) return null
  return <div className="metric-row">{metrics.slice(0, 4).map((metric) => <Metric key={metric.label} label={metric.label} value={metric.value} />)}</div>
}

function Metric({ label, value }) {
  return <div className="metric"><strong>{value}</strong><span>{label}</span></div>
}

function ResultSection({ title, children }) {
  return <div className="result-section"><h3>{title}</h3>{children}</div>
}

function ResultSections({ sections }) {
  if (!sections.length) return null
  return sections.slice(0, 4).map((section) => (
    <ResultSection key={section.title || section.heading} title={section.title || section.heading || 'Details'}>
      <ul className="recommendations">
        {(section.items || section.bullets || []).slice(0, 6).map((item) => <li key={item}><CheckCircle2 size={16} />{item}</li>)}
      </ul>
    </ResultSection>
  ))
}

function HowItWorks() {
  return (
    <details className="how" open>
      <summary>How it works</summary>
      <p>Each tool turns your input into a structured AI search visibility analysis with clear recommendations for GEO, LLMO, and answer-engine performance.</p>
    </details>
  )
}

function useAiTool(toolId, onRunComplete) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  async function run(input) {
    setLoading(true)
    setError('')
    try {
      const data = await callApi({ tool: toolId, input })
      setResult(data)
      await onRunComplete?.()
    } catch (runError) {
      setError(runError.message)
    } finally {
      setLoading(false)
    }
  }
  return { loading, result, error, run }
}

function BrandEntity({ onRunComplete }) {
  const [form, setForm] = useState({ brand: '', domain: '', country: 'Worldwide', language: 'English' })
  const { loading, result, error, run } = useAiTool('brand', onRunComplete)
  return (
    <ToolFrame toolId="brand" title="Does AI know your brand?" badge="Real-time entity verification" result={result} loading={loading} error={error} onRun={() => run(form)} action="Check AI Authority">
      <div className="two-col">
        <Field label="Brand name" required><input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="e.g. Notion, Stripe, Acme" /></Field>
        <Field label="Domain" required><input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="https://example.com" /></Field>
        <Field label="Country"><SelectField value={form.country} onChange={(country) => setForm({ ...form, country })} options={countries} /></Field>
        <Field label="Language"><SelectField value={form.language} onChange={(language) => setForm({ ...form, language })} options={languages} /></Field>
      </div>
    </ToolFrame>
  )
}

function CrawlerSimulation({ onRunComplete }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  async function run() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/crawl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ url }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Crawler simulation failed.')
      setRows(data.rows)
      await onRunComplete?.()
    } catch (crawlError) {
      setError(crawlError.message)
    } finally {
      setLoading(false)
    }
  }
  return (
    <>
      <div className="tool-head"><div><h2>Run an AI search crawlability check</h2><span>AI search</span></div><button className="ghost-button">Reset</button></div>
      <section className="panel form-panel full">
        <Field label="Website URL" required><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" /></Field>
        <div className="crawler-grid">
          {crawlers.map((name) => {
            const row = rows.find((item) => item.name === name)
            return <div className="crawler-row" key={name}><CheckCircle2 size={16} /><span>{name}</span><strong>{row ? `${row.status} ${row.code}` : 'Will test'}</strong></div>
          })}
        </div>
        <div className="form-footer"><p>Results are saved to your workspace.</p><button className="primary-button" onClick={run} disabled={loading}>{loading ? <Loader2 className="spin" size={17} /> : <Bot size={17} />}Start Crawler Simulation</button></div>
      </section>
      <CrawlerResultPanel rows={rows} loading={loading} error={error} />
      <HowItWorks />
    </>
  )
}

function CrawlerResultPanel({ rows, loading, error }) {
  if (!rows.length && !loading && !error) {
    return (
      <section className="panel result-panel crawler-result">
        <p className="eyeline">Result</p>
        <strong>No crawl test yet</strong>
        <p className="result-summary">Run the simulation to test how your server responds to common AI crawler user-agents. This checks HTTP access behavior; it does not replace a full robots.txt or log-file audit.</p>
      </section>
    )
  }
  const allowed = rows.filter((row) => row.status === 'Allowed').length
  const blocked = rows.length - allowed
  return (
    <section className="panel result-panel crawler-result">
      <p className="eyeline">Crawler Access Result</p>
      <strong>{allowed} of {rows.length} AI crawlers can access the URL</strong>
      {error ? <p className="result-error">{error}</p> : <p className="result-summary">{loading ? 'Testing crawler user-agents...' : blocked ? 'Some AI crawlers could not access the URL. Review bot protection, firewall rules, CDN settings, and robots policies.' : 'The tested AI crawler user-agents received successful HTTP responses.'}</p>}
      <MetricGrid metrics={[{ label: 'Allowed', value: allowed }, { label: 'Blocked / Error', value: blocked }]} />
      <div className="crawler-result-list">
        {rows.map((row) => <div className={row.status === 'Allowed' ? 'crawler-status allowed' : 'crawler-status blocked'} key={row.name}><span>{row.name}</span><strong>{row.status} {row.code}</strong></div>)}
      </div>
    </section>
  )
}

function ModeSwitch({ value, onChange }) {
  return <div className="mode-row">{promptModes.map((mode) => <button key={mode} className={value === mode ? 'active' : ''} onClick={() => onChange(mode)}>{mode}</button>)}</div>
}

function FanOut({ onRunComplete }) {
  const [mode, setMode] = useState('Query Fan Out')
  const [query, setQuery] = useState('')
  const { loading, result, error, run } = useAiTool('fanout', onRunComplete)
  return (
    <ToolFrame toolId="fanout" title="Run Fan-Out Analysis" badge="All engines" result={result} loading={loading} error={error} onRun={() => run({ mode, query })} action="Start Fan-Out Analysis">
      <ModeSwitch value={mode} onChange={setMode} />
      <Field label={fanoutModeHelp[mode]} required><input value={query} onChange={(e) => setQuery(e.target.value)} /></Field>
      <div className="check-list">{['Google AI Overview', 'Google AI Mode', 'ChatGPT'].map((x) => <label key={x}><input type="checkbox" defaultChecked />{x}</label>)}</div>
    </ToolFrame>
  )
}

function PromptResearch({ onRunComplete }) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ brand: '', domain: '', country: 'Worldwide', language: 'English' })
  const { loading, result, error, run } = useAiTool('research', onRunComplete)
  const steps = ['Brand & Domain', 'Brand Description', 'Competitors', 'Topics', 'Personas', 'Search Console', 'SEO Keywords', 'Email']
  return (
    <ToolFrame toolId="research" title="Advanced Prompt Research" badge="Looking for a holistic list of prompts" result={result} loading={loading} error={error} onRun={() => run({ step, ...form })} action="Start AI Prompt Research">
      <ModeSwitch value="Advanced" onChange={() => {}} />
      <div className="steps">{steps.map((s, index) => <button key={s} className={step === index + 1 ? 'active' : ''} onClick={() => setStep(index + 1)}><strong>{index + 1}</strong><span>{s}</span></button>)}</div>
      <p className="info-box">Generate a comprehensive list of search prompts to monitor your brand visibility in AI search engines.</p>
      <div className="two-col">
        <Field label="Your brand"><input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
        <Field label="Domain (without https://)"><input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} /></Field>
        <Field label="Country"><SelectField value={form.country} onChange={(country) => setForm({ ...form, country })} options={countries} /></Field>
        <Field label="Language"><SelectField value={form.language} onChange={(language) => setForm({ ...form, language })} options={languages} /></Field>
      </div>
    </ToolFrame>
  )
}

function LandingCreator({ onRunComplete }) {
  const [form, setForm] = useState({ question: '', brand: '', domain: '', differentiators: '', competitors: '', data: '', context: '', instructions: '', language: 'English' })
  const { loading, result, error, run } = useAiTool('landing', onRunComplete)
  return (
    <ToolFrame toolId="landing" title="Create GEO Optimized Landing Page" badge="AI search optimized" result={result} loading={loading} error={error} onRun={() => run(form)} action="Start Creating Landing Page">
      <Field label="Main question for your landing page" required><input value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="What is your main question?" /></Field>
      <div className="two-col">
        <Field label="Your brand" required><input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
        <Field label="Your domain" required><input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="https://mydomain.com" /></Field>
      </div>
      {[
        ['differentiators', 'Key differentiators'],
        ['competitors', 'Competitors'],
        ['data', 'Available data'],
        ['context', 'Industry context'],
        ['instructions', 'Additional instructions'],
      ].map(([key, label]) => <Field key={key} label={label}><textarea value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></Field>)}
      <Field label="Output language"><SelectField value={form.language} onChange={(language) => setForm({ ...form, language })} options={languages} /></Field>
    </ToolFrame>
  )
}

function ContentCreator({ onRunComplete }) {
  const [briefOnly, setBriefOnly] = useState(false)
  const [type, setType] = useState('Article')
  const [form, setForm] = useState({ prompt: '', urls: '', language: 'English', length: 'Short (500 words)', brand: '', domain: '', instructions: '' })
  const { loading, result, error, run } = useAiTool('content', onRunComplete)
  return (
    <ToolFrame toolId="content" title="Create GEO Optimized Content" badge="AI engines & prompts" result={result} loading={loading} error={error} onRun={() => run({ briefOnly, type, ...form })} action="Start Creating Content">
      <label className="checkbox-line"><input type="checkbox" checked={briefOnly} onChange={(e) => setBriefOnly(e.target.checked)} /> I would like to receive a content brief instead of the full content</label>
      <Field label="Prompt with no or low visibility" required><input value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="What is your main question?" /></Field>
      <Field label="Add up to 3 relevant URLs"><textarea value={form.urls} onChange={(e) => setForm({ ...form, urls: e.target.value })} placeholder="https://domain.com/path/file.html" /></Field>
      <div className="two-col">
        <Field label="Output language"><SelectField value={form.language} onChange={(language) => setForm({ ...form, language })} options={languages} /></Field>
        <Field label="Desired content length"><SelectField value={form.length} onChange={(length) => setForm({ ...form, length })} options={['Short (500 words)', 'Standard (1000 words)', 'Long (1800 words)']} /></Field>
        <Field label="Include your brand"><input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
        <Field label="Include your domain"><input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} /></Field>
      </div>
      <div className="mode-row small">{['Article', 'Blog Post', 'Listicle', 'Comparison'].map((x) => <button key={x} className={type === x ? 'active' : ''} onClick={() => setType(x)}>{x}</button>)}</div>
      <Field label="Additional instructions"><textarea value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></Field>
      <div className="check-list compact">{['Include expert quotes', 'Include FAQs', 'Include a comparison table', 'Include external links', 'Include a CTA'].map((x) => <label key={x}><input type="checkbox" />{x}</label>)}</div>
    </ToolFrame>
  )
}

function ContentCheck({ onRunComplete }) {
  const [form, setForm] = useState({ url: '', content: '', language: 'English' })
  const { loading, result, error, run } = useAiTool('check', onRunComplete)
  return (
    <ToolFrame toolId="check" title="Check your content for GEO compliance" badge="AI search optimized" result={result} loading={loading} error={error} onRun={() => run(form)} action="Start Content Check">
      <Field label="URL of your content"><input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://domain.com/path/page.html" /></Field>
      <div className="or-line"><span>OR</span></div>
      <Field label="Paste your content directly"><textarea className="large" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Paste the content you want to analyze here..." /></Field>
      <Field label="Output language"><SelectField value={form.language} onChange={(language) => setForm({ ...form, language })} options={languages} /></Field>
    </ToolFrame>
  )
}

function Benchmark({ onRunComplete }) {
  const [form, setForm] = useState({ prompt: '', country: 'Worldwide', language: 'English', industry: '' })
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const tableRows = useMemo(() => {
    return rows.map((row, index) => ({
      rank: row.rank || index + 1,
      brand: row.brand || `Brand ${index + 1}`,
      share: typeof row.share === 'number' ? `${row.share}%` : row.share,
      sentiment: typeof row.sentiment === 'number' ? (row.sentiment >= 85 ? 'Leader' : row.sentiment >= 74 ? 'Challenger' : 'Emerging') : row.sentiment,
      reason: row.reason || 'Entity strength',
    }))
  }, [rows])
  async function run() {
    setLoading(true)
    setError('')
    try {
      const data = await callApi({ tool: 'benchmark', input: form })
      setResult(data)
      setRows((data.brands || []).slice(0, 10))
      await onRunComplete?.()
    } catch (runError) {
      setError(runError.message)
    } finally {
      setLoading(false)
    }
  }
  return (
    <>
      <ToolFrame toolId="benchmark" title="Benchmark AI visibility" badge="Top 10 brands by prompt, country, and language" result={result} loading={loading} error={error} onRun={run} action="Run Benchmark">
        <Field label="Search prompt" required><input value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="Best CRM software for mid-market teams" /></Field>
        <div className="three-col">
          <Field label="Country"><SelectField value={form.country} onChange={(country) => setForm({ ...form, country })} options={countries} /></Field>
          <Field label="Language"><SelectField value={form.language} onChange={(language) => setForm({ ...form, language })} options={languages} /></Field>
          <Field label="Industry filter"><input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="SaaS, finance, travel..." /></Field>
        </div>
      </ToolFrame>
      {tableRows.length > 0 && (
        <section className="panel table-panel">
          <div className="table-head"><strong>Top 10 brands</strong><span>{form.country} / {form.language}</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Rank</th><th>Brand</th><th>Visibility</th><th>Status</th><th>Primary driver</th></tr></thead>
              <tbody>{tableRows.map((row) => <tr key={row.rank}><td>{row.rank}</td><td>{row.brand}</td><td>{row.share}</td><td><span className="status-pill">{row.sentiment}</span></td><td>{row.reason}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

export default App

const legalContent = {
  imprint: {
    title: 'Imprint',
    sections: [
      {
        heading: 'Service Provider',
        body: [
          'SASMAZ DIGITAL SOLUTIONS',
          'Tolgar Sasmaz',
          '81543 Munich, Germany',
          'Email: tolgar@sasmaz.digital',
        ],
      },
      {
        heading: 'Responsible for Content',
        body: [
          'Tolgar Sasmaz, 81543 Munich, Germany.',
        ],
      },
      {
        heading: 'Dispute Resolution',
        body: [
          'The European Commission provides an online dispute resolution platform at https://ec.europa.eu/consumers/odr/. We are not obliged and not willing to participate in dispute settlement proceedings before a consumer arbitration board.',
        ],
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    sections: [
      {
        heading: 'Controller',
        body: [
          'SASMAZ DIGITAL SOLUTIONS, Tolgar Sasmaz, 81543 Munich, Germany, tolgar@sasmaz.digital.',
        ],
      },
      {
        heading: 'Data We Process',
        body: [
          'We process account data such as email address and name, authentication data handled by Supabase Auth, and the prompts, URLs, settings, and generated results you save in your workspace.',
          'We also process technical data such as IP address, request metadata, and security logs through our hosting and infrastructure providers.',
        ],
      },
      {
        heading: 'Purpose and Legal Basis',
        body: [
          'We process data to provide the GEO OPTIMIZER AI service, secure user accounts, save analysis history, prevent abuse, and improve service reliability.',
          'The legal basis is contract performance, legitimate interests in secure service operation, and consent where required.',
        ],
      },
      {
        heading: 'Processors',
        body: [
          'We use Supabase for authentication and database storage, Vercel for hosting, and OpenRouter/OpenAI-compatible model providers for AI analysis requests.',
          'AI analysis inputs may be transmitted to the configured model provider to generate results.',
        ],
      },
      {
        heading: 'Retention and Rights',
        body: [
          'Account and workspace data is retained while your account exists or as required by law. You may request access, correction, deletion, restriction, portability, or objection by contacting tolgar@sasmaz.digital.',
          'You may also lodge a complaint with a competent data protection authority.',
        ],
      },
    ],
  },
  terms: {
    title: 'Terms of Use',
    sections: [
      {
        heading: 'Service',
        body: [
          'GEO OPTIMIZER AI provides tools for AI search visibility analysis, content checks, prompt research, crawler simulation, and benchmarking.',
        ],
      },
      {
        heading: 'User Responsibilities',
        body: [
          'You are responsible for the accuracy, legality, and rights clearance of content, URLs, prompts, and data you submit.',
          'You must not use the service for unlawful, harmful, abusive, or security-testing activity against third parties without authorization.',
        ],
      },
      {
        heading: 'AI Results',
        body: [
          'AI-generated outputs may be incomplete or inaccurate and should be reviewed before business, legal, or public use.',
          'The service does not provide legal, financial, or professional advice.',
        ],
      },
      {
        heading: 'Availability',
        body: [
          'We aim to provide reliable access, but availability may depend on third-party providers such as hosting, database, and AI model services.',
        ],
      },
    ],
  },
  cookies: {
    title: 'Cookie Notice',
    sections: [
      {
        heading: 'Essential Cookies',
        body: [
          'We use essential authentication cookies to keep users signed in and protect sessions. These cookies are required for the application to function.',
        ],
      },
      {
        heading: 'Analytics and Marketing Cookies',
        body: [
          'We do not currently use non-essential analytics or marketing cookies in this application.',
        ],
      },
      {
        heading: 'Managing Cookies',
        body: [
          'You can delete or block cookies in your browser settings. Blocking essential cookies may prevent login and workspace features from working.',
        ],
      },
    ],
  },
}
