import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { createApp } from './server/app.js'
import { createBilling, createStripeClient } from './server/billing.js'
import { createLlm } from './server/llm.js'
import { createSafeFetch } from './server/net.js'
import { createMemoryStore, createSupabaseStore } from './server/store.js'

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
  supabaseAdmin,
  supabaseAuth,
  config: {
    isProduction,
    appUrl,
    adminEmails: envValue('ADMIN_EMAILS').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean),
    staticDir: isProduction && !process.env.VERCEL ? path.join(__dirname, 'dist') : null,
  },
})

if (!process.env.VERCEL) {
  const port = process.env.PORT || 8787
  app.listen(port, () => console.log(`GEO OPTIMIZER AI running on http://localhost:${port}`))
}

export default app
