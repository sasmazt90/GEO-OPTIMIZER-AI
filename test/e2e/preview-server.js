// Serves the built frontend against in-memory fakes (no database, no model
// keys, no network) for UI smoke tests: node test/e2e/preview-server.js
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../../server/app.js'
import { createSafeFetch } from '../../server/net.js'
import { createMemoryStore } from '../../server/store.js'
import { fakeFetchImpl, fakeLlm } from '../helpers.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const store = createMemoryStore()
const user = { id: 'demo', email: 'demo@example.com', user_metadata: { name: 'Demo User' }, created_at: new Date().toISOString() }
store.state.profiles.set(user.id, { id: user.id, email: user.email, name: 'Demo User', plan: process.env.PREVIEW_PLAN || 'pro' })

const app = createApp({
  store,
  llm: fakeLlm(),
  fetcher: createSafeFetch({ fetchImpl: fakeFetchImpl() }),
  authenticate: async () => user,
  config: { rateLimit: false, isProduction: false, staticDir: path.join(root, 'dist'), batchSize: 6 },
})
const port = Number(process.env.PORT || 4179)
app.listen(port, '127.0.0.1', () => console.log(`preview on http://127.0.0.1:${port}`))
