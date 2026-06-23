import cookieParser from 'cookie-parser'
import cors from 'cors'
import 'dotenv/config'
import express from 'express'
import rateLimit from 'express-rate-limit'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import helmet from 'helmet'
import { nanoid } from 'nanoid'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const app = express()
const port = process.env.PORT || 8787
const isProduction = process.env.NODE_ENV === 'production'
const envValue = (key, fallback = '') => (process.env[key] || fallback).trim()
const supabaseUrl = envValue('SUPABASE_URL')
const supabaseSecretKey = envValue('SUPABASE_SECRET_KEY')
const supabasePublishableKey = envValue('SUPABASE_PUBLISHABLE_KEY')
const appUrl = envValue('APP_URL', 'http://localhost:5173')
const requireSupabase = envValue('REQUIRE_SUPABASE', 'true') !== 'false'

const supabaseAdmin = supabaseUrl && supabaseSecretKey
  ? createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null
const supabaseAuth = supabaseUrl && (supabasePublishableKey || supabaseSecretKey)
  ? createClient(supabaseUrl, supabasePublishableKey || supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null

if (requireSupabase && (!supabaseAdmin || !supabaseAuth)) {
  throw new Error('Supabase Auth requires SUPABASE_URL, SUPABASE_SECRET_KEY, and SUPABASE_PUBLISHABLE_KEY')
}

app.set('trust proxy', 1)
app.use(helmet({
  contentSecurityPolicy: isProduction ? undefined : false,
}))
app.use(cors({
  origin: appUrl,
  credentials: true,
}))
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
}))
app.use('/api/auth/', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
}))

const toolInstructions = {
  brand: 'Analyze whether AI systems can identify this brand as an entity for the selected country and language. Evaluate entity clarity, third-party corroboration, sameAs/schema readiness, category ownership, answer-engine citation likelihood, and concrete fixes. If fetchedPage is supplied, ground observations in that page evidence.',
  visibility: 'Check whether the selected brand is likely to be visible for the user prompt across the selected AI answer engines and model surfaces. Use directModelChecks when supplied: those are live model-answer probes for supported OpenRouter models. For surfaces without direct query support, clearly mark the finding as an assessment. Return model-by-model presence, confidence, likely evidence, citation gaps, competitive pressure, and precise actions to improve inclusion.',
  fanout: 'Create a query fan-out analysis for Google AI Overview, Google AI Mode, and ChatGPT style answer engines. Expand the source prompt into realistic sub-queries grouped by intent, comparison, alternatives, pricing, trust, and implementation.',
  research: 'Generate a structured AI prompt research plan across branded, non-branded, competitor, topic, persona, SEO, and Search Console prompt types. Include monitorable prompt buckets and why each matters.',
  landing: 'Create a GEO optimized landing page plan with answer-first structure, proof sections, FAQs, comparison context, schema recommendations, and extractable answer blocks. If fetchedPage is supplied, use it to avoid recommending sections that already exist.',
  content: 'Create or brief GEO optimized content that is extractable by AI answer engines. Include outline, answer snippets, evidence needs, FAQ angles, and structure recommendations. If referencePages are supplied, use their actual extracted text as context.',
  check: 'Review content for GEO compliance using the actual fetchedContent or pasted content, not just the URL. If targetQuery is supplied, first assess whether the fetched/pasted content already answers that exact query or topic. Score answerability, entity clarity, evidence, structure, schema, freshness, and extraction quality. Do not recommend creating content for a topic if the supplied content already covers it; instead identify specific missing evidence, structure, schema, source, internal linking, or clarity improvements.',
  benchmark: 'Return the top 10 brands likely to appear for the user prompt in the selected country and language, ranked by likely AI answer visibility, topical authority, citation footprint, and sentiment.',
}

