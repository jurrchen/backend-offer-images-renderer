import type { FastifyInstance } from 'fastify'
import { renderRequestSchema } from '../schemas.js'
import { RenderError } from '../middleware/error.js'
import type { WorkerPoolManager } from '../../workers/WorkerPoolManager.js'
import { analytics, categorizeError } from '../../utils/analytics.js'
import { logger, rootCtx } from '../../logger/index.js'

export async function renderRoutes(fastify: FastifyInstance, opts: { workerPool: WorkerPoolManager }): Promise<void> {
  const { workerPool } = opts

  fastify.post('/', {
    schema: {
      tags: ['Render'],
      body: renderRequestSchema,
    },
  }, async (request, reply) => {
    const startTime = Date.now()
    const ctx = request.ctx ?? rootCtx

    try {
      const { generatorId, image, region, color, view } = request.body as any

      logger.info(ctx, 'Render request', { generatorId, view, color, region })

      if (!workerPool.isInitialized()) {
        throw new RenderError('Worker pool not initialized')
      }

      const queueDepth = workerPool.getStatus().queueDepth

      const result = await workerPool.renderSingle({
        generatorId,
        viewId: view,
        colorName: color,
        regionId: region,
        imageData: image,
      }, ctx.traceID)

      const duration = Date.now() - startTime
      const { assetLoadMs, assetNetworkMs, assetProcessingMs } = result

      logger.info(ctx, 'Render complete', { durationMs: duration, assetLoadMs, assetNetworkMs, assetProcessingMs, bytes: result.buffer.length })

      await analytics.log({
        type: 'single',
        generatorId,
        viewId: view,
        colorName: color,
        imageCount: 1,
        durationMs: duration,
        resolution: 2048,
        assetLoadMs,
        assetNetworkMs,
        assetProcessingMs,
        status: 'success',
        queueDepth,
        requestId: request.requestId,
      })

      const timingHeaders: Record<string, string> = {
        'X-Render-Duration': duration.toString(),
      }
      if (result.timing) {
        timingHeaders['X-T-Switch-Ms'] = result.timing.switchGeneratorMs.toString()
        timingHeaders['X-T-Load-Ms'] = result.timing.loadImagesMs.toString()
        timingHeaders['X-T-Gpu-Ms'] = result.timing.gpuUploadMs.toString()
        timingHeaders['X-T-Render-Ms'] = result.timing.renderMs.toString()
        timingHeaders['X-T-Export-Ms'] = result.timing.exportMs.toString()
        timingHeaders['X-T-Gc-Ms'] = result.timing.gcMs.toString()
        timingHeaders['X-T-Worker-Ms'] = result.timing.totalWorkerMs.toString()
        timingHeaders['X-T-Queue-Ms'] = result.timing.queueWaitMs.toString()
      }

      return reply
        .type('image/png')
        .headers({
          'Cache-Control': 'public, max-age=31536000',
          ...timingHeaders,
        })
        .send(result.buffer)
    } catch (error) {
      logger.error(ctx, 'Render failed', { error })
      const msg = (error as Error).message
      const statusCode = msg.startsWith('Server busy') ? 503 : 500

      analytics.logError({
        endpoint: '/api/v1/render',
        errorCategory: categorizeError(error as Error),
        errorMessage: msg,
        errorStack: (error as Error).stack,
        statusCode,
        generatorId: (request.body as any)?.generatorId,
        requestId: request.requestId,
        durationMs: Date.now() - startTime,
      }).catch(() => {})

      throw new RenderError(msg, statusCode)
    }
  })
}
