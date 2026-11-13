// Google Search Console: OAuth connection, Search Analytics queries and the
// calculations behind performance, rank tracking and keyword opportunities.
// Every number shown to the user comes from the Search Console API; the
// functions below only join, filter and aggregate those rows.
import crypto from 'node:crypto'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const API_URL = 'https://www.googleapis.com/webmasters/v3'
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly openid email'
// Search Console data is final after roughly two days.
const DATA_LAG_DAYS = 2

export class GscError extends Error {
  constructor(message, status = 502, code = 'gsc_error') {
    super(message)
    this.name = 'GscError'
    this.status = status
    this.code = code
  }
}

// Encrypts refresh tokens at rest (AES-256-GCM, key derived from a server secret).
export function createTokenBox(secret) {
  if (!secret) return null
  const key = crypto.createHash('sha256').update(String(secret)).digest()
  return {
    seal(text) {
      const iv = crypto.randomBytes(12)
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()])
      return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')}`
    },
    open(sealed) {
      const raw = Buffer.from(String(sealed).replace(/^v1\./, ''), 'base64url')
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
      decipher.setAuthTag(raw.subarray(12, 28))
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
    },
  }
}

function emailFromIdToken(idToken) {
  try {
    return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')).email || ''
  } catch {
    return ''
  }
}

export function createGsc({ clientId = '', clientSecret = '', redirectUri = '', fetchImpl = fetch } = {}) {
  const enabled = Boolean(clientId && clientSecret && redirectUri)
  const accessCache = new Map()

  async function tokenRequest(params) {
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }).toString(),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      if (data.error === 'invalid_grant') throw new GscError('The Search Console connection has expired or was revoked. Connect again.', 401, 'reconnect')
      throw new GscError('Google did not accept the sign-in. Try connecting again.', 502, 'oauth_failed')
    }
    return data
  }

  async function accessToken(refreshToken) {
    const cacheKey = crypto.createHash('sha256').update(refreshToken).digest('hex')
    const cached = accessCache.get(cacheKey)
    if (cached && cached.expires > Date.now() + 30_000) return cached.token
    const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
    accessCache.set(cacheKey, { token: data.access_token, expires: Date.now() + (Number(data.expires_in) || 3000) * 1000 })
    return data.access_token
  }

  async function apiCall(refreshToken, path, init = {}) {
    const token = await accessToken(refreshToken)
    const response = await fetchImpl(`${API_URL}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers } })
    const data = await response.json().catch(() => ({}))
    if (response.status === 401) throw new GscError('The Search Console connection has expired or was revoked. Connect again.', 401, 'reconnect')
    if (response.status === 403) throw new GscError('This Google account has no access to that Search Console property.', 403, 'forbidden')
    if (response.status === 429) throw new GscError('Search Console rate limit reached. Try again in a minute.', 429, 'rate_limited')
    if (!response.ok) throw new GscError(data?.error?.message ? `Search Console: ${String(data.error.message).slice(0, 200)}` : 'Search Console request failed.', 502)
    return data
  }

  return {
    enabled,
    authUrl(state) {
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state })
      return `${AUTH_URL}?${params}`
    },
    async exchange(code) {
      const data = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
      if (!data.refresh_token) throw new GscError('Google did not return a long-lived token. Remove the app at myaccount.google.com/permissions and connect again.', 502, 'no_refresh_token')
      if (!/webmasters/.test(String(data.scope || ''))) throw new GscError('Search Console access was not granted. Tick the Search Console permission on the Google consent screen.', 400, 'scope_missing')
      return { refreshToken: data.refresh_token, email: emailFromIdToken(data.id_token) }
    },
    async sites(refreshToken) {
      const data = await apiCall(refreshToken, '/sites')
      return (data.siteEntry || [])
        .filter((entry) => entry.permissionLevel !== 'siteUnverifiedUser')
        .map((entry) => ({ siteUrl: entry.siteUrl, permission: entry.permissionLevel, type: entry.siteUrl.startsWith('sc-domain:') ? 'domain' : 'url-prefix' }))
        .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl))
    },
    async query(refreshToken, siteUrl, body) {
      const data = await apiCall(refreshToken, `/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, { method: 'POST', body: JSON.stringify(body) })
      return data.rows || []
    },
    async revoke(refreshToken) {
      await fetchImpl(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).catch(() => {})
    },
  }
}

// ---------- pure helpers ----------
const day = (date) => date.toISOString().slice(0, 10)
const shift = (date, days) => new Date(date.getTime() + days * 86_400_000)
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits

// The current window ends DATA_LAG_DAYS ago; the previous window is the same length directly before it.
export function dateRanges(days, now = new Date()) {
  const end = shift(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), -DATA_LAG_DAYS)
  const start = shift(end, -(days - 1))
  const previousEnd = shift(start, -1)
  return { current: { startDate: day(start), endDate: day(end) }, previous: { startDate: day(shift(previousEnd, -(days - 1))), endDate: day(previousEnd) } }
}

