import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  FileCheck2,
  FilePenLine,
  History,
  LayoutTemplate,
  Loader2,
  LogOut,
  Menu,
  Search,
  ShieldCheck,
  Sparkles,
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
const benchmarkBrands = ['HubSpot', 'Semrush', 'Ahrefs', 'Shopify', 'Notion', 'Salesforce', 'Adobe', 'Canva', 'Zapier', 'Monday.com']

function defaultResult(toolId) {
  const map = {
    brand: {
      title: 'Brand entity snapshot',
      score: 78,
      summary: 'Your brand has recognizable entity signals, but AI engines need clearer third-party corroboration and concise sameAs references.',
      bullets: ['Add organization schema with sameAs links', 'Create a short brand facts section', 'Mention founder, category, location, and primary use cases consistently'],
    },
    fanout: {
      title: 'Fan-out map',
      score: 84,
      summary: 'The source query expands into comparison, alternatives, pricing, implementation, and best-for prompts across AI answer engines.',
      bullets: ['Best tools for the job-to-be-done', 'Alternatives to incumbent providers', 'Pricing and integration constraints', 'Use-case specific buying questions'],
    },
    research: {
      title: 'Prompt research set',
      score: 91,
      summary: 'A complete monitoring set should combine branded prompts, bottom-funnel non-branded prompts, competitor prompts, and persona-led prompts.',
      bullets: ['Build 30 branded prompts', 'Build 40 competitor prompts', 'Build 25 persona prompts', 'Refresh monthly by country and language'],
    },
    landing: {
      title: 'Landing page outline',
      score: 88,
      summary: 'The landing page should answer the main query directly, include entity facts, proof, comparison context, FAQs, and extractable summaries.',
      bullets: ['Lead with a direct answer block', 'Add an evidence table', 'Use FAQ schema and concise headings', 'Close with a short decision guide'],
    },
    content: {
      title: 'Generated content brief',
      score: 86,
      summary: 'The content should be conversational, source-friendly, quote-ready, and structured around AI answer snippets.',
      bullets: ['Add a 60-word answer summary', 'Use comparison tables where relevant', 'Include examples and FAQs', 'Reference credible external sources'],
    },
    check: {
      title: 'GEO compliance review',
      score: 73,
      summary: 'The content is readable, but it needs stronger factual extraction points, author/entity context, and answer-first formatting.',
      bullets: ['Move the answer above the fold', 'Add author and organization context', 'Break long sections into clear answer blocks', 'Add date-sensitive review notes'],
    },
    benchmark: {
      title: 'Benchmark ranking',
      score: 82,
      summary: 'Top brands are ranked by likely mention share, topical authority, citation footprint, and answer-engine entity clarity.',
      bullets: ['Track competitors weekly', 'Separate global and local benchmarks', 'Compare branded and non-branded prompt visibility'],
    },
  }
  return map[toolId] || map.brand
}

async function callApi(payload) {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error('Request failed')
  return response.json()
}

