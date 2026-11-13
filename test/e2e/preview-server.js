// Serves the built frontend against in-memory fakes (no database, no model
// keys, no network) for UI smoke tests: node test/e2e/preview-server.js
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../../server/app.js'
import { createSafeFetch } from '../../server/net.js'
import { createMemoryStore } from '../../server/store.js'
import { createGsc, createTokenBox } from '../../server/gsc.js'
import { createVitals } from '../../server/vitals.js'
import { PSI_SAMPLE, fakeFetchImpl, fakeGoogle, fakeLlm } from '../helpers.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const store = createMemoryStore()
const user = { id: 'demo', email: 'demo@example.com', user_metadata: { name: 'Demo User' }, created_at: new Date().toISOString() }
store.state.profiles.set(user.id, { id: user.id, email: user.email, name: 'Demo User', plan: process.env.PREVIEW_PLAN || 'pro' })

const tokenBox = createTokenBox('preview-secret')
// The preview user starts with a Search Console connection so the connected views can be tested.
await store.saveGscConnection(user.id, { email: 'demo@gmail.example', refreshToken: tokenBox.seal('rt-1') })

const app = createApp({
  store,
  llm: fakeLlm(),
  fetcher: createSafeFetch({ fetchImpl: fakeFetchImpl() }),
  authenticate: async () => user,
  gsc: createGsc({ clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost/api/gsc/callback', fetchImpl: fakeGoogle().fetchImpl }),
  tokenBox,
  vitals: createVitals({ fetchImpl: async () => new Response(JSON.stringify(PSI_SAMPLE)) }),
  renderer: { render: async (url) => ({ ok: true, url, status: 200, ms: 640, requests: 9, failedRequests: [], consoleErrors: [], blockedRequests: 0, html: '<html lang="en"><head><title>Acme CRM for mid-market sales teams</title></head><body><main><h1>CRM for mid-market sales teams</h1><p>' + 'rendered text '.repeat(700) + '</p><a href="/pricing">Pricing</a></main></body></html>' }) },
  config: { rateLimit: false, isProduction: false, staticDir: path.join(root, 'dist'), batchSize: 6 },
})
const port = Number(process.env.PORT || 4179)
app.listen(port, '127.0.0.1', () => console.log(`preview on http://127.0.0.1:${port}`))