const resultShape = `Return strict JSON with:
title string, score number 0-100, summary string,
metrics array of 2-4 objects {label,value},
bullets array of concise recommendations,
sections array of objects {title,items} where items is an array of strings.
Sections must include purpose-specific, evidence-based groups named exactly:
Already done, Needs improvement, Missing / should add.
Use these sections to clearly explain what is present, what is weak, and what the user should add next.
Add additional tool-specific sections after those three when useful.
Do not invent observed facts that are not supported by the user input or live check result; state uncertainty when needed.
Recommendations must be tied to specific evidence from fetched content, pasted content, direct model probes, or the supplied brief. Avoid generic SEO advice when actual evidence is available.
For fanout also include queries array of 6-10 objects {query,intent}.
For visibility also include models array of objects {model,presence,confidence,evidence,nextAction}. Presence should be Visible, Likely, Weak, or Not visible.
For benchmark also include brands array of exactly 10 objects {rank,brand,share,sentiment,reason}.`

const authSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(120),
})
const emailSchema = z.object({
  email: z.string().trim().email().max(160),
})
const profileSchema = z.object({
  name: z.string().trim().min(2).max(80),
})
const sessionSchema = z.object({
  accessToken: z.string().min(20),
  refreshToken: z.string().min(20).optional(),
})
const passwordUpdateSchema = z.object({
  accessToken: z.string().min(20),
  password: z.string().min(8).max(120),
})
const generateSchema = z.object({
  tool: z.enum(['brand', 'visibility', 'fanout', 'research', 'landing', 'content', 'check', 'benchmark']).default('brand'),
  input: z.record(z.string(), z.unknown()).default({}),
})
const crawlSchema = z.object({
  url: z.string().trim().min(3).max(500),
})

function absoluteUrl(value) {
  if (!value || typeof value !== 'string') return ''
  return /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`
}

function extractTitle(html) {
  const match = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match ? match[1].replace(/\s+/g, ' ').trim() : ''
}

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchPageEvidence(url) {
  const target = absoluteUrl(url)
  if (!target) return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 9000)
  try {
    const response = await fetch(target, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GEOOptimizerAI/1.0; +https://geo-optimizer-ai.sasmaz.digital)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
    })
    const contentType = response.headers.get('content-type') || ''
    const raw = await response.text()
    const limited = raw.slice(0, 1_000_000)
    const text = htmlToText(limited)
    return {
      url: target,
      status: response.status,
      ok: response.ok,
      contentType,
      title: extractTitle(limited),
      wordCount: text ? text.split(/\s+/).length : 0,
      textSample: text.slice(0, 12000),
    }
  } catch (error) {
    return {
      url: target,
      ok: false,
      status: 0,
      error: error.name === 'AbortError' ? 'Fetch timed out' : error.message,
      wordCount: 0,
      textSample: '',
    }
  } finally {
    clearTimeout(timeout)
  }
}

function splitUrls(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3)
}

async function enrichInput(tool, input) {
  const next = { ...input }
  if ((tool === 'brand' || tool === 'landing' || tool === 'visibility') && input.domain) {
    next.fetchedPage = await fetchPageEvidence(input.domain)
  }
  if (tool === 'check') {
    if (input.url) next.fetchedContent = await fetchPageEvidence(input.url)
    if (input.content) {
      const text = String(input.content).replace(/\s+/g, ' ').trim()
      next.pastedContent = {
        wordCount: text ? text.split(/\s+/).length : 0,
        textSample: text.slice(0, 12000),
      }
    }
  }
  if (tool === 'content' && input.urls) {
    next.referencePages = await Promise.all(splitUrls(input.urls).map(fetchPageEvidence))
  }
  return next
}

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge,
    path: '/',
  }
}

function setAuthCookies(res, session) {
  if (!session?.access_token) return
  res.cookie('sb_access_token', session.access_token, cookieOptions(60 * 60 * 1000))
  if (session.refresh_token) {
    res.cookie('sb_refresh_token', session.refresh_token, cookieOptions(30 * 24 * 60 * 60 * 1000))
  }
}

function clearAuthCookies(res) {
  res.clearCookie('sb_access_token', { path: '/' })
  res.clearCookie('sb_refresh_token', { path: '/' })
  res.clearCookie('geo_session', { path: '/' })
}

function profileName(user, profile) {
  return profile?.name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'User'
}

function publicUser(user, profile) {
  return {
    id: user.id,
    name: profileName(user, profile),
    email: user.email,
    createdAt: user.created_at,
  }
}

async function getProfile(userId) {
  const { data, error } = await supabaseAdmin
    .from('geo_app_users')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

async function upsertProfile(user, name) {
  const profile = {
    id: user.id,
    name: name || profileName(user),
    email: user.email,
    password_hash: 'supabase-auth',
  }
  const { data, error } = await supabaseAdmin
    .from('geo_app_users')
    .upsert(profile, { onConflict: 'id' })
    .select('*')
    .single()
  if (error) throw error
  return data
}

async function getUserFromRequest(req, res) {
  let accessToken = req.cookies.sb_access_token
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
  try {
    const user = await getUserFromRequest(req, res)
    if (!user) return res.status(401).json({ error: 'Authentication required' })
    const profile = await upsertProfile(user)
    req.user = user
    req.profile = profile
    next()
  } catch {
    res.status(401).json({ error: 'Invalid session' })
  }
}

async function listRuns(userId) {
  const { data, error } = await supabaseAdmin
    .from('geo_app_runs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error
  return data.map((run) => ({
    id: run.id,
    userId: run.user_id,
    type: run.type,
    payload: run.payload,
    result: run.result,
    createdAt: run.created_at,
  }))
}

function fallback() {
  return {
    title: 'Analysis result',
    score: 0,
    summary: '',
    metrics: [],
    bullets: [],
    sections: [],
    queries: [],
    brands: [],
    models: [],
  }
}

async function callOpenAI(tool, input) {
  const openAiKey = envValue('OPENAI_API_KEY')
  if (!openAiKey) return null
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: envValue('OPENAI_MODEL', 'gpt-4o-mini'),
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are GEO OPTIMIZER AI. ${toolInstructions[tool] || toolInstructions.brand}
${resultShape}`,
        },
        { role: 'user', content: JSON.stringify(input) },
      ],
    }),
  })
  if (!response.ok) throw new Error(`OpenAI error ${response.status}`)
  const data = await response.json()
  return JSON.parse(data.choices?.[0]?.message?.content || '{}')
}