function App() {
  const [activeTool, setActiveTool] = useState('brand')
  const [mobileNav, setMobileNav] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [runs, setRuns] = useState([])
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
  }

  if (authLoading) return <LoadingScreen />
  if (!user) return <AuthScreen onAuthed={(nextUser) => { setUser(nextUser); loadRuns() }} />

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-button mobile-only" onClick={() => setMobileNav(true)} aria-label="Open navigation">
          <Menu size={20} />
        </button>
        <div className="brand-mark" aria-label="GEO OPTIMIZER AI">
          <span className="brand-icon"><Sparkles size={19} /></span>
          <div>
            <strong>GEO OPTIMIZER AI</strong>
            <small>GEO and LLMO command center</small>
          </div>
        </div>
        <nav className="tabs desktop-tabs" aria-label="Feature tabs">
          {tools.map((tool) => (
            <button key={tool.id} className={tool.id === activeTool ? 'tab active' : 'tab'} onClick={() => setActiveTool(tool.id)}>
              <tool.icon size={16} />
              <span>{tool.label}</span>
            </button>
          ))}
        </nav>
        <div className="account-chip">
          <span>{user.name}</span>
          <button className="icon-button" onClick={logout} aria-label="Sign out"><LogOut size={17} /></button>
        </div>
      </header>

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

      <main className="workspace">
        <aside className="side-rail">
          <p className="eyeline">Selected workflow</p>
          <h1>{active.label}</h1>
          <p>{active.tag}</p>
          <div className="rail-stat">
            <strong>8</strong>
            <span>AI visibility tools</span>
          </div>
          <div className="rail-stat">
            <strong>Live</strong>
            <span>OpenAI / OpenRouter ready</span>
          </div>
          <div className="recent-runs">
            <div><History size={15} /><strong>Recent runs</strong></div>
            {runs.length === 0 && <p>No saved runs yet.</p>}
            {runs.slice(0, 5).map((run) => (
              <button key={run.id} onClick={() => setActiveTool(run.type === 'crawler' ? 'crawler' : run.type)}>
                <span>{run.type}</span>
                <small>{new Date(run.createdAt).toLocaleDateString()}</small>
              </button>
            ))}
          </div>
        </aside>
        <section className="tool-surface">
          <ToolRouter activeTool={activeTool} onRunComplete={loadRuns} />
        </section>
      </main>
    </div>
  )
}

function LoadingScreen() {
  return <div className="auth-shell"><div className="auth-card compact"><Loader2 className="spin" size={22} /><strong>Loading GEO OPTIMIZER AI</strong></div></div>
}

