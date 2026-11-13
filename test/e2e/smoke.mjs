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
