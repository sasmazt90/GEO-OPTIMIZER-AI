// robots.txt parsing and evaluation (RFC 9309: most specific user-agent group,
// longest matching rule wins, Allow wins a tie).

export const AI_BOTS = [
  { name: 'OAI-SearchBot', operator: 'OpenAI', purpose: 'search', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot' },
  { name: 'ChatGPT-User', operator: 'OpenAI', purpose: 'user', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot' },
  { name: 'GPTBot', operator: 'OpenAI', purpose: 'training', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot' },
  { name: 'PerplexityBot', operator: 'Perplexity', purpose: 'search', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot' },
  { name: 'Perplexity-User', operator: 'Perplexity', purpose: 'user', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user' },
  { name: 'Claude-SearchBot', operator: 'Anthropic', purpose: 'search', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Claude-SearchBot/1.0; +https://www.anthropic.com' },
  { name: 'Claude-User', operator: 'Anthropic', purpose: 'user', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Claude-User/1.0; +https://www.anthropic.com' },
  { name: 'ClaudeBot', operator: 'Anthropic', purpose: 'training', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +claudebot@anthropic.com' },
  { name: 'Googlebot', operator: 'Google', purpose: 'search', ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
  { name: 'Google-Extended', operator: 'Google', purpose: 'training', ua: null },
  { name: 'Bingbot', operator: 'Microsoft', purpose: 'search', ua: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)' },
  { name: 'Applebot-Extended', operator: 'Apple', purpose: 'training', ua: null },
  { name: 'CCBot', operator: 'Common Crawl', purpose: 'training', ua: 'CCBot/2.0 (https://commoncrawl.org/faq/)' },
  { name: 'meta-externalagent', operator: 'Meta', purpose: 'training', ua: 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)' },
]

export function parseRobots(text) {
  const groups = []
  const sitemaps = []
  let current = null
  let lastWasAgent = false
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (field === 'sitemap') {
      if (value) sitemaps.push(value)
    } else if ((field === 'allow' || field === 'disallow') && current) {
      current.rules.push({ type: field, path: value })
    }
  }
  return { groups, sitemaps }
}

function patternToRegex(pattern) {
  const anchored = pattern.endsWith('$')
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}${anchored ? '$' : ''}`)
}

function selectGroups(robots, botName) {
  const token = botName.toLowerCase()
  const specific = robots.groups.filter((group) => group.agents.some((agent) => agent !== '*' && (agent === token || token.includes(agent))))
  if (specific.length) return { groups: specific, matched: 'specific' }
  const wildcard = robots.groups.filter((group) => group.agents.includes('*'))
  return { groups: wildcard, matched: wildcard.length ? 'wildcard' : 'none' }
}

// Returns { allowed, matched: 'specific' | 'wildcard' | 'none', rule }.
export function evaluateRobots(robots, botName, path = '/') {
  const { groups, matched } = selectGroups(robots, botName)
  let best = null
  for (const group of groups) {
    for (const rule of group.rules) {
      if (!rule.path) continue // empty Disallow means allow everything
      if (!patternToRegex(rule.path).test(path)) continue
      const length = rule.path.length
      if (!best || length > best.length || (length === best.length && rule.type === 'allow')) {
        best = { ...rule, length }
      }
    }
  }
  return { allowed: !best || best.type === 'allow', matched, rule: best ? `${best.type}: ${best.path}` : null }
}
