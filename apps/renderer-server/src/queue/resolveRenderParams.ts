/**
 * resolveRenderParams — extract and resolve all render parameters from a raw request body.
 *
 * Shared by PgJobQueue worker and any future callers. Mirrors the resolution logic in
 * src/api/routes/batch.ts so the pg-boss worker produces identical results to the sync path.
 */

import { fourthwallApi } from '../services/FourthwallApiService.js'
import { RenderError } from '../api/middleware/error.js'
import type { BatchRenderParams } from '../workers/types.js'

export interface ResolvedRenderParams {
  // Params ready to pass to workerPool.renderBatch()
  batchParams: BatchRenderParams
  generatorData: any
  // Resolution metadata (for analytics / Pub/Sub message)
  generatorId: string
  generatorSource: string
  generatorFetchMs: number
  productResolved?: string
  colors: string[]
  views: string[]
  requestedRegions: string[]
  printMethod: string
}

export async function resolveRenderParams(body: Record<string, unknown>): Promise<ResolvedRenderParams> {
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
  } = body as any

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

  const colors: string[] = providedColors ?? fourthwallApi.getAutoColors(resolvedGeneratorData)
  const views: string[] = providedViews ?? fourthwallApi.getAvailableViews(resolvedGeneratorData)

  const defaultRegion = fourthwallApi.getDefaultRegion(resolvedGeneratorData)
  const imagesWithRegion = (images as any[]).map((img: { region?: string; data: string }) => ({
    region: img.region ?? defaultRegion,
    data: img.data,
  }))

  const requestedRegions = imagesWithRegion.map((img: { region: string }) => img.region)

  try {
    fourthwallApi.validateRegions(resolvedGeneratorData, requestedRegions)
  } catch (error) {
    throw new RenderError((error as Error).message, 400)
  }

  const printMethod: string = (resolvedGeneratorData.regions?.[0] as any)?.productionMethod || 'UNKNOWN'

  const batchParams: BatchRenderParams = {
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
  }

  return {
    batchParams,
    generatorData: resolvedGeneratorData,
    generatorId,
    generatorSource,
    generatorFetchMs,
    productResolved,
    colors,
    views,
    requestedRegions,
    printMethod,
  }
}
