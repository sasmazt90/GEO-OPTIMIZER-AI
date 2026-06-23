import { useEffect, useState } from 'react'
import {
  BarChart3,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FilePenLine,
  History,
  KeyRound,
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
  { id: 'brandAccess', label: 'Brand & Access', icon: ShieldCheck, tag: 'Entity and crawler readiness' },
  { id: 'visibility', label: 'AI Visibility Check', icon: Eye, tag: 'Model presence by query' },
  { id: 'fanout', label: 'Query Intelligence', icon: Search, tag: 'Query expansion' },
  { id: 'research', label: 'Prompt Research', icon: BrainCircuit, tag: 'Prompt universe' },
  { id: 'contentStudio', label: 'Content Studio', icon: FilePenLine, tag: 'Create and audit GEO content' },
  { id: 'benchmark', label: 'Benchmark', icon: BarChart3, tag: 'Top brands' },
]

const toolDescriptions = {
  brand: 'Checks whether a brand is clearly recognized as an entity by AI systems. It reviews brand name, domain, country, and language to assess entity clarity, trust signals, schema/sameAs needs, and concrete improvement actions.',
  crawler: 'Tests whether the website responds successfully to AI crawler user-agents such as GPTBot, ChatGPT-User, OAI-SearchBot, Googlebot, PerplexityBot, ClaudeBot, and others.',
  visibility: 'Checks whether a selected brand is likely to appear for a specific prompt across AI answer engines and model surfaces. It returns model-by-model presence, confidence, evidence gaps, and actions to improve visibility.',
  fanout: 'Analyzes how an AI search system may expand one query into related sub-queries, comparisons, alternatives, research intents, pricing questions, and implementation paths.',
  research: 'Creates monitorable AI search prompt sets for brand visibility, including brand, competitor, topic, persona, SEO keyword, and Search Console prompt categories.',
  landing: 'Creates an answer-first GEO landing page structure with page blocks, FAQs, proof sections, comparison context, schema recommendations, and extractable answer snippets.',
  content: 'Creates GEO/LLMO-ready content or a content brief based on prompts, URLs, brand context, content type, and target length so AI systems can extract clear answers.',
  check: 'Reviews an existing URL or pasted content for GEO compliance. It scores answerability, entity clarity, evidence, structure, schema, freshness, and extraction quality.',
  benchmark: 'Ranks the top 10 brands likely to appear for a prompt in the selected country and language using likely AI visibility, topical authority, citation footprint, and sentiment.',
}

const groupDescriptions = {
  brandAccess: 'Run brand entity checks and AI crawler access simulations from one place.',
  visibility: toolDescriptions.visibility,
  fanout: toolDescriptions.fanout,
  research: toolDescriptions.research,
  contentStudio: 'Create GEO landing pages and content, then audit existing pages for AI answer readiness.',
  benchmark: toolDescriptions.benchmark,
}

const promptModes = ['Your brand', 'SEO keywords', 'A website', 'Advanced', 'Query Fan Out']
const crawlers = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'Googlebot', 'GoogleOther', 'PerplexityBot', 'ClaudeBot', 'Grok']
const queryIntelligenceSurfaces = ['Google AI Overview', 'Google AI Mode', 'ChatGPT', 'Perplexity', 'Claude', 'Gemini', 'Microsoft Copilot']
const contentSettingOptions = ['Include expert quotes', 'Include FAQs', 'Include a comparison table', 'Include external links', 'Include a CTA']
const fanoutModeHelp = {
  'Your brand': 'Enter your brand or branded search prompt',
  'SEO keywords': 'Enter SEO keywords, one per line or comma-separated',
  'A website': 'Enter a website URL to infer likely AI search prompts',
  Advanced: 'Enter a detailed market, persona, competitor, or topic brief',
  'Query Fan Out': 'Enter the source query you want expanded',
}
const resultPlaceholders = {
  brand: 'Enter a brand, domain, country, and language to check entity clarity across AI answer surfaces.',
  visibility: 'Enter a brand and prompt to check likely presence across AI answer engines and model surfaces.',
  fanout: 'Enter a prompt and select a mode to see how AI search systems may expand it into related sub-queries.',
  research: 'Complete the research inputs to generate a monitoring prompt set for brand, competitor, persona, topic, and SEO visibility.',
  landing: 'Fill in the landing page brief to generate an answer-first GEO page structure.',
  content: 'Provide a prompt or URLs to create GEO-ready content or a content brief.',
  check: 'Paste content or add a URL to receive a GEO compliance review.',
  benchmark: 'Enter a prompt, country, and language to rank likely visible brands.',
}

