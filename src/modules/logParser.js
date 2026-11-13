// Finds AI and search crawler requests in web server access logs.
// Works on Apache/nginx combined format and on any line-based log that
// contains the user-agent, a timestamp and the request path (incl. JSON lines).

export const LOG_BOTS = [
  { name: 'OAI-SearchBot', operator: 'OpenAI', purpose: 'Search index', pattern: /OAI-SearchBot/i },
  { name: 'ChatGPT-User', operator: 'OpenAI', purpose: 'Live answer fetch', pattern: /ChatGPT-User/i },
  { name: 'GPTBot', operator: 'OpenAI', purpose: 'Model training', pattern: /GPTBot/i },
  { name: 'PerplexityBot', operator: 'Perplexity', purpose: 'Search index', pattern: /PerplexityBot/i },
  { name: 'Perplexity-User', operator: 'Perplexity', purpose: 'Live answer fetch', pattern: /Perplexity-User/i },
  { name: 'Claude-SearchBot', operator: 'Anthropic', purpose: 'Search index', pattern: /Claude-SearchBot/i },
  { name: 'Claude-User', operator: 'Anthropic', purpose: 'Live answer fetch', pattern: /Claude-User/i },
  { name: 'ClaudeBot', operator: 'Anthropic', purpose: 'Model training', pattern: /ClaudeBot|anthropic-ai/i },
  { name: 'Google-Extended', operator: 'Google', purpose: 'Model training', pattern: /Google-Extended/i },
  { name: 'GoogleOther', operator: 'Google', purpose: 'Research crawl', pattern: /GoogleOther/i },
  { name: 'Googlebot', operator: 'Google', purpose: 'Search index', pattern: /Googlebot/i },
  { name: 'Bingbot', operator: 'Microsoft', purpose: 'Search index', pattern: /bingbot/i },
  { name: 'Applebot', operator: 'Apple', purpose: 'Search and training', pattern: /Applebot/i },
  { name: 'Meta-ExternalAgent', operator: 'Meta', purpose: 'Model training', pattern: /meta-externalagent|meta-externalfetcher/i },
  { name: 'Bytespider', operator: 'ByteDance', purpose: 'Model training', pattern: /Bytespider/i },
  { name: 'Amazonbot', operator: 'Amazon', purpose: 'Search and training', pattern: /Amazonbot/i },
  { name: 'CCBot', operator: 'Common Crawl', purpose: 'Model training', pattern: /CCBot/i },
  { name: 'DuckAssistBot', operator: 'DuckDuckGo', purpose: 'Live answer fetch', pattern: /DuckAssistBot/i },
  { name: 'MistralAI-User', operator: 'Mistral', purpose: 'Live answer fetch', pattern: /MistralAI-User/i },
  { name: 'cohere-ai', operator: 'Cohere', purpose: 'Model training', pattern: /cohere-ai|cohere-training/i },
]

const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }
const ANY_BOT = new RegExp(LOG_BOTS.map((bot) => bot.pattern.source).join('|'), 'i')

function dayOf(line) {
  const clf = /\[(\d{2})\/([A-Za-z]{3})\/(\d{4})[:\s]/.exec(line)
  if (clf && MONTHS[clf[2].toLowerCase()]) return `${clf[3]}-${MONTHS[clf[2].toLowerCase()]}-${clf[1]}`
  const iso = /(\d{4})-(\d{2})-(\d{2})[T\s]\d{2}:\d{2}/.exec(line)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : ''
}

function requestOf(line) {
  const clf = /"(?:GET|POST|HEAD|PUT|DELETE|OPTIONS|PATCH) ([^\s"]+)[^"]*" (\d{3})/.exec(line)
  if (clf) return { path: clf[1], status: clf[2] }
  const path = /"(?:path|uri|url|request_uri|requestPath|ClientRequestURI|ClientRequestPath)"\s*:\s*"([^"]+)"/i.exec(line)
  const status = /"(?:status|statusCode|response_code|EdgeResponseStatus|sc-status)"\s*:\s*"?(\d{3})/i.exec(line)
  return { path: path ? path[1] : '', status: status ? status[1] : '' }
}

export function createLogStats() {
  return { lines: 0, botHits: 0, days: new Set(), bots: new Map() }
}

export function addLogLine(stats, line) {
  if (!line) return
  stats.lines += 1
  if (!ANY_BOT.test(line)) return
  const bot = LOG_BOTS.find((entry) => entry.pattern.test(line))
  const day = dayOf(line)
  const { path, status } = requestOf(line)
  stats.botHits += 1
  if (day) stats.days.add(day)
  let entry = stats.bots.get(bot.name)
  if (!entry) {
    entry = { name: bot.name, operator: bot.operator, purpose: bot.purpose, hits: 0, first: '', last: '', statuses: new Map(), paths: new Map(), days: new Map() }
    stats.bots.set(bot.name, entry)
  }
  entry.hits += 1
  if (day) {
    if (!entry.first || day < entry.first) entry.first = day
    if (!entry.last || day > entry.last) entry.last = day
    entry.days.set(day, (entry.days.get(day) || 0) + 1)
  }
  if (status) entry.statuses.set(status, (entry.statuses.get(status) || 0) + 1)
  if (path && entry.paths.size < 5000) {
    const clean = path.split('?')[0].slice(0, 200)
    entry.paths.set(clean, (entry.paths.get(clean) || 0) + 1)
  }
}

export function finishLogStats(stats) {
  const days = [...stats.days].sort()
  const bots = [...stats.bots.values()].sort((a, b) => b.hits - a.hits).map((entry) => {
    const errors = [...entry.statuses.entries()].filter(([code]) => code >= '400').reduce((sum, [, count]) => sum + count, 0)
    return {
      name: entry.name, operator: entry.operator, purpose: entry.purpose, hits: entry.hits, first: entry.first, last: entry.last,
      errorRate: entry.hits ? Math.round((errors / entry.hits) * 1000) / 10 : 0,
      statuses: [...entry.statuses.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count })),
      topPaths: [...entry.paths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([path, count]) => ({ path, count })),
      daily: days.map((day) => entry.days.get(day) || 0),
    }
  })
  const seen = new Set(bots.map((bot) => bot.name))
  return {
    lines: stats.lines,
    botHits: stats.botHits,
    from: days[0] || '',
    to: days.at(-1) || '',
    days,
    bots,
    missing: LOG_BOTS.filter((bot) => !seen.has(bot.name)).map((bot) => ({ name: bot.name, operator: bot.operator, purpose: bot.purpose })),
  }
}

export function parseLogText(text) {
  const stats = createLogStats()
  for (const line of String(text).split(/\r?\n/)) addLogLine(stats, line)
  return finishLogStats(stats)
}
