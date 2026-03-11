import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { config } from '../../config/index.js'
import { getAnalyticsDb } from '../../db/client.js'
import { testRuns } from '../../db/schema.js'
import { RenderError } from '../middleware/error.js'

const createTestRunSchema = z.object({
  server_url: z.string().url(),
  source_type: z.enum(['local', 'external', 'mac', 'docker']).optional().default('local'),
  name: z.string().optional(),
  description: z.string().optional(),
  fixture_names: z.array(z.string().min(1)).min(1),
})

function getDb() {
  if (!config.database.url) {
    throw new RenderError('Database not configured on this server', 503)
  }
  return getAnalyticsDb()
}

export async function testRunRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/', {
    schema: {
      tags: ['Test Runs'],
      body: createTestRunSchema,
    },
  }, async (request, reply) => {
    const { server_url, source_type, name, description, fixture_names } = request.body as z.infer<typeof createTestRunSchema>
    const db = getDb()

    const [row] = await db.insert(testRuns).values({
      server_url,
      source_type,
      name: name || `Test Run — ${new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }).format(new Date())}`,
      description,
      status: 'running',
      fixture_names,
      total_renders: 0,
      successful: 0,
      failed: 0,
    } as any).returning({ id: testRuns.id })

    if (!row) throw new RenderError('Failed to create test run', 500)

    return reply.code(201).send({ id: row.id, status: 'running' })
  })

  fastify.post('/:id/finalize', {
    schema: { tags: ['Test Runs'] },
  }, async (request) => {
    const { id: runId } = request.params as { id: string }
    if (!z.string().uuid().safeParse(runId).success) {
      throw new RenderError('Invalid test run ID', 400)
    }

    const db = getDb()

    const statsResult = await db.execute(sql`
      SELECT COUNT(*)::INTEGER AS                                   total,
             COUNT(*) FILTER (WHERE status = 'success')::INTEGER AS ok,
             COUNT(*) FILTER (WHERE status = 'failed')::INTEGER AS  err,
             AVG(duration_ms) AS                                    avg_dur,
             SUM(duration_ms)::BIGINT AS                            total_dur,
             AVG(asset_load_ms) AS                                  avg_asset
      FROM analytics.renderer_render_analytics
      WHERE test_run_id = ${runId}::uuid
    `)

    const stats = statsResult.rows[0] as {
      total: number; ok: number; err: number
      avg_dur: number | null; total_dur: number | null; avg_asset: number | null
    }

    await db.update(testRuns)
      .set({
        status: 'completed',
        total_renders: stats.total,
        successful: stats.ok,
        failed: stats.err,
        avg_duration_ms: stats.avg_dur ?? undefined,
        total_duration_ms: stats.total_dur ?? undefined,
        avg_asset_load_ms: stats.avg_asset ?? undefined,
        completed_at: new Date(),
      } as any)
      .where(eq(testRuns.id, runId))

    return { id: runId, status: 'completed' }
  })
}