async function callOpenRouter(tool, input) {
  const openRouterKey = envValue('OPENROUTER_API_KEY')
  if (!openRouterKey) return null
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openRouterKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': appUrl,
      'X-Title': 'GEO OPTIMIZER AI',
    },
    body: JSON.stringify({
      model: envValue('OPENROUTER_MODEL', 'openai/gpt-4o-mini'),
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `You are GEO OPTIMIZER AI. ${toolInstructions[tool] || toolInstructions.brand} ${resultShape}` },
        { role: 'user', content: JSON.stringify(input) },
      ],
    }),
  })
  if (!response.ok) throw new Error(`OpenRouter error ${response.status}`)
  const data = await response.json()
  return JSON.parse(data.choices?.[0]?.message?.content || '{}')
}

const visibilityModelCandidates = {
  ChatGPT: ['openai/gpt-chat-latest', '~openai/gpt-mini-latest', 'openai/gpt-5.4-mini', 'openai/gpt-5.1'],
  Claude: ['~anthropic/claude-haiku-latest', 'anthropic/claude-haiku-4.5', '~anthropic/claude-sonnet-latest', 'anthropic/claude-3-haiku'],
  Gemini: ['~google/gemini-flash-latest', 'google/gemini-2.5-flash', 'google/gemini-3.5-flash', 'google/gemini-2.5-flash-lite'],
  Perplexity: ['perplexity/sonar-pro', 'perplexity/sonar-pro-search', 'perplexity/sonar'],
}

let openRouterModelCache = null
let openRouterModelCacheAt = 0

