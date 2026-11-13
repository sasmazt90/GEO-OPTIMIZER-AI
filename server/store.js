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

export function createSupabaseStore(db) {
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
  }
}

export function createMemoryStore() {
  const state = { profiles: new Map(), runs: [], usage: new Map(), projects: [], prompts: [], measurements: [], samples: [] }
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
  }
}