const howItWorksContent = {
  brand: {
    title: 'How brand entity analysis works',
    body: 'This check reviews whether AI systems have enough clear signals to understand the brand as a distinct entity in the selected market and language.',
    steps: [
      'It combines brand name, domain, country, and language context into an entity visibility prompt.',
      'It evaluates entity clarity, third-party corroboration, schema/sameAs readiness, category ownership, and answer-engine citation likelihood.',
      'The result separates what is already strong, what needs improvement, and what should be added next.',
    ],
  },
  crawler: {
    title: 'How crawler simulation works',
    body: 'This simulation tests whether common AI crawler user-agents can reach the submitted URL at the HTTP response level.',
    steps: [
      'It sends live requests using user-agent strings for GPTBot, ChatGPT-User, OAI-SearchBot, Googlebot, PerplexityBot, ClaudeBot, and related crawlers.',
      'It reports whether each crawler received an allowed response or was blocked/erroring.',
      'It does not replace robots.txt, sitemap, rendered HTML, or server log analysis; those remain separate follow-up checks.',
    ],
  },
  visibility: {
    title: 'How model presence checking works',
    body: 'This tool checks whether a brand is likely to appear for a specific prompt across selected AI answer surfaces.',
    steps: [
      'For supported OpenRouter models, it runs direct answer probes and checks whether the brand appears naturally in the answer.',
      'For surfaces without a direct query API, such as Google AI Overview or Copilot, it marks findings as an assessment instead of pretending to have live access.',
      'The result shows model-by-model presence, confidence, evidence gaps, and next actions to improve inclusion.',
    ],
  },
  fanout: {
    title: 'How query fan-out analysis works',
    body: 'This analysis estimates how AI search systems may expand one prompt into multiple related intents before generating an answer.',
    steps: [
      'You choose the input mode: brand, SEO keywords, website, advanced brief, or direct query fan-out.',
      'The tool expands the source input into comparison, alternatives, pricing, trust, implementation, and use-case sub-queries.',
      'The result helps you decide which related prompts and answer paths your brand or content should cover.',
    ],
  },
  research: {
    title: 'How prompt research works',
    body: 'This workflow creates a monitorable prompt universe for AI search visibility tracking.',
    steps: [
      'It starts with brand, domain, market, and language, then supports structured research steps for competitors, topics, personas, SEO keywords, and Search Console inputs.',
      'It groups prompts by monitoring purpose, such as branded, non-branded, competitor, topic, persona, and buying-intent queries.',
      'The result is a practical prompt set you can use to track AI visibility and content gaps over time.',
    ],
  },
  landing: {
    title: 'How landing page creation works',
    body: 'This creator turns a main question and brand brief into an answer-first GEO landing page plan.',
    steps: [
      'It uses your question, brand, domain, differentiators, competitors, available proof, industry context, and language.',
      'It creates page blocks designed for AI extraction: direct answer sections, proof, comparisons, FAQs, schema ideas, and concise snippets.',
      'The result shows which page elements are ready, which need stronger evidence, and what should be added before publishing.',
    ],
  },
  content: {
    title: 'How content creation works',
    body: 'This creator produces GEO/LLMO-ready content or a content brief for a target prompt and content type.',
    steps: [
      'It uses your prompt, reference URLs, brand/domain context, output language, desired length, and content type.',
      'It structures content so AI answer engines can extract clear definitions, lists, comparisons, FAQs, evidence, and calls to action.',
      'The result can be used as a draft direction or a brief, depending on whether brief-only mode is selected.',
    ],
  },
  check: {
    title: 'How content checking works',
    body: 'This check reviews an existing URL or pasted content for GEO compliance and answer-engine readability.',
    steps: [
      'It analyzes answerability, entity clarity, evidence, structure, schema readiness, freshness, and extraction quality.',
      'It produces a compliance score and a breakdown of what is already working, what is weak, and what is missing.',
      'The result focuses on practical fixes that make the page easier for AI systems to cite, summarize, and include.',
    ],
  },
  benchmark: {
    title: 'How benchmark ranking works',
    body: 'This benchmark estimates which brands are most likely to appear for a prompt in the selected country and language.',
    steps: [
      'It uses your prompt, market, language, and optional industry filter to define the competitive answer context.',
      'It ranks ten likely visible brands by topical authority, citation footprint, sentiment, and prompt relevance.',
      'The result helps you compare visibility competitors and identify the signals your brand needs to improve.',
    ],
  },
}

const visibilityModels = ['ChatGPT', 'Google AI Overview', 'Google AI Mode', 'Perplexity', 'Claude', 'Gemini', 'Microsoft Copilot']

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

function reportLabel(toolId) {
  const labels = {
    brand: 'Brand Entity Report',
    crawler: 'Crawler Simulation Report',
    visibility: 'AI Visibility Report',
    fanout: 'Query Intelligence Report',
    research: 'Prompt Research Report',
    landing: 'Landing Page Report',
    content: 'Content Creator Report',
    check: 'Content Check Report',
    benchmark: 'Benchmark Report',
  }
  return labels[toolId] || 'GEO Optimizer Report'
}