async function getOpenRouterModelIds(openRouterKey) {
  const now = Date.now()
  if (openRouterModelCache && now - openRouterModelCacheAt < 60 * 60 * 1000) return openRouterModelCache
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${openRouterKey}` },
  })
  if (!response.ok) return []
  const data = await response.json()
  openRouterModelCache = (data.data || []).map((model) => model.id)
  openRouterModelCacheAt = now
  return openRouterModelCache
}

async function resolveVisibilityModel(surface, openRouterKey) {
  const candidates = visibilityModelCandidates[surface]
  if (!candidates?.length) return ''
  const ids = await getOpenRouterModelIds(openRouterKey)
  if (ids.length) return candidates.find((candidate) => ids.includes(candidate)) || ''
  return candidates.find((candidate) => !candidate.startsWith('~')) || ''
}

function includesBrand(answer, brand) {
  const normalizedAnswer = String(answer || '').toLowerCase()
  const normalizedBrand = String(brand || '').toLowerCase().replace(/[^a-z0-9ğüşöçıİĞÜŞÖÇ]+/gi, ' ').trim()
  if (!normalizedBrand) return false
  return normalizedAnswer.includes(normalizedBrand)
}

async function directVisibilityChecks(input) {
  const openRouterKey = envValue('OPENROUTER_API_KEY')
  const selectedModels = Array.isArray(input.models) && input.models.length
    ? input.models
    : ['ChatGPT', 'Google AI Overview', 'Google AI Mode', 'Perplexity', 'Claude', 'Gemini', 'Microsoft Copilot']
  if (!openRouterKey || !selectedModels.length || !input.prompt || !input.brand) return []

  const checks = await Promise.all(selectedModels.slice(0, 8).map(async (surface) => {
    const model = await resolveVisibilityModel(surface, openRouterKey)
    if (!model) {
      return {
        model: surface,
        directQuery: false,
        presence: 'Assessment only',
        confidence: '-',
        evidence: 'No direct query API is configured for this surface.',
        nextAction: 'Use the assessment as directional and prioritize citation-ready content for this surface.',
      }
    }

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': appUrl,
          'X-Title': 'GEO OPTIMIZER AI',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 500,
          messages: [
            {
              role: 'system',
              content: `Answer the user's query naturally for ${input.country || 'Worldwide'} in ${input.language || 'English'}. Do not force any brand mention. Return a concise answer.`,
            },
            { role: 'user', content: String(input.prompt) },
          ],
        }),
      })
      if (!response.ok) throw new Error(`Model probe failed ${response.status}`)
      const data = await response.json()
      const answer = data.choices?.[0]?.message?.content || ''
      const mentioned = includesBrand(answer, input.brand)
      return {
        model: surface,
        directQuery: true,
        presence: mentioned ? 'Visible' : 'Not visible',
        confidence: mentioned ? 'High' : 'Medium',
        evidence: mentioned ? `The live model answer mentioned ${input.brand}.` : `The live model answer did not mention ${input.brand}.`,
        nextAction: mentioned
          ? 'Maintain the evidence and entity signals that already support this mention.'
          : `Add clearer evidence connecting ${input.brand} to this query and make it easy for answer engines to extract.`,
        answerSample: String(answer).slice(0, 500),
      }
    } catch (error) {
      return {
        model: surface,
        directQuery: false,
        presence: 'Unavailable',
        confidence: '-',
        evidence: error.message,
        nextAction: 'Retry later or use a supported OpenRouter model for this surface.',
      }
    }
  }))

  return checks
}

function normalizeResult(tool, result) {
  const merged = { ...fallback(tool), ...result }
  const rawScore = Number(merged.score) || 0
  merged.score = Math.max(0, Math.min(100, rawScore > 0 && rawScore <= 1 ? Math.round(rawScore * 100) : Math.round(rawScore)))
  merged.bullets = Array.isArray(merged.bullets) ? merged.bullets.slice(0, 8).map(String) : []
  merged.metrics = normalizeMetrics(merged.metrics)
  merged.sections = normalizeSections(merged.sections)
  merged.queries = normalizeQueries(merged.queries)
  if (tool !== 'fanout') merged.queries = []
  if (tool === 'benchmark') merged.brands = normalizeBrands(merged.brands)
  if (tool !== 'benchmark') merged.brands = []
  if (tool === 'visibility') merged.models = normalizeModels(merged.models)
  if (tool !== 'visibility') merged.models = []
  return merged
}

function normalizeMetrics(metrics) {
  if (!Array.isArray(metrics)) return []
  return metrics.slice(0, 4).map((metric) => ({
    label: String(metric?.label || 'Metric'),
    value: String(metric?.value || '-'),
  }))
}

