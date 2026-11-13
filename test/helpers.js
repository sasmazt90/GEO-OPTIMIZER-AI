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

export async function startApp({ llm = fakeLlm(), plan = 'free', site = SITE, config = {}, extras = {} } = {}) {
  const store = createMemoryStore()
  const user = { id: 'user-1', email: 'owner@example.com', user_metadata: { name: 'Owner' }, created_at: '2026-01-01T00:00:00Z' }
  store.state.profiles.set(user.id, { id: user.id, email: user.email, name: 'Owner', plan })
  const fetchLog = []
  const app = createApp({
    store,
    llm,
    fetcher: createSafeFetch({ fetchImpl: fakeFetchImpl(site, fetchLog) }),
    authenticate: async (req) => (req.headers['x-test-anon'] ? null : user),
    ...extras,
    config: { rateLimit: false, isProduction: false, batchSize: 5, ...config },
  })
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const api = async (method, path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, headers: response.headers, body: await response.json().catch(() => ({})) }
  }
  return { store, user, api, base, llm, fetchLog, close: () => new Promise((resolve) => server.close(resolve)) }
}

// Fake Google OAuth + Search Console API for createGsc({ fetchImpl }).
export function fakeGoogle({ revoked = false } = {}) {
  const calls = []
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const idToken = `x.${Buffer.from(JSON.stringify({ email: 'owner@gmail.example' })).toString('base64url')}.y`
  const row = (keys, clicks, impressions, position) => ({ keys, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position })
  const fetchImpl = async (url, init = {}) => {
    const body = typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body || ''))
    calls.push({ url, body, auth: init.headers?.Authorization })
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      if (body.grant_type === 'authorization_code') return body.code === 'good-code' ? json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 'https://www.googleapis.com/auth/webmasters.readonly openid email', id_token: idToken }) : json({ error: 'invalid_grant' }, 400)
      return revoked ? json({ error: 'invalid_grant' }, 400) : json({ access_token: 'at-2', expires_in: 3600 })
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) return json({})
    if (url.endsWith('/webmasters/v3/sites')) return json({ siteEntry: [{ siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteOwner' }, { siteUrl: 'https://other.com/', permissionLevel: 'siteUnverifiedUser' }] })
    if (url.includes('/searchAnalytics/query')) {
      const previous = body.startDate < '2026-10-01' || body.previousMarker
      const dims = (body.dimensions || []).join(',')
      if (dims === '') return json({ rows: [row([], previous ? 80 : 120, previous ? 4000 : 5000, previous ? 14 : 11.5)] })
      if (dims === 'date') return json({ rows: [row([body.endDate], 10, 400, 11), row([body.startDate], 6, 300, 12.4)] })
      if (dims === 'query') {
        return json({ rows: previous
          ? [row(['acme crm'], 50, 600, 2.1), row(['crm for sales teams'], 10, 900, 12.4), row(['old query'], 5, 100, 8)]
          : [row(['acme crm'], 60, 700, 1.4), row(['crm for sales teams'], 20, 1200, 7.2), row(['what is a crm'], 4, 800, 15)] })
      }
      if (dims === 'page') return json({ rows: [row(['https://acme.com/'], 90, 3000, 6), row(['https://acme.com/pricing'], 30, 2000, 9)] })
      if (dims === 'query,page') {
        const filler = Array.from({ length: 6 }, (_, index) => row([`filler ${index}`, 'https://acme.com/'], 12, 100, 5))
        return json({ rows: [
          row(['acme crm', 'https://acme.com/'], 60, 700, 1.4),
          row(['crm for sales teams', 'https://acme.com/'], 12, 800, 6.8), row(['crm for sales teams', 'https://acme.com/pricing'], 8, 400, 8),
          row(['what is a crm', 'https://acme.com/blog'], 4, 800, 15),
          row(['crm pricing', 'https://acme.com/pricing'], 1, 500, 5.2),
          ...filler,
        ] })
      }
      if (dims === 'date,query') return json({ rows: ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((date, index) => row([date, 'acme crm'], 5, 50, 4 - index)) })
    }
    return json({ error: { message: 'unexpected' } }, 500)
  }
  return { fetchImpl, calls }
}

export const PSI_SAMPLE = {
  id: 'https://acme.com/',
  analysisUTCTimestamp: '2026-11-13T10:00:00.000Z',
  loadingExperience: { metrics: {
    LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2300, category: 'FAST', distributions: [{ proportion: 0.8 }, { proportion: 0.15 }, { proportion: 0.05 }] },
    INTERACTION_TO_NEXT_PAINT: { percentile: 260, category: 'AVERAGE', distributions: [{ proportion: 0.6 }, { proportion: 0.3 }, { proportion: 0.1 }] },
    CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 4, category: 'FAST', distributions: [{ proportion: 0.9 }, { proportion: 0.07 }, { proportion: 0.03 }] },
  } },
  originLoadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2000 }, INTERACTION_TO_NEXT_PAINT: { percentile: 150 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 } } },
  lighthouseResult: {
    finalDisplayedUrl: 'https://acme.com/', lighthouseVersion: '13.0.0',
    categories: { performance: { score: 0.72 } },
    audits: {
      'largest-contentful-paint': { id: 'largest-contentful-paint', numericValue: 3100.4, score: 0.6 },
      'first-contentful-paint': { id: 'first-contentful-paint', numericValue: 1500, score: 0.9 },
      'cumulative-layout-shift': { id: 'cumulative-layout-shift', numericValue: 0.02, score: 1 },
      'total-blocking-time': { id: 'total-blocking-time', numericValue: 340, score: 0.7 },
      'speed-index': { id: 'speed-index', numericValue: 4200, score: 0.7 },
      'render-blocking-resources': { id: 'render-blocking-resources', title: 'Eliminate render-blocking resources', score: 0.4, displayValue: 'Est savings of 620 ms', details: { type: 'opportunity', overallSavingsMs: 620 } },
      'unused-javascript': { id: 'unused-javascript', title: 'Reduce unused JavaScript', score: 0.5, metricSavings: { LCP: 300, FCP: 0 }, details: { overallSavingsBytes: 180000 } },
      'uses-http2': { id: 'uses-http2', title: 'Use HTTP/2', score: 1, details: { overallSavingsMs: 0 } },
    },
  },
}
