import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import 'dotenv/config'
import express from 'express'
import rateLimit from 'express-rate-limit'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import { nanoid } from 'nanoid'
import { z } from 'zod'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const app = express()
const port = process.env.PORT || 8787
const isProduction = process.env.NODE_ENV === 'production'
const jwtSecret = process.env.JWT_SECRET || 'dev-only-change-me'
const dbPath = path.join(__dirname, 'data', 'db.json')

app.set('trust proxy', 1)
app.use(helmet({
  contentSecurityPolicy: isProduction ? undefined : false,
}))
app.use(cors({
  origin: process.env.APP_URL || 'http://localhost:5173',
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
  brand: 'Analyze whether AI systems can identify this brand as an entity. Return entity confidence and recommendations.',
  fanout: 'Create a query fan-out analysis for Google AI Overview, Google AI Mode, and ChatGPT style answer engines.',
  research: 'Generate a structured AI prompt research plan across branded, non-branded, competitor, topic, persona, SEO, and Search Console prompts.',
  landing: 'Create a GEO optimized landing page plan with answer-first structure, proof sections, FAQs, and schema recommendations.',
  content: 'Create or brief GEO optimized content that is extractable by AI answer engines.',
  check: 'Review content for GEO compliance and provide practical fixes.',
  benchmark: 'Return the top 10 brands likely to appear for the user prompt in the selected country and language.',
}

const authSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(120),
})
const generateSchema = z.object({
  tool: z.enum(['brand', 'fanout', 'research', 'landing', 'content', 'check', 'benchmark']).default('brand'),
  input: z.record(z.string(), z.unknown()).default({}),
})
const crawlSchema = z.object({
  url: z.string().trim().min(3).max(500),
})

async function readDb() {
  try {
    return JSON.parse(await fs.readFile(dbPath, 'utf8'))
  } catch {
    const seed = { users: [], runs: [] }
    await writeDb(seed)
    return seed
  }
}

async function writeDb(db) {
  await fs.mkdir(path.dirname(dbPath), { recursive: true })
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2))
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  }
}

function signSession(user) {
  return jwt.sign({ sub: user.id, email: user.email }, jwtSecret, { expiresIn: '7d' })
}

function setSessionCookie(res, token) {
  res.cookie('geo_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  })
}

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies.geo_session
    if (!token) return res.status(401).json({ error: 'Authentication required' })
    const payload = jwt.verify(token, jwtSecret)
    const db = await readDb()
    const user = db.users.find((item) => item.id === payload.sub)
    if (!user) return res.status(401).json({ error: 'Invalid session' })
    req.user = user
    req.db = db
    next()
  } catch {
    res.status(401).json({ error: 'Invalid session' })
  }
}

function fallback(tool) {
  const title = {
    brand: 'Brand entity snapshot',
    fanout: 'Fan-out map',
    research: 'Prompt research set',
    landing: 'Landing page outline',
    content: 'Generated content brief',
    check: 'GEO compliance review',
    benchmark: 'Benchmark ranking',
  }[tool] || 'GEO analysis'

  return {
    title,
    score: tool === 'check' ? 73 : 86,
    summary: 'Demo analysis generated locally because the live provider was unavailable. Configure the API keys in .env for live AI output.',
    bullets: [
      'Use clear entity facts and consistent brand wording',
      'Add concise answer blocks that AI systems can quote',
      'Include evidence, comparison context, and FAQ coverage',
      'Refresh prompts by country and language on a schedule',
    ],
    brands: makeBenchmarkRows(),
  }
}

function makeBenchmarkRows() {
  const brands = ['HubSpot', 'Semrush', 'Ahrefs', 'Shopify', 'Notion', 'Salesforce', 'Adobe', 'Canva', 'Zapier', 'Monday.com']
  return brands.map((brand, index) => ({
    rank: index + 1,
    brand,
    share: `${Math.max(92 - index * 6, 38)}%`,
    sentiment: index < 3 ? 'Leader' : index < 7 ? 'Challenger' : 'Emerging',
    reason: ['Entity strength', 'Citation footprint', 'Topical authority', 'Answer consistency'][index % 4],
  }))
}

