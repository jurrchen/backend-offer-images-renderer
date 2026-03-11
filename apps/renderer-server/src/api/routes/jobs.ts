import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { jobRequestSchema } from '../schemas.js'
import type { JobRequest } from '../schemas.js'
import { RenderError } from '../middleware/error.js'
import type { WorkerPoolManager } from '../../workers/WorkerPoolManager.js'
import { analytics, categorizeError } from '../../utils/analytics.js'
import { fourthwallApi } from '../../services/FourthwallApiService.js'
import { createJob, startJob, completeJob, failJob, getJob } from '../../jobs/job-store.js'
import type { PgJobQueue, JobStatusResponse, JobListItem } from '../../queue/PgJobQueue.js'

async function executeJobFallback(
  jobId: string,
  body: JobRequest,
  workerPool: WorkerPoolManager,
  requestId?: string,
): Promise<void> {
  const startTime = Date.now()

  try {
    startJob(jobId)

    if (!workerPool.isInitialized()) {
      throw new RenderError('Worker pool not initialized')
    }

    const { generators, images: artworkItems, colors: requestedColors, views: requestedViews, renderSize = 2048 } = body
    const { generatorData: genDataRaw, sizes } = generators[0]
    const generatorData = genDataRaw as any
    const colors = requestedColors ?? fourthwallApi.getAutoColors(generatorData)
    const views = requestedViews ?? fourthwallApi.getAvailableViews(generatorData)
    const defaultRegion = fourthwallApi.getDefaultRegion(generatorData)
    const printMethod: string = generatorData.regions?.[0]?.productionMethod || 'UNKNOWN'

    const fetchedImages: Array<{ region: string; data: string }> = []
    for (const artItem of artworkItems) {
      const resp = await fetch(artItem.url)
      if (!resp.ok) throw new RenderError(`Failed to fetch artwork from ${artItem.url}: ${resp.status}`)
      const buf = await resp.arrayBuffer()
      fetchedImages.push({ region: artItem.region ?? defaultRegion, data: Buffer.from(buf).toString('base64') })
    }

    const requestedRegions = fetchedImages.map((img) => img.region)
    try {
      fourthwallApi.validateRegions(generatorData, requestedRegions)
    } catch (err) {
      throw new RenderError((err as Error).message, 400)
    }

    const queueDepth = workerPool.getStatus().queueDepth

    const result = await workerPool.renderBatch(
      {
        generatorId: generatorData.id,
        images: fetchedImages,
        colors,
        views,
        renderSize,
        generatorData,
      },
      generatorData,
    )

    const duration = Date.now() - startTime
    const { results } = result

    await analytics.log({
      type: 'batch',
      generatorId: generatorData.id,
      imageCount: results.length,
      durationMs: duration,
      resolution: renderSize,
      status: 'success',
      printMethod,
      queueDepth,
      requestId,
    })

    const images = results.flatMap((r) =>
      sizes.map((size) => ({
        image: Buffer.from(r.buffer).toString('base64'),
        size,
        region: r.region,
        color: r.color,
        style: printMethod,
        width: renderSize,
        height: renderSize,
        view: r.view,
      }))
    )

    completeJob(jobId, { images, count: results.length * sizes.length, duration } as any, {
      colorsUsed: colors,
      viewsUsed: views,
      regionsUsed: [...new Set(requestedRegions)],
      printMethod,
    })
  } catch (error) {
    const msg = (error as Error).message
    console.error(`[job:${jobId}] Failed:`, msg)

    const statusCode = error instanceof RenderError
      ? (error as any).statusCode || 500
      : msg.startsWith('Server busy') ? 503 : 500

    analytics.logError({
      endpoint: '/api/v1/jobs',
      errorCategory: categorizeError(error as Error),
      errorMessage: msg,
      errorStack: (error as Error).stack,
      statusCode,
      requestId,
      durationMs: Date.now() - startTime,
    }).catch(() => {})

    failJob(jobId, msg)
  }
}

export async function jobsRoutes(
  fastify: FastifyInstance,
  opts: { workerPool: WorkerPoolManager; pgJobQueue?: PgJobQueue },
): Promise<void> {
  const { workerPool, pgJobQueue } = opts

  fastify.get('/', {
    schema: { tags: ['Jobs'] },
  }, async (request) => {
    const { limit: limitStr } = request.query as { limit?: string }
    const limit = Math.min(parseInt(limitStr || '50', 10), 200)
    if (!pgJobQueue) return { jobs: [], total: 0 }
    const jobs: JobListItem[] = await pgJobQueue.listJobs(limit)
    return { jobs, total: jobs.length }
  })

  fastify.post('/', {
    schema: {
      tags: ['Jobs'],
      body: jobRequestSchema,
    },
  }, async (request, reply) => {
    if (pgJobQueue) {
      const jobId = await pgJobQueue.submit(request.body as JobRequest, request.requestId)
      return reply.code(202).send({
        id: jobId,
        status: 'pending',
        pollUrl: `/api/v1/jobs/${jobId}`,
      })
    }

    const jobId = randomUUID()
    createJob(jobId, request.body as JobRequest)

    executeJobFallback(jobId, request.body as JobRequest, workerPool, request.requestId).catch(() => {})

    return reply.code(202).send({
      id: jobId,
      status: 'pending',
      pollUrl: `/api/v1/jobs/${jobId}`,
    })
  })

  fastify.get('/:id', {
    schema: { tags: ['Jobs'] },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }

    if (pgJobQueue) {
      try {
        const job: JobStatusResponse | null = await pgJobQueue.getJob(id)

        if (!job) {
          return reply.code(404).send({
            error: 'Not Found',
            message: `Job ${id} not found or expired.`,
            statusCode: 404,
            timestamp: new Date().toISOString(),
            path: request.url,
          })
        }

        return job
      } catch (err) {
        console.error('[jobs] pg-boss getJob error:', (err as Error).message)
        return reply.code(503).send({
          error: 'Service Unavailable',
          message: 'Job store temporarily unavailable.',
          statusCode: 503,
          timestamp: new Date().toISOString(),
          path: request.url,
        })
      }
    }

    const job = getJob(id)

    if (!job) {
      return reply.code(404).send({
        error: 'Not Found',
        message: `Job ${id} not found or expired.`,
        statusCode: 404,
        timestamp: new Date().toISOString(),
        path: request.url,
      })
    }

    const response: Record<string, unknown> = {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
    }

    if (job.startedAt) response.startedAt = job.startedAt
    if (job.completedAt) response.completedAt = job.completedAt
    if (job.durationMs != null) response.durationMs = job.durationMs
    if (job.metadata) response.metadata = job.metadata

    if (job.status === 'completed' && job.result) {
      response.result = job.result
    }

    if (job.status === 'failed' && job.error) {
      response.error = job.error
    }

    return response
  })
}