function safeCell(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function tableHtml(title, headers, rows) {
  if (!rows?.length) return ''
  return `<h2>${safeCell(title)}</h2><table border="1"><thead><tr>${headers.map((header) => `<th>${safeCell(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${safeCell(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
}

function rowsFromSections(sections = []) {
  return sections.flatMap((section) => (section.items || []).map((item) => [section.title, item]))
}

function buildReportWorkbook(toolId, data) {
  const generatedAt = new Date().toLocaleString()
  const sections = Array.isArray(data.sections) ? data.sections : []
  const metrics = Array.isArray(data.metrics) ? data.metrics : []
  const bullets = Array.isArray(data.bullets) ? data.bullets : []
  const html = [
    '<html><head><meta charset="utf-8" /></head><body>',
    `<h1>${safeCell(reportLabel(toolId))}</h1>`,
    tableHtml('Overview', ['Field', 'Value'], [
      ['Generated at', generatedAt],
      ['Title', data.title || reportLabel(toolId)],
      ['Score', data.score ?? '-'],
      ['Summary', data.summary || '-'],
    ]),
    tableHtml('Metrics', ['Metric', 'Value'], metrics.map((metric) => [metric.label, metric.value])),
    tableHtml('Status and Recommendations', ['Section', 'Item'], rowsFromSections(sections)),
    tableHtml('Action Items', ['Recommendation'], bullets.map((item) => [item])),
    tableHtml('Generated Queries', ['Query', 'Intent'], (data.queries || []).map((item) => [item.query || item, item.intent || item.reason || ''])),
    tableHtml('Surface Insights', ['AI Surface', 'Fan-Out Behavior', 'Query Patterns'], (data.surfaceInsights || []).map((row) => [row.surface, row.behavior, row.queryPatterns])),
    tableHtml('Model Presence', ['AI Surface', 'Presence', 'Confidence', 'Evidence / Gap', 'Next Action'], (data.models || []).map((row) => [row.model || row.surface, row.presence || row.status, row.confidence || '-', row.evidence || row.reason || '-', row.nextAction || row.action || '-'])),
    tableHtml('Top Brands', ['Rank', 'Brand', 'Visibility', 'Status', 'Primary Driver'], (data.brands || []).map((row, index) => [row.rank || index + 1, row.brand, row.share, row.sentiment, row.reason])),
    tableHtml('Crawler Results', ['Crawler', 'Status', 'HTTP Code'], (data.rows || []).map((row) => [row.name, row.status, row.code])),
    '</body></html>',
  ].join('')
  return html
}

function downloadExcelReport(toolId, data) {
  const workbook = buildReportWorkbook(toolId, data || {})
  const blob = new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 10)
  link.href = url
  link.download = `${toolId || 'geo'}-report-${stamp}.xls`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function App() {
  const [activeTool, setActiveTool] = useState('brandAccess')
  const [mobileNav, setMobileNav] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [legalPage, setLegalPage] = useState('')
  const [accountPage, setAccountPage] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [runs, setRuns] = useState([])
  const [recoveryToken, setRecoveryToken] = useState('')
  const active = tools.find((tool) => tool.id === activeTool) || tools[0]

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
              <button key={run.id} onClick={() => { setActiveTool(primaryToolForRun(run.type)); setAccountPage(false) }}>
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
          {!accountPage && <ToolIntro>{groupDescriptions[activeTool]}</ToolIntro>}
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
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)

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

  async function changePassword(event) {
    event.preventDefault()
    setPasswordSaving(true)
    setError('')
    setMessage('')
    try {
      if (passwordForm.newPassword !== passwordForm.confirmPassword) throw new Error('New passwords do not match.')
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Password could not be changed.')
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setMessage(data.message || 'Password changed successfully.')
    } catch (passwordError) {
      setError(passwordError.message)
    } finally {
      setPasswordSaving(false)
    }
  }

  return (
    <div className="account-stack">
      {message && <p className="auth-success account-message">{message}</p>}
      {error && <p className="auth-error account-message">{error}</p>}
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
          <div className="account-actions">
            <button className="primary-button" disabled={saving}>{saving ? <Loader2 className="spin" size={17} /> : <UserRound size={17} />}Save Profile</button>
            <button type="button" className="ghost-button" onClick={sendReset} disabled={saving}>Send Password Reset</button>
          </div>
        </form>
      </section>

      <section className="panel account-panel">
        <div className="account-head">
          <div>
            <p className="eyeline">Security</p>
            <h2>Change password</h2>
          </div>
        </div>
        <form onSubmit={changePassword} className="account-form">
          <Field label="Current password" required><input type="password" autoComplete="current-password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} /></Field>
          <div className="two-col">
            <Field label="New password" required><input type="password" autoComplete="new-password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} /></Field>
            <Field label="Confirm new password" required><input type="password" autoComplete="new-password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })} /></Field>
          </div>
          <div className="account-actions">
            <button className="primary-button" disabled={passwordSaving}>{passwordSaving ? <Loader2 className="spin" size={17} /> : <KeyRound size={17} />}Change Password</button>
          </div>
        </form>
      </section>
    </div>
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

function primaryToolForRun(type) {
  if (type === 'brand' || type === 'crawler') return 'brandAccess'
  if (type === 'landing' || type === 'content' || type === 'check') return 'contentStudio'
  if (type === 'visibility') return 'visibility'
  return tools.some((tool) => tool.id === type) ? type : 'brandAccess'
}

function ToolIntro({ children }) {
  return <p className="tool-description">{children}</p>
}

function SubToolSwitch({ value, onChange, options }) {
  return (
    <div className="mode-row subtool-row">
      {options.map((option) => (
        <button key={option.id} className={value === option.id ? 'active' : ''} onClick={() => onChange(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

function ToolRouter({ activeTool, onRunComplete }) {
  if (activeTool === 'brandAccess') return <BrandAccess onRunComplete={onRunComplete} />
  if (activeTool === 'visibility') return <VisibilityCheck onRunComplete={onRunComplete} />
  if (activeTool === 'fanout') return <FanOut onRunComplete={onRunComplete} />
  if (activeTool === 'research') return <PromptResearch onRunComplete={onRunComplete} />
  if (activeTool === 'contentStudio') return <ContentStudio onRunComplete={onRunComplete} />
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

function FieldGroup({ label, children, hint, required }) {
  return (
    <div className="field">
      <span>{label} {required && <b>Required</b>}</span>
      {children}
      {hint && <em>{hint}</em>}
    </div>
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

function ToolFrame({
  toolId,
  title,
  badge,
  children,
  result,
  loading,
  error,
  onRun,
  onReset,
  action = 'Start Analysis',
  newAction = 'New Analysis',
  howItWorks,
}) {
  const resultMode = loading || Boolean(result) || Boolean(error)
  return (
    <>
      <div className="tool-head">
        <div>
          <h2>{title}</h2>
          <span>{badge}</span>
        </div>
        <button className="ghost-button" onClick={onReset}>Reset</button>
      </div>
      {resultMode ? (
        <div className="result-workspace">
          <ResultPanel toolId={toolId} result={result} loading={loading} error={error} wide />
          {!loading && (
            <div className="result-actions">
              <button className="primary-button" onClick={onReset}>
                <Wand2 size={17} />
                {newAction}
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
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
          <HowItWorks content={howItWorks || howItWorksContent[toolId]} />
        </>
      )}
    </>
  )
}

function ResultPanel({ toolId, result, loading, error, wide = false }) {
  if (!result && !loading && !error) return <EmptyResult toolId={toolId} />
  if (loading) return <ProcessingPanel toolId={toolId} wide={wide} />
  const data = result || {}
  const hideScore = ['fanout', 'research', 'landing', 'content'].includes(toolId)
  return (
    <section className={`panel result-panel result-${toolId}${wide ? ' wide' : ''}`}>
      <div className="result-header-grid">
        <div className="result-top">
          <p className="eyeline">Result</p>
          <strong>{data.title || (loading ? 'Analysis in progress' : 'Analysis result')}</strong>
        </div>
        <div className="result-side-actions">
          <button type="button" className="ghost-button small" onClick={() => downloadExcelReport(toolId, data)}><Download size={16} />Download Excel Report</button>
          {!hideScore && <ScoreBlock score={data.score} loading={loading} label={toolId === 'check' ? 'Compliance Score' : 'Confidence Score'} />}
        </div>
      </div>
      {error ? (
        <p className="result-error">{error}</p>
      ) : (
        <p className="result-summary">{loading ? 'Running live analysis and preparing structured recommendations.' : data.summary}</p>
      )}
      <ToolSpecificResult toolId={toolId} data={data} />
    </section>
  )
}

function ProcessingPanel({ toolId, wide = false }) {
  const labels = {
    brand: 'Checking brand entity signals',
    visibility: 'Checking model presence',
    fanout: 'Generating query fan-out',
    research: 'Building prompt research',
    landing: 'Creating landing page plan',
    content: 'Creating GEO content',
    check: 'Checking content compliance',
    benchmark: 'Ranking visible brands',
    crawler: 'Testing crawler access',
  }
  return (
    <section className={`panel result-panel processing-panel result-${toolId}${wide ? ' wide' : ''}`} aria-live="polite" aria-busy="true">
      <div className="processing-core">
        <Loader2 className="spin" size={42} />
        <p className="eyeline">Processing</p>
        <strong>{labels[toolId] || 'Running analysis'}</strong>
        <span>We are analyzing live inputs and preparing structured recommendations. This can take a little longer when model probes or page content checks are involved.</span>
      </div>
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
  const statusSections = extractStatusSections(sections, bullets, data.score)
  const detailSections = sections.filter((section) => !statusKind(section.title || section.heading || ''))
  const uncategorizedBullets = hasStatusContent(statusSections) ? [] : bullets

  if (toolId === 'fanout') {
    const queries = Array.isArray(data.queries) ? data.queries : bullets.map((query) => ({ query, intent: 'Related search path' }))
    return (
      <>
        <MetricGrid metrics={metrics} />
        <StatusBoard sections={statusSections} />
        <SurfaceInsightsTable rows={data.surfaceInsights || []} />
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
        <ResultSections sections={detailSections} />
      </>
    )
  }

  if (toolId === 'research') {
    return (
      <>
        <MetricGrid metrics={metrics} />
        <StatusBoard sections={statusSections} />
        <ResultSections sections={detailSections.length ? detailSections : [{ title: 'Prompt Buckets', items: bullets }]} />
      </>
    )
  }

  if (toolId === 'landing') {
    return (
      <>
        <MetricGrid metrics={metrics} />
        <StatusBoard sections={statusSections} />
        <ResultSections sections={detailSections.length ? detailSections : [{ title: 'Recommended Page Blocks', items: bullets }]} />
      </>
    )
  }

  if (toolId === 'content') {
    return (
      <>
        <MetricGrid metrics={metrics} />
        <StatusBoard sections={statusSections} />
        <ResultSections sections={detailSections.length ? detailSections : [{ title: 'Content Outline', items: bullets }]} />
      </>
    )
  }

  if (toolId === 'benchmark') {
    return (
      <>
        <MetricGrid metrics={metrics} />
        <StatusBoard sections={statusSections} />
        <BenchmarkTable rows={data.brands || []} />
        <RecommendationsList items={uncategorizedBullets} />
      </>
    )
  }

  if (toolId === 'visibility') {
    return (
      <>
        <MetricGrid metrics={metrics} />
        <StatusBoard sections={statusSections} />
        <ModelPresenceTable rows={data.models || []} />
        <ResultSections sections={detailSections} />
        <RecommendationsList items={uncategorizedBullets} />
      </>
    )
  }

  return (
    <>
      <MetricGrid metrics={metrics} />
      <StatusBoard sections={statusSections} />
      <ResultSections sections={detailSections} />
      <RecommendationsList items={uncategorizedBullets} />
    </>
  )
}

function hasStatusContent(sections) {
  return ['done', 'improve', 'missing'].some((key) => Array.isArray(sections[key]) && sections[key].length > 0)
}

function RecommendationsList({ items }) {
  if (!Array.isArray(items) || !items.length) return null
  return (
    <ResultSection title="Recommendations">
      <ul className="recommendations">
        {items.map((item) => <li key={item}><CheckCircle2 size={16} />{item}</li>)}
      </ul>
    </ResultSection>
  )
}

function SurfaceInsightsTable({ rows }) {
  if (!Array.isArray(rows) || !rows.length) return null
  return (
    <ResultSection title="Surface-specific fan-out">
      <div className="table-wrap">
        <table>
          <thead><tr><th>AI Surface</th><th>Fan-Out Behavior</th><th>Query Patterns</th></tr></thead>
          <tbody>
            {rows.slice(0, 10).map((row) => (
              <tr key={row.surface}>
                <td>{row.surface}</td>
                <td>{row.behavior}</td>
                <td>{row.queryPatterns}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ResultSection>
  )
}

function ModelPresenceTable({ rows }) {
  if (!Array.isArray(rows) || !rows.length) return null
  return (
    <ResultSection title="Model presence by surface">
      <div className="table-wrap">
        <table>
          <thead><tr><th>AI Surface</th><th>Presence</th><th>Confidence</th><th>Evidence / Gap</th><th>Next Action</th></tr></thead>
          <tbody>
            {rows.slice(0, 10).map((row) => (
              <tr key={row.model || row.surface}>
                <td>{row.model || row.surface}</td>
                <td><span className="status-pill">{row.presence || row.status || 'Unknown'}</span></td>
                <td>{row.confidence || '-'}</td>
                <td>{row.evidence || row.reason || '-'}</td>
                <td>{row.nextAction || row.action || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ResultSection>
  )
}

function statusKind(title) {
  const normalized = title.toLowerCase()
  if (normalized.includes('already') || normalized.includes('done') || normalized.includes('working') || normalized.includes('present')) return 'done'
  if (normalized.includes('improve') || normalized.includes('needs') || normalized.includes('weak') || normalized.includes('partial')) return 'improve'
  if (normalized.includes('missing') || normalized.includes('should add') || normalized.includes('add next') || normalized.includes('not covered')) return 'missing'
  return ''
}

function extractStatusSections(sections, bullets, score) {
  const defaults = {
    done: [],
    improve: [],
    missing: [],
  }
  sections.forEach((section) => {
    const kind = statusKind(section.title || section.heading || '')
    if (kind) defaults[kind] = [...defaults[kind], ...(section.items || section.bullets || [])]
  })
  if (!defaults.done.length && Number(score) >= 75) defaults.done = ['Core answer-engine signals are strong enough to build on.']
  if (!defaults.improve.length) defaults.improve = bullets.slice(0, 3)
  if (!defaults.missing.length) defaults.missing = bullets.slice(3, 6)
  return defaults
}

function StatusBoard({ sections }) {
  const cards = [
    { key: 'done', title: 'Already done', empty: 'No confirmed strengths yet.' },
    { key: 'improve', title: 'Needs improvement', empty: 'No urgent improvement item surfaced.' },
    { key: 'missing', title: 'Missing / should add', empty: 'No missing item surfaced.' },
  ]
  const hasContent = cards.some((card) => sections[card.key]?.length)
  if (!hasContent) return null
  return (
    <div className="status-board">
      {cards.map((card) => (
        <div className={`status-card ${card.key}`} key={card.key}>
          <h3>{card.title}</h3>
          <ul className="recommendations">
            {(sections[card.key]?.length ? sections[card.key] : [card.empty]).slice(0, 5).map((item) => <li key={item}><CheckCircle2 size={16} />{item}</li>)}
          </ul>
        </div>
      ))}
    </div>
  )
}

function BenchmarkTable({ rows }) {
  if (!Array.isArray(rows) || !rows.length) return null
  const tableRows = rows.slice(0, 10).map((row, index) => ({
    rank: row.rank || index + 1,
    brand: row.brand || `Brand ${index + 1}`,
    share: typeof row.share === 'number' ? `${row.share}%` : row.share,
    sentiment: typeof row.sentiment === 'number' ? (row.sentiment >= 85 ? 'Leader' : row.sentiment >= 74 ? 'Challenger' : 'Emerging') : row.sentiment,
    reason: row.reason || 'Entity strength',
  }))
  return (
    <ResultSection title="Top 10 brands">
      <div className="table-wrap">
        <table>
          <thead><tr><th>Rank</th><th>Brand</th><th>Visibility</th><th>Status</th><th>Primary driver</th></tr></thead>
          <tbody>{tableRows.map((row) => <tr key={row.rank}><td>{row.rank}</td><td>{row.brand}</td><td>{row.share}</td><td><span className="status-pill">{row.sentiment}</span></td><td>{row.reason}</td></tr>)}</tbody>
        </table>
      </div>
    </ResultSection>
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

function HowItWorks({ content }) {
  const details = content || {
    title: 'How this analysis works',
    body: 'This tool turns your input into a structured AI search visibility analysis.',
    steps: [],
  }
  return (
    <details className="how" open>
      <summary>{details.title}</summary>
      <p>{details.body}</p>
      {details.steps?.length > 0 && (
        <ul>
          {details.steps.map((step) => <li key={step}>{step}</li>)}
        </ul>
      )}
    </details>
  )
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function validateToolInput(toolId, input = {}) {
  const requirements = {
    brand: [
      ['brand', 'Enter a brand name.'],
      ['domain', 'Enter a domain.'],
    ],
    visibility: [
      ['brand', 'Enter a brand name.'],
      ['prompt', 'Enter a search prompt or user question.'],
    ],
    fanout: [
      ['query', 'Enter a query, keyword, website, or brief to analyze.'],
    ],
    research: [
      ['brand', 'Enter your brand.'],
      ['domain', 'Enter your domain.'],
    ],
    landing: [
      ['question', 'Enter the main landing page question.'],
      ['brand', 'Enter your brand.'],
      ['domain', 'Enter your domain.'],
    ],
    content: [
      ['prompt', 'Enter the content prompt.'],
    ],
    benchmark: [
      ['prompt', 'Enter the benchmark search prompt.'],
    ],
  }
  if (toolId === 'check' && !hasText(input.url) && !hasText(input.content)) {
    return 'Enter a content URL or paste content to analyze.'
  }
  const missing = (requirements[toolId] || []).find(([key]) => !hasText(input[key]))
  if (missing) return missing[1]
  if (toolId === 'visibility' && (!Array.isArray(input.models) || !input.models.length)) return 'Select at least one AI surface.'
  if (toolId === 'fanout' && (!Array.isArray(input.surfaces) || !input.surfaces.length)) return 'Select at least one AI surface.'
  return ''
}

function isValidWebsiteUrl(value) {
  if (!hasText(value)) return false
  try {
    const target = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`
    return new URL(target).hostname.includes('.')
  } catch {
    return false
  }
}

function useAiTool(toolId, onRunComplete) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  function reset() {
    setResult(null)
    setError('')
    setLoading(false)
  }
  async function run(input) {
    const validationError = validateToolInput(toolId, input)
    if (validationError) {
      setResult(null)
      setError(validationError)
      return
    }
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
  return { loading, result, error, run, reset }
}

function BrandAccess({ onRunComplete }) {
  const [mode, setMode] = useState('brand')
  return (
    <>
      <SubToolSwitch
        value={mode}
        onChange={setMode}
        options={[
          { id: 'brand', label: 'Brand Entity' },
          { id: 'crawler', label: 'Crawler Simulation' },
        ]}
      />
      <p className="info-box">{mode === 'brand' ? toolDescriptions.brand : toolDescriptions.crawler}</p>
      {mode === 'brand' ? <BrandEntity onRunComplete={onRunComplete} /> : <CrawlerSimulation onRunComplete={onRunComplete} />}
    </>
  )
}

function BrandEntity({ onRunComplete }) {
  const emptyForm = { brand: '', domain: '', country: 'Worldwide', language: 'English' }
  const [form, setForm] = useState(emptyForm)
  const { loading, result, error, run, reset } = useAiTool('brand', onRunComplete)
  const resetTool = () => {
    reset()
    setForm(emptyForm)
  }
  return (
    <ToolFrame toolId="brand" title="Does AI know your brand?" badge="Real-time entity verification" result={result} loading={loading} error={error} onRun={() => run(form)} onReset={resetTool} action="Check AI Authority" newAction="New Brand Entity Check">
      <div className="two-col">
        <Field label="Brand name" required><input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="e.g. Notion, Stripe, Acme" /></Field>
        <Field label="Domain" required><input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="https://example.com" /></Field>
        <Field label="Country"><SelectField value={form.country} onChange={(country) => setForm({ ...form, country })} options={countries} /></Field>
        <Field label="Language"><SelectField value={form.language} onChange={(language) => setForm({ ...form, language })} options={languages} /></Field>
      </div>
    </ToolFrame>
  )
}

function VisibilityCheck({ onRunComplete }) {
  const emptyForm = {
    brand: '',
    domain: '',
    prompt: '',
    country: 'Worldwide',
    language: 'English',
    models: visibilityModels,
  }
  const [form, setForm] = useState(emptyForm)
  const { loading, result, error, run, reset } = useAiTool('visibility', onRunComplete)
  const resetTool = () => {
    reset()
    setForm(emptyForm)
  }
  function toggleModel(model) {
    const nextModels = form.models.includes(model)
      ? form.models.filter((item) => item !== model)
      : [...form.models, model]
    setForm({ ...form, models: nextModels.length ? nextModels : [model] })
  }
  return (
    <ToolFrame toolId="visibility" title="Check AI model presence" badge="Model-by-model visibility" result={result} loading={loading} error={error} onRun={() => run(form)} onReset={resetTool} action="Check Model Presence" newAction="New Visibility Check">
      <div className="two-col">
        <Field label="Brand name" required><input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="e.g. Bioderma, Stripe, Acme" /></Field>
        <Field label="Domain"><input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="https://example.com" /></Field>
      </div>
      <Field label="Search prompt or user question" required><textarea value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="e.g. Best dermatology brands for sensitive skin in Turkey" /></Field>
      <div className="two-col">
        <Field label="Country"><SelectField value={form.country} onChange={(country) => setForm({ ...form, country })} options={countries} /></Field>
        <Field label="Language"><SelectField value={form.language} onChange={(language) => setForm({ ...form, language })} options={languages} /></Field>
      </div>
      <FieldGroup label="AI surfaces to check">
        <div className="check-list compact model-list">
          {visibilityModels.map((model) => (
            <label key={model}>
              <input type="checkbox" checked={form.models.includes(model)} onChange={() => toggleModel(model)} />
              {model}
            </label>
          ))}
        </div>
      </FieldGroup>
    </ToolFrame>
  )
}

function CrawlerSimulation({ onRunComplete }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const resultMode = loading || rows.length > 0 || Boolean(error)
  function resetTool() {
    setUrl('')
    setRows([])
    setError('')
    setLoading(false)
  }
  async function run() {
    if (!isValidWebsiteUrl(url)) {
      setRows([])
      setError('Enter a valid website URL.')
      return
    }
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
      <div className="tool-head"><div><h2>Run an AI search crawlability check</h2><span>AI search</span></div><button className="ghost-button" onClick={resetTool}>Reset</button></div>
      {resultMode ? (
        <div className="result-workspace">
          <CrawlerResultPanel rows={rows} loading={loading} error={error} wide />
          {!loading && (
            <div className="result-actions">
              <button className="primary-button" onClick={resetTool}>
                <Bot size={17} />
                New Crawler Simulation
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <section className="panel form-panel full">
            <Field label="Website URL" required><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" /></Field>
            <div className="crawler-grid">
              {crawlers.map((name) => (
                <div className="crawler-row" key={name}><CheckCircle2 size={16} /><span>{name}</span><strong>Will test</strong></div>
              ))}
            </div>
            <div className="form-footer"><p>Results are saved to your workspace.</p><button className="primary-button" onClick={run} disabled={loading}>{loading ? <Loader2 className="spin" size={17} /> : <Bot size={17} />}Start Crawler Simulation</button></div>
          </section>
          <CrawlerResultPanel rows={rows} loading={loading} error={error} />
          <HowItWorks content={howItWorksContent.crawler} />
        </>
      )}
    </>
  )
}

function ContentStudio({ onRunComplete }) {
  const [mode, setMode] = useState('check')
  return (
    <>
      <SubToolSwitch
        value={mode}
        onChange={setMode}
        options={[
          { id: 'check', label: 'Content Check' },
          { id: 'content', label: 'Content Creator' },
          { id: 'landing', label: 'Landing Page Creator' },
        ]}
      />
      <p className="info-box">{toolDescriptions[mode]}</p>
      {mode === 'check' && <ContentCheck onRunComplete={onRunComplete} />}
      {mode === 'content' && <ContentCreator onRunComplete={onRunComplete} />}
      {mode === 'landing' && <LandingCreator onRunComplete={onRunComplete} />}
    </>
  )
}

function CrawlerResultPanel({ rows, loading, error, wide = false }) {
  if (loading) return <ProcessingPanel toolId="crawler" wide={wide} />
  if (!rows.length && !loading && !error) {
    return (
      <section className={`panel result-panel crawler-result${wide ? ' wide' : ''}`}>
        <p className="eyeline">Result</p>
        <strong>No crawl test yet</strong>
        <p className="result-summary">Run the simulation to test how your server responds to common AI crawler user-agents. This checks HTTP access behavior; it does not replace a full robots.txt or log-file audit.</p>
      </section>
    )
  }
  const allowed = rows.filter((row) => row.status === 'Allowed').length
  const blocked = rows.length - allowed
  return (
    <section className={`panel result-panel crawler-result${wide ? ' wide' : ''}`}>
      <div className="result-header-grid">
        <div className="result-top">
          <p className="eyeline">Crawler Access Result</p>
          <strong>{allowed} of {rows.length} AI crawlers can access the URL</strong>
        </div>
        <div className="result-side-actions">
          <button type="button" className="ghost-button small" onClick={() => downloadExcelReport('crawler', {
            title: 'Crawler Access Result',
            score: rows.length ? Math.round((allowed / rows.length) * 100) : 0,
            summary: blocked ? 'Some crawler user-agents could not access the URL.' : 'All tested crawler user-agents received successful HTTP responses.',
            metrics: [{ label: 'Allowed', value: allowed }, { label: 'Blocked / Error', value: blocked }],
            rows,
          })}><Download size={16} />Download Excel Report</button>
        </div>
      </div>
      {error ? <p className="result-error">{error}</p> : <p className="result-summary">{loading ? 'Testing crawler user-agents...' : blocked ? 'Some AI crawlers could not access the URL. Review bot protection, firewall rules, CDN settings, and robots policies.' : 'The tested AI crawler user-agents received successful HTTP responses.'}</p>}
      <MetricGrid metrics={[{ label: 'Allowed', value: allowed }, { label: 'Blocked / Error', value: blocked }]} />
      <StatusBoard sections={{
        done: allowed ? [`${allowed} tested crawler user-agents received accessible HTTP responses.`] : [],
        improve: blocked ? ['Review bot protection, firewall, CDN, and rate-limit rules for blocked crawlers.'] : ['Keep this check in your release workflow after CDN, firewall, CMS, or bot-protection changes.'],
        missing: ['Robots.txt, sitemap exposure, server logs, and rendered HTML extraction still require separate validation.'],
      }} />
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
  const [surfaces, setSurfaces] = useState(queryIntelligenceSurfaces)
  const { loading, result, error, run, reset } = useAiTool('fanout', onRunComplete)
  const resetTool = () => {
    reset()
    setMode('Query Fan Out')
    setQuery('')
    setSurfaces(queryIntelligenceSurfaces)
  }
  function toggleSurface(surface) {
    const nextSurfaces = surfaces.includes(surface)
      ? surfaces.filter((item) => item !== surface)
      : [...surfaces, surface]
    setSurfaces(nextSurfaces.length ? nextSurfaces : [surface])
  }
  return (
    <ToolFrame toolId="fanout" title="Run Fan-Out Analysis" badge="All engines" result={result} loading={loading} error={error} onRun={() => run({ mode, query, surfaces })} onReset={resetTool} action="Start Fan-Out Analysis" newAction="New Fan-Out Analysis">
      <ModeSwitch value={mode} onChange={setMode} />
      <Field label={fanoutModeHelp[mode]} required><input value={query} onChange={(e) => setQuery(e.target.value)} /></Field>
      <FieldGroup label="AI surfaces to model">
        <div className="check-list compact model-list">
          {queryIntelligenceSurfaces.map((surface) => (
            <label key={surface}>
              <input type="checkbox" checked={surfaces.includes(surface)} onChange={() => toggleSurface(surface)} />
              {surface}
            </label>
          ))}
        </div>
      </FieldGroup>
    </ToolFrame>
  )
}

function PromptResearch({ onRunComplete }) {
  const [step, setStep] = useState(1)
  const emptyForm = { brand: '', domain: '', country: 'Worldwide', language: 'English' }
  const [form, setForm] = useState(emptyForm)
  const { loading, result, error, run, reset } = useAiTool('research', onRunComplete)
  const steps = ['Brand & Domain', 'Brand Description', 'Competitors', 'Topics', 'Personas', 'Search Console', 'SEO Keywords', 'Email']
  const resetTool = () => {
    reset()
    setStep(1)
    setForm(emptyForm)
  }
  return (
    <ToolFrame toolId="research" title="Advanced Prompt Research" badge="Looking for a holistic list of prompts" result={result} loading={loading} error={error} onRun={() => run({ step, ...form })} onReset={resetTool} action="Start AI Prompt Research" newAction="New Prompt Research">
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
  const emptyForm = { question: '', brand: '', domain: '', differentiators: '', competitors: '', data: '', context: '', instructions: '', language: 'English' }
  const [form, setForm] = useState(emptyForm)
  const { loading, result, error, run, reset } = useAiTool('landing', onRunComplete)
  const resetTool = () => {
    reset()
    setForm(emptyForm)
  }
  return (
    <ToolFrame toolId="landing" title="Create GEO Optimized Landing Page" badge="AI search optimized" result={result} loading={loading} error={error} onRun={() => run(form)} onReset={resetTool} action="Start Creating Landing Page" newAction="New Landing Page">
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
  const [settings, setSettings] = useState([])
  const emptyForm = { prompt: '', urls: '', language: 'English', length: 'Short (500 words)', brand: '', domain: '', instructions: '' }
  const [form, setForm] = useState(emptyForm)
  const { loading, result, error, run, reset } = useAiTool('content', onRunComplete)
  const resetTool = () => {
    reset()
    setBriefOnly(false)
    setType('Article')
    setSettings([])
    setForm(emptyForm)
  }
  function toggleSetting(setting) {
    setSettings(settings.includes(setting)
      ? settings.filter((item) => item !== setting)
      : [...settings, setting])
  }
  return (
    <ToolFrame toolId="content" title="Create GEO Optimized Content" badge="AI engines & prompts" result={result} loading={loading} error={error} onRun={() => run({ briefOnly, type, settings, ...form })} onReset={resetTool} action="Start Creating Content" newAction="New Content">
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
      <div className="check-list compact">
        {contentSettingOptions.map((setting) => (
          <label key={setting}>
            <input type="checkbox" checked={settings.includes(setting)} onChange={() => toggleSetting(setting)} />
            {setting}
          </label>
        ))}
      </div>
    </ToolFrame>
  )
}

function ContentCheck({ onRunComplete }) {
  const emptyForm = { url: '', targetQuery: '', content: '', language: 'English' }
  const [form, setForm] = useState(emptyForm)
  const { loading, result, error, run, reset } = useAiTool('check', onRunComplete)
  const resetTool = () => {
    reset()
    setForm(emptyForm)
  }
  return (
    <ToolFrame toolId="check" title="Check your content for GEO compliance" badge="AI search optimized" result={result} loading={loading} error={error} onRun={() => run(form)} onReset={resetTool} action="Start Content Check" newAction="New Content Check">
      <Field label="URL of your content"><input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://domain.com/path/page.html" /></Field>
      <Field label="Target query or topic"><input value={form.targetQuery} onChange={(e) => setForm({ ...form, targetQuery: e.target.value })} placeholder="e.g. seboreik dermatit belirtileri" /></Field>
      <div className="or-line"><span>OR</span></div>
      <Field label="Paste your content directly"><textarea className="large" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Paste the content you want to analyze here..." /></Field>
      <Field label="Output language"><SelectField value={form.language} onChange={(language) => setForm({ ...form, language })} options={languages} /></Field>
    </ToolFrame>
  )
}

function Benchmark({ onRunComplete }) {
  const emptyForm = { prompt: '', country: 'Worldwide', language: 'English', industry: '' }
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  function resetTool() {
    setForm(emptyForm)
    setLoading(false)
    setResult(null)
    setError('')
  }
  async function run() {
    const validationError = validateToolInput('benchmark', form)
    if (validationError) {
      setResult(null)
      setError(validationError)
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await callApi({ tool: 'benchmark', input: form })
      setResult(data)
      await onRunComplete?.()
    } catch (runError) {
      setError(runError.message)
    } finally {
      setLoading(false)
    }
  }
  return (
    <ToolFrame toolId="benchmark" title="Benchmark AI visibility" badge="Top 10 brands by prompt, country, and language" result={result} loading={loading} error={error} onRun={run} onReset={resetTool} action="Run Benchmark" newAction="New Benchmark">
      <Field label="Search prompt" required><input value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="Best CRM software for mid-market teams" /></Field>
      <div className="three-col">
        <Field label="Country"><SelectField value={form.country} onChange={(country) => setForm({ ...form, country })} options={countries} /></Field>
        <Field label="Language"><SelectField value={form.language} onChange={(language) => setForm({ ...form, language })} options={languages} /></Field>
        <Field label="Industry filter"><input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="SaaS, finance, travel..." /></Field>
      </div>
    </ToolFrame>
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
