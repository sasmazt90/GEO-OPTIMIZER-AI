// Model access: structured analysis calls and live answer probes.
const OPENROUTER = 'https://openrouter.ai/api/v1'

const surfaceCandidates = {
  ChatGPT: ['openai/gpt-chat-latest', '~openai/gpt-mini-latest', 'openai/gpt-5.4-mini', 'openai/gpt-5.1', 'openai/gpt-4o-mini'],
  Claude: ['~anthropic/claude-haiku-latest', 'anthropic/claude-haiku-4.5', '~anthropic/claude-sonnet-latest', 'anthropic/claude-3-haiku'],
  Gemini: ['~google/gemini-flash-latest', 'google/gemini-2.5-flash', 'google/gemini-3.5-flash', 'google/gemini-2.5-flash-lite'],
  Perplexity: ['perplexity/sonar', 'perplexity/sonar-pro'],
}

export const PROBE_SURFACES = Object.keys(surfaceCandidates)

function parseJson(content) {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1))
    throw new Error('Model returned invalid JSON')
  }
}

export function collectCitations(data) {
  const message = data?.choices?.[0]?.message || {}
  const urls = []
  for (const annotation of message.annotations || []) {
    const url = annotation?.url_citation?.url || annotation?.url
    if (url) urls.push(url)
  }
  for (const entry of data?.citations || []) urls.push(typeof entry === 'string' ? entry : entry?.url)
  for (const entry of data?.search_results || []) urls.push(entry?.url)
  return [...new Set(urls.filter(Boolean).map(String))]
}

export function createLlm({ env = process.env, fetchImpl = fetch, appUrl = '' } = {}) {
  const value = (key, fallback = '') => String(env[key] || fallback).trim()
  const openRouterKey = () => value('OPENROUTER_API_KEY')
  const openAiKey = () => value('OPENAI_API_KEY')
  let modelCache = null
  let modelCacheAt = 0

  async function post(url, key, body, timeoutMs = 45000) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': appUrl, 'X-Title': 'GEO OPTIMIZER AI' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`Model request failed (${response.status})`)
      return await response.json()
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Model request timed out', { cause: error })
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async function chatJson(system, user, { maxTokens } = {}) {
    const messages = [{ role: 'system', content: system }, { role: 'user', content: user }]
    const base = { temperature: 0, seed: 7, response_format: { type: 'json_object' }, messages, ...(maxTokens ? { max_tokens: maxTokens } : {}) }
    if (openRouterKey()) {
      const data = await post(`${OPENROUTER}/chat/completions`, openRouterKey(), { model: value('OPENROUTER_MODEL', 'openai/gpt-4o-mini'), ...base })
      return parseJson(data.choices?.[0]?.message?.content)
    }
    if (openAiKey()) {
      const data = await post('https://api.openai.com/v1/chat/completions', openAiKey(), { model: value('OPENAI_MODEL', 'gpt-4o-mini'), ...base })
      return parseJson(data.choices?.[0]?.message?.content)
    }
    return null
  }

  async function modelIds() {
    const now = Date.now()
    if (modelCache && now - modelCacheAt < 60 * 60 * 1000) return modelCache
    try {
      const response = await fetchImpl(`${OPENROUTER}/models`, { headers: { Authorization: `Bearer ${openRouterKey()}` } })
      if (!response.ok) return []
      const data = await response.json()
      modelCache = (data.data || []).map((model) => model.id)
      modelCacheAt = now
      return modelCache
    } catch {
      return []
    }
  }

  async function resolveModel(surface) {
    const override = value(`PROBE_MODEL_${surface.toUpperCase()}`)
    if (override) return override
    const candidates = surfaceCandidates[surface]
    if (!candidates) return ''
    const ids = await modelIds()
    if (ids.length) return candidates.find((candidate) => ids.includes(candidate)) || ''
    return candidates.find((candidate) => !candidate.startsWith('~')) || ''
  }

  return {
    available: () => Boolean(openRouterKey() || openAiKey()),
    canProbe: () => Boolean(openRouterKey()),
    surfaces: () => PROBE_SURFACES,
    chatJson,

    // Asks the question the way a user would and returns the raw answer.
    // grounded=true turns on live web search so answers carry source URLs
    // (Perplexity is always grounded).
    async probe(surface, prompt, { country = 'Worldwide', language = 'English', grounded = false } = {}) {
      if (!openRouterKey()) throw new Error('Live model probes are not configured')
      const model = await resolveModel(surface)
      if (!model) throw new Error(`No model available for ${surface}`)
      const useWeb = grounded && surface !== 'Perplexity'
      const data = await post(`${OPENROUTER}/chat/completions`, openRouterKey(), {
        model,
        temperature: 0.7,
        max_tokens: 700,
        ...(useWeb ? { plugins: [{ id: 'web', max_results: 5 }] } : {}),
        messages: [
          { role: 'system', content: `You are answering a user located in ${country}. Reply in ${language}. Answer the question directly and name specific brands, products or providers where relevant.` },
          { role: 'user', content: String(prompt) },
        ],
      }, 40000)
      const answer = String(data.choices?.[0]?.message?.content || '').trim()
      if (!answer) throw new Error('Empty model answer')
      return { answer, citations: collectCitations(data), model }
    },

    // Proposes brand/company names that appear in the answers. The names are
    // only candidates: counting is done in code against the answer text.
    async extractBrands(answers) {
      const corpus = answers.filter(Boolean).slice(0, 80).map((answer, index) => `[${index + 1}] ${String(answer).slice(0, 1400)}`).join('\n\n').slice(0, 60000)
      if (!corpus) return []
      const result = await chatJson(
        'Extract the distinct brand, company, product or organization names that are explicitly named in the numbered answers. Use the exact spelling from the text. Do not add names that are not present. Return strict JSON: {"brands": ["Name", ...]} with at most 40 names.',
        corpus,
        { maxTokens: 900 },
      )
      const names = Array.isArray(result?.brands) ? result.brands : []
      return [...new Set(names.map((name) => String(name).trim()).filter((name) => name.length >= 2 && name.length <= 60))].slice(0, 40)
    },
  }
}