function normalizeSections(sections) {
  if (!Array.isArray(sections)) return []
  return sections.slice(0, 5).map((section, index) => ({
    title: String(section?.title || section?.heading || `Section ${index + 1}`),
    items: Array.isArray(section?.items || section?.bullets) ? (section.items || section.bullets).slice(0, 8).map(String) : [],
  })).filter((section) => section.items.length)
}

function normalizeQueries(queries) {
  if (!Array.isArray(queries)) return []
  return queries.slice(0, 10).map((query) => ({
    query: String(query?.query || query),
    intent: String(query?.intent || query?.reason || 'Related search path'),
  }))
}

function normalizeBrands(brands) {
  if (!Array.isArray(brands)) return []
  return brands.slice(0, 10).map((row, index) => ({
    rank: Number(row.rank) || index + 1,
    brand: String(row.brand || `Brand ${index + 1}`),
    share: typeof row.share === 'number' ? `${row.share}%` : String(row.share || `${90 - index * 5}%`),
    sentiment: typeof row.sentiment === 'number' ? (row.sentiment >= 85 ? 'Leader' : row.sentiment >= 74 ? 'Challenger' : 'Emerging') : String(row.sentiment || 'Challenger'),
    reason: String(row.reason || 'Entity strength'),
  }))
}

function normalizeModels(models) {
  if (!Array.isArray(models)) return []
  return models.slice(0, 10).map((row) => ({
    model: String(row.model || row.surface || 'AI surface'),
    presence: String(row.presence || row.status || 'Unknown'),
    confidence: String(row.confidence || '-'),
    evidence: String(row.evidence || row.reason || 'No evidence supplied'),
    nextAction: String(row.nextAction || row.action || 'Improve entity clarity and citation-ready evidence'),
  }))
}

async function saveRun(userId, type, payload, result) {
  const { error } = await supabaseAdmin
    .from('geo_app_runs')
    .insert({
      id: nanoid(),
      user_id: userId,
      type,
      payload,
      result,
    })
  if (error) throw error
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'GEO OPTIMIZER AI', auth: 'supabase', database: supabaseAdmin ? 'supabase' : 'unconfigured', time: new Date().toISOString() })
})

app.post('/api/auth/register', async (req, res) => {
  const parsed = authSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid registration details' })
  const email = parsed.data.email.toLowerCase()
  const { data, error } = await supabaseAuth.auth.signUp({
    email,
    password: parsed.data.password,
    options: {
      data: { name: parsed.data.name || email.split('@')[0] },
      emailRedirectTo: `${appUrl}/auth/callback`,
    },
  })
  if (error) return res.status(400).json({ error: error.message })
  if (data.user) await upsertProfile(data.user, parsed.data.name)
  if (data.session) {
    setAuthCookies(res, data.session)
    return res.status(201).json({ user: publicUser(data.user, await getProfile(data.user.id)) })
  }
  res.status(201).json({
    pendingConfirmation: true,
    message: 'Check your email to confirm your account before signing in.',
  })
})

app.post('/api/auth/login', async (req, res) => {
  const parsed = authSchema.omit({ name: true }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid login details' })
  const { data, error } = await supabaseAuth.auth.signInWithPassword({
    email: parsed.data.email.toLowerCase(),
    password: parsed.data.password,
  })
  if (error || !data.session || !data.user) {
    return res.status(401).json({ error: error?.message || 'Invalid email or password' })
  }
  const profile = await upsertProfile(data.user)
  setAuthCookies(res, data.session)
  res.json({ user: publicUser(data.user, profile) })
})

app.post('/api/auth/session', async (req, res) => {
  const parsed = sessionSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid session payload' })
  const { data, error } = await supabaseAuth.auth.getUser(parsed.data.accessToken)
  if (error || !data.user) return res.status(401).json({ error: 'Invalid auth callback' })
  const profile = await upsertProfile(data.user)
  setAuthCookies(res, {
    access_token: parsed.data.accessToken,
    refresh_token: parsed.data.refreshToken,
  })
  res.json({ user: publicUser(data.user, profile) })
})

app.post('/api/auth/reset-password', async (req, res) => {
  const parsed = emailSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid email' })
  const { error } = await supabaseAuth.auth.resetPasswordForEmail(parsed.data.email.toLowerCase(), {
    redirectTo: `${appUrl}/auth/callback`,
  })
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true, message: 'Password reset email sent.' })
})

