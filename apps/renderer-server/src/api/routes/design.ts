import type { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import { designRequestSchema, type DesignRequest } from '../schemas.js'
import { NotFoundError, DesignerError } from '../middleware/error.js'
import { centerArtwork } from '../../designer/ArtworkCenterer.js'
import { buildXastState } from '../../designer/XastBuilder.js'
import { parsePrintAreaBoundingBox } from '../../designer/PrintAreaParser.js'
import { getImageDimensions, stripDataUri } from '../../utils/image-dimensions.js'
import type {
  BoundingBox,
  CenteringResult,
  RegionDimensions,
  ScaleMode,
  StateItem,
} from '../../designer/types.js'

export async function designRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/', {
    schema: {
      tags: ['Design'],
      body: designRequestSchema,
    },
  }, async (request, reply) => {
    const startTime = Date.now()
    const body = request.body as DesignRequest

    const scaleMode = (body.outputConfig?.scaleMode ?? 'contain') as ScaleMode
    const stateValue: Record<string, StateItem[]> = {}

    for (const item of body.items) {
      const region = item.generatorData.regions.find(
        (r: any) => r.id === item.regionId || r.name === item.regionId,
      )

      if (!region) {
        throw new NotFoundError(
          `Region "${item.regionId}" not found in generator data. Available regions: ${item.generatorData.regions.map((r: any) => r.id || r.name).join(', ')}`,
        )
      }

      const regionDimensions: RegionDimensions = {
        pixelsWidth:
          region.dimensions?.pixelsWidth ??
          region.pixelsWidth ??
          region.width ??
          0,
        pixelsHeight:
          region.dimensions?.pixelsHeight ??
          region.pixelsHeight ??
          region.height ??
          0,
      }

      if (!regionDimensions.pixelsWidth || !regionDimensions.pixelsHeight) {
        throw new DesignerError(
          `Region "${item.regionId}" has no valid dimensions (pixelsWidth/pixelsHeight)`,
          400,
        )
      }

      const boundingBox: BoundingBox = parsePrintAreaBoundingBox(region.printArea) ?? {
        x: 0,
        y: 0,
        width: regionDimensions.pixelsWidth,
        height: regionDimensions.pixelsHeight,
      }

      const artworks: CenteringResult[] = []

      for (const image of item.images) {
        const assetId = uuidv4()

        let dims: { width: number; height: number }
        if (image.data) {
          const buffer = stripDataUri(image.data)
          dims = await getImageDimensions(buffer)
        } else {
          dims = { width: image.width!, height: image.height! }
        }

        const result = centerArtwork(
          assetId,
          dims.width,
          dims.height,
          boundingBox,
          scaleMode,
        )

        artworks.push(result)
      }

      const hrefMap = new Map<string, string>()
      for (let i = 0; i < item.images.length; i++) {
        const image = item.images[i]
        const artwork = artworks[i]
        if (image.href) {
          hrefMap.set(artwork.assetId, image.href)
        }
      }

      const xastState = buildXastState(boundingBox, artworks, hrefMap)

      const stateItem: StateItem = {
        regionId: item.regionId,
        records: [{ active: true, value: xastState }],
      }

      for (const size of item.sizes) {
        stateValue[size] = [stateItem]
      }
    }

    reply.header('X-Design-Duration', String(Date.now() - startTime))

    return {
      version: '4' as const,
      value: stateValue,
    }
  })
}
