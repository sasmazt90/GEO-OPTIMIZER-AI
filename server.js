import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { createApp } from './server/app.js'
import { createBilling, createStripeClient } from './server/billing.js'
import { createGsc, createTokenBox } from './server/gsc.js'
import { createLlm } from './server/llm.js'
import { createMailer } from './server/mail.js'
import { createSafeFetch } from './server/net.js'
import { createRenderer } from './server/render.js'
import { createMemoryStore, createSupabaseStore } from './server/store.js'
import { createVitals } from './server/vitals.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envValue = (key, fallback = '') => (process.env[key] || fallback).trim()
const isProduction = process.env.NODE_ENV === 'production'
const supabaseUrl = envValue('SUPABASE_URL')
const supabaseSecretKey = envValue('SUPABASE_SECRET_KEY')
const supabasePublishableKey = envValue('SUPABASE_PUBLISHABLE_KEY')
const appUrl = envValue('APP_URL', 'http://localhost:5173')
const requireSupabase = envValue('REQUIRE_SUPABASE', 'true') !== 'false'

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } }
const supabaseAdmin = supabaseUrl && supabaseSecretKey ? createClient(supabaseUrl, supabaseSecretKey, clientOptions) : null
const supabaseAuth = supabaseUrl && (supabasePublishableKey || supabaseSecretKey) ? createClient(supabaseUrl, supabasePublishableKey || supabaseSecretKey, clientOptions) : null

if (requireSupabase && (!supabaseAdmin || !supabaseAuth)) {
  throw new Error('Supabase Auth requires SUPABASE_URL, SUPABASE_SECRET_KEY, and SUPABASE_PUBLISHABLE_KEY')
}

const store = supabaseAdmin ? createSupabaseStore(supabaseAdmin) : createMemoryStore()
// STRIPE_SECRET_KEY should be a restricted key (rk_...) limited to Customers,
// Checkout Sessions, Customer portal, Subscriptions, Prices and Charges (read).
const stripe = createStripeClient(envValue('STRIPE_SECRET_KEY'))

const app = createApp({
  store,
  billing: createBilling({ stripe, store, appUrl, webhookSecret: envValue('STRIPE_WEBHOOK_SECRET') }),
  llm: createLlm({ appUrl }),
  fetcher: createSafeFetch(),
  // Search Console: a Google OAuth web client whose redirect URI is APP_URL + /api/gsc/callback.
  gsc: createGsc({ clientId: envValue('GOOGLE_CLIENT_ID'), clientSecret: envValue('GOOGLE_CLIENT_SECRET'), redirectUri: `${appUrl}/api/gsc/callback` }),
  // Refresh tokens are encrypted at rest with a key derived from this secret.
  tokenBox: createTokenBox(envValue('TOKEN_ENCRYPTION_KEY') || envValue('JWT_SECRET') || supabaseSecretKey),
  // SMTP for scheduled measurement reports (IONOS: smtp.ionos.de, port 587).
  mailer: createMailer({ host: envValue('SMTP_HOST'), port: envValue('SMTP_PORT', '587'), user: envValue('SMTP_USER'), pass: envValue('SMTP_PASS'), from: envValue('MAIL_FROM') }),
  vitals: createVitals({ apiKey: envValue('PAGESPEED_API_KEY') }),
  renderer: envValue('RENDER_DISABLED') === 'true' ? null : createRenderer(),
  supabaseAdmin,
  supabaseAuth,
  config: {
    isProduction,
    appUrl,
    adminEmails: envValue('ADMIN_EMAILS').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean),
    staticDir: isProduction && !process.env.VERCEL ? path.join(__dirname, 'dist') : null,
    // The daily cron authenticates with CRON_SECRET and continues unfinished runs by calling itself.
    cronSecret: envValue('CRON_SECRET'),
    selfUrl: appUrl,
    cronBudgetMs: process.env.VERCEL ? 220_000 : 45_000,
  },
})

if (!process.env.VERCEL) {
  const port = process.env.PORT || 8787
  app.listen(port, () => console.log(`GEO OPTIMIZER AI running on http://localhost:${port}`))
}

export default app
