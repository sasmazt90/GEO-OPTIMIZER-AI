# Pricing and unit economics

Plans and allowances live in `server/plans.js`. The test `unit economics: every paid plan stays profitable at 100% usage` fails if a change pushes a paid plan below a 40% worst-case margin.

## Unit costs (planning values, USD)

| Unit | Planning cost | Basis |
| --- | --- | --- |
| Live answer credit (one model answer) | $0.008 | About 120 input and up to 700 output tokens. List prices per 1M tokens (Nov 2026): GPT-4o mini $0.15 / $0.60, Claude Haiku 4.5 $1 / $5, Gemini 2.5 Flash $0.30 / $2.50, Perplexity Sonar $1 / $1 plus a per-request search fee. Worst single answer is about $0.004 to $0.008; the planning value also covers the brand-extraction call. |
| Web-grounded answer | $0.032 (charged as 4 credits) | Adds live web search, billed per request by the search provider. |
| Analysis (structured model call) | $0.003 | About 6,000 input and 1,000 output tokens on GPT-4o mini is $0.0015; doubled for headroom. |
| Site audit / crawler check | $0 | Rule-based; compute only. |
| Site crawl page, schema check, page comparison | $0 | Rule-based; compute only. Crawled pages have their own monthly allowance. |
| Core Web Vitals test | $0 | Google PageSpeed Insights API (free quota). Uses one audit credit per device. |
| Search Console reports | $0 | Google Search Console API (free quota). Not metered. |
| JavaScript-rendered audit | $0 model cost | Headless Chromium on the function; several seconds of compute, so it uses two audit credits. |

Costs are in USD and prices in EUR. The margin test treats 1 USD as 1 EUR, which understates the margin.

## Plans

| | Free | Pro | Agency |
| --- | --- | --- | --- |
| Price per month | €0 | €49 | €149 |
| Price per year | €0 | €490 | €1,490 |
| Live answer credits / month | 60 | 2,500 | 7,000 |
| Analyses / month | 30 | 500 | 2,000 |
| Audits / month | 20 | 500 | 3,000 |
| Projects | 1 | 10 | 50 |
| Prompts per project | 10 | 50 | 200 |
| Pages per site crawl | 25 | 500 | 2,000 |
| Crawled pages / month | 100 | 5,000 | 20,000 |
| Tracked keywords (Search Console) | 10 | 100 | 500 |

## Margin if a subscriber uses 100% of the allowance

Payment fees are modelled at 3.5% + €0.25, above the standard European card rate.

| Plan | Revenue / month | Model cost (max) | Payment fees | Net | Margin |
| --- | --- | --- | --- | --- | --- |
| Free | €0 | $0.57 | €0 | −$0.57 | acquisition cost |
| Pro monthly | €49.00 | $21.50 | €1.97 | €25.53 | 52% |
| Pro yearly | €40.83 | $21.50 | €1.68 | €17.65 | 43% |
| Agency monthly | €149.00 | $62.00 | €5.47 | €81.53 | 55% |
| Agency yearly | €124.17 | $62.00 | €4.60 | €57.57 | 46% |

Typical SaaS usage is well below the allowance; at 40% utilisation the Pro monthly margin is about 78%.

## Fixed costs to cover

Hosting and database are not per-user costs: roughly $20 per month for a commercial Vercel plan and $25 per month for a paid Supabase project, plus the domain. Two Pro subscribers at full usage cover them.

## Guard rails

- Scheduled measurements use the same answer credits as manual runs and are skipped once the allowance is used up. The Free plan can schedule weekly runs only.
- Allowances are monthly, not daily, so the worst case per subscriber is bounded.
- Web-grounded answers consume 4 credits.
- A free account can cost at most about $0.57 per month.
- `ADMIN_EMAILS` accounts get the Agency allowance without billing.
- To cap spend further, set `PROBE_MODEL_<SURFACE>` to cheaper models and set a monthly limit on the OpenRouter key.

## VAT

Checkout does not calculate tax: the Stripe account has no active tax registration. Before selling to consumers or businesses in the EU, register for VAT (or confirm an exemption with a tax advisor), add the registration in Stripe Tax, then enable `automatic_tax` in `server/billing.js`.
