import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import path from 'node:path'
import { z } from 'zod'
import { runAudit, pageChecks } from './audit.js'
import { extractPage, pageEvidence } from './html.js'
import { buildTasks, processBatch, summarize } from './measure.js'
import { analyzeAnswer, domainOf, wilson } from './mentions.js'
import { BlockedUrlError, assertPublicUrl, normalizeUrl } from './net.js'
import { GROUNDED_MULTIPLIER, PAID_PLANS, PLANS, QuotaError, consume, currentPeriod, nextReset, resolvePlan } from './plans.js'
import { compareRender } from './render.js'
import { AI_BOTS, evaluateRobots, parseRobots } from './robots.js'
import { registerScheduleRoutes } from './schedule.js'
import { handleSeoError, registerSeoRoutes } from './seo.js'
import { MigrationPendingError } from './store.js'

const toolInstructions = {
  brand: 'Analyze whether AI systems can identify this brand as an entity for the selected country and language. Evaluate entity clarity, third-party corroboration, sameAs/schema readiness, category ownership, answer-engine citation likelihood, and concrete fixes. fetchedPage contains facts extracted from the live page, including its JSON-LD types and sameAs links: treat those as ground truth and never claim schema is missing when it is listed there.',
  visibility: 'Explain the measured AI visibility result. measured contains real counts from live model answers (answers mentioning the brand out of answers collected, per surface, with answer samples). Do not change or re-estimate those numbers. Explain why the brand is or is not mentioned based on the answer samples and fetchedPage, and give precise actions to improve inclusion.',
  fanout: 'Create a query fan-out analysis for the selected AI surfaces in input.surfaces. Expand the source prompt into realistic sub-queries grouped by intent, comparison, alternatives, pricing, trust, and implementation. Explain how each selected surface may fan out or reformulate the query differently.',
  research: 'Generate a structured AI prompt research plan across branded, non-branded, competitor, topic, persona, SEO, and Search Console prompt types. Include monitorable prompt buckets and why each matters.',
  landing: 'Create a GEO optimized landing page plan with answer-first structure, proof sections, FAQs, comparison context, schema recommendations, and extractable answer blocks. If fetchedPage is supplied, use it to avoid recommending sections that already exist.',
  content: 'Create or brief GEO optimized content that is extractable by AI answer engines. Include outline, answer snippets, evidence needs, FAQ angles, and structure recommendations. If referencePages are supplied, use their actual extracted text as context. Respect input.settings such as expert quotes, FAQs, comparison table, external links, or CTA when selected.',
  check: 'Review content for GEO compliance using the actual fetchedContent or pasted content, not just the URL. deterministicChecks lists rule-based findings already computed from the page HTML: treat them as ground truth, do not contradict them, and do not produce your own numeric score for them. If targetQuery is supplied, first assess whether the content already answers that exact query. Identify specific missing evidence, structure, schema, source, internal linking, or clarity improvements.',
}

const resultShape = `Return strict JSON with:
title string, score number 0-100, summary string,
metrics array of 2-4 objects {label,value},
bullets array of concise recommendations,
sections array of objects {title,items} where items is an array of strings.
Sections must include purpose-specific, evidence-based groups named exactly:
Already done, Needs improvement, Missing / should add.
Add additional tool-specific sections after those three when useful.
Do not invent observed facts that are not supported by the user input or supplied evidence; state uncertainty when needed.
Recommendations must be tied to specific evidence from fetched content, pasted content, measured results, or the supplied brief. Avoid generic SEO advice when actual evidence is available.
For fanout also include queries array of 6-10 objects {query,intent} and surfaceInsights array of objects {surface,behavior,queryPatterns} where queryPatterns is a short string.`

const text = (max) => z.string().trim().min(1).max(max)
const authSchema = z.object({ name: z.string().trim().min(2).max(80).optional(), email: z.string().trim().email().max(160), password: z.string().min(8).max(120) })
const emailSchema = z.object({ email: z.string().trim().email().max(160) })
const profileSchema = z.object({ name: z.string().trim().min(2).max(80) })
const sessionSchema = z.object({ accessToken: z.string().min(20), refreshToken: z.string().min(20).optional() })
const passwordUpdateSchema = z.object({ accessToken: z.string().min(20), password: z.string().min(8).max(120) })
const passwordChangeSchema = z.object({ currentPassword: z.string().min(8).max(120), newPassword: z.string().min(8).max(120) })
const generateSchema = z.object({
  tool: z.enum(['brand', 'visibility', 'fanout', 'research', 'landing', 'content', 'check', 'benchmark']).default('brand'),
  input: z.record(z.string(), z.unknown()).default({}),
})
const urlSchema = z.object({ url: z.string().trim().min(3).max(500) })
const auditSchema = z.object({ url: z.string().trim().min(3).max(500), pages: z.number().int().min(0).max(10).default(0), render: z.boolean().default(false) })
const competitorSchema = z.object({ name: text(80), aliases: z.array(text(80)).max(5).default([]) })
const projectSchema = z.object({
  name: text(80),
  brand: text(80),
  aliases: z.array(text(80)).max(8).default([]),
  domain: z.string().trim().max(200).default(''),
  competitors: z.array(competitorSchema).max(15).default([]),
  country: text(60).default('Worldwide'),
  language: text(40).default('English'),
})
const promptsSchema = z.object({ prompts: z.array(z.object({ text: text(300), category: z.string().trim().max(40).default('general') })).min(1).max(50) })
const measurementSchema = z.object({
  surfaces: z.array(z.string()).min(1).max(8),
  samples: z.number().int().min(1).max(5).default(3),
  grounded: z.boolean().default(false),
})

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function validateToolInput(tool, input = {}) {
  const requirements = {
    brand: [['brand', 'Enter a brand name.'], ['domain', 'Enter a domain.']],
    visibility: [['brand', 'Enter a brand name.'], ['prompt', 'Enter a search prompt or user question.']],
    fanout: [['query', 'Enter a query, keyword, website, or brief to analyze.']],
    research: [['brand', 'Enter your brand.'], ['domain', 'Enter your domain.']],
    landing: [['question', 'Enter the main landing page question.'], ['brand', 'Enter your brand.'], ['domain', 'Enter your domain.']],
    content: [['prompt', 'Enter the content prompt.']],
    benchmark: [['prompt', 'Enter the benchmark search prompt.']],
  }
  if (tool === 'check' && !hasText(input.url) && !hasText(input.content)) return 'Enter a content URL or paste content to analyze.'
  const missing = (requirements[tool] || []).find(([key]) => !hasText(input[key]))
  if (missing) return missing[1]
  if (tool === 'visibility' && (!Array.isArray(input.models) || !input.models.length)) return 'Select at least one AI surface.'
  if (tool === 'fanout' && (!Array.isArray(input.surfaces) || !input.surfaces.length)) return 'Select at least one AI surface.'
  return ''
}

