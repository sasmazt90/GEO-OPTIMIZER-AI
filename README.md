# GEO Optimizer AI

SEO and generative engine optimization (GEO) platform. It measures how often AI assistants name a brand, audits technical SEO and AI crawler access, and tracks visibility over time.

## Modules

| Module | What it does | How the result is produced |
| --- | --- | --- |
| Visibility Tracking | Projects, tracked prompts, measurement runs, trend, share of voice, cited sources, citation gap, brand perception, per-prompt content briefs, pasted-answer check for surfaces without an API, CSV export | Every prompt is asked live on each selected model 1 to 5 times; mentions are counted in code. Rates carry a 95% Wilson interval. |
| AI Bot Traffic | Which AI and search crawlers visit the site, how often, which pages, error rates | Parsed in the browser from uploaded access logs (combined format or JSON lines, .gz supported); nothing is uploaded |
| Site Audit | 30+ checks: crawl access, indexability, on-page SEO, JSON-LD, content extractability, performance | Rule-based on the raw HTML, robots.txt and sitemap. Same page, same score. No model involved. |
| Crawler Access | robots.txt verdict and live HTTP status for 14 search and AI crawlers | robots.txt parsed per RFC 9309 plus a request per user-agent |
| AI Visibility Check | One prompt, three live answers per model | Counted |
| Benchmark | Brands named for a prompt across four models | Brand names are extracted from the answers, then counted against the answer text |
| Content Check | GEO review of a URL or pasted text | Rule-based score for URLs; model commentary grounded in the extracted page facts |
| Brand Entity, Query Intelligence, Prompt Research, Content and Landing Page Creator | Analysis and drafting | Model output (temperature 0), grounded in fetched page facts including JSON-LD |

Surfaces without a public API (Google AI Overviews, AI Mode, Copilot) are reported as not measurable. API answers can differ from the consumer apps.

## Platform

- Supabase Auth with HttpOnly cookies; all data access through the service role on the server, RLS enabled on every table
- Plans with monthly allowances (`server/plans.js`), metered per user; see [docs/PRICING.md](docs/PRICING.md)
- Stripe Checkout, customer portal and signed webhooks (`server/billing.js`); the webhook is the only thing that changes a plan
- SSRF protection for every user-supplied URL (`server/net.js`): scheme, port and literal-IP checks plus a guarded DNS lookup at connect time, re-validated on every redirect
- Measurement runs are processed in small batches (`POST /api/measurements/:id/step`) so they fit serverless time limits

## Development

```bash
npm install
cp .env.example .env   # fill in keys
npm run dev            # API on :8787, Vite on :5173
npm test               # unit and API tests (no network, no keys)
npm run test:e2e       # UI smoke test in headless Chromium against in-memory fakes
npm run lint
```

`node test/e2e/preview-server.js` serves the built app with a fake user, fake models and a fake website, which is useful for UI work without any keys.

## Deploying

1. Apply `supabase/migrations/*.sql` in order. `20261113000100_platform_v2.sql` is additive. Until it is applied, the existing tools keep working; tracking returns a "migration pending" message and usage is not metered.
2. Set the environment variables from `.env.example`.
3. Stripe: create one Product per paid plan with prices that have the lookup keys `geo_pro_monthly`, `geo_pro_yearly`, `geo_agency_monthly`, `geo_agency_yearly`. Add a webhook endpoint at `/api/stripe/webhook` for the events listed in `WEBHOOK_EVENTS` (`server/billing.js`) and store its signing secret as `STRIPE_WEBHOOK_SECRET`. Save the customer portal settings once in the Stripe Dashboard.
4. Deploy. `vercel.json` routes `/api/*` to the Express app and sets a 60 second function limit.

## Layout

```
server/      app.js (routes), audit.js, html.js, robots.js, net.js, measure.js, mentions.js, llm.js, billing.js, plans.js, store.js
src/         App.jsx (shell and analysis tools), modules/ (Tracking, SiteAudit, Plans)
supabase/    migrations
test/        unit.test.js, api.test.js, e2e/
```
