// UI smoke test against the preview server. Usage: node test/e2e/smoke.mjs [outDir]
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const out = process.argv[2] || 'test/e2e/shots'
mkdirSync(out, { recursive: true })
const port = 4179
const server = spawn('node', ['test/e2e/preview-server.js'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((resolve) => server.stdout.once('data', resolve))
const browser = await chromium.launch()
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
  await page.goto(`http://127.0.0.1:${port}/`)

  // Tracking: create a project, add prompts, measure.
  await page.getByPlaceholder('e.g. Bioderma').fill('Acme')
  await page.getByPlaceholder('example.com').fill('acme.com')
  await page.getByPlaceholder('e.g. La Roche-Posay, Avène').fill('Salesforce, HubSpot')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.getByRole('button', { name: 'Suggest 10 prompts' }).click()
  await page.getByText('Best CRM question 10?').waitFor()
  await page.getByRole('button', { name: 'Measure visibility' }).click()
  await page.getByText('Brands named in the answers').waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'Measure visibility' }).click()
  await page.locator('svg.trend').waitFor({ timeout: 30000 })
  await page.screenshot({ path: `${out}/tracking.png`, fullPage: true })

  await page.getByText('Citation gap: sources that back competitors but not you').waitFor()
  await page.getByText('How the answers describe Acme').waitFor()
  await page.getByRole('button', { name: 'Create content brief' }).first().click()
  await page.locator('.brief').first().waitFor()
  await page.getByPlaceholder('Paste the AI answer here').fill('For CRM, HubSpot and Salesforce lead the market; Acme is a newer option.')
  await page.getByRole('button', { name: 'Analyse answer' }).click()
  await page.getByText('Brands in order:').waitFor()
  await page.screenshot({ path: `${out}/tracking-insights.png`, fullPage: true })

  // Schedule: save a weekly run and send a test email.
  await page.locator('section.panel', { hasText: 'Measure this project automatically' }).locator('select').first().selectOption('weekly')
  await page.getByRole('button', { name: 'Save schedule' }).click()
  await page.getByText('Schedule saved.').waitFor()
  await page.getByRole('button', { name: 'Send test email' }).click()
  await page.getByText('Test email sent to demo@example.com.').waitFor()
  await page.locator('section.panel', { hasText: 'Measure this project automatically' }).screenshot({ path: `${out}/schedule.png` })

  // AI bot traffic from an access log.
  await page.getByRole('button', { name: 'AI Bot Traffic' }).first().click()
  const log = Array.from({ length: 40 }, (_, index) => `20.0.0.1 - - [${String(10 + (index % 3)).padStart(2, '0')}/Nov/2026:10:00:00 +0000] "GET /page-${index % 4} HTTP/1.1" ${index % 9 === 0 ? 403 : 200} 100 "-" "Mozilla/5.0; compatible; ${index % 2 ? 'GPTBot/1.1' : 'PerplexityBot/1.0'}"`).join('\n')
  await page.locator('input[type=file]').setInputFiles({ name: 'access.log', mimeType: 'text/plain', buffer: Buffer.from(log) })
  await page.getByText('Crawlers that visited').waitFor()
  await page.screenshot({ path: `${out}/bot-traffic.png`, fullPage: true })

  // Site audit.
  await page.getByRole('button', { name: 'Site Audit' }).first().click()
  await page.getByPlaceholder('https://example.com').fill('acme.com')
  await page.getByRole('button', { name: 'Run audit' }).click()
  await page.getByText('Crawler access').waitFor()
  await page.screenshot({ path: `${out}/audit.png`, fullPage: true })

  // Rendered audit and audit history.
  await page.getByRole('button', { name: 'Audit another page' }).click()
  await page.getByPlaceholder('https://example.com').fill('acme.com')
  await page.getByText('Also render the page with JavaScript').click()
  await page.getByRole('button', { name: 'Run audit' }).click()
  await page.getByText('Words after rendering').waitFor()
  await page.getByRole('button', { name: 'Compare audits' }).click()
  await page.getByText('Checks improved').waitFor()
  await page.screenshot({ path: `${out}/audit-rendered.png`, fullPage: true })

  // Search Console: performance, rank tracking, opportunities.
  await page.getByRole('button', { name: 'Search Console' }).first().click()
  await page.getByText('Top queries').waitFor()
  await page.screenshot({ path: `${out}/gsc-performance.png`, fullPage: true })
  await page.getByRole('button', { name: 'Rank tracking' }).click()
  await page.getByPlaceholder('Add keywords, separated by commas').fill('acme crm, never seen')
  await page.getByRole('button', { name: 'Track', exact: true }).click()
  await page.getByText('no impressions').waitFor()
  await page.getByText('Biggest gains').waitFor()
  await page.screenshot({ path: `${out}/gsc-rankings.png`, fullPage: true })
  await page.getByRole('button', { name: 'Keyword opportunities' }).click()
  await page.getByText('Striking distance: close to the top results').waitFor()
  await page.screenshot({ path: `${out}/gsc-opportunities.png`, fullPage: true })

  // Site crawl.
  await page.getByRole('button', { name: 'Site Crawl' }).first().click()
  await page.getByPlaceholder('https://example.com').fill('acme.com')
  await page.getByRole('button', { name: 'Start crawl' }).click()
  await page.getByText('Issues by number of pages').waitFor({ timeout: 30000 })
  await page.getByText('Broken and blocked URLs').waitFor()
  await page.screenshot({ path: `${out}/crawl.png`, fullPage: true })

  // Core Web Vitals.
  await page.getByRole('button', { name: 'Core Web Vitals' }).first().click()
  await page.getByPlaceholder('https://example.com').fill('acme.com')
  await page.getByRole('button', { name: 'Test page' }).click()
  await page.getByText('Core Web Vitals: Failed').waitFor()
  await page.screenshot({ path: `${out}/vitals.png`, fullPage: true })

  // Schema markup: validate a URL, then generate and validate.
  await page.getByRole('button', { name: 'Schema Markup' }).first().click()
  await page.getByPlaceholder('https://example.com/product').fill('acme.com')
  await page.locator('form').getByRole('button', { name: 'Validate', exact: true }).click()
  await page.getByText('SoftwareApplication: Acme CRM').waitFor()
  await page.screenshot({ path: `${out}/schema-validate.png`, fullPage: true })
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  await page.getByPlaceholder('Acme GmbH').fill('Acme')
  await page.locator('.split').getByRole('button', { name: 'Validate', exact: true }).click()
  await page.getByText('Recommended property "url" is missing.').waitFor()
  await page.screenshot({ path: `${out}/schema-generate.png`, fullPage: true })

  // Page comparison.
  await page.getByRole('button', { name: 'Page Comparison' }).first().click()
  await page.getByPlaceholder('https://example.com/your-page').fill('acme.com/pricing')
  await page.getByPlaceholder(/competitor-a\.com/).fill('acme.com')
  await page.getByRole('button', { name: 'Compare pages' }).click()
  await page.getByText('Where your page is behind').waitFor()
  await page.getByText('Side by side').waitFor()
  await page.screenshot({ path: `${out}/compare.png`, fullPage: true })

  // Benchmark.
  await page.getByRole('button', { name: 'Benchmark' }).first().click()
  await page.getByPlaceholder('Best CRM software for mid-market teams').fill('best crm')
  await page.getByRole('button', { name: 'Run Benchmark' }).click()
  await page.getByText('Brands named in live answers').waitFor()
  await page.screenshot({ path: `${out}/benchmark.png`, fullPage: true })

  // Plans.
  await page.getByRole('button', { name: 'Open profile settings' }).click()
  await page.getByText('Plan and usage').waitFor()
  await page.screenshot({ path: `${out}/plans.png`, fullPage: true })

  // Mobile layout.
  await page.setViewportSize({ width: 390, height: 800 })
  await page.screenshot({ path: `${out}/plans-mobile.png`, fullPage: false })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  if (overflow) errors.push('page scrolls horizontally at 390px')
} catch (error) {
  errors.push(error.message.split('\n')[0])
  await browser.contexts()[0]?.pages()[0]?.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {})
} finally {
  await browser.close()
  server.kill()
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log('smoke ok')