function normalizeResult(tool, result) {
  const merged = { title: 'Analysis result', score: 0, summary: '', metrics: [], bullets: [], sections: [], queries: [], surfaceInsights: [], brands: [], models: [], ...result }
  const rawScore = Number(merged.score) || 0
  merged.score = Math.max(0, Math.min(100, rawScore > 0 && rawScore <= 1 ? Math.round(rawScore * 100) : Math.round(rawScore)))
  merged.bullets = Array.isArray(merged.bullets) ? merged.bullets.slice(0, 8).map(String) : []
  merged.metrics = Array.isArray(merged.metrics) ? merged.metrics.slice(0, 4).map((metric) => ({ label: String(metric?.label || 'Metric'), value: String(metric?.value ?? '-') })) : []
  merged.sections = Array.isArray(merged.sections)
    ? merged.sections.slice(0, 6).map((section, index) => ({
      title: String(section?.title || section?.heading || `Section ${index + 1}`),
      items: Array.isArray(section?.items || section?.bullets) ? (section.items || section.bullets).slice(0, 8).map(String) : [],
    })).filter((section) => section.items.length)
    : []
  merged.queries = tool === 'fanout' && Array.isArray(merged.queries)
    ? merged.queries.slice(0, 10).map((query) => ({ query: String(query?.query || query), intent: String(query?.intent || query?.reason || 'Related search path') }))
    : []
  merged.surfaceInsights = tool === 'fanout' && Array.isArray(merged.surfaceInsights)
    ? merged.surfaceInsights.slice(0, 10).map((row) => ({ surface: String(row.surface || row.model || 'AI surface'), behavior: String(row.behavior || row.summary || ''), queryPatterns: String(row.queryPatterns || row.patterns || '') }))
    : []
  if (tool !== 'benchmark') merged.brands = []
  if (tool !== 'visibility') merged.models = []
  return merged
}