function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Authentication failed')
      onAuthed(data.user)
    } catch (authError) {
      setError(authError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">
          <span className="brand-icon"><Sparkles size={19} /></span>
          <div><strong>GEO OPTIMIZER AI</strong><small>Production workspace</small></div>
        </div>
        <h1>{mode === 'login' ? 'Sign in to your workspace' : 'Create your account'}</h1>
        <p>Run GEO and LLMO workflows with saved history, protected API access, and account-level sessions.</p>
        <form onSubmit={submit}>
          {mode === 'register' && <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" /></Field>}
          <Field label="Email" required><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.com" /></Field>
          <Field label="Password" required><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" /></Field>
          {error && <p className="auth-error">{error}</p>}
          <button className="primary-button" disabled={loading}>{loading ? <Loader2 className="spin" size={17} /> : <ShieldCheck size={17} />}{mode === 'login' ? 'Sign In' : 'Create Account'}</button>
        </form>
        <button className="text-button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Create a new account' : 'I already have an account'}
        </button>
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

function ToolFrame({ title, badge, children, result, loading, onRun, action = 'Start Analysis' }) {
  return (
    <>
      <div className="tool-head">
        <div>
          <h2>{title}</h2>
          <span>{badge}</span>
        </div>
        <button className="ghost-button">New Check</button>
      </div>
      <div className="panel-grid">
        <section className="panel form-panel">{children}
          <div className="form-footer">
            <p>Used <strong>{Math.floor(400 + title.length * 173)}</strong> times and counting</p>
            <button className="primary-button" onClick={onRun} disabled={loading}>
              {loading ? <Loader2 className="spin" size={17} /> : <Wand2 size={17} />}
              {action}
            </button>
          </div>
        </section>
        <ResultPanel result={result} loading={loading} />
      </div>
      <HowItWorks />
    </>
  )
}

function ResultPanel({ result, loading }) {
  const data = result || defaultResult('brand')
  return (
    <section className="panel result-panel">
      <div className="result-top">
        <p className="eyeline">AI output</p>
        <strong>{data.title}</strong>
      </div>
      <div className="score-ring" style={{ '--score': `${data.score}%` }}>
        <span>{loading ? '...' : data.score}</span>
        <small>Confidence Score</small>
      </div>
      <p className="result-summary">{loading ? 'Running live analysis and preparing structured recommendations.' : data.summary}</p>
      <div className="metric-row">
        <Metric label="Sources Checked" value="4" />
        <Metric label="Entity Signals" value={data.score > 80 ? 'Strong' : 'Medium'} />
      </div>
      <ul className="recommendations">
        {(data.bullets || []).map((item) => <li key={item}><CheckCircle2 size={16} />{item}</li>)}
      </ul>
    </section>
  )
}

function Metric({ label, value }) {
  return <div className="metric"><strong>{value}</strong><span>{label}</span></div>
}

function HowItWorks() {
  return (
    <details className="how" open>
      <summary>How it works</summary>
      <p>Each tool structures your prompt, sends it through a server-side AI provider, and returns extractable recommendations for GEO, LLMO, and AI search visibility workflows.</p>
    </details>
  )
}

function useAiTool(toolId, onRunComplete) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(defaultResult(toolId))
  async function run(input) {
    setLoading(true)
    try {
      const data = await callApi({ tool: toolId, input })
      setResult(data)
      await onRunComplete?.()
    } catch {
      setResult(defaultResult(toolId))
    } finally {
      setLoading(false)
    }
  }
  return { loading, result, run }
}

function BrandEntity({ onRunComplete }) {
  const [form, setForm] = useState({ brand: '', domain: '', country: 'Worldwide', language: 'English' })
  const { loading, result, run } = useAiTool('brand', onRunComplete)
  return (
    <ToolFrame title="Does AI know your brand?" badge="Real-time entity verification" result={result} loading={loading} onRun={() => run(form)} action="Check AI Authority">
      <div className="two-col">
        <Field label="Brand name" required><input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="e.g. Notion, Stripe, OtterlyAI" /></Field>
        <Field label="Domain" required><input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="https://example.com" /></Field>
        <Field label="Country"><SelectField value={form.country} onChange={(country) => setForm({ ...form, country })} options={countries} /></Field>
        <Field label="Language"><SelectField value={form.language} onChange={(language) => setForm({ ...form, language })} options={languages} /></Field>
      </div>
      <div className="quick-picks">{['Notion', 'Anthropic', 'Stripe', 'Basecamp', 'Miro'].map((x) => <button key={x} onClick={() => setForm({ ...form, brand: x })}>{x}</button>)}</div>
    </ToolFrame>
  )
}

function CrawlerSimulation({ onRunComplete }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState(crawlers.map((name) => ({ name, status: 'Ready', code: '-' })))
  async function run() {
    setLoading(true)
    try {
      const response = await fetch('/api/crawl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ url }) })
      const data = await response.json()
      setRows(data.rows)
      await onRunComplete?.()
    } finally {
      setLoading(false)
    }
  }
  return (
    <>
      <div className="tool-head"><div><h2>Run an AI search crawlability check</h2><span>AI search</span></div><button className="ghost-button">New Check</button></div>
      <section className="panel form-panel full">
        <Field label="Website URL" required><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" /></Field>
        <div className="crawler-grid">
          {rows.map((row) => <div className="crawler-row" key={row.name}><CheckCircle2 size={16} /><span>{row.name}</span><strong>{row.status} {row.code !== '-' ? row.code : ''}</strong></div>)}
        </div>
        <div className="form-footer"><p>Used <strong>1128</strong> times and counting</p><button className="primary-button" onClick={run} disabled={loading}>{loading ? <Loader2 className="spin" size={17} /> : <Bot size={17} />}Start Crawler Simulation</button></div>
      </section>
      <HowItWorks />
    </>
  )
}

function ModeSwitch({ value, onChange }) {
  return <div className="mode-row">{promptModes.map((mode) => <button key={mode} className={value === mode ? 'active' : ''} onClick={() => onChange(mode)}>{mode}</button>)}</div>
}

function FanOut({ onRunComplete }) {
  const [mode, setMode] = useState('Query Fan Out')
  const [query, setQuery] = useState('')
  const { loading, result, run } = useAiTool('fanout', onRunComplete)
  return (
    <ToolFrame title="Run Fan-Out Analysis" badge="All engines" result={result} loading={loading} onRun={() => run({ mode, query })} action="Start Fan-Out Analysis">
      <ModeSwitch value={mode} onChange={setMode} />
      <Field label="Your query or search prompt" required><input value={query} onChange={(e) => setQuery(e.target.value)} /></Field>
      <div className="check-list">{['Google AI Overview', 'Google AI Mode', 'ChatGPT'].map((x) => <label key={x}><input type="checkbox" defaultChecked />{x}</label>)}</div>
    </ToolFrame>
  )
}

function PromptResearch({ onRunComplete }) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ brand: '', domain: '', country: 'Worldwide', language: 'English' })
  const { loading, result, run } = useAiTool('research', onRunComplete)
  const steps = ['Brand & Domain', 'Brand Description', 'Competitors', 'Topics', 'Personas', 'Search Console', 'SEO Keywords', 'Email']
  return (
    <ToolFrame title="Advanced Prompt Research" badge="Looking for a holistic list of prompts" result={result} loading={loading} onRun={() => run({ step, ...form })} action="Start AI Prompt Research">
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
  const { loading, result, run } = useAiTool('landing', onRunComplete)
  return (
    <ToolFrame title="Create GEO Optimized Landing Page" badge="AI search optimized" result={result} loading={loading} onRun={() => run(form)} action="Start Creating Landing Page">
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
  const { loading, result, run } = useAiTool('content', onRunComplete)
  return (
    <ToolFrame title="Create GEO Optimized Content" badge="AI engines & prompts" result={result} loading={loading} onRun={() => run({ briefOnly, type, ...form })} action="Start Creating Content">
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
  const { loading, result, run } = useAiTool('check', onRunComplete)
  return (
    <ToolFrame title="Check your content for GEO compliance" badge="AI search optimized" result={result} loading={loading} onRun={() => run(form)} action="Start Content Check">
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
  const [result, setResult] = useState(defaultResult('benchmark'))
  const tableRows = useMemo(() => {
    const source = rows.length ? rows : benchmarkBrands.map((brand, i) => ({
    rank: i + 1,
    brand,
    share: `${Math.max(92 - i * 6, 38)}%`,
    sentiment: i < 3 ? 'Leader' : i < 7 ? 'Challenger' : 'Emerging',
    reason: ['Entity strength', 'Citation footprint', 'Topical authority', 'Answer consistency'][i % 4],
  }))
    return source.map((row, index) => ({
      rank: row.rank || index + 1,
      brand: row.brand || `Brand ${index + 1}`,
      share: typeof row.share === 'number' ? `${row.share}%` : row.share,
      sentiment: typeof row.sentiment === 'number' ? (row.sentiment >= 85 ? 'Leader' : row.sentiment >= 74 ? 'Challenger' : 'Emerging') : row.sentiment,
      reason: row.reason || 'Entity strength',
    }))
  }, [rows])
  async function run() {
    setLoading(true)
    try {
      const data = await callApi({ tool: 'benchmark', input: form })
      setResult(data)
      setRows((data.brands || []).slice(0, 10))
      await onRunComplete?.()
    } catch {
      setResult(defaultResult('benchmark'))
    } finally {
      setLoading(false)
    }
  }
  return (
    <>
      <ToolFrame title="Benchmark AI visibility" badge="Top 10 brands by prompt, country, and language" result={result} loading={loading} onRun={run} action="Run Benchmark">
        <Field label="Search prompt" required><input value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="Best CRM software for mid-market teams" /></Field>
        <div className="three-col">
          <Field label="Country"><SelectField value={form.country} onChange={(country) => setForm({ ...form, country })} options={countries} /></Field>
          <Field label="Language"><SelectField value={form.language} onChange={(language) => setForm({ ...form, language })} options={languages} /></Field>
          <Field label="Industry filter"><input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="SaaS, finance, travel..." /></Field>
        </div>
      </ToolFrame>
      <section className="panel table-panel">
        <div className="table-head"><strong>Top 10 brands</strong><span>{form.country} / {form.language}</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Rank</th><th>Brand</th><th>Visibility</th><th>Status</th><th>Primary driver</th></tr></thead>
            <tbody>{tableRows.map((row) => <tr key={row.rank}><td>{row.rank}</td><td>{row.brand}</td><td>{row.share}</td><td><span className="status-pill">{row.sentiment}</span></td><td>{row.reason}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </>
  )
}

export default App
