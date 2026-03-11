import type { FastifyInstance } from 'fastify'
import { and, eq, gte, lte, desc } from 'drizzle-orm'
import { config } from '../../config/index.js'
import { getAnalyticsDb } from '../../db/client.js'
import {
  renderAnalytics,
  errorAnalytics,
  workerPoolMetrics,
  apiMetrics,
  cacheAnalytics,
  testRuns,
} from '../../db/schema.js'
import { RenderError } from '../middleware/error.js'

const MAX_LIMIT = 1000

function parseLimit(raw: string | undefined, def = 500): number {
  const n = parseInt(raw ?? String(def), 10)
  return Math.min(isNaN(n) ? def : n, MAX_LIMIT)
}

function toDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined
  const d = new Date(raw)
  return isNaN(d.getTime()) ? undefined : d
}

function getDb() {
  if (!config.database.url) {
    throw new RenderError('Database not configured on this server', 503)
  }
  return getAnalyticsDb()
}

export async function analyticsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/renders', { schema: { tags: ['Analytics'] } }, async (request) => {
    const q = request.query as Record<string, string | undefined>
    const db = getDb()
    const limit = parseLimit(q.limit)
    const from = toDate(q.from)
    const to = toDate(q.to)

    const filters = []
    if (q.server_url)   filters.push(eq(renderAnalytics.server_url, q.server_url))
    if (q.source_type)  filters.push(eq(renderAnalytics.source_type, q.source_type))
    if (q.print_method) filters.push(eq(renderAnalytics.print_method, q.print_method))
    if (q.test_run_id)  filters.push(eq(renderAnalytics.test_run_id, q.test_run_id))
    if (from) filters.push(gte(renderAnalytics.created_at, from))
    if (to)   filters.push(lte(renderAnalytics.created_at, to))

    return db.select().from(renderAnalytics)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(renderAnalytics.created_at))
      .limit(limit)
  })

  fastify.get('/errors', { schema: { tags: ['Analytics'] } }, async (request) => {
    const q = request.query as Record<string, string | undefined>
    const db = getDb()
    const limit = parseLimit(q.limit)
    const from = toDate(q.from)
    const to = toDate(q.to)

    const filters = []
    if (q.service)         filters.push(eq(errorAnalytics.service, q.service))
    if (q.error_category)  filters.push(eq(errorAnalytics.error_category, q.error_category))
    if (from) filters.push(gte(errorAnalytics.created_at, from))
    if (to)   filters.push(lte(errorAnalytics.created_at, to))

    return db.select().from(errorAnalytics)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(errorAnalytics.created_at))
      .limit(limit)
  })

  fastify.get('/api-metrics', { schema: { tags: ['Analytics'] } }, async (request) => {
    const q = request.query as Record<string, string | undefined>
    const db = getDb()
    const limit = parseLimit(q.limit)
    const from = toDate(q.from)
    const to = toDate(q.to)

    const filters = []
    if (q.endpoint) filters.push(eq(apiMetrics.endpoint, q.endpoint))
    if (from) filters.push(gte(apiMetrics.created_at, from))
    if (to)   filters.push(lte(apiMetrics.created_at, to))

    return db.select().from(apiMetrics)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(apiMetrics.created_at))
      .limit(limit)
  })

  fastify.get('/workers', { schema: { tags: ['Analytics'] } }, async (request) => {
    const q = request.query as Record<string, string | undefined>
    const db = getDb()
    const limit = parseLimit(q.limit)
    const from = toDate(q.from)
    const to = toDate(q.to)

    const filters = []
    if (from) filters.push(gte(workerPoolMetrics.created_at, from))
    if (to)   filters.push(lte(workerPoolMetrics.created_at, to))

    return db.select().from(workerPoolMetrics)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(workerPoolMetrics.created_at))
      .limit(limit)
  })

  fastify.get('/cache', { schema: { tags: ['Analytics'] } }, async (request) => {
    const q = request.query as Record<string, string | undefined>
    const db = getDb()
    const limit = parseLimit(q.limit)
    const from = toDate(q.from)
    const to = toDate(q.to)

    const filters = []
    if (q.cache_type) filters.push(eq(cacheAnalytics.cache_type, q.cache_type))
    if (from) filters.push(gte(cacheAnalytics.created_at, from))
    if (to)   filters.push(lte(cacheAnalytics.created_at, to))

    return db.select().from(cacheAnalytics)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(cacheAnalytics.created_at))
      .limit(limit)
  })

  fastify.get('/test-runs', { schema: { tags: ['Analytics'] } }, async (request) => {
    const q = request.query as Record<string, string | undefined>
    const db = getDb()
    const limit = parseLimit(q.limit)

    const filters = []
    if (q.status)     filters.push(eq(testRuns.status, q.status))
    if (q.server_url) filters.push(eq(testRuns.server_url, q.server_url))

    return db.select().from(testRuns)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(testRuns.created_at))
      .limit(limit)
  })
}