export function filterGroups({ country = '', device = '', queryRegex = '' } = {}) {
  const filters = []
  if (country) filters.push({ dimension: 'country', operator: 'equals', expression: country.toLowerCase() })
  if (device) filters.push({ dimension: 'device', operator: 'equals', expression: device.toUpperCase() })
  if (queryRegex) filters.push({ dimension: 'query', operator: 'includingRegex', expression: queryRegex })
  return filters.length ? [{ groupType: 'and', filters }] : undefined
}

const metric = (row) => ({ clicks: row?.clicks || 0, impressions: row?.impressions || 0, ctr: round((row?.ctr || 0) * 100, 2), position: row ? round(row.position || 0, 1) : null })

function joinPeriods(currentRows, previousRows, limit) {
  const previous = new Map(previousRows.map((row) => [row.keys[0], row]))
  const rows = currentRows.map((row) => {
    const before = previous.get(row.keys[0])
    const now = metric(row)
    return {
      key: row.keys[0], ...now,
      previousClicks: before ? before.clicks : null,
      previousPosition: before ? round(before.position, 1) : null,
      clicksChange: before ? now.clicks - before.clicks : null,
      // Positive = moved up (a smaller position number is better).
      positionChange: before ? round(before.position - row.position, 1) : null,
      isNew: !before,
    }
  })
  const seen = new Set(currentRows.map((row) => row.keys[0]))
  const lost = previousRows.filter((row) => !seen.has(row.keys[0])).map((row) => ({ key: row.keys[0], ...metric(row) }))
  return { rows: rows.slice(0, limit), lost: lost.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 50) }
}

export function buildPerformance({ ranges, totals, previousTotals, daily, queries, previousQueries, pages, previousPages }) {
  const current = metric(totals[0])
  const previous = metric(previousTotals[0])
  const joinedQueries = joinPeriods(queries, previousQueries, 1000)
  const joinedPages = joinPeriods(pages, previousPages, 250)
  const movers = joinedQueries.rows.filter((row) => row.positionChange !== null && row.impressions >= 10)
  return {
    ranges,
    totals: { current, previous, hasPrevious: previousTotals.length > 0 },
    daily: daily.map((row) => ({ date: row.keys[0], ...metric(row) })).sort((a, b) => a.date.localeCompare(b.date)),
    queries: joinedQueries.rows,
    pages: joinedPages.rows,
    rankings: {
      improved: [...movers].filter((row) => row.positionChange >= 1).sort((a, b) => b.positionChange - a.positionChange).slice(0, 25),
      declined: [...movers].filter((row) => row.positionChange <= -1).sort((a, b) => a.positionChange - b.positionChange).slice(0, 25),
      newQueries: joinedQueries.rows.filter((row) => row.isNew).slice(0, 25),
      lostQueries: joinedQueries.lost.slice(0, 25),
      distribution: [[1, 3], [4, 10], [11, 20], [21, 100]].map(([from, to]) => ({
        label: from === 21 ? '21+' : `${from}–${to}`,
        current: queries.filter((row) => Math.round(row.position) >= from && Math.round(row.position) <= to).length,
        previous: previousQueries.filter((row) => Math.round(row.position) >= from && Math.round(row.position) <= to).length,
      })),
    },
    method: `Google Search Console Search Analytics, ${ranges.current.startDate} to ${ranges.current.endDate}, compared with the ${ranges.previous.startDate} to ${ranges.previous.endDate} window. Position is the impression-weighted average Google reports. The most recent ${DATA_LAG_DAYS} days are excluded because the data is not final.`,
  }
}

const QUESTION = /^(what|how|why|when|where|who|which|whose|can|could|does|do|did|is|are|was|were|should|will|would|wie|was |warum|weshalb|wann|wo |wer|welche[rsmn]?|kann|ist|sind|soll|nasıl|neden|niçin|ne zaman|nerede|kim|hangi|ne |kaç|comment|pourquoi|quand|où|qui|quel(le)?s?|est-ce|qu[eé] |c[oó]mo|por qu[eé]|cu[aá]ndo|d[oó]nde|qui[eé]n|cu[aá]l|come|perch[eé]|quando|dove|chi|quale)\b/i
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

