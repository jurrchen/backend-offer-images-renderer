import type { FastifyInstance } from 'fastify'
import { batchRenderRequestSchema } from '../schemas.js'
import type { BatchRenderResponse } from '../schemas.js'
import { RenderError } from '../middleware/error.js'
import type { WorkerPoolManager } from '../../workers/WorkerPoolManager.js'
import { analytics, categorizeError } from '../../utils/analytics.js'
import { fourthwallApi } from '../../services/FourthwallApiService.js'
import { logger, rootCtx } from '../../logger/index.js'

export async function batchRoutes(fastify: FastifyInstance, opts: { workerPool: WorkerPoolManager }): Promise<void> {
  const { workerPool } = opts

  fastify.post('/', {
    schema: {
      tags: ['Render'],
      body: batchRenderRequestSchema,
    },
  }, async (request, reply) => {
    const startTime = Date.now()
    const ctx = request.ctx ?? rootCtx

    try {
      const {
        generatorId: providedGeneratorId,
        images,
        colors: providedColors,
        views: providedViews,
        renderSize,
        imageFormat,
        imageQuality,
        outputDir,
        generatorData: providedGeneratorData,
        productSlug,
        productType,
        productQuery,
        artworkQuality,
        autoCenter,
        testRunId,
      } = request.body as any

      if (!workerPool.isInitialized()) {
        throw new RenderError('Worker pool not initialized')
      }

      const {
        generatorData: resolvedGeneratorData,
        generatorId,
        source: generatorSource,
        fetchMs: generatorFetchMs,
        productResolved,
      } = await fourthwallApi.resolveGenerator({
        generatorId: providedGeneratorId,
        generatorData: providedGeneratorData,
        productSlug,
        productType,
        productQuery,
      })

      const colors = providedColors ?? fourthwallApi.getAutoColors(resolvedGeneratorData)
      const views = providedViews ?? fourthwallApi.getAvailableViews(resolvedGeneratorData)

      const defaultRegion = fourthwallApi.getDefaultRegion(resolvedGeneratorData)
      logger.debug(ctx, 'Default region resolved', { defaultRegion, regionCount: resolvedGeneratorData.regions?.length || 0 })

      const imagesWithRegion = images.map((img: { region?: string; data: string }) => ({
        region: img.region ?? defaultRegion,
        data: img.data,
      }))

      const regionsAutoSelected = images.some((img: { region?: string }) => !img.region)

      logger.info(ctx, 'Batch render request', {
        generatorId, colors: colors.length, views: views.length,
        imageCount: colors.length * views.length,
        colorsAuto: !providedColors, viewsAuto: !providedViews, regionAuto: regionsAutoSelected,
        generatorSource, generatorFetchMs,
      })

      const requestedRegions = imagesWithRegion.map((img: { region: string }) => img.region)
      try {
        fourthwallApi.validateRegions(resolvedGeneratorData, requestedRegions)
      } catch (error) {
        throw new RenderError((error as Error).message, 400)
      }

      const queueDepth = workerPool.getStatus().queueDepth

      const result = await workerPool.renderBatch(
        {
          generatorId,
          images: imagesWithRegion,
          colors,
          views,
          renderSize,
          imageFormat,
          imageQuality,
          outputDir,
          artworkQuality,
          autoCenter,
          generatorData: resolvedGeneratorData,
        },
        resolvedGeneratorData,
        ctx.traceID,
      )

      const duration = Date.now() - startTime
      const { assetLoadMs, assetNetworkMs, assetProcessingMs, results } = result

      logger.info(ctx, 'Batch render complete', { durationMs: duration, imageCount: results.length, assetLoadMs, assetNetworkMs, assetProcessingMs })

      const printMethod = (resolvedGeneratorData.regions?.[0] as any)?.productionMethod || 'UNKNOWN'

      await analytics.log({
        type: 'batch',
        generatorId,
        imageCount: results.length,
        durationMs: duration,
        resolution: renderSize,
        assetLoadMs,
        assetNetworkMs,
        assetProcessingMs,
        status: 'success',
        outputDir,
        printMethod,
        testRunId,
        queueDepth,
        requestId: request.requestId,
      })

      const MAX_IMAGES_IN_RESPONSE = 20
      const shouldLimitResponse = results.length > MAX_IMAGES_IN_RESPONSE

      if (shouldLimitResponse) {
        logger.warn(ctx, 'Large batch, limiting response', { totalImages: results.length, returnedImages: MAX_IMAGES_IN_RESPONSE })
      }

      const response: BatchRenderResponse = {
        results: results
          .slice(0, shouldLimitResponse ? MAX_IMAGES_IN_RESPONSE : results.length)
          .map(r => ({
            image: Buffer.from(r.buffer).toString('base64'),
            color: r.color,
            view: r.view,
            region: r.region,
          })),
        count: results.length,
        duration,
      }

      const responseHeaders: Record<string, string> = {
        'X-Render-Duration': duration.toString(),
        'X-Render-Count': results.length.toString(),
        'X-Render-Returned': response.results.length.toString(),
        'X-Render-Truncated': shouldLimitResponse ? 'true' : 'false',
        'X-Generator-Id': generatorId,
        'X-Generator-Source': generatorSource,
        'X-Generator-Fetch-Ms': generatorFetchMs.toString(),
        'X-Colors-Used': colors.join(','),
        'X-Views-Used': views.join(','),
        'X-Regions-Used': [...new Set(requestedRegions)].join(','),
        'X-Colors-Auto': providedColors ? 'false' : 'true',
        'X-Views-Auto': providedViews ? 'false' : 'true',
        'X-Regions-Auto': regionsAutoSelected ? 'true' : 'false',
        'X-Print-Method': printMethod,
      }

      if (result.timing) {
        responseHeaders['X-T-Switch-Ms'] = result.timing.switchGeneratorMs.toString()
        responseHeaders['X-T-Load-Ms'] = result.timing.loadImagesMs.toString()
        responseHeaders['X-T-Gpu-Ms'] = result.timing.gpuUploadMs.toString()
        responseHeaders['X-T-Render-Ms'] = result.timing.renderMs.toString()
        responseHeaders['X-T-Export-Ms'] = result.timing.exportMs.toString()
        responseHeaders['X-T-Gc-Ms'] = result.timing.gcMs.toString()
        responseHeaders['X-T-Worker-Ms'] = result.timing.totalWorkerMs.toString()
        responseHeaders['X-T-Queue-Ms'] = result.timing.queueWaitMs.toString()
      }

      if (productResolved) {
        responseHeaders['X-Product-Resolved'] = productResolved
      }

      return reply
        .headers(responseHeaders)
        .send(response)
    } catch (error) {
      logger.error(ctx, 'Batch render failed', { error })

      const msg = (error as Error).message
      const statusCode = error instanceof RenderError
        ? (error as any).statusCode || 500
        : msg.startsWith('Server busy') ? 503 : 500

      const printMethod = (request.body as any)?.generatorData?.regions?.[0]?.productionMethod
      analytics.logError({
        endpoint: '/api/v1/render/batch',
        errorCategory: categorizeError(error as Error),
        errorMessage: msg,
        errorStack: (error as Error).stack,
        statusCode,
        generatorId: (request.body as any)?.generatorId,
        printMethod,
        requestId: request.requestId,
        durationMs: Date.now() - startTime,
      }).catch(() => {})

      if (error instanceof RenderError) {
        throw error
      }
      throw new RenderError(msg, statusCode)
    }
  })
}