export function createApp({ store, llm, fetcher, billing = null, supabaseAdmin = null, supabaseAuth = null, authenticate = null, gsc = null, tokenBox = null, vitals = null, renderer = null, mailer = null, config = {} }) {
  const app = express()
  const isProduction = config.isProduction ?? process.env.NODE_ENV === 'production'
  const appUrl = config.appUrl || 'http://localhost:5173'
  const adminEmails = config.adminEmails || []
  const systemPrompt = (tool) => `You are GEO OPTIMIZER AI. ${toolInstructions[tool]}\n${resultShape}`

  app.set('trust proxy', 1)
  app.use(helmet({ contentSecurityPolicy: isProduction ? undefined : false }))
  app.use(cors({ origin: appUrl, credentials: true }))
  // Stripe signs the exact bytes it sent, so this route must see the raw body.
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!billing?.enabled || !billing.webhookConfigured) return res.status(503).json({ error: 'Billing is not configured' })
    let type
    try {
      type = await billing.handleWebhook(req.body, req.headers['stripe-signature'])
    } catch (error) {
      if (/signature|payload|timestamp|secret/i.test(error?.message || '') || error?.type === 'StripeSignatureVerificationError') {
        return res.status(400).json({ error: 'Invalid signature' })
      }
      console.error('stripe webhook', error?.message)
      return res.status(500).json({ error: 'Webhook handling failed' }) // Stripe retries
    }
    res.json({ received: true, type })
  })
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  if (config.rateLimit !== false) {
    app.use('/api/', rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }))
    app.use('/api/auth/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }))
  }

  // ---------- auth helpers ----------
  function cookieOptions(maxAge) {
    return { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge, path: '/' }
  }
  function setAuthCookies(res, session) {
    if (!session?.access_token) return
    res.cookie('sb_access_token', session.access_token, cookieOptions(60 * 60 * 1000))
    if (session.refresh_token) res.cookie('sb_refresh_token', session.refresh_token, cookieOptions(30 * 24 * 60 * 60 * 1000))
  }
  function clearAuthCookies(res) {
    for (const name of ['sb_access_token', 'sb_refresh_token', 'geo_session']) res.clearCookie(name, { path: '/' })
  }
  function publicUser(user, profile, plan) {
    return { id: user.id, name: profile?.name || user.user_metadata?.name || user.email?.split('@')[0] || 'User', email: user.email, createdAt: user.created_at, plan }
  }
  async function supabaseUser(req, res) {
    const accessToken = req.cookies.sb_access_token
    const refreshToken = req.cookies.sb_refresh_token
    if (!accessToken && !refreshToken) return null
    if (accessToken) {
      const { data, error } = await supabaseAuth.auth.getUser(accessToken)
      if (!error && data.user) return data.user
    }
    if (!refreshToken) return null
    const { data, error } = await supabaseAuth.auth.refreshSession({ refresh_token: refreshToken })
    if (error || !data.session?.access_token || !data.user) return null
    setAuthCookies(res, data.session)
    return data.user
  }
  async function requireAuth(req, res, next) {
    let user
    try {
      user = authenticate ? await authenticate(req, res) : await supabaseUser(req, res)
    } catch {
      return res.status(401).json({ error: 'Invalid session' })
    }
    if (!user) return res.status(401).json({ error: 'Authentication required' })
    try {
      req.user = user
      req.profile = await store.upsertProfile(user)
      req.plan = resolvePlan(req.profile, user, adminEmails)
      req.limits = PLANS[req.plan]
      next()
    } catch (error) {
      next(error)
    }
  }
  const requireAuthClients = (req, res, next) => (supabaseAdmin && supabaseAuth ? next() : res.status(503).json({ error: 'Authentication is not configured' }))

  // ---------- page evidence ----------
  async function fetchEvidence(url) {
    try {
      const fetched = await fetcher(url, { timeoutMs: 10000 })
      const facts = fetched.ok ? extractPage(fetched.text, fetched.url) : null
      return { fetched, facts, evidence: pageEvidence(fetched, facts) }
    } catch (error) {
      if (error instanceof BlockedUrlError) return { fetched: null, facts: null, evidence: { url, ok: false, error: error.message } }
      throw error
    }
  }

  async function probeMany(req, prompt, surfaces, samples, context) {
    const usable = surfaces.filter((surface) => llm.surfaces().includes(surface))
    if (!usable.length || !llm.canProbe()) return []
    await consume(store, req.user.id, req.plan, 'probe', usable.length * samples * (context.grounded ? GROUNDED_MULTIPLIER : 1))
    const tasks = usable.flatMap((surface) => Array.from({ length: samples }, (_, sampleIndex) => ({ surface, sampleIndex })))
    return Promise.all(tasks.map(async (task) => {
      try {
        const probe = await llm.probe(task.surface, prompt, context)
        return { ...task, status: 'done', promptId: 'adhoc', promptText: prompt, answer: probe.answer, citations: probe.citations, model: probe.model }
      } catch (error) {
        return { ...task, status: 'error', promptId: 'adhoc', promptText: prompt, answer: '', citations: [], error: error.message }
      }
    }))
  }

  // ---------- tool runners ----------
  async function runVisibility(req, input) {
    const samples = Math.min(3, req.limits.maxSamples)
    const context = { country: input.country, language: input.language, grounded: Boolean(input.grounded) }
    const [page, results] = await Promise.all([
      hasText(input.domain) ? fetchEvidence(input.domain) : null,
      probeMany(req, String(input.prompt), input.models, samples, context),
    ])
    const project = { brand: String(input.brand), aliases: [], domain: input.domain || '', competitors: [] }
    const summary = summarize(results, project)
    const models = input.models.map((surface) => {
      const rows = results.filter((row) => row.surface === surface)
      const done = rows.filter((row) => row.status === 'done')
      if (!rows.length) {
        return { model: surface, presence: 'Not measurable', confidence: '-', evidence: 'This surface has no public query API, so it is not measured. Use the measured surfaces as the signal.', nextAction: 'Track ChatGPT, Claude, Gemini and Perplexity; Google AI Overviews must be checked manually.' }
      }
      if (!done.length) return { model: surface, presence: 'Unavailable', confidence: '-', evidence: rows[0].error || 'Model request failed.', nextAction: 'Retry in a few minutes.' }
      const hits = done.filter((row) => analyzeAnswer({ answer: row.answer, citations: row.citations, brand: project.brand, domain: project.domain }).brandMentioned)
      const sample = (hits[0] || done[0]).answer.replace(/\s+/g, ' ').slice(0, 260)
      return {
        model: surface,
        presence: hits.length === done.length ? 'Visible' : hits.length ? 'Partly visible' : 'Not visible',
        confidence: `${hits.length} of ${done.length} answers`,
        evidence: `${hits.length ? 'Mentioned' : 'Not mentioned'} in ${hits.length} of ${done.length} live answers (${done[0].model}). Sample: "${sample}…"`,
        nextAction: hits.length === done.length ? 'Maintain the sources and entity signals behind this mention.' : `Publish and earn citable evidence that connects ${project.brand} to this question.`,
      }
    })
    let narrative = {}
    if (llm.available() && summary.answers) {
      narrative = await llm.chatJson(systemPrompt('visibility'), JSON.stringify({
        input, fetchedPage: page?.evidence || null,
        measured: { visibility: summary.visibility, bySurface: summary.bySurface, brandsNamed: summary.brands.slice(0, 10), citedDomains: summary.citedDomains.slice(0, 8), answerSamples: results.filter((row) => row.status === 'done').slice(0, 6).map((row) => ({ surface: row.surface, answer: row.answer.slice(0, 900) })) },
      })) || {}
    }
    const result = normalizeResult('visibility', narrative)
    result.title = `AI visibility for "${project.brand}"`
    result.score = Math.round(summary.visibility.rate)
    result.measured = true
    result.metrics = [
      { label: 'Answers mentioning brand', value: `${Math.round((summary.visibility.rate / 100) * summary.answers)} of ${summary.answers}` },
      { label: 'Visibility rate', value: `${summary.visibility.rate}% (95% CI ${summary.visibility.low}–${summary.visibility.high}%)` },
      { label: 'Average position', value: summary.avgPosition ? String(summary.avgPosition) : '-' },
      { label: 'Own domain cited', value: summary.citation.answersWithSources ? `${summary.citation.ownCited} of ${summary.citation.answersWithSources} sourced answers` : 'No sources returned' },
    ]
    if (!summary.answers) result.summary = 'No live answers could be collected. Check that the model provider key is configured, then retry.'
    result.models = models
    return result
  }

  async function runBenchmark(req, input) {
    if (!llm.canProbe()) return null
    const samples = Math.min(3, req.limits.maxSamples)
    const prompt = hasText(input.industry) ? `${input.prompt} (${input.industry})` : String(input.prompt)
    const results = await probeMany(req, prompt, llm.surfaces(), samples, { country: input.country, language: input.language, grounded: Boolean(input.grounded) })
    const done = results.filter((row) => row.status === 'done')
    if (!done.length) return null
    const names = await llm.extractBrands(done.map((row) => row.answer)).catch(() => [])
    const project = { brand: hasText(input.brand) ? String(input.brand) : '', aliases: [], domain: '', competitors: [] }
    const summary = summarize(results, project, names)
    const top = summary.brands.slice(0, 10)
    return {
      ...normalizeResult('benchmark', {}),
      title: 'Measured brand visibility',
      measured: true,
      score: project.brand ? Math.round(summary.visibility.rate) : 0,
      hideScore: !project.brand,
      summary: top.length
        ? `${top[0].name} is named most often: ${top[0].answers} of ${summary.answers} live answers. Counted from ${summary.answers} answers across ${summary.bySurface.length} AI models (${samples} per model).`
        : `No brands were named in ${summary.answers} live answers.`,
      metrics: [
        { label: 'Live answers collected', value: String(summary.answers) },
        { label: 'Distinct brands named', value: String(summary.brands.length) },
        { label: 'Models queried', value: summary.bySurface.map((row) => row.surface).join(', ') },
      ],
      brands: top.map((entry) => ({ rank: entry.rank, brand: entry.name, share: `${entry.mentionRate}%`, sentiment: `${entry.answers} of ${summary.answers} answers`, reason: `Share of voice ${entry.shareOfVoice}% · avg. position ${entry.avgPosition}` })),
      sections: [
        ...(summary.citedDomains.length ? [{ title: 'Most cited sources', items: summary.citedDomains.slice(0, 8).map((row) => `${row.domain}: cited in ${row.answers} answers`) }] : []),
        { title: 'Visibility by model', items: summary.bySurface.map((row) => `${row.surface} (${row.model}): ${row.answers} answers collected`) },
        { title: 'Method', items: [summary.method, 'Brand names are extracted from the answers and then counted against the answer text. Small samples vary: re-run or track the prompt in a project for a trend.'] },
      ],
      bullets: [],
    }
  }

  async function runGenerate(req, tool, input) {
    if (tool === 'visibility') return runVisibility(req, input)
    if (tool === 'benchmark') return runBenchmark(req, input)

    const enriched = { ...input }
    let deterministic = null
    if ((tool === 'brand' || tool === 'landing') && hasText(input.domain)) enriched.fetchedPage = (await fetchEvidence(input.domain)).evidence
    if (tool === 'check') {
      if (hasText(input.url)) {
        const page = await fetchEvidence(input.url)
        enriched.fetchedContent = page.evidence
        if (page.facts) {
          const categories = pageChecks(page.fetched, page.facts).filter((category) => category.id !== 'indexability')
          const checks = categories.flatMap((category) => category.checks)
          const total = checks.reduce((sum, item) => sum + item.weight, 0)
          const earned = checks.reduce((sum, item) => sum + item.weight * (item.status === 'pass' ? 1 : item.status === 'warn' ? 0.5 : 0), 0)
          deterministic = { score: Math.round((earned / total) * 100), checks }
          enriched.deterministicChecks = checks.map((item) => ({ check: item.label, status: item.status, detail: item.detail }))
        }
      }
      if (hasText(input.content)) {
        const pasted = String(input.content).replace(/\s+/g, ' ').trim()
        enriched.pastedContent = { wordCount: pasted.split(/\s+/).length, textSample: pasted.slice(0, 12000) }
      }
    }
    if (tool === 'content' && hasText(input.urls)) {
      const urls = String(input.urls).split(/[\n,]+/).map((item) => item.trim()).filter(Boolean).slice(0, 3)
      enriched.referencePages = (await Promise.all(urls.map(fetchEvidence))).map((page) => page.evidence)
    }

    const raw = await llm.chatJson(systemPrompt(tool), JSON.stringify(enriched))
    if (!raw) return null
    const result = normalizeResult(tool, raw)
    if (deterministic) {
      result.score = deterministic.score
      result.measured = true
      result.metrics = [
        { label: 'Checks passed', value: `${deterministic.checks.filter((item) => item.status === 'pass').length} of ${deterministic.checks.length}` },
        { label: 'Words in HTML', value: String(enriched.fetchedContent.wordCount) },
        { label: 'Schema types', value: enriched.fetchedContent.structuredData?.types.slice(0, 4).join(', ') || 'none' },
      ]
      result.sections.push({ title: 'Rule-based checks', items: deterministic.checks.map((item) => `${item.status.toUpperCase()} · ${item.label}: ${item.detail}`) })
    }
    if (tool === 'fanout' && !result.surfaceInsights.length && Array.isArray(input.surfaces)) {
      result.surfaceInsights = input.surfaces.map((surface) => ({ surface, behavior: 'Included in the selected query intelligence model.', queryPatterns: 'Review the generated fan-out queries through this surface lens.' }))
    }
    return result
  }

  // ---------- routes ----------
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'GEO OPTIMIZER AI', version: 2, auth: supabaseAuth ? 'supabase' : 'custom', models: llm.available(), probes: llm.canProbe(), billing: Boolean(billing?.enabled), searchConsole: Boolean(gsc?.enabled && tokenBox), render: Boolean(renderer), email: Boolean(mailer?.enabled), schedules: Boolean(config.cronSecret), time: new Date().toISOString() })
  })

  app.post('/api/auth/register', requireAuthClients, async (req, res) => {
    const parsed = authSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid registration details' })
    const email = parsed.data.email.toLowerCase()
    const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password: parsed.data.password, email_confirm: true, user_metadata: { name: parsed.data.name || email.split('@')[0] } })
    if (error) return res.status(error.message?.toLowerCase().includes('already') ? 409 : 400).json({ error: error.message })
    if (!data.user) return res.status(400).json({ error: 'Could not create account' })
    await store.upsertProfile(data.user, parsed.data.name)
    const { data: sessionData, error: sessionError } = await supabaseAuth.auth.signInWithPassword({ email, password: parsed.data.password })
    if (sessionError || !sessionData.session || !sessionData.user) {
      return res.status(201).json({ message: 'Account created. Please sign in.', user: publicUser(data.user, await store.getProfile(data.user.id), 'free') })
    }
    setAuthCookies(res, sessionData.session)
    const profile = await store.getProfile(sessionData.user.id)
    res.status(201).json({ user: publicUser(sessionData.user, profile, resolvePlan(profile, sessionData.user, adminEmails)) })
  })

  app.post('/api/auth/login', requireAuthClients, async (req, res) => {
    const parsed = authSchema.omit({ name: true }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid login details' })
    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email: parsed.data.email.toLowerCase(), password: parsed.data.password })
    if (error || !data.session || !data.user) return res.status(401).json({ error: error?.message || 'Invalid email or password' })
    const profile = await store.upsertProfile(data.user)
    setAuthCookies(res, data.session)
    res.json({ user: publicUser(data.user, profile, resolvePlan(profile, data.user, adminEmails)) })
  })

  app.post('/api/auth/session', requireAuthClients, async (req, res) => {
    const parsed = sessionSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid session payload' })
    const { data, error } = await supabaseAuth.auth.getUser(parsed.data.accessToken)
    if (error || !data.user) return res.status(401).json({ error: 'Invalid auth callback' })
    const profile = await store.upsertProfile(data.user)
    setAuthCookies(res, { access_token: parsed.data.accessToken, refresh_token: parsed.data.refreshToken })
    res.json({ user: publicUser(data.user, profile, resolvePlan(profile, data.user, adminEmails)) })
  })

  app.post('/api/auth/reset-password', requireAuthClients, async (req, res) => {
    const parsed = emailSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid email' })
    const { error } = await supabaseAuth.auth.resetPasswordForEmail(parsed.data.email.toLowerCase(), { redirectTo: `${appUrl}/auth/callback` })
    if (error) return res.status(400).json({ error: error.message })
    res.json({ ok: true, message: 'Password reset email sent.' })
  })

  app.post('/api/auth/resend-confirmation', requireAuthClients, async (req, res) => {
    const parsed = emailSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid email' })
    const { error } = await supabaseAuth.auth.resend({ type: 'signup', email: parsed.data.email.toLowerCase(), options: { emailRedirectTo: `${appUrl}/auth/callback` } })
    if (error) return res.status(400).json({ error: error.message })
    res.json({ ok: true, message: 'Confirmation email sent.' })
  })

  app.post('/api/auth/update-password', requireAuthClients, async (req, res) => {
    const parsed = passwordUpdateSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid password update request' })
    const { data, error } = await supabaseAuth.auth.getUser(parsed.data.accessToken)
    if (error || !data.user) return res.status(401).json({ error: 'Invalid password recovery token' })
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, { password: parsed.data.password })
    if (updateError) return res.status(400).json({ error: updateError.message })
    clearAuthCookies(res)
    res.json({ ok: true, message: 'Password updated. Please sign in again.' })
  })

  app.post('/api/auth/change-password', requireAuthClients, requireAuth, async (req, res) => {
    const parsed = passwordChangeSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid password change request' })
    const { error: verifyError } = await supabaseAuth.auth.signInWithPassword({ email: req.user.email, password: parsed.data.currentPassword })
    if (verifyError) return res.status(401).json({ error: 'Current password is incorrect.' })
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, { password: parsed.data.newPassword })
    if (updateError) return res.status(400).json({ error: updateError.message })
    res.json({ ok: true, message: 'Password changed successfully.' })
  })

  app.post('/api/auth/logout', (req, res) => {
    clearAuthCookies(res)
    res.json({ ok: true })
  })

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user, req.profile, req.plan) })
  })

  app.put('/api/auth/profile', requireAuthClients, requireAuth, async (req, res) => {
    const parsed = profileSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid profile details' })
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, { user_metadata: { ...req.user.user_metadata, name: parsed.data.name } })
    if (updateError) return res.status(400).json({ error: updateError.message })
    const profile = await store.upsertProfile(req.user, parsed.data.name)
    res.json({ user: publicUser(req.user, profile, req.plan) })
  })

  app.get('/api/account', requireAuth, async (req, res) => {
    const usage = await store.getUsage(req.user.id, currentPeriod())
    res.json({
      plan: req.plan,
      planLabel: req.limits.label,
      limits: req.limits,
      unlimited: Boolean(req.limits.unlimited),
      usage: { analysis: usage?.analysis || 0, probe: usage?.probe || 0, audit: usage?.audit || 0, crawl: usage?.crawl || 0 },
      features: { render: Boolean(renderer), searchConsole: Boolean(gsc?.enabled && tokenBox), vitals: Boolean(vitals) },
      metered: usage !== null,
      resetsOn: nextReset(),
      groundedMultiplier: GROUNDED_MULTIPLIER,
      surfaces: llm.surfaces(),
      probes: llm.canProbe(),
      billing: {
        enabled: Boolean(billing?.enabled),
        hasCustomer: Boolean(req.profile?.stripe_customer_id),
        status: req.profile?.subscription_status || 'none',
        flag: req.profile?.billing_flag || null,
      },
      plans: Object.entries(PLANS).filter(([, plan]) => !plan.unlimited).map(([id, plan]) => ({ id, label: plan.label, price: plan.price, probes: plan.probes, analyses: plan.analyses, audits: plan.audits, projects: plan.projects, promptsPerProject: plan.promptsPerProject, maxSamples: plan.maxSamples, auditPages: plan.auditPages, crawlPages: plan.crawlPages, crawlPagesMonthly: plan.crawlPagesMonthly, keywords: plan.keywords })),
    })
  })

  app.post('/api/billing/checkout', requireAuth, async (req, res) => {
    const parsed = z.object({ plan: z.enum(PAID_PLANS), interval: z.enum(['month', 'year']).default('month') }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Choose a plan.' })
    if (!billing?.enabled) return res.status(503).json({ error: 'Online billing is not enabled yet. Contact us to upgrade.' })
    try {
      res.json(await billing.createCheckout(req.user, req.profile, parsed.data.plan, parsed.data.interval))
    } catch (error) {
      console.error('billing checkout', error?.message)
      res.status(502).json({ error: 'Could not start checkout. Please try again.' })
    }
  })

  app.post('/api/billing/portal', requireAuth, async (req, res) => {
    if (!billing?.enabled) return res.status(503).json({ error: 'Online billing is not enabled yet.' })
    if (!req.profile?.stripe_customer_id) return res.status(400).json({ error: 'There is no subscription to manage yet.' })
    try {
      res.json(await billing.createPortal(req.user, req.profile))
    } catch (error) {
      console.error('billing portal', error?.message)
      res.status(502).json({ error: 'Could not open the billing portal. Please try again.' })
    }
  })

  app.get('/api/runs', requireAuth, async (req, res) => {
    res.json({ runs: await store.listRuns(req.user.id) })
  })

  app.post('/api/generate', requireAuth, async (req, res) => {
    const parsed = generateSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid analysis request' })
    const { tool, input } = parsed.data
    const validationError = validateToolInput(tool, input)
    if (validationError) return res.status(400).json({ error: validationError })
    await consume(store, req.user.id, req.plan, 'analysis', 1)
    let result
    try {
      result = await runGenerate(req, tool, input)
    } catch (error) {
      if (error instanceof QuotaError || error instanceof BlockedUrlError) throw error
      console.error(`generate:${tool}`, error.message)
      return res.status(502).json({ error: 'AI analysis is temporarily unavailable. Please try again shortly.' })
    }
    if (!result) return res.status(503).json({ error: 'AI analysis is temporarily unavailable. Please try again shortly.' })
    await store.saveRun(req.user.id, tool, input, result)
    res.json(result)
  })

  app.post('/api/crawl', requireAuth, async (req, res) => {
    const parsed = urlSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid URL' })
    const target = assertPublicUrl(parsed.data.url)
    await consume(store, req.user.id, req.plan, 'audit', 1)
    const robotsRes = await fetcher(`${target.origin}/robots.txt`, { timeoutMs: 8000, maxBytes: 300_000 })
    const robotsFound = robotsRes.ok && !/<html/i.test(robotsRes.text.slice(0, 500))
    const robots = parseRobots(robotsFound ? robotsRes.text : '')
    const rows = await Promise.all(AI_BOTS.map(async (bot) => {
      const verdict = evaluateRobots(robots, bot.name, target.pathname || '/')
      let code = null
      if (bot.ua) {
        const response = await fetcher(target.href, { headers: { 'User-Agent': bot.ua }, timeoutMs: 8000, maxBytes: 20_000 })
        code = response.status || 'ERR'
      }
      const httpOk = code === null || code === 200
      return {
        name: bot.name,
        operator: bot.operator,
        purpose: bot.purpose,
        robots: verdict.allowed ? 'Allowed' : 'Disallowed',
        rule: verdict.rule || (robotsFound ? 'no matching rule' : 'no robots.txt'),
        code: code === null ? 'robots only' : code,
        status: !verdict.allowed ? 'Blocked' : httpOk ? 'Allowed' : 'Blocked',
      }
    }))
    const result = { rows, robotsTxt: robotsFound, url: target.href }
    await store.saveRun(req.user.id, 'crawler', { url: parsed.data.url }, result)
    res.json(result)
  })

  app.post('/api/audit', requireAuth, async (req, res) => {
    const parsed = auditSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Enter a valid website URL.' })
    assertPublicUrl(parsed.data.url)
    const wantsRender = parsed.data.render && Boolean(renderer)
    await consume(store, req.user.id, req.plan, 'audit', wantsRender ? 2 : 1)
    const result = await runAudit(normalizeUrl(parsed.data.url), { fetcher, extraPages: Math.min(parsed.data.pages, req.limits.auditPages) })
    if (wantsRender && result.page) {
      // The rendered DOM is compared with the same raw response a non-rendering crawler receives.
      const [raw, rendered] = await Promise.all([fetcher(result.url, { timeoutMs: 12000 }), renderer.render(result.url)])
      result.rendering = rendered.ok && raw.ok ? compareRender(extractPage(raw.text, raw.url), rendered) : { ok: false, error: rendered.error || 'The page could not be rendered.' }
    }
    const checks = [...result.categories, ...(result.rendering?.ok ? [result.rendering.category] : [])]
      .flatMap((category) => category.checks.map((item) => ({ id: item.id, label: item.label, status: item.status, detail: String(item.detail || '').slice(0, 300), category: category.label })))
    try {
      const saved = await store.saveAudit(req.user.id, { url: result.url, host: new URL(result.url).hostname.toLowerCase().replace(/^www\./, ''), score: result.score, counts: result.counts, checks, rendered: Boolean(result.rendering?.ok) })
      result.auditId = saved.id
    } catch (error) {
      if (!(error instanceof MigrationPendingError)) console.error('audit history', error?.message)
    }
    await store.saveRun(req.user.id, 'audit', { url: parsed.data.url }, { title: result.url, score: result.score, summary: result.summary, counts: result.counts })
    res.json(result)
  })

  // ---------- projects & tracking ----------
  async function loadProject(req, res) {
    const project = await store.getProject(req.user.id, req.params.id)
    if (!project) res.status(404).json({ error: 'Project not found' })
    return project
  }

  app.get('/api/projects', requireAuth, async (req, res) => {
    res.json({ projects: await store.listProjects(req.user.id), limit: req.limits.projects })
  })

  app.post('/api/projects', requireAuth, async (req, res) => {
    const parsed = projectSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Enter a project name and brand.' })
    const existing = await store.listProjects(req.user.id)
    if (existing.length >= req.limits.projects) return res.status(403).json({ error: `Your ${req.limits.label} plan includes ${req.limits.projects} project(s).`, upgrade: true })
    const data = { ...parsed.data, domain: parsed.data.domain ? domainOf(parsed.data.domain) : '' }
    res.status(201).json({ project: await store.createProject(req.user.id, data) })
  })

  app.get('/api/projects/:id', requireAuth, async (req, res) => {
    const project = await loadProject(req, res)
    if (!project) return
    const [prompts, measurements] = await Promise.all([store.listPrompts(req.user.id, project.id), store.listMeasurements(req.user.id, project.id, 30)])
    res.json({ project, prompts, measurements, promptLimit: req.limits.promptsPerProject })
  })

  app.put('/api/projects/:id', requireAuth, async (req, res) => {
    const parsed = projectSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Enter a project name and brand.' })
    const data = { ...parsed.data, domain: parsed.data.domain ? domainOf(parsed.data.domain) : '' }
    const project = await store.updateProject(req.user.id, req.params.id, data)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    res.json({ project })
  })

  app.delete('/api/projects/:id', requireAuth, async (req, res) => {
    await store.deleteProject(req.user.id, req.params.id)
    res.json({ ok: true })
  })

  app.post('/api/projects/:id/prompts', requireAuth, async (req, res) => {
    const parsed = promptsSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Enter at least one prompt (max 300 characters each).' })
    const project = await loadProject(req, res)
    if (!project) return
    const existing = await store.listPrompts(req.user.id, project.id)
    const known = new Set(existing.map((prompt) => prompt.text.toLowerCase()))
    const fresh = parsed.data.prompts.filter((prompt) => !known.has(prompt.text.toLowerCase()) && known.add(prompt.text.toLowerCase()))
    if (existing.length + fresh.length > req.limits.promptsPerProject) {
      return res.status(403).json({ error: `Your ${req.limits.label} plan tracks up to ${req.limits.promptsPerProject} prompts per project.`, upgrade: true })
    }
    const added = fresh.length ? await store.addPrompts(req.user.id, project.id, fresh) : []
    res.status(201).json({ prompts: [...existing, ...added] })
  })

  app.delete('/api/prompts/:id', requireAuth, async (req, res) => {
    await store.deletePrompt(req.user.id, req.params.id)
    res.json({ ok: true })
  })

  app.post('/api/projects/:id/prompts/suggest', requireAuth, async (req, res) => {
    const project = await loadProject(req, res)
    if (!project) return
    await consume(store, req.user.id, req.plan, 'analysis', 1)
    const page = project.domain ? await fetchEvidence(project.domain) : null
    const raw = await llm.chatJson(
      'You design prompt sets for tracking brand visibility in AI answer engines. Write questions real buyers would type into ChatGPT or Perplexity for this brand\'s category, in the project language and for the project country. Do NOT include the brand name in the questions: unbranded category, comparison, problem and best-of questions measure visibility. Return strict JSON: {"prompts":[{"text":"...","category":"category|comparison|problem|best-of|how-to"}]} with exactly 10 prompts.',
      JSON.stringify({ brand: project.brand, domain: project.domain, competitors: project.competitors.map((entry) => entry.name), country: project.country, language: project.language, page: page?.evidence ? { title: page.evidence.title, description: page.evidence.metaDescription, headings: page.evidence.headings?.slice(0, 15), text: page.evidence.textSample?.slice(0, 2500) } : null }),
    )
    const prompts = Array.isArray(raw?.prompts) ? raw.prompts.map((item) => ({ text: String(item?.text || '').trim().slice(0, 300), category: String(item?.category || 'category').slice(0, 40) })).filter((item) => item.text) : []
    if (!prompts.length) return res.status(503).json({ error: 'Prompt suggestions are temporarily unavailable.' })
    res.json({ prompts: prompts.slice(0, 10) })
  })

  // Analyse an answer the user copied from a surface without an API (for example a Google AI Overview).
  app.post('/api/projects/:id/analyze-answer', requireAuth, async (req, res) => {
    const parsed = z.object({ text: z.string().trim().min(20).max(20000), sources: z.string().max(5000).default('') }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Paste the answer text (at least 20 characters).' })
    const project = await loadProject(req, res)
    if (!project) return
    await consume(store, req.user.id, req.plan, 'analysis', 1)
    const discovered = await llm.extractBrands([parsed.data.text]).catch(() => [])
    const analysis = analyzeAnswer({
      answer: parsed.data.text,
      citations: parsed.data.sources.split(/[\s,]+/).filter((item) => /\./.test(item)).slice(0, 40).map((item) => (/^https?:\/\//i.test(item) ? item : `https://${item}`)),
      brand: project.brand, aliases: project.aliases, domain: project.domain, competitors: project.competitors, extraNames: discovered,
    })
    res.json({ ...analysis, brand: project.brand, method: 'Counted from the pasted text. Brand names are matched against the text; nothing is estimated.' })
  })

  // Content brief for a tracked prompt, grounded in the latest measurement.
  app.post('/api/projects/:id/brief', requireAuth, async (req, res) => {
    const parsed = z.object({ prompt: text(300) }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Choose a prompt.' })
    const project = await loadProject(req, res)
    if (!project) return
    await consume(store, req.user.id, req.plan, 'analysis', 1)
    const latest = (await store.listMeasurements(req.user.id, project.id, 10)).find((item) => item.status === 'completed' && item.summary)
    const row = latest?.summary.byPrompt.find((entry) => entry.prompt === parsed.data.prompt)
    const page = project.domain ? await fetchEvidence(project.domain) : null
    const raw = await llm.chatJson(
      `${systemPrompt('content')}\nWrite a content brief for one page that would make the brand a credible answer to the target question. measured contains real counts from live AI answers: use them to say which brands and sources currently win this question and what the page must offer to earn a mention. Do not restate the numbers differently. Sections after the three required ones: "Recommended outline" (H1 and H2/H3 headings), "Answer block" (a 40 to 70 word direct answer to open the page), "Evidence to include", "Sources worth earning a mention on".`,
      JSON.stringify({
        targetQuestion: parsed.data.prompt, brand: project.brand, domain: project.domain, country: project.country, language: project.language,
        measured: row ? { visibilityRate: row.rate, answers: row.answers, brandsNamedMostOften: row.topBrands } : null,
        sourcesCitedForThisBrandSet: latest?.summary.citedDomains.slice(0, 8) || [],
        sourcesCitingCompetitorsOnly: latest?.summary.citationGap?.slice(0, 8) || [],
        brandPage: page?.evidence ? { title: page.evidence.title, headings: page.evidence.headings?.slice(0, 20), text: page.evidence.textSample?.slice(0, 3000) } : null,
      }),
    )
    if (!raw) return res.status(503).json({ error: 'Content briefs are temporarily unavailable.' })
    const result = normalizeResult('content', raw)
    await store.saveRun(req.user.id, 'content', { prompt: parsed.data.prompt, project: project.name }, result)
    res.json(result)
  })

  app.get('/api/projects/:id/measurements', requireAuth, async (req, res) => {
    const project = await loadProject(req, res)
    if (!project) return
    res.json({ measurements: await store.listMeasurements(req.user.id, project.id, 60) })
  })

  app.post('/api/projects/:id/measurements', requireAuth, async (req, res) => {
    const parsed = measurementSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Select at least one AI model.' })
    if (!llm.canProbe()) return res.status(503).json({ error: 'Live model probes are not configured on this server.' })
    const project = await loadProject(req, res)
    if (!project) return
    const prompts = await store.listPrompts(req.user.id, project.id)
    if (!prompts.length) return res.status(400).json({ error: 'Add at least one prompt to track.' })
    const surfaces = parsed.data.surfaces.filter((surface) => llm.surfaces().includes(surface))
    if (!surfaces.length) return res.status(400).json({ error: 'Select at least one AI model.' })
    const samples = Math.min(parsed.data.samples, req.limits.maxSamples)
    const tasks = buildTasks(prompts, surfaces, samples)
    await consume(store, req.user.id, req.plan, 'probe', tasks.length * (parsed.data.grounded ? GROUNDED_MULTIPLIER : 1))
    const measurement = await store.createMeasurement(req.user.id, project.id, { surfaces, samples, grounded: parsed.data.grounded, prompts: prompts.length }, tasks)
    res.status(201).json({ measurement })
  })

  app.get('/api/measurements/:id', requireAuth, async (req, res) => {
    const measurement = await store.getMeasurement(req.user.id, req.params.id)
    if (!measurement) return res.status(404).json({ error: 'Measurement not found' })
    const samples = req.query.samples === '1' ? await store.listSamples(measurement.id) : undefined
    res.json({ measurement, samples })
  })

  app.post('/api/measurements/:id/step', requireAuth, async (req, res) => {
    const measurement = await store.getMeasurement(req.user.id, req.params.id)
    if (!measurement) return res.status(404).json({ error: 'Measurement not found' })
    if (measurement.status !== 'running') return res.json({ status: measurement.status, remaining: 0, total: measurement.total, summary: measurement.summary })
    const project = await store.getProject(req.user.id, measurement.projectId)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    const progress = await processBatch({ store, llm, measurement, project, batchSize: config.batchSize || 6 })
    res.json({ ...progress, total: measurement.total })
  })

  registerScheduleRoutes(app, { store, llm, mailer, requireAuth, config: { ...config, appUrl, adminEmails } })
  registerSeoRoutes(app, { store, fetcher, requireAuth, gsc, tokenBox, vitals, config: { ...config, appUrl, isProduction } })

  app.use('/api/', (req, res) => res.status(404).json({ error: 'Not found' }))

  if (config.staticDir) {
    app.use(express.static(config.staticDir))
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(config.staticDir, 'index.html')) : next()))
  }

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    if (error instanceof BlockedUrlError) return res.status(400).json({ error: error.message })
    if (error instanceof QuotaError) return res.status(429).json({ error: error.message, quota: true, kind: error.kind })
    if (error instanceof MigrationPendingError) return res.status(503).json({ error: error.message, migration: true })
    if (handleSeoError(error, res)) return undefined
    if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') return res.status(400).json({ error: 'Invalid request body' })
    console.error(req.method, req.path, error?.message || error)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  })

  return app
}

export { wilson }