async function callOpenAI(tool, input) {
  if (!process.env.OPENAI_API_KEY) return null
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are GEO OPTIMIZER AI. ${toolInstructions[tool] || toolInstructions.brand}
Return strict JSON with keys: title, score, summary, bullets. Score is 0-100. Bullets is an array of 4 concise recommendations. If tool is benchmark, also include brands array of exactly 10 objects with rank, brand, share, sentiment, reason.`,
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
  if (!process.env.OPENROUTER_API_KEY) return null
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173',
      'X-Title': 'GEO OPTIMIZER AI',
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `You are GEO OPTIMIZER AI. ${toolInstructions[tool] || toolInstructions.brand} Return strict JSON with title, score, summary, bullets, and brands for benchmark.` },
        { role: 'user', content: JSON.stringify(input) },
      ],
    }),
  })
  if (!response.ok) throw new Error(`OpenRouter error ${response.status}`)
  const data = await response.json()
  return JSON.parse(data.choices?.[0]?.message?.content || '{}')
}

function normalizeResult(tool, result) {
  const merged = { ...fallback(tool), ...result }
  merged.score = Math.max(0, Math.min(100, Number(merged.score) || 0))
  merged.bullets = Array.isArray(merged.bullets) ? merged.bullets.slice(0, 6).map(String) : fallback(tool).bullets
  if (tool === 'benchmark') merged.brands = normalizeBrands(merged.brands)
  return merged
}

function normalizeBrands(brands) {
  const rows = Array.isArray(brands) && brands.length ? brands : makeBenchmarkRows()
  return rows.slice(0, 10).map((row, index) => ({
    rank: Number(row.rank) || index + 1,
    brand: String(row.brand || `Brand ${index + 1}`),
    share: typeof row.share === 'number' ? `${row.share}%` : String(row.share || `${90 - index * 5}%`),
    sentiment: typeof row.sentiment === 'number' ? (row.sentiment >= 85 ? 'Leader' : row.sentiment >= 74 ? 'Challenger' : 'Emerging') : String(row.sentiment || 'Challenger'),
    reason: String(row.reason || 'Entity strength'),
  }))
}

async function saveRun(userId, type, payload, result) {
  const db = await readDb()
  db.runs.unshift({
    id: nanoid(),
    userId,
    type,
    payload,
    result,
    createdAt: new Date().toISOString(),
  })
  db.runs = db.runs.slice(0, 1000)
  await writeDb(db)
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'GEO OPTIMIZER AI', time: new Date().toISOString() })
})

app.post('/api/auth/register', async (req, res) => {
  const parsed = authSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid registration details' })
  const db = await readDb()
  const email = parsed.data.email.toLowerCase()
  if (db.users.some((user) => user.email === email)) return res.status(409).json({ error: 'Email already registered' })
  const user = {
    id: nanoid(),
    name: parsed.data.name || email.split('@')[0],
    email,
    passwordHash: await bcrypt.hash(parsed.data.password, 12),
    createdAt: new Date().toISOString(),
  }
  db.users.push(user)
  await writeDb(db)
  setSessionCookie(res, signSession(user))
  res.status(201).json({ user: publicUser(user) })
})

app.post('/api/auth/login', async (req, res) => {
  const parsed = authSchema.omit({ name: true }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid login details' })
  const db = await readDb()
  const user = db.users.find((item) => item.email === parsed.data.email.toLowerCase())
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }
  setSessionCookie(res, signSession(user))
  res.json({ user: publicUser(user) })
})

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('geo_session', { path: '/' })
  res.json({ ok: true })
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

app.get('/api/runs', requireAuth, async (req, res) => {
  const db = await readDb()
  res.json({ runs: db.runs.filter((run) => run.userId === req.user.id).slice(0, 30) })
})

app.post('/api/generate', requireAuth, async (req, res) => {
  const parsed = generateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid analysis request' })
  const { tool, input } = parsed.data
  try {
    const raw = (await callOpenAI(tool, input)) || (await callOpenRouter(tool, input)) || fallback(tool)
    const result = normalizeResult(tool, raw)
    await saveRun(req.user.id, tool, input, result)
    res.json(result)
  } catch (error) {
    console.error(error.message)
    const result = normalizeResult(tool, fallback(tool))
    await saveRun(req.user.id, tool, input, result)
    res.json(result)
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

app.listen(port, () => {
  console.log(`GEO OPTIMIZER AI running on http://localhost:${port}`)
})
