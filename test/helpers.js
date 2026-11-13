import { createApp } from '../server/app.js'
import { createSafeFetch } from '../server/net.js'
import { createMemoryStore } from '../server/store.js'

export const SITE = {
  'https://acme.com/': { body: `<!doctype html><html lang="en"><head><title>Acme CRM for mid-market sales teams</title>
<meta name="description" content="Acme is a CRM for mid-market sales teams with pipeline forecasting, email sync and reporting built in.">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="https://acme.com/">
<meta property="og:title" content="Acme CRM"><meta property="og:description" content="CRM for mid-market teams"><meta property="og:image" content="https://acme.com/og.png">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Acme","url":"https://acme.com","sameAs":["https://www.linkedin.com/company/acme","https://en.wikipedia.org/wiki/Acme"]},{"@type":"SoftwareApplication","name":"Acme CRM","dateModified":"2026-10-01"},{"@type":"BreadcrumbList","itemListElement":[]}]}</script>
</head><body><nav><a href="/pricing">Pricing</a><a href="/features">Features</a><a href="/blog">Blog</a><a href="/about">About</a></nav><main>
<h1>CRM for mid-market sales teams</h1>
<p>Acme is a customer relationship management platform built for mid-market sales teams that need accurate forecasting, automatic email sync and clear pipeline reporting without enterprise complexity.</p>
<h2>What is Acme CRM?</h2><p>${'Acme helps teams track every deal from first contact to close. '.repeat(30)}</p>
<h2>How much does Acme cost?</h2><ul><li>Starter</li><li>Growth</li><li>Scale</li></ul>
<h2>Frequently asked questions</h2><p>${'Answers to common questions about setup and migration. '.repeat(20)}</p>
<img src="/a.png" alt="Pipeline view"></main></body></html>` },
  'https://acme.com/robots.txt': { body: 'User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: https://acme.com/sitemap.xml\n', type: 'text/plain' },
  'https://acme.com/sitemap.xml': { body: '<urlset><url><loc>https://acme.com/</loc></url><url><loc>https://acme.com/pricing</loc></url></urlset>', type: 'application/xml' },
  'https://acme.com/pricing': { body: '<html><head><title>Pricing</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>' },
  'https://blocked.com/': { body: '<html><head><title>Blocked</title><meta name="robots" content="noindex"></head><body><p>hi</p></body></html>' },
  'https://blocked.com/robots.txt': { body: 'User-agent: *\nDisallow: /\n', type: 'text/plain' },
}

export function fakeFetchImpl(site = SITE, log = []) {
  return async (url, init = {}) => {
    log.push({ url, ua: init.headers?.['User-Agent'] })
    const entry = site[url]
    if (!entry) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } })
    if (entry.redirect) return new Response(null, { status: 301, headers: { location: entry.redirect } })
    return new Response(entry.body, { status: entry.status || 200, headers: { 'content-type': entry.type || 'text/html; charset=utf-8' } })
  }
}

// Deterministic fake model: answers depend on surface and sample index.
export function fakeLlm({ canProbe = true, failSurface = null } = {}) {
  const calls = { probe: 0, chat: 0 }
  return {
    calls,
    available: () => true,
    canProbe: () => canProbe,
    surfaces: () => ['ChatGPT', 'Claude', 'Gemini', 'Perplexity'],
    async chatJson(system) {
      calls.chat += 1
      if (/prompt sets/.test(system)) return { prompts: Array.from({ length: 10 }, (_, index) => ({ text: `Best CRM question ${index + 1}?`, category: 'best-of' })) }
      if (/Extract the distinct brand/.test(system)) return { brands: ['Acme', 'Salesforce', 'HubSpot', 'Pipedrive', 'NotInAnyAnswer'] }
      return { title: 'Analysis', score: 55, summary: 'Narrative summary.', metrics: [], bullets: ['Do the thing'], sections: [{ title: 'Already done', items: ['Something'] }] }
    },
    async probe(surface, prompt) {
      calls.probe += 1
      if (surface === failSurface) throw new Error('Model request failed (500)')
      const n = calls.probe
      const mentionsAcme = surface === 'ChatGPT' || (surface === 'Perplexity' && n % 2 === 0)
      const answer = mentionsAcme
        ? `For "${prompt}", strong options are Salesforce, Acme's CRM and HubSpot.`
        : `For "${prompt}", most teams pick Salesforce or HubSpot; Pipedrive is a lighter option.`
      const citations = surface === 'Perplexity' ? ['https://www.g2.com/categories/crm', mentionsAcme ? 'https://acme.com/pricing' : 'https://www.salesforce.com/'] : []
      return { answer, citations, model: `fake/${surface.toLowerCase()}` }
    },
    async classifyPerception(brand, excerpts) {
      calls.chat += 1
      return excerpts.map((excerpt, index) => ({ i: index + 1, sentiment: index % 4 === 0 ? 'negative' : 'positive', attributes: index % 2 ? ['easy to set up'] : ['strong forecasting', 'expensive'] }))
    },
    async extractBrands() {
      calls.chat += 1
      return ['Acme', 'Salesforce', 'HubSpot', 'Pipedrive', 'NotInAnyAnswer']
    },
  }
}

export async function startApp({ llm = fakeLlm(), plan = 'free', site = SITE, config = {} } = {}) {
  const store = createMemoryStore()
  const user = { id: 'user-1', email: 'owner@example.com', user_metadata: { name: 'Owner' }, created_at: '2026-01-01T00:00:00Z' }
  store.state.profiles.set(user.id, { id: user.id, email: user.email, name: 'Owner', plan })
  const fetchLog = []
  const app = createApp({
    store,
    llm,
    fetcher: createSafeFetch({ fetchImpl: fakeFetchImpl(site, fetchLog) }),
    authenticate: async (req) => (req.headers['x-test-anon'] ? null : user),
    config: { rateLimit: false, isProduction: false, batchSize: 5, ...config },
  })
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const api = async (method, path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, body: await response.json().catch(() => ({})) }
  }
  return { store, user, api, base, llm, fetchLog, close: () => new Promise((resolve) => server.close(resolve)) }
}