app.post('/api/auth/resend-confirmation', async (req, res) => {
  const parsed = emailSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid email' })
  const { error } = await supabaseAuth.auth.resend({
    type: 'signup',
    email: parsed.data.email.toLowerCase(),
    options: { emailRedirectTo: `${appUrl}/auth/callback` },
  })
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true, message: 'Confirmation email sent.' })
})

app.post('/api/auth/update-password', async (req, res) => {
  const parsed = passwordUpdateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid password update request' })
  const { data, error } = await supabaseAuth.auth.getUser(parsed.data.accessToken)
  if (error || !data.user) return res.status(401).json({ error: 'Invalid password recovery token' })
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
    password: parsed.data.password,
  })
  if (updateError) return res.status(400).json({ error: updateError.message })
  clearAuthCookies(res)
  res.json({ ok: true, message: 'Password updated. Please sign in again.' })
})

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookies(res)
  res.json({ ok: true })
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user, req.profile) })
})

app.put('/api/auth/profile', requireAuth, async (req, res) => {
  const parsed = profileSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid profile details' })
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
    user_metadata: { ...req.user.user_metadata, name: parsed.data.name },
  })
  if (updateError) return res.status(400).json({ error: updateError.message })
  const profile = await upsertProfile({ ...req.user, user_metadata: { ...req.user.user_metadata, name: parsed.data.name } }, parsed.data.name)
  res.json({ user: publicUser(req.user, profile) })
})

app.get('/api/runs', requireAuth, async (req, res) => {
  res.json({ runs: await listRuns(req.user.id) })
})

app.post('/api/generate', requireAuth, async (req, res) => {
  const parsed = generateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid analysis request' })
  const { tool, input } = parsed.data
  try {
    const enrichedInput = await enrichInput(tool, input)
    const directModelChecks = tool === 'visibility' ? await directVisibilityChecks(enrichedInput) : []
    const analysisInput = tool === 'visibility'
      ? { ...enrichedInput, directModelChecks }
      : enrichedInput
    const raw = (await callOpenRouter(tool, analysisInput)) || (await callOpenAI(tool, analysisInput))
    if (!raw) return res.status(503).json({ error: 'AI analysis is temporarily unavailable. Please try again shortly.' })
    const result = normalizeResult(tool, raw)
    if (tool === 'visibility' && directModelChecks.length) {
      result.models = normalizeModels(directModelChecks)
    }
    await saveRun(req.user.id, tool, input, result)
    res.json(result)
  } catch (error) {
    console.error(error.message)
    res.status(502).json({ error: 'AI analysis is temporarily unavailable. Please try again shortly.' })
  }
})

app.post('/api/crawl', requireAuth, async (req, res) => {
  const parsed = crawlSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid URL' })
  const target = /^https?:\/\//i.test(parsed.data.url) ? parsed.data.url : `https://${parsed.data.url}`
  const agents = {
    GPTBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot',
    'ChatGPT-User': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); ChatGPT-User/1.0; +https://openai.com/bot',
    'OAI-SearchBot': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
    Googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    GoogleOther: 'GoogleOther',
    PerplexityBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot',
    ClaudeBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +https://www.anthropic.com',
    Grok: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Grok/1.0',
  }

  const rows = await Promise.all(Object.entries(agents).map(async ([name, userAgent]) => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 7500)
      const response = await fetch(target, { method: 'GET', headers: { 'User-Agent': userAgent }, signal: controller.signal })
      clearTimeout(timeout)
      return { name, status: response.ok ? 'Allowed' : 'Blocked', code: response.status }
    } catch {
      return { name, status: 'Blocked', code: 'ERR' }
    }
  }))

  await saveRun(req.user.id, 'crawler', { url: parsed.data.url }, { rows })
  res.json({ rows })
})

if (isProduction) {
  app.use(express.static(path.join(__dirname, 'dist')))
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next()
    res.sendFile(path.join(__dirname, 'dist', 'index.html'))
  })
}

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`GEO OPTIMIZER AI running on http://localhost:${port}`)
  })
}

export default app
