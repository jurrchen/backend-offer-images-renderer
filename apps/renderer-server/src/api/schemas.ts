import { z } from 'zod'

/**
 * Schema for single render request
 */
export const renderRequestSchema = z.object({
  generatorId: z.string().min(1, 'Generator ID is required'),
  image: z.string().min(1, 'Image data is required'),
  region: z.string().min(1, 'Region ID is required'),
  color: z.string().min(1, 'Color name is required'),
  view: z.string().min(1, 'View ID is required'),
})

export type RenderRequest = z.infer<typeof renderRequestSchema>

/**
 * Product type presets for automatic product resolution
 */
export const productTypeSchema = z.enum(['bestsellers', 'staff-picked'])
export type ProductType = z.infer<typeof productTypeSchema>

/**
 * Schema for batch render request
 */
export const batchRenderRequestSchema = z
  .object({
    // Generator identification (one of these must resolve to a generator)
    generatorId: z.string().min(1).optional(), // Direct generator ID
    generatorData: z.any().optional(), // Full generator configuration (if provided, used directly)

    // Product resolution options (mutually exclusive) - extracts generatorId from product
    productSlug: z.string().min(1).optional(), // Priority 1: direct slug lookup
    productType: productTypeSchema.optional(), // Priority 2: preset category (bestsellers, staff-picked)
    productQuery: z.string().min(1).optional(), // Priority 3: search query

    images: z
      .array(
        z.object({
          region: z.string().min(1).optional(), // Optional - auto-selects: default > front > back > first available
          data: z.string().min(1, 'Image data is required'),
        })
      )
      .min(1, 'At least one image is required'),
    colors: z.array(z.string().min(1)).optional(), // Optional - if not provided, auto-select light/dark colors
    views: z.array(z.string().min(1)).optional(), // Optional - if not provided, use all available views
    renderSize: z.number().int().positive().optional().default(2048),
    imageFormat: z.enum(['image/png', 'image/jpeg']).optional().default('image/png'),
    imageQuality: z.number().min(0).max(1).optional().default(0.92),
    outputDir: z.string().optional(),

    // Artwork processing options
    artworkQuality: z.number().min(0.1).max(1).optional().default(1), // Quality factor for artwork scaling (0.1-1)
    autoCenter: z.boolean().optional().default(true), // Auto-center artwork within region dimensions

    // Test run tracking
    testRunId: z.string().uuid().optional(), // Links batch analytics to a test run
  })
  .refine(
    (data) => {
      // Only one of productSlug, productType, productQuery can be provided
      const productOptions = [data.productSlug, data.productType, data.productQuery].filter(Boolean)
      return productOptions.length <= 1
    },
    {
      message: 'Only one of productSlug, productType, or productQuery can be provided',
      path: ['productSlug'],
    }
  )
  .refine(
    (data) => {
      // Must have at least one way to resolve the generator
      const hasGenerator = data.generatorId || data.generatorData
      const hasProductResolution = data.productSlug || data.productType || data.productQuery
      return hasGenerator || hasProductResolution
    },
    {
      message: 'Must provide generatorId, generatorData, or a product resolution method (productSlug, productType, productQuery)',
      path: ['generatorId'],
    }
  )

export type BatchRenderRequest = z.infer<typeof batchRenderRequestSchema>

/**
 * Schema for worker status in health response
 */
export const workerStatusSchema = z.object({
  idle: z.number().int().nonnegative(),
  busy: z.number().int().nonnegative(),
})

export type WorkerStatusResponse = z.infer<typeof workerStatusSchema>

/**
 * Schema for process memory metrics
 */
export const memoryMetricsSchema = z.object({
  rssMb: z.number().nonnegative(),
  heapUsedMb: z.number().nonnegative(),
  heapTotalMb: z.number().nonnegative(),
  externalMb: z.number().nonnegative(),
  containerUsedMb: z.number().nonnegative().optional(),
  containerLimitMb: z.number().nonnegative().optional(),
  containerUsagePercent: z.number().nonnegative().optional(),
})

export type MemoryMetrics = z.infer<typeof memoryMetricsSchema>

/**
 * Schema for health check response
 */
export const healthResponseSchema = z.object({
  status: z.enum(['healthy', 'unhealthy']),
  version: z.string(),
  renderer: z.enum(['js', 'rust']),
  workers: z.number().int().nonnegative(),
  workerStatus: workerStatusSchema.optional(),
  queueDepth: z.number().int().nonnegative().optional(),
  uptime: z.number().nonnegative(),
  memory: memoryMetricsSchema.optional(),
  authEnabled: z.boolean().optional(),
  generators: z
    .array(
      z.object({
        id: z.string(),
        active: z.boolean(),
        printMethod: z.string(),
        viewCount: z.number(),
        colorCount: z.number(),
      })
    )
    .optional(),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>

/**
 * Schema for batch render response
 */
export const batchRenderResponseSchema = z.object({
  results: z.array(
    z.object({
      image: z.string(), // base64 encoded
      color: z.string(),
      view: z.string(),
      region: z.string(),
    })
  ),
  count: z.number().int().nonnegative(),
  duration: z.number().nonnegative().optional(),
})

export type BatchRenderResponse = z.infer<typeof batchRenderResponseSchema>

/**
 * Schema for error response
 */
export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number().int(),
  timestamp: z.string().datetime(),
  path: z.string().optional(),
})

export type ErrorResponse = z.infer<typeof errorResponseSchema>

/**
 * Schema for async job request (POST /api/v1/jobs)
 * Each generator covers a set of product sizes; images are pre-uploaded CDN URLs.
 */
export const jobRequestSchema = z.object({
  generators: z.array(
    z.object({
      generatorData: z
        .object({ regions: z.array(z.any()).min(1) })
        .passthrough(),
      sizes: z.array(z.string().min(1)).min(1),
    })
  ).min(1),
  images: z.array(
    z.object({
      region: z.string().min(1),
      url: z.string().url(),
    })
  ).min(1),
  colors: z.array(z.string().min(1)).optional(),
  views: z.array(z.string().min(1)).optional(),
  type: z.enum(['preview', 'offer']),
  renderSize: z.number().int().positive().optional().default(2048),
})

export type JobRequest = z.infer<typeof jobRequestSchema>

/**
 * Schema for a single item in a design request
 */
const designItemSchema = z.object({
  generatorData: z.object({
    regions: z.array(z.any()).min(1, 'At least one region is required'),
  }).passthrough(),
  regionId: z.string().min(1, 'regionId is required'),
  images: z.array(
    z.object({
      data: z.string().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      href: z.string().url().optional(), // pre-provided CDN URL → populates XAST href
    }).refine(
      (img) => img.data || (img.width && img.height),
      { message: 'Provide either data (base64) or both width + height' },
    ),
  ).min(1, 'At least one image is required'),
  sizes: z.array(z.string().min(1)).min(1, 'At least one size is required'),
})

/**
 * Schema for design request
 */
export const designRequestSchema = z.object({
  items: z.array(designItemSchema).min(1, 'At least one item is required'),
  outputConfig: z.object({
    scaleMode: z.enum(['contain', 'cover', 'natural']).optional(),
    backgroundColor: z.string().optional(),
  }).optional(),
})

export type DesignRequest = z.infer<typeof designRequestSchema>
