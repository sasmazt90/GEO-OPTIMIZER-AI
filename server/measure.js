// AI visibility measurement: every tracked prompt is asked on every selected
// surface several times; results are counted, never estimated.
import { analyzeAnswer, wilson } from './mentions.js'

export const SURFACES = ['ChatGPT', 'Claude', 'Gemini', 'Perplexity']

export function buildTasks(prompts, surfaces, samples) {
  const tasks = []
  for (const prompt of prompts) {
    for (const surface of surfaces) {
      for (let index = 0; index < samples; index += 1) {
        tasks.push({ promptId: prompt.id, promptText: prompt.text, surface, sampleIndex: index })
      }
    }
  }
  return tasks
}

function groupBy(items, keyOf) {
  const map = new Map()
  for (const item of items) {
    const key = keyOf(item)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(item)
  }
  return map
}

// samples: rows with { status, surface, promptId, promptText, answer, citations }.
export function summarize(samples, project, discoveredNames = []) {
  const done = samples.filter((sample) => sample.status === 'done')
  const failed = samples.filter((sample) => sample.status === 'error').length
  const analyzed = done.map((sample) => ({
    sample,
    analysis: analyzeAnswer({
      answer: sample.answer,
      citations: sample.citations || [],
      brand: project.brand,
      aliases: project.aliases || [],
      domain: project.domain,
      competitors: project.competitors || [],
      extraNames: discoveredNames,
    }),
  }))

  const rateOf = (rows) => wilson(rows.filter((row) => row.analysis.brandMentioned).length, rows.length)
  const overall = rateOf(analyzed)

  const brandCounts = new Map()
  let totalMentions = 0
  for (const { analysis } of analyzed) {
    for (const mention of analysis.mentions) {
      const entry = brandCounts.get(mention.name) || { name: mention.name, own: mention.own, answers: 0, positionSum: 0 }
      entry.answers += 1
      entry.positionSum += mention.position
      brandCounts.set(mention.name, entry)
      totalMentions += 1
    }
  }
  const trackedNames = new Set((project.competitors || []).map((competitor) => competitor.name))
  const brands = [...brandCounts.values()]
    .map((entry) => ({
      name: entry.name,
      own: entry.own,
      tracked: entry.own || trackedNames.has(entry.name),
      answers: entry.answers,
      mentionRate: analyzed.length ? Math.round((entry.answers / analyzed.length) * 1000) / 10 : 0,
      shareOfVoice: totalMentions ? Math.round((entry.answers / totalMentions) * 1000) / 10 : 0,
      avgPosition: Math.round((entry.positionSum / entry.answers) * 10) / 10,
    }))
    .sort((a, b) => b.answers - a.answers || a.avgPosition - b.avgPosition)
    .map((entry, index) => ({ rank: index + 1, ...entry }))
  const own = brands.find((entry) => entry.own)

  const withCitations = analyzed.filter((row) => row.analysis.citedDomains.length > 0)
  const domainCounts = new Map()
  for (const { analysis } of withCitations) {
    for (const domain of analysis.citedDomains) domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1)
  }
  const citedDomains = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([domain, answers]) => ({ domain, answers, share: Math.round((answers / withCitations.length) * 1000) / 10 }))

  const bySurface = [...groupBy(analyzed, (row) => row.sample.surface).entries()].map(([surface, rows]) => ({
    surface, answers: rows.length, ...rateOf(rows), model: rows[0].sample.model || '', grounded: rows.some((row) => row.analysis.citations.length > 0),
  }))
  const byPrompt = [...groupBy(analyzed, (row) => row.sample.promptId).entries()].map(([promptId, rows]) => ({
    promptId,
    prompt: rows[0].sample.promptText,
    answers: rows.length,
    ...rateOf(rows),
    avgPosition: (() => {
      const positions = rows.map((row) => row.analysis.brandPosition).filter(Boolean)
      return positions.length ? Math.round((positions.reduce((sum, value) => sum + value, 0) / positions.length) * 10) / 10 : null
    })(),
    topBrands: [...groupBy(rows.flatMap((row) => row.analysis.mentions), (mention) => mention.name).entries()]
      .map(([name, list]) => ({ name, answers: list.length })).sort((a, b) => b.answers - a.answers).slice(0, 5),
  })).sort((a, b) => a.rate - b.rate)

  return {
    answers: analyzed.length,
    failed,
    visibility: overall,
    shareOfVoice: own?.shareOfVoice ?? 0,
    avgPosition: own?.avgPosition ?? null,
    citation: {
      answersWithSources: withCitations.length,
      ownCited: withCitations.filter((row) => row.analysis.ownCited).length,
      rate: withCitations.length ? Math.round((withCitations.filter((row) => row.analysis.ownCited).length / withCitations.length) * 1000) / 10 : null,
    },
    brands: brands.slice(0, 25),
    citedDomains,
    bySurface,
    byPrompt,
    method: 'Counts from live model answers. Rates are the share of answers that mention the brand, with a 95% Wilson interval.',
  }
}

// Processes one batch of pending samples for a measurement. Safe to call
// repeatedly from short-lived serverless invocations.
export async function processBatch({ store, llm, measurement, project, batchSize = 6 }) {
  const pending = await store.listPendingSamples(measurement.id, batchSize)
  await Promise.all(pending.map(async (sample) => {
    try {
      const probe = await llm.probe(sample.surface, sample.promptText, {
        country: project.country, language: project.language, grounded: Boolean(measurement.config?.grounded),
      })
      await store.updateSample(sample.id, { status: 'done', answer: probe.answer.slice(0, 8000), citations: probe.citations.slice(0, 30), model: probe.model })
    } catch (error) {
      await store.updateSample(sample.id, { status: 'error', error: String(error.message || error).slice(0, 300) })
    }
  }))

  const remaining = await store.countPendingSamples(measurement.id)
  if (remaining > 0) return { status: 'running', remaining }

  const samples = await store.listSamples(measurement.id)
  // If extraction fails, tracked brands are still counted exactly.
  const discovered = await llm.extractBrands(samples.filter((sample) => sample.status === 'done').map((sample) => sample.answer)).catch(() => [])
  const summary = summarize(samples, project, discovered)
  const status = summary.answers === 0 ? 'failed' : 'completed'
  await store.updateMeasurement(measurement.id, { status, summary, completedAt: new Date().toISOString() })
  return { status, remaining: 0, summary }
}