// rows: Search Analytics rows with dimensions [query, page].
export function buildOpportunities(rows) {
  const byQuery = new Map()
  for (const row of rows) {
    const [query, page] = row.keys
    const entry = byQuery.get(query) || { query, clicks: 0, impressions: 0, weighted: 0, pages: [] }
    entry.clicks += row.clicks
    entry.impressions += row.impressions
    entry.weighted += row.position * row.impressions
    entry.pages.push({ page, clicks: row.clicks, impressions: row.impressions, position: round(row.position, 1) })
    byQuery.set(query, entry)
  }
  const queries = [...byQuery.values()].map((entry) => {
    const pages = entry.pages.sort((a, b) => b.impressions - a.impressions)
    return { query: entry.query, clicks: entry.clicks, impressions: entry.impressions, ctr: entry.impressions ? round((entry.clicks / entry.impressions) * 100, 2) : 0, position: entry.impressions ? round(entry.weighted / entry.impressions, 1) : 0, page: pages[0]?.page || '', pages }
  })

  const striking = queries.filter((entry) => entry.position > 3 && entry.position <= 20 && entry.impressions >= 10)
    .sort((a, b) => b.impressions - a.impressions).slice(0, 50)
    .map(({ pages, ...entry }) => ({ ...entry, pageCount: pages.length }))

  // CTR benchmark = the median CTR of this site's own queries at the same rounded position.
  const buckets = new Map()
  for (const entry of queries) {
    const position = Math.round(entry.position)
    if (position < 1 || position > 10 || entry.impressions < 20) continue
    buckets.set(position, [...(buckets.get(position) || []), entry.ctr])
  }
  const benchmarks = new Map([...buckets].filter(([, values]) => values.length >= 5).map(([position, values]) => [position, round(median(values), 2)]))
  const lowCtr = queries.map((entry) => {
    const benchmark = benchmarks.get(Math.round(entry.position))
    if (!benchmark || entry.impressions < 50 || entry.ctr >= benchmark * 0.5) return null
    return { query: entry.query, page: entry.page, impressions: entry.impressions, clicks: entry.clicks, ctr: entry.ctr, position: entry.position, benchmarkCtr: benchmark, missedClicks: Math.round((entry.impressions * (benchmark - entry.ctr)) / 100) }
  }).filter(Boolean).sort((a, b) => b.missedClicks - a.missedClicks).slice(0, 50)

  const cannibalization = queries.filter((entry) => entry.impressions >= 20)
    .map((entry) => ({ query: entry.query, impressions: entry.impressions, clicks: entry.clicks, pages: entry.pages.filter((page) => page.impressions >= entry.impressions * 0.1).slice(0, 5) }))
    .filter((entry) => entry.pages.length >= 2)
    .sort((a, b) => b.impressions - a.impressions).slice(0, 40)

  const questions = queries.filter((entry) => QUESTION.test(entry.query) || /\?\s*$/.test(entry.query))
    .sort((a, b) => b.impressions - a.impressions).slice(0, 50)
    .map(({ pages, ...entry }) => ({ ...entry, pageCount: pages.length }))

  return {
    analysed: { queries: queries.length, rows: rows.length },
    striking,
    lowCtr,
    ctrBenchmarks: [...benchmarks].sort((a, b) => a[0] - b[0]).map(([position, ctr]) => ({ position, ctr })),
    cannibalization,
    questions,
    method: 'Calculated from Search Console query and page rows. Striking distance: average position 4 to 20 with at least 10 impressions. Low CTR: less than half of the median CTR of this site\'s own queries at the same position (positions with fewer than five comparable queries are skipped). Cannibalisation: two or more pages each holding at least 10% of a query\'s impressions. Nothing is estimated from third-party keyword databases.',
  }
}

const escapeRe2 = (value) => value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')

// Splits tracked queries into RE2 alternations that fit the API's 4096-character filter limit.
export function keywordRegexes(queries, maxLength = 3800) {
  const groups = []
  let current = []
  let length = 0
  for (const query of queries) {
    const escaped = escapeRe2(query.toLowerCase())
    if (current.length && length + escaped.length + 1 > maxLength) {
      groups.push(current)
      current = []
      length = 0
    }
    current.push(escaped)
    length += escaped.length + 1
  }
  if (current.length) groups.push(current)
  return groups.map((group) => `^(${group.join('|')})$`)
}

// rows: dimensions [date, query]. Returns one series per tracked query, including queries with no data.
export function buildKeywordTrends(keywords, rows, ranges) {
  const byQuery = new Map()
  for (const row of rows) {
    const [date, query] = row.keys
    byQuery.set(query, [...(byQuery.get(query) || []), { date, position: round(row.position, 1), clicks: row.clicks, impressions: row.impressions }])
  }
  return keywords.map((keyword) => {
    const series = (byQuery.get(keyword.query.toLowerCase()) || []).sort((a, b) => a.date.localeCompare(b.date))
    const impressions = series.reduce((sum, point) => sum + point.impressions, 0)
    const half = Math.floor(series.length / 2)
    const average = (points) => {
      const total = points.reduce((sum, point) => sum + point.impressions, 0)
      return total ? round(points.reduce((sum, point) => sum + point.position * point.impressions, 0) / total, 1) : null
    }
    const first = series.length >= 4 ? average(series.slice(0, half)) : null
    const last = series.length >= 4 ? average(series.slice(half)) : null
    return {
      id: keyword.id, query: keyword.query, series,
      clicks: series.reduce((sum, point) => sum + point.clicks, 0), impressions,
      position: average(series),
      best: series.length ? Math.min(...series.map((point) => point.position)) : null,
      change: first !== null && last !== null ? round(first - last, 1) : null,
      daysWithData: series.length,
    }
  }).map((entry) => ({ ...entry, range: ranges.current }))
}
