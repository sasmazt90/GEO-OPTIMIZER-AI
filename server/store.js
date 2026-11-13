// Persistence. The Supabase store is used in production; the memory store
// backs tests and local runs without a database.
import { nanoid } from 'nanoid'

export class MigrationPendingError extends Error {
  constructor() {
    super('This feature needs the latest database migration. Apply supabase/migrations and try again.')
    this.name = 'MigrationPendingError'
  }
}

function isMissingRelation(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`
  return /PGRST20[0-5]|42P01|42883|42703|Could not find the (table|function|.*column)|does not exist/i.test(text)
}

function unwrap({ data, error }) {
  if (error) throw isMissingRelation(error) ? new MigrationPendingError() : new Error(error.message || 'Database error')
  return data
}

const STALE_CLAIM_MS = 120_000

const projectOut = (row) => row && ({
  id: row.id, name: row.name, brand: row.brand, aliases: row.aliases || [], domain: row.domain || '', competitors: row.competitors || [],
  country: row.country, language: row.language, createdAt: row.created_at,
})
const promptOut = (row) => ({ id: row.id, projectId: row.project_id, text: row.text, category: row.category || 'general', createdAt: row.created_at })
const measurementOut = (row) => row && ({
  id: row.id, projectId: row.project_id, status: row.status, config: row.config || {}, total: row.total, summary: row.summary || null,
  createdAt: row.created_at, completedAt: row.completed_at,
})
const sampleOut = (row) => ({
  id: row.id, measurementId: row.measurement_id, promptId: row.prompt_id, promptText: row.prompt_text, surface: row.surface, sampleIndex: row.sample_index,
  status: row.status, answer: row.answer || '', citations: row.citations || [], model: row.model || '', error: row.error || '',
})
const runOut = (row) => ({ id: row.id, userId: row.user_id, type: row.type, payload: row.payload, result: row.result, createdAt: row.created_at })

const crawlOut = (row) => row && ({
  id: row.id, userId: row.user_id, startUrl: row.start_url, host: row.host, status: row.status, config: row.config || {}, summary: row.summary || null,
  createdAt: row.created_at, completedAt: row.completed_at,
})
const crawlPageOut = (row) => ({ id: row.id, url: row.url, depth: row.depth, source: row.source, foundOn: row.found_on || '', linked: Boolean(row.linked), status: row.status, result: row.result || null })
const auditOut = (row) => row && ({ id: row.id, url: row.url, host: row.host, score: row.score, counts: row.counts || {}, checks: row.checks || [], rendered: Boolean(row.rendered), createdAt: row.created_at })
const keywordOut = (row) => ({ id: row.id, siteUrl: row.site_url, query: row.query, createdAt: row.created_at })
const PAGE_SIZE = 1000
const scheduleOut = (row) => row && ({
  projectId: row.project_id, userId: row.user_id, frequency: row.frequency, surfaces: row.surfaces || [], samples: row.samples, grounded: Boolean(row.grounded),
  notify: row.notify, threshold: row.threshold, nextRunAt: row.next_run_at, lastRunAt: row.last_run_at, measurementId: row.measurement_id || null, lastStatus: row.last_status || '',
})
const scheduleIn = (patch) => {
  const map = { frequency: 'frequency', surfaces: 'surfaces', samples: 'samples', grounded: 'grounded', notify: 'notify', threshold: 'threshold', nextRunAt: 'next_run_at', lastRunAt: 'last_run_at', measurementId: 'measurement_id', lastStatus: 'last_status' }
  const row = { updated_at: new Date().toISOString() }
  for (const [key, column] of Object.entries(map)) if (key in patch) row[column] = patch[key]
  return row
}

export function createSupabaseStore(db) {
  // PostgREST returns at most 1000 rows per request, so large reads are paged.
  async function allRows(build) {
    const rows = []
    for (let from = 0; ; from += PAGE_SIZE) {
      const page = unwrap(await build().range(from, from + PAGE_SIZE - 1))
      rows.push(...page)
      if (page.length < PAGE_SIZE) return rows
    }
  }
  return {
    async getProfile(userId) {
      return unwrap(await db.from('geo_app_users').select('*').eq('id', userId).maybeSingle())
    },
    async upsertProfile(user, name) {
      const profile = { id: user.id, name: name || user.user_metadata?.name || user.email?.split('@')[0] || 'User', email: user.email, password_hash: 'supabase-auth' }
      return unwrap(await db.from('geo_app_users').upsert(profile, { onConflict: 'id' }).select('*').single())
    },
    async getProfileByCustomer(customerId) {
      return unwrap(await db.from('geo_app_users').select('*').eq('stripe_customer_id', customerId).maybeSingle())
    },
    async setBilling(userId, patch) {
      return unwrap(await db.from('geo_app_users').update(patch).eq('id', userId).select('*').maybeSingle())
    },
    async listRuns(userId) {
      return unwrap(await db.from('geo_app_runs').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(30)).map(runOut)
    },
    async saveRun(userId, type, payload, result) {
      unwrap(await db.from('geo_app_runs').insert({ id: nanoid(), user_id: userId, type, payload, result }))
    },

    async getUsage(userId, period) {
      try {
        const rows = unwrap(await db.from('geo_app_usage').select('kind,count').eq('user_id', userId).eq('period', period))
        return Object.fromEntries(rows.map((row) => [row.kind, row.count]))
      } catch (error) {
        if (error instanceof MigrationPendingError) return null
        throw error
      }
    },
    async getUsageCount(userId, period, kind) {
      const usage = await this.getUsage(userId, period)
      return usage === null ? null : usage[kind] || 0
    },
    async incrementUsage(userId, period, kind, amount) {
      try {
        unwrap(await db.rpc('geo_app_increment_usage', { p_user: userId, p_period: period, p_kind: kind, p_amount: amount }))
      } catch (error) {
        if (!(error instanceof MigrationPendingError)) throw error
      }
    },

    async listProjects(userId) {
      return unwrap(await db.from('geo_app_projects').select('*').eq('user_id', userId).order('created_at', { ascending: true })).map(projectOut)
    },
    async getProject(userId, id) {
      return projectOut(unwrap(await db.from('geo_app_projects').select('*').eq('user_id', userId).eq('id', id).maybeSingle()))
    },
    async createProject(userId, data) {
      return projectOut(unwrap(await db.from('geo_app_projects').insert({ id: nanoid(), user_id: userId, ...data }).select('*').single()))
    },
    async updateProject(userId, id, data) {
      return projectOut(unwrap(await db.from('geo_app_projects').update(data).eq('user_id', userId).eq('id', id).select('*').maybeSingle()))
    },
    async deleteProject(userId, id) {
      unwrap(await db.from('geo_app_projects').delete().eq('user_id', userId).eq('id', id))
    },

    async listPrompts(userId, projectId) {
      return unwrap(await db.from('geo_app_prompts').select('*').eq('user_id', userId).eq('project_id', projectId).order('created_at', { ascending: true })).map(promptOut)
    },
    async addPrompts(userId, projectId, prompts) {
      const rows = prompts.map((prompt) => ({ id: nanoid(), user_id: userId, project_id: projectId, text: prompt.text, category: prompt.category || 'general' }))
      return unwrap(await db.from('geo_app_prompts').insert(rows).select('*')).map(promptOut)
    },
    async deletePrompt(userId, id) {
      unwrap(await db.from('geo_app_prompts').delete().eq('user_id', userId).eq('id', id))
    },

    async createMeasurement(userId, projectId, config, tasks) {
      const id = nanoid()
      const row = unwrap(await db.from('geo_app_measurements').insert({ id, user_id: userId, project_id: projectId, status: 'running', config, total: tasks.length }).select('*').single())
      const samples = tasks.map((task) => ({
        id: nanoid(), measurement_id: id, user_id: userId, prompt_id: task.promptId, prompt_text: task.promptText, surface: task.surface, sample_index: task.sampleIndex, status: 'pending',
      }))
      for (let offset = 0; offset < samples.length; offset += 500) unwrap(await db.from('geo_app_samples').insert(samples.slice(offset, offset + 500)))
      return measurementOut(row)
    },
    async getMeasurement(userId, id) {
      return measurementOut(unwrap(await db.from('geo_app_measurements').select('*').eq('user_id', userId).eq('id', id).maybeSingle()))
    },
    async listMeasurements(userId, projectId, limit = 30) {
      return unwrap(await db.from('geo_app_measurements').select('*').eq('user_id', userId).eq('project_id', projectId).order('created_at', { ascending: false }).limit(limit)).map(measurementOut)
    },
    async updateMeasurement(id, patch) {
      const data = {}
      if (patch.status) data.status = patch.status
      if (patch.summary) data.summary = patch.summary
      if (patch.completedAt) data.completed_at = patch.completedAt
      unwrap(await db.from('geo_app_measurements').update(data).eq('id', id))
    },
    async listPendingSamples(measurementId, limit) {
      const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
      const candidates = unwrap(await db.from('geo_app_samples').select('id').eq('measurement_id', measurementId)
        .or(`status.eq.pending,and(status.eq.running,claimed_at.lt.${staleBefore})`).order('id').limit(limit))
      if (!candidates.length) return []
      const claimed = unwrap(await db.from('geo_app_samples').update({ status: 'running', claimed_at: new Date().toISOString() })
        .in('id', candidates.map((row) => row.id)).in('status', ['pending', 'running']).select('*'))
      return claimed.map(sampleOut)
    },
    async countPendingSamples(measurementId) {
      const { count, error } = await db.from('geo_app_samples').select('id', { count: 'exact', head: true }).eq('measurement_id', measurementId).in('status', ['pending', 'running'])
      if (error) unwrap({ data: null, error })
      return count || 0
    },
    async listSamples(measurementId) {
      return unwrap(await db.from('geo_app_samples').select('*').eq('measurement_id', measurementId).order('id').limit(5000)).map(sampleOut)
    },
    async updateSample(id, patch) {
      unwrap(await db.from('geo_app_samples').update(patch).eq('id', id))
    },

    async getGscConnection(userId) {
      const row = unwrap(await db.from('geo_app_gsc_connections').select('*').eq('user_id', userId).maybeSingle())
      return row ? { email: row.google_email, refreshToken: row.refresh_token, createdAt: row.created_at } : null
    },
    async saveGscConnection(userId, { email, refreshToken }) {
      unwrap(await db.from('geo_app_gsc_connections').upsert({ user_id: userId, google_email: email || '', refresh_token: refreshToken, created_at: new Date().toISOString() }, { onConflict: 'user_id' }))
    },
    async deleteGscConnection(userId) {
      unwrap(await db.from('geo_app_gsc_connections').delete().eq('user_id', userId))
    },
    async listKeywords(userId, siteUrl) {
      return unwrap(await db.from('geo_app_keywords').select('*').eq('user_id', userId).eq('site_url', siteUrl).order('created_at', { ascending: true }).limit(1000)).map(keywordOut)
    },
    async countKeywords(userId) {
      const { count, error } = await db.from('geo_app_keywords').select('id', { count: 'exact', head: true }).eq('user_id', userId)
      if (error) unwrap({ data: null, error })
      return count || 0
    },
    async addKeywords(userId, siteUrl, queries) {
      const rows = queries.map((query) => ({ id: nanoid(), user_id: userId, site_url: siteUrl, query }))
      unwrap(await db.from('geo_app_keywords').upsert(rows, { onConflict: 'user_id,site_url,query', ignoreDuplicates: true }))
    },
    async deleteKeyword(userId, id) {
      unwrap(await db.from('geo_app_keywords').delete().eq('user_id', userId).eq('id', id))
    },

    async createCrawl(userId, data, seeds) {
      const id = nanoid()
      const row = unwrap(await db.from('geo_app_crawls').insert({ id, user_id: userId, start_url: data.startUrl, host: data.host, status: 'running', config: data.config }).select('*').single())
      const pages = seeds.map((seed) => ({ id: nanoid(), crawl_id: id, user_id: userId, url: seed.url, depth: seed.depth, source: seed.source, linked: seed.source !== 'sitemap' }))
      for (let offset = 0; offset < pages.length; offset += 500) unwrap(await db.from('geo_app_crawl_pages').upsert(pages.slice(offset, offset + 500), { onConflict: 'crawl_id,url', ignoreDuplicates: true }))
      return crawlOut(row)
    },
    async getCrawl(userId, id) {
      return crawlOut(unwrap(await db.from('geo_app_crawls').select('*').eq('user_id', userId).eq('id', id).maybeSingle()))
    },
    async listCrawls(userId, limit = 20) {
      return unwrap(await db.from('geo_app_crawls').select('id,user_id,start_url,host,status,summary,created_at,completed_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit)).map(crawlOut)
    },
    async deleteCrawl(userId, id) {
      unwrap(await db.from('geo_app_crawls').delete().eq('user_id', userId).eq('id', id))
    },
    async updateCrawl(id, patch) {
      const data = {}
      if (patch.status) data.status = patch.status
      if (patch.summary) data.summary = patch.summary
      if (patch.completedAt) data.completed_at = patch.completedAt
      unwrap(await db.from('geo_app_crawls').update(data).eq('id', id))
    },
    async claimCrawlPages(crawlId, limit) {
      const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
      const candidates = unwrap(await db.from('geo_app_crawl_pages').select('id').eq('crawl_id', crawlId)
        .or(`status.eq.pending,and(status.eq.running,claimed_at.lt.${staleBefore})`).order('depth').order('id').limit(limit))
      if (!candidates.length) return []
      return unwrap(await db.from('geo_app_crawl_pages').update({ status: 'running', claimed_at: new Date().toISOString() })
        .in('id', candidates.map((row) => row.id)).in('status', ['pending', 'running']).select('id,url,depth,source,found_on,linked,status')).map(crawlPageOut)
    },
    async countCrawlPages(crawlId, statuses) {
      let query = db.from('geo_app_crawl_pages').select('id', { count: 'exact', head: true }).eq('crawl_id', crawlId)
      if (statuses) query = query.in('status', statuses)
      const { count, error } = await query
      if (error) unwrap({ data: null, error })
      return count || 0
    },
    // Adds newly found URLs (up to maxPages in total) and marks sitemap URLs that turned out to be linked.
    async discoverCrawlPages(crawlId, userId, entries, maxPages) {
      const existing = await allRows(() => db.from('geo_app_crawl_pages').select('id,url,source,linked').eq('crawl_id', crawlId).order('id'))
      const known = new Map(existing.map((row) => [row.url, row]))
      const toLink = entries.map((entry) => known.get(entry.url)).filter((row) => row && !row.linked).map((row) => row.id)
      for (let offset = 0; offset < toLink.length; offset += 150) unwrap(await db.from('geo_app_crawl_pages').update({ linked: true }).in('id', toLink.slice(offset, offset + 150)))
      const fresh = entries.filter((entry) => !known.has(entry.url)).slice(0, Math.max(0, maxPages - existing.length))
      if (!fresh.length) return 0
      const rows = fresh.map((entry) => ({ id: nanoid(), crawl_id: crawlId, user_id: userId, url: entry.url, depth: entry.depth, source: 'link', found_on: entry.foundOn || '', linked: true }))
      unwrap(await db.from('geo_app_crawl_pages').upsert(rows, { onConflict: 'crawl_id,url', ignoreDuplicates: true }))
      return rows.length
    },
    async updateCrawlPage(id, patch) {
      unwrap(await db.from('geo_app_crawl_pages').update(patch).eq('id', id))
    },
    async skipCrawlPages(crawlId) {
      unwrap(await db.from('geo_app_crawl_pages').update({ status: 'skipped' }).eq('crawl_id', crawlId).in('status', ['pending', 'running']))
    },
    async listCrawlPages(crawlId) {
      return (await allRows(() => db.from('geo_app_crawl_pages').select('id,url,depth,source,found_on,linked,status,result').eq('crawl_id', crawlId).order('id'))).map(crawlPageOut)
    },

    async getSchedule(userId, projectId) {
      return scheduleOut(unwrap(await db.from('geo_app_schedules').select('*').eq('user_id', userId).eq('project_id', projectId).maybeSingle()))
    },
    async saveSchedule(userId, projectId, patch) {
      return scheduleOut(unwrap(await db.from('geo_app_schedules').upsert({ project_id: projectId, user_id: userId, ...scheduleIn(patch) }, { onConflict: 'project_id' }).select('*').single()))
    },
    async updateSchedule(projectId, patch) {
      unwrap(await db.from('geo_app_schedules').update(scheduleIn(patch)).eq('project_id', projectId))
    },
    async listDueSchedules(nowIso, limit = 25) {
      return unwrap(await db.from('geo_app_schedules').select('*').neq('frequency', 'off').is('measurement_id', null).lte('next_run_at', nowIso).order('next_run_at').limit(limit)).map(scheduleOut)
    },
    async listActiveSchedules(limit = 50) {
      return unwrap(await db.from('geo_app_schedules').select('*').not('measurement_id', 'is', null).order('last_run_at').limit(limit)).map(scheduleOut)
    },

    async saveAudit(userId, audit) {
      const row = { id: nanoid(), user_id: userId, url: audit.url, host: audit.host, score: audit.score, counts: audit.counts, checks: audit.checks, rendered: Boolean(audit.rendered) }
      return auditOut(unwrap(await db.from('geo_app_audits').insert(row).select('*').single()))
    },
    async listAudits(userId, { host = '', limit = 100 } = {}) {
      let query = db.from('geo_app_audits').select('id,url,host,score,counts,rendered,created_at').eq('user_id', userId)
      if (host) query = query.eq('host', host)
      return unwrap(await query.order('created_at', { ascending: false }).limit(limit)).map(auditOut)
    },
    async getAudit(userId, id) {
      return auditOut(unwrap(await db.from('geo_app_audits').select('*').eq('user_id', userId).eq('id', id).maybeSingle()))
    },
  }
}

export function createMemoryStore() {
  const state = { profiles: new Map(), runs: [], usage: new Map(), projects: [], prompts: [], measurements: [], samples: [], gsc: new Map(), keywords: [], crawls: [], crawlPages: [], audits: [], schedules: new Map() }
  const now = () => new Date().toISOString()
  return {
    state,
    async getProfile(userId) { return state.profiles.get(userId) || null },
    async upsertProfile(user, name) {
      const existing = state.profiles.get(user.id) || {}
      const profile = { plan: 'free', ...existing, id: user.id, email: user.email, name: name || existing.name || user.email?.split('@')[0] || 'User' }
      state.profiles.set(user.id, profile)
      return profile
    },
    async getProfileByCustomer(customerId) { return [...state.profiles.values()].find((profile) => profile.stripe_customer_id === customerId) || null },
    async setBilling(userId, patch) {
      const profile = state.profiles.get(userId)
      if (profile) Object.assign(profile, patch)
      return profile || null
    },
    async listRuns(userId) { return state.runs.filter((run) => run.userId === userId).slice(-30).reverse() },
    async saveRun(userId, type, payload, result) { state.runs.push({ id: nanoid(), userId, type, payload, result, createdAt: now() }) },
    async getUsage(userId, day) {
      const result = {}
      for (const [key, count] of state.usage) {
        const [user, usageDay, kind] = key.split('|')
        if (user === userId && usageDay === day) result[kind] = count
      }
      return result
    },
    async getUsageCount(userId, day, kind) { return state.usage.get(`${userId}|${day}|${kind}`) || 0 },
    async incrementUsage(userId, day, kind, amount) {
      const key = `${userId}|${day}|${kind}`
      state.usage.set(key, (state.usage.get(key) || 0) + amount)
    },
    async listProjects(userId) { return state.projects.filter((project) => project.userId === userId) },
    async getProject(userId, id) { return state.projects.find((project) => project.userId === userId && project.id === id) || null },
    async createProject(userId, data) {
      const project = { id: nanoid(), userId, aliases: [], competitors: [], domain: '', ...data, createdAt: now() }
      state.projects.push(project)
      return project
    },
    async updateProject(userId, id, data) {
      const project = await this.getProject(userId, id)
      if (project) Object.assign(project, data)
      return project
    },
    async deleteProject(userId, id) {
      state.projects = state.projects.filter((project) => !(project.userId === userId && project.id === id))
      state.prompts = state.prompts.filter((prompt) => prompt.projectId !== id)
    },
    async listPrompts(userId, projectId) { return state.prompts.filter((prompt) => prompt.userId === userId && prompt.projectId === projectId) },
    async addPrompts(userId, projectId, prompts) {
      const rows = prompts.map((prompt) => ({ id: nanoid(), userId, projectId, text: prompt.text, category: prompt.category || 'general', createdAt: now() }))
      state.prompts.push(...rows)
      return rows
    },
    async deletePrompt(userId, id) { state.prompts = state.prompts.filter((prompt) => !(prompt.userId === userId && prompt.id === id)) },
    async createMeasurement(userId, projectId, config, tasks) {
      const measurement = { id: nanoid(), userId, projectId, status: 'running', config, total: tasks.length, summary: null, createdAt: now(), completedAt: null }
      state.measurements.push(measurement)
      state.samples.push(...tasks.map((task) => ({ id: nanoid(), measurementId: measurement.id, ...task, status: 'pending', answer: '', citations: [], model: '', error: '' })))
      return measurement
    },
    async getMeasurement(userId, id) { return state.measurements.find((item) => item.userId === userId && item.id === id) || null },
    async listMeasurements(userId, projectId, limit = 30) {
      return state.measurements.filter((item) => item.userId === userId && item.projectId === projectId).slice(-limit).reverse()
    },
    async updateMeasurement(id, patch) { Object.assign(state.measurements.find((item) => item.id === id), patch) },
    async listPendingSamples(measurementId, limit) {
      const pending = state.samples.filter((sample) => sample.measurementId === measurementId && sample.status === 'pending').slice(0, limit)
      pending.forEach((sample) => { sample.status = 'running' })
      return pending
    },
    async countPendingSamples(measurementId) {
      return state.samples.filter((sample) => sample.measurementId === measurementId && ['pending', 'running'].includes(sample.status)).length
    },
    async listSamples(measurementId) { return state.samples.filter((sample) => sample.measurementId === measurementId) },
    async updateSample(id, patch) { Object.assign(state.samples.find((sample) => sample.id === id), patch) },

    async getGscConnection(userId) { return state.gsc.get(userId) || null },
    async saveGscConnection(userId, connection) { state.gsc.set(userId, { ...connection, createdAt: now() }) },
    async deleteGscConnection(userId) { state.gsc.delete(userId) },
    async listKeywords(userId, siteUrl) { return state.keywords.filter((item) => item.userId === userId && item.siteUrl === siteUrl) },
    async countKeywords(userId) { return state.keywords.filter((item) => item.userId === userId).length },
    async addKeywords(userId, siteUrl, queries) {
      for (const query of queries) {
        if (!state.keywords.some((item) => item.userId === userId && item.siteUrl === siteUrl && item.query === query)) state.keywords.push({ id: nanoid(), userId, siteUrl, query, createdAt: now() })
      }
    },
    async deleteKeyword(userId, id) { state.keywords = state.keywords.filter((item) => !(item.userId === userId && item.id === id)) },

    async createCrawl(userId, data, seeds) {
      const crawl = { id: nanoid(), userId, startUrl: data.startUrl, host: data.host, status: 'running', config: data.config, summary: null, createdAt: now(), completedAt: null }
      state.crawls.push(crawl)
      state.crawlPages.push(...seeds.map((seed) => ({ id: nanoid(), crawlId: crawl.id, url: seed.url, depth: seed.depth, source: seed.source, foundOn: '', linked: seed.source !== 'sitemap', status: 'pending', result: null })))
      return crawl
    },
    async getCrawl(userId, id) { return state.crawls.find((crawl) => crawl.userId === userId && crawl.id === id) || null },
    async listCrawls(userId, limit = 20) { return state.crawls.filter((crawl) => crawl.userId === userId).slice(-limit).reverse() },
    async deleteCrawl(userId, id) {
      state.crawls = state.crawls.filter((crawl) => !(crawl.userId === userId && crawl.id === id))
      state.crawlPages = state.crawlPages.filter((page) => page.crawlId !== id)
    },
    async updateCrawl(id, patch) { Object.assign(state.crawls.find((crawl) => crawl.id === id), patch) },
    async claimCrawlPages(crawlId, limit) {
      const pending = state.crawlPages.filter((page) => page.crawlId === crawlId && page.status === 'pending').sort((a, b) => a.depth - b.depth).slice(0, limit)
      pending.forEach((page) => { page.status = 'running' })
      return pending
    },
    async countCrawlPages(crawlId, statuses) {
      return state.crawlPages.filter((page) => page.crawlId === crawlId && (!statuses || statuses.includes(page.status))).length
    },
    async discoverCrawlPages(crawlId, userId, entries, maxPages) {
      let added = 0
      for (const entry of entries) {
        const existing = state.crawlPages.find((page) => page.crawlId === crawlId && page.url === entry.url)
        if (existing) existing.linked = true
        else if (state.crawlPages.filter((page) => page.crawlId === crawlId).length < maxPages) {
          state.crawlPages.push({ id: nanoid(), crawlId, url: entry.url, depth: entry.depth, source: 'link', foundOn: entry.foundOn || '', linked: true, status: 'pending', result: null })
          added += 1
        }
      }
      return added
    },
    async updateCrawlPage(id, patch) { Object.assign(state.crawlPages.find((page) => page.id === id), patch) },
    async skipCrawlPages(crawlId) {
      state.crawlPages.filter((page) => page.crawlId === crawlId && ['pending', 'running'].includes(page.status)).forEach((page) => { page.status = 'skipped' })
    },
    async listCrawlPages(crawlId) { return state.crawlPages.filter((page) => page.crawlId === crawlId) },

    async getSchedule(userId, projectId) {
      const schedule = state.schedules.get(projectId)
      return schedule && schedule.userId === userId ? schedule : null
    },
    async saveSchedule(userId, projectId, patch) {
      const schedule = { projectId, userId, frequency: 'off', surfaces: [], samples: 1, grounded: false, notify: 'change', threshold: 5, nextRunAt: null, lastRunAt: null, measurementId: null, lastStatus: '', ...state.schedules.get(projectId), ...patch }
      state.schedules.set(projectId, schedule)
      return schedule
    },
    async updateSchedule(projectId, patch) { Object.assign(state.schedules.get(projectId), patch) },
    async listDueSchedules(nowIso, limit = 25) {
      return [...state.schedules.values()].filter((item) => item.frequency !== 'off' && !item.measurementId && item.nextRunAt && item.nextRunAt <= nowIso).slice(0, limit)
    },
    async listActiveSchedules(limit = 50) { return [...state.schedules.values()].filter((item) => item.measurementId).slice(0, limit) },

    async saveAudit(userId, audit) {
      const row = { id: nanoid(), userId, ...audit, rendered: Boolean(audit.rendered), createdAt: new Date(Date.now() + state.audits.length).toISOString() }
      state.audits.push(row)
      return row
    },
    async listAudits(userId, { host = '', limit = 100 } = {}) {
      return state.audits.filter((audit) => audit.userId === userId && (!host || audit.host === host)).slice(-limit).reverse().map((audit) => ({ ...audit, checks: undefined }))
    },
    async getAudit(userId, id) { return state.audits.find((audit) => audit.userId === userId && audit.id === id) || null },
  }
}
