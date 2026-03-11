import { ProductRendererV2, ProductRenderer } from '@fourthwall/product-renderer'
import type { ProductRendererParameters } from '@fourthwall/product-renderer/dist/index.js'
import type { BulkDrawResolve } from '@fourthwall/product-renderer/dist/types.js'
import { createCanvas, Image, Canvas } from 'canvas'
import gl from 'gl'
import { rendererConfig } from '@fourthwall/product-renderer/dist/constants.js'
import { Buffer } from 'node:buffer'
import { readFileSync, existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { LRUCache } from 'lru-cache'
import { WebGLRenderTarget, FloatType } from 'three'
import { logger, rootCtx, withContext } from '../logger/index.js'
import type { LogContext } from '../logger/index.js'

// Module-level context for this worker process (set once, used for all non-job logs)
const workerCtx: LogContext = withContext(rootCtx, {
  workerID: process.env.WORKER_ID ? `render-worker-${process.env.WORKER_ID}` : undefined,
})

// ============================================================================
// In-Memory LRU Cache for Assets (P0 Performance Optimization)
// ============================================================================

// Hit/miss/eviction counters for cache analytics
let textureHits = 0, textureMisses = 0, textureEvictions = 0
let meshHits = 0, meshMisses = 0, meshEvictions = 0

// Cache for decoded image/texture buffers - check this BEFORE disk cache
const textureMemoryCache = new LRUCache<string, Buffer>({
  max: 30,  // Max 30 entries
  maxSize: 200 * 1024 * 1024,  // 200MB max total size
  sizeCalculation: (value: Buffer) => value.length,
  ttl: 1000 * 60 * 15,  // 15 minute TTL
  dispose: () => { textureEvictions++ },
})

// Cache for parsed mesh/GLB data buffers
const meshMemoryCache = new LRUCache<string, Buffer>({
  max: 15,  // Max 15 entries
  maxSize: 50 * 1024 * 1024,  // 50MB max total size
  sizeCalculation: (value: Buffer) => value.length,
  ttl: 1000 * 60 * 15,  // 15 minute TTL
  dispose: () => { meshEvictions++ },
})

// Helper to determine if URL is likely a mesh (GLB/GLTF) or texture
const isMeshUrl = (url: string): boolean => {
  const lowerUrl = url.toLowerCase()
  return lowerUrl.includes('.glb') || lowerUrl.includes('.gltf') || lowerUrl.includes('/mesh/')
}

// Get appropriate cache based on asset type
const getMemoryCache = (url: string): LRUCache<string, Buffer> => {
  return isMeshUrl(url) ? meshMemoryCache : textureMemoryCache
}

// Export cache stats for monitoring
export const getCacheStats = () => ({
  texture: {
    size: textureMemoryCache.calculatedSize,
    maxSize: 200 * 1024 * 1024,
    entries: textureMemoryCache.size,
    maxEntries: 30,
    hits: textureHits,
    misses: textureMisses,
    evictions: textureEvictions,
  },
  mesh: {
    size: meshMemoryCache.calculatedSize,
    maxSize: 50 * 1024 * 1024,
    entries: meshMemoryCache.size,
    maxEntries: 15,
    hits: meshHits,
    misses: meshMisses,
    evictions: meshEvictions,
  },
})

// Reset all cache counters to 0 (useful for periodic reporting)
export const resetCacheCounters = () => {
  textureHits = 0; textureMisses = 0; textureEvictions = 0
  meshHits = 0; meshMisses = 0; meshEvictions = 0
}

// Polyfill `self` — Three.js GLTFLoader references it in loadImageSource (browser/Web Worker global)
if (typeof globalThis.self === 'undefined') {
  ;(globalThis as any).self = globalThis
}

// Negative cache for CDN paths that returned 404 (prevents hammering CDN for deleted assets)
const NEGATIVE_CACHE_TTL_MS = 60_000 // 60 seconds
const negativeCacheMap = new Map<string, number>() // cdnPath → expiry timestamp

// Global fetch polyfill to handle local proxy URLs and avoid circular dependency/startup issues
// This must be applied at the top level to catch all fetches from libraries like Three.js
// Enhanced with in-memory LRU cache (P0 Performance Optimization)
const originalFetch = global.fetch
global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url)

  const isLocalProxy = url && url.includes('/assets/cdn/')
  const isOriginalCdn = url && url.includes('cdn.fourthwall.com/')

  if (isLocalProxy || isOriginalCdn) {
    let cdnPath: string
    if (isLocalProxy) {
      cdnPath = url.split('/assets/cdn/')[1]
    } else {
      cdnPath = url.split('cdn.fourthwall.com/')[1]
    }

    const cacheKey = cdnPath
    const memoryCache = getMemoryCache(url)
    const localPath = path.join(process.cwd(), 'assets', 'cdn', cdnPath)

    // 0. Check negative cache (fast-fail for known 404s)
    const negativeExpiry = negativeCacheMap.get(cacheKey)
    if (negativeExpiry !== undefined) {
      if (Date.now() < negativeExpiry) {
        logger.debug(workerCtx, 'Asset negative cache hit (404)', { cdnPath })
        return new Response(null, { status: 404, statusText: 'Not Found (cached)' })
      }
      // TTL expired — remove stale entry
      negativeCacheMap.delete(cacheKey)
    }

    // 1. Check in-memory cache FIRST (fastest)
    const memoryCached = memoryCache.get(cacheKey)
    if (memoryCached) {
      if (isMeshUrl(url)) { meshHits++ } else { textureHits++ }
      logger.debug(workerCtx, 'Asset memory cache hit', { cdnPath })
      return new Response(new Uint8Array(memoryCached))
    }

    // 2. Check disk cache (disk hit = memory miss)
    if (existsSync(localPath)) {
      try {
        if (isMeshUrl(url)) { meshMisses++ } else { textureMisses++ }
        logger.debug(workerCtx, 'Asset disk cache hit', { cdnPath })
        const buffer = readFileSync(localPath)
        // Populate memory cache for next time
        memoryCache.set(cacheKey, buffer)
        return new Response(new Uint8Array(buffer))
      } catch (e) {
        logger.error(workerCtx, 'Failed to read asset from disk cache', { cdnPath, error: e })
      }
    }

    // 3. Network fetch (slowest)
    if (isMeshUrl(url)) { meshMisses++ } else { textureMisses++ }
    const targetUrl = isOriginalCdn ? url : `https://cdn.fourthwall.com/${cdnPath}`
    logger.debug(workerCtx, 'Asset cache miss, fetching from CDN', { cdnPath })

    const response = await originalFetch(targetUrl, init)

    // Cache the response buffer in both memory and disk
    if (response.ok) {
      const cacheBuffer = Buffer.from(await response.clone().arrayBuffer())

      // Save to memory cache immediately (sync, fast)
      memoryCache.set(cacheKey, cacheBuffer)

      // Save to disk cache async (fire and forget)
      mkdir(path.dirname(localPath), { recursive: true })
        .then(() => writeFile(localPath, cacheBuffer))
        .then(() => logger.debug(workerCtx, 'Asset cached to disk', { cdnPath }))
        .catch(err => logger.error(workerCtx, 'Failed to cache asset to disk', { cdnPath, error: err }))
    } else if (response.status === 404) {
      // Store in negative cache to avoid repeated CDN hits for deleted assets
      negativeCacheMap.set(cacheKey, Date.now() + NEGATIVE_CACHE_TTL_MS)
      logger.debug(workerCtx, 'Asset 404 cached (negative cache)', { cdnPath, ttlSec: NEGATIVE_CACHE_TTL_MS / 1000 })
    }

    return response
  }
  return originalFetch(input, init)
}

export interface RenderParams {
  generatorId: string
  viewId: string
  colorName: string
  regionId: string
  imageData: Buffer | string // base64 or buffer
}

export interface BatchRenderParams {
  generatorId: string
  images: Array<{
    region: string
    data: string // base64
  }>
  colors: string[]
  views: string[]
  renderSize?: number
  imageFormat?: string
  imageQuality?: number
  outputDir?: string
  // Artwork processing options
  artworkQuality?: number // Quality factor for artwork scaling (0.1-1), default 1
  autoCenter?: boolean    // Auto-center artwork within region dimensions, default true
  generatorData?: any     // Generator data for looking up region dimensions
}

export interface RenderResult {
  buffer: Buffer
  color: string
  view: string
  region: string
  assetLoadMs?: number
}

/**
 * Granular per-phase render timing collected inside renderSingle/renderBatch
 */
export interface RenderTiming {
  queueWaitMs: number        // time waiting in pool queue (filled by WorkerPoolManager)
  switchGeneratorMs: number  // switchGeneratorSafe() — mesh/texture loading
  loadImagesMs: number       // loadImageToCanvas() / loadImageToCanvasProcessed() total
  gpuUploadMs: number        // regionCanvasToActiveGeneratorTexture() total
  renderMs: number           // renderer.update() or bulkDrawActiveGenerator()
  exportMs: number           // toBlob() + blobToBuffer()
  gcMs: number               // global.gc()
  totalWorkerMs: number      // full renderSingle/renderBatch wall time
}

function logMemory(label: string, ctx: LogContext = workerCtx): void {
  const usage = process.memoryUsage()
  logger.debug(ctx, `memory [${label}]`, {
    rssMb: Math.round(usage.rss / 1024 / 1024),
    heapUsedMb: Math.round(usage.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(usage.heapTotal / 1024 / 1024),
    externalMb: Math.round(usage.external / 1024 / 1024),
    arrayBuffersMb: Math.round(usage.arrayBuffers / 1024 / 1024),
  })
}

let liveTextures = 0
let liveFramebuffers = 0
let liveBuffers = 0

/**
 * HeadlessRenderer wraps ProductRendererV2 to work in a Node.js environment
 * with headless WebGL (gl) instead of browser WebGL
 */
export class HeadlessRenderer {
  private renderer: ProductRendererV2 | null = null
  private canvas: Canvas | null = null
  private glContext: WebGLRenderingContext | null = null
  private initialized = false
  private setupCalled = false
  private generatorConfig: ProductRendererParameters['generators'] = []
  private initialGeneratorIds = new Set<string>()

  // Asset timing tracking (wall-clock)
  private assetPhaseStartTime = 0
  private lastAssetNetworkMs = 0
  private lastAssetProcessingMs = 0

  // Granular per-phase render timing (set at end of renderSingle/renderBatch)
  private lastTiming: RenderTiming | null = null

  constructor(private canvasSize = 2048) {}

  /**
   * Get network time (actual fetch duration) for the last operation
   */
  getLastAssetNetworkTime(): number {
    return this.lastAssetNetworkMs
  }

  /**
   * Get processing time (parsing, GPU upload) for the last operation
   */
  getLastAssetProcessingTime(): number {
    return this.lastAssetProcessingMs
  }

  /**
   * Get total asset loading time (wall-clock) for the last operation
   */
  getLastAssetLoadTime(): number {
    return this.lastAssetNetworkMs + this.lastAssetProcessingMs
  }

  /**
   * Get granular per-phase timing for the last render operation
   */
  getLastTiming(): RenderTiming | null {
    return this.lastTiming
  }

  /**
   * Reset asset load time trackers
   */
  resetAssetLoadTime(): void {
    this.assetPhaseStartTime = 0
    this.lastAssetNetworkMs = 0
    this.lastAssetProcessingMs = 0
  }

  /**
   * Mark the start of asset loading phase
   */
  private startAssetPhase(): void {
    this.assetPhaseStartTime = Date.now()
  }

  /**
   * Mark the end of asset loading phase
   */
  private endAssetPhase(): void {
    if (this.assetPhaseStartTime > 0) {
      const totalWallClock = Date.now() - this.assetPhaseStartTime
      // Processing time = wall-clock - network (network is tracked individually in fetch polyfill)
      this.lastAssetProcessingMs = Math.max(0, totalWallClock - this.lastAssetNetworkMs)
    }
  }

  /**
   * Initialize the headless renderer with generator configurations
   */
  async initialize(generators: ProductRendererParameters['generators']): Promise<void> {
    if (this.initialized) {
      logger.warn(workerCtx, 'HeadlessRenderer already initialized')
      return
    }

    logger.info(workerCtx, 'HeadlessRenderer initializing', { canvasSize: this.canvasSize })

    this.generatorConfig = generators

    // Infer printMethod from regions' productionMethod if missing
    generators.forEach(gen => {
      if (!gen.printMethod && (gen as any).regions && (gen as any).regions.length > 0) {
        const productionMethod = (gen as any).regions[0].productionMethod
        if (productionMethod) {
          gen.printMethod = productionMethod
          logger.debug(workerCtx, 'Inferred printMethod for generator', { generatorId: gen.id, printMethod: productionMethod })
        }
      }
    })

    // Ensure at least one generator is marked as active
    const hasActiveGenerator = generators.some(g => g.active)
    if (!hasActiveGenerator && generators.length > 0) {
      logger.debug(workerCtx, 'No active generator found, marking first as active', { generatorId: generators[0].id })
      generators[0].active = true
    }

    // Polyfill document.createElement for Node.js environment
    if (typeof document === 'undefined') {
      (global as any).document = {
        createElement: (tagName: string) => {
          if (tagName === 'canvas') return createCanvas(1, 1)
          if (tagName === 'img') {
            // Return a Canvas that behaves like an Image element
            // This fixes the texImage2D issue - @kmamal/gl accepts Canvas but not Image
            const canvas = createCanvas(1, 1) as any
            canvas.onload = null
            canvas.onerror = null
            let _src = ''

            // Add addEventListener/removeEventListener for Three.js compatibility
            canvas.addEventListener = function (event: string, handler: (...args: any[]) => void) {
              if (event === 'load') this.onload = handler
              if (event === 'error') this.onerror = handler
            }
            canvas.removeEventListener = function () {}

            // Add src property that loads image data into the canvas
            Object.defineProperty(canvas, 'src', {
              set: (url: string) => {
                _src = url
                if (url && url.startsWith('http')) {
                  // Fetch the image and draw it onto the canvas
                  // The global fetch polyfill handles local caching and redirection automatically
                  const startFetch = Date.now()
                  fetch(url)
                    .then((res) => res.arrayBuffer())
                    .then((arrayBuffer) => {
                      const fetchDuration = Date.now() - startFetch
                      // Track network time (individual fetches, even if parallel)
                      this.lastAssetNetworkMs += fetchDuration
                      
                      const img = new Image()
                      img.src = Buffer.from(arrayBuffer)

                      // Resize canvas to match image
                      canvas.width = img.width
                      canvas.height = img.height

                      // Draw image onto canvas
                      const ctx = canvas.getContext('2d')
                      ctx.drawImage(img, 0, 0)

                      // Trigger onload
                      if (canvas.onload) {
                        canvas.onload()
                      }
                    })
                    .catch((err) => {
                      if (canvas.onerror) canvas.onerror(err as any)
                    })
                } else if (url && url.startsWith('data:')) {
                  // Handle data URLs
                  try {
                    const base64Data = url.split(',')[1]
                    const buffer = Buffer.from(base64Data, 'base64')
                    const img = new Image()
                    img.src = buffer

                    canvas.width = img.width
                    canvas.height = img.height

                    const ctx = canvas.getContext('2d')
                    ctx.drawImage(img, 0, 0)

                    if (canvas.onload) {
                      setTimeout(() => canvas.onload(), 0)
                    }
                  } catch (err) {
                    if (canvas.onerror) {
                      setTimeout(() => canvas.onerror(err), 0)
                    }
                  }
                } else if (url) {
                  // Handle local file paths (for heather texture, etc.)
                  try {
                    let filePath = url
                    // Remove file:// protocol if present
                    if (url.startsWith('file://')) {
                      filePath = url.replace('file://', '')
                    }

                    if (existsSync(filePath)) {
                      const buffer = readFileSync(filePath)
                      const img = new Image()
                      img.src = buffer

                      canvas.width = img.width
                      canvas.height = img.height

                      const ctx = canvas.getContext('2d')
                      ctx.drawImage(img, 0, 0)

                      if (canvas.onload) {
                        setTimeout(() => canvas.onload(), 0)
                      }
                    } else {
                      throw new Error(`File not found: ${filePath}`)
                    }
                  } catch (err) {
                    if (canvas.onerror) {
                      setTimeout(() => canvas.onerror(err), 0)
                    }
                  }
                }
              },
              get() {
                return _src
              },
            })

            return canvas
          }
          return {
            style: {},
            setAttribute: () => {},
            getAttribute: () => null,
            addEventListener: () => {},
            removeEventListener: () => {},
          }
        },
        createElementNS: (_ns: string, tagName: string) => {
          return (global as any).document.createElement(tagName)
        },
      }
    }

    // Polyfill FileReader for ProductRendererV2.bulkDrawActiveGenerator
    if (typeof (global as any).FileReader === 'undefined') {
      (global as any).FileReader = class FileReader {
        onloadend: (() => void) | null = null
        result: string | null = null
        readAsDataURL(blob: Blob) {
          blob.arrayBuffer().then((buffer) => {
            const base64 = Buffer.from(buffer).toString('base64')
            this.result = `data:${blob.type};base64,${base64}`
            if (this.onloadend) {
              setTimeout(() => this.onloadend!(), 0)
            }
          })
        }
      }
    }

    // Polyfill navigator for Node.js environment (needed by texture loader)
    if (typeof navigator === 'undefined') {
      (global as any).navigator = {
        userAgent: 'Node.js HeadlessRenderer',
      }
    }

    // Polyfill ProgressEvent for GLTFLoader
    if (typeof ProgressEvent === 'undefined') {
      (global as any).ProgressEvent = class ProgressEvent {
        lengthComputable: boolean
        loaded: number
        total: number
        type: string

        constructor(type: string, options: any = {}) {
          this.type = type
          this.lengthComputable = options.lengthComputable || false
          this.loaded = options.loaded || 0
          this.total = options.total || 0
        }
      }
    }

    // Create headless canvas
    this.canvas = createCanvas(this.canvasSize, this.canvasSize)
    logger.debug(workerCtx, 'Canvas created', { canvasSize: this.canvasSize })

    // Create headless WebGL context using gl (headless-gl)
    try {
      logger.debug(workerCtx, 'Creating GL context', { canvasSize: this.canvasSize })
      const rawContext = gl(this.canvasSize, this.canvasSize, {
        alpha: true,
        depth: true,
        stencil: true,
        antialias: false,
        premultipliedAlpha: false, // Must match ProductRendererV2's setting
        preserveDrawingBuffer: true,
      })
      logger.debug(workerCtx, 'GL context created', { hasContext: !!rawContext })

      this.glContext = rawContext as unknown as WebGLRenderingContext

      // --- GL OBJECT TRACKING ---
      const glCtx = this.glContext as any
      const origCreateTexture = glCtx.createTexture.bind(glCtx)
      const origDeleteTexture = glCtx.deleteTexture.bind(glCtx)
      glCtx.createTexture = function () { liveTextures++; return origCreateTexture() }
      glCtx.deleteTexture = function (tex: any) { liveTextures--; return origDeleteTexture(tex) }

      const origCreateFramebuffer = glCtx.createFramebuffer.bind(glCtx)
      const origDeleteFramebuffer = glCtx.deleteFramebuffer.bind(glCtx)
      glCtx.createFramebuffer = function () { liveFramebuffers++; return origCreateFramebuffer() }
      glCtx.deleteFramebuffer = function (fb: any) { liveFramebuffers--; return origDeleteFramebuffer(fb) }

      const origCreateBuffer = glCtx.createBuffer.bind(glCtx)
      const origDeleteBuffer = glCtx.deleteBuffer.bind(glCtx)
      glCtx.createBuffer = function () { liveBuffers++; return origCreateBuffer() }
      glCtx.deleteBuffer = function (buf: any) { liveBuffers--; return origDeleteBuffer(buf) }
      logger.debug(workerCtx, 'GL context patched for object tracking')
      // --- END GL OBJECT TRACKING ---

      // Log GPU/renderer info
      this.logGpuInfo()

      // Patch missing WebGL extensions that Three.js needs for embroidery
      this.patchWebGLExtensions()

      logger.info(workerCtx, 'WebGL context ready')
    } catch (error) {
      logger.error(workerCtx, 'Failed to create GL context', { error })
      throw error
    }

    // Patch canvas to work with headless GL
    logger.debug(workerCtx, 'Patching canvas for headless GL')
    this.patchCanvas()

    // Override renderer config for headless mode
    // bufferSize stays at 4096 (default) for full-quality embroidery & artwork rendering.
    // textures.buffer has samples:2 (MSAA) but Three.js MSAA allocation is gated by
    // isWebGL2 checks — headless-gl is WebGL1, so samples:2 is silently ignored.
    rendererConfig.pixelRatio = 1
    logger.debug(workerCtx, 'Headless rendererConfig set', { bufferSize: rendererConfig.bufferSize, pixelRatio: rendererConfig.pixelRatio })

    // Initialize ProductRendererV2 with headless context
    try {
      this.renderer = new ProductRendererV2({
        webglCanvas: this.canvas as unknown as HTMLCanvasElement,
        generators: this.generatorConfig,
        forceFloatTextures: true, // Use FloatType (32-bit) RTs — headless-gl supports OES_texture_float
      } as any)

      // Only call setup() if we have generators (static mode)
      // In dynamic mode (0 generators), setup() will be called when first generator is added
      if (generators.length > 0) {
        logger.info(workerCtx, 'ProductRendererV2 setup starting', { generatorCount: generators.length })
        await this.renderer.setup()
        this.setupCalled = true
        this.patchComposerRenderTargets()
        this.hideSobelProcessingPlane()
        logger.info(workerCtx, 'ProductRendererV2 setup complete', {
          generatorCount: generators.length,
          activeGenerator: generators.find(g => g.active)?.id || 'none',
        })
      } else {
        logger.debug(workerCtx, 'Skipping ProductRendererV2 setup — dynamic mode (no generators)')
      }

      // Track which generators were loaded at init time (permanent, never cleaned up)
      this.initialGeneratorIds = new Set(this.generatorConfig.map((g: any) => g.id))

      this.initialized = true
    } catch (error) {
      logger.error(workerCtx, 'Failed to initialize ProductRendererV2', { error })
      throw error
    }
  }

  /**
   * Log GPU/renderer information from WebGL context
   */
  private logGpuInfo(): void {
    if (!this.glContext) return

    const gl = this.glContext as any

    // Get basic renderer info
    const renderer = gl.getParameter(gl.RENDERER)
    const vendor = gl.getParameter(gl.VENDOR)
    const version = gl.getParameter(gl.VERSION)
    const shadingLanguageVersion = gl.getParameter(gl.SHADING_LANGUAGE_VERSION)

    // Try to get unmasked renderer/vendor (more detailed info)
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
    let unmaskedRenderer = renderer
    let unmaskedVendor = vendor
    if (debugInfo) {
      unmaskedRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || renderer
      unmaskedVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || vendor
    }

    // Check if it's software rendering
    const isSoftware = unmaskedRenderer.toLowerCase().includes('llvmpipe') ||
                       unmaskedRenderer.toLowerCase().includes('swiftshader') ||
                       unmaskedRenderer.toLowerCase().includes('software') ||
                       unmaskedRenderer.toLowerCase().includes('mesa')

    logger.info(workerCtx, 'GPU info', {
      renderer: unmaskedRenderer,
      vendor: unmaskedVendor,
      version,
      glsl: shadingLanguageVersion,
      softwareRendering: isSoftware,
    })
    if (isSoftware) {
      logger.warn(workerCtx, 'Software rendering detected (CPU) — performance will be slow')
    }
  }

  /**
   * Patch missing WebGL extensions for Three.js compatibility
   * NOTE: We intentionally do NOT polyfill OES_texture_half_float because:
   * 1. headless-gl doesn't support half-float textures
   * 2. ProductRendererV2 now uses forceFloatTextures flag to use FloatType (32-bit) instead
   * 3. Providing a fake polyfill causes "unloadable texture" errors
   */
  private patchWebGLExtensions(): void {
    if (!this.glContext) {
      return
    }

    // Log which extensions are actually available
    const gl = this.glContext as any
    const floatExt = gl.getExtension('OES_texture_float')
    const floatLinear = gl.getExtension('OES_texture_float_linear')
    const halfFloat = gl.getExtension('OES_texture_half_float')
    logger.debug(workerCtx, 'WebGL extensions', {
      OES_texture_float: !!floatExt,
      OES_texture_float_linear: !!floatLinear,
      OES_texture_half_float: !!halfFloat,
    })
  }

  /**
   * Replace the EffectComposer's HalfFloatType render targets with FloatType.
   * EffectComposer creates internal ping-pong buffers using HalfFloatType,
   * which headless-gl does NOT support (OES_texture_half_float unavailable).
   * This causes UV (and embroidery) post-processing to write to broken
   * framebuffers, producing all-black processedLayer textures.
   */
  private patchComposerRenderTargets(): void {
    const composer = (this.renderer as any)?._composer
    if (!composer) {
      logger.debug(workerCtx, 'No EffectComposer found — skipping render target patch')
      return
    }

    const w = composer.renderTarget1.width
    const h = composer.renderTarget1.height
    logger.debug(workerCtx, 'Patching EffectComposer render targets HalfFloat → Float', { w, h })

    const rt1 = new WebGLRenderTarget(w, h, { type: FloatType })
    rt1.texture.name = 'EffectComposer.rt1'
    const rt2 = rt1.clone()
    rt2.texture.name = 'EffectComposer.rt2'

    composer.renderTarget1.dispose()
    composer.renderTarget2.dispose()
    composer.renderTarget1 = rt1
    composer.renderTarget2 = rt2
    composer.writeBuffer = rt1
    composer.readBuffer = rt2

    logger.debug(workerCtx, 'EffectComposer render targets patched to FloatType')
  }

  /**
   * Hide the Sobel processing plane in scenes.processing to prevent it from
   * overwriting the embroidery stitch pattern.
   *
   * GeneratorInstance.setPreviewPlane() adds a fullscreen Sobel quad at z=-100
   * to scenes.processing. The embroidery processing meshes sit at z=-1000.
   * Since textures.embroidery has depthBuffer:false, there's no depth testing —
   * the Sobel plane renders last (scene insertion order) and overwrites the
   * stitch pattern with neutral gray (~0.5), which is identity in blendOverlay.
   */
  private hideSobelProcessingPlane(): void {
    const activeGen = (this.renderer as any)?.state?.activeGenerator
    if (!activeGen?.scenes?.processing) return

    const children = activeGen.scenes.processing.children
    for (const child of children) {
      if (child.position?.z === -100 && child.geometry?.type === 'PlaneGeometry') {
        child.visible = false
        logger.debug(workerCtx, 'Hidden Sobel processing plane in scenes.processing')
        return
      }
    }
  }

  /**
   * Clear the poisoned _switchInFlight promise on ProductRendererV2.
   *
   * When switchGenerator() fails (e.g. 404 on a mesh), the internal
   * `_switchInFlight` promise is never set back to null because the
   * cleanup line after `await` is unreachable. Every subsequent call
   * to switchGenerator() — even for different generators — re-awaits
   * the rejected promise and throws the same stale error.
   *
   * This method resets that internal field. It degrades gracefully if
   * the property is renamed in a future version (logs a warning, does nothing).
   */
  private clearSwitchInFlight(): void {
    try {
      const renderer = this.renderer as any
      if (renderer && '_switchInFlight' in renderer) {
        renderer._switchInFlight = null
        logger.debug(workerCtx, 'Cleared _switchInFlight on ProductRendererV2')
      } else if (renderer) {
        logger.warn(workerCtx, '_switchInFlight property not found on ProductRendererV2 — may have been renamed')
      }
    } catch (e) {
      logger.warn(workerCtx, 'Failed to clear _switchInFlight', { error: e })
    }
  }

  /**
   * Safe wrapper around renderer.switchGenerator() that recovers from
   * 404 errors caused by stale generators with deleted CDN assets.
   *
   * When a 404 occurs:
   * 1. Clears the poisoned _switchInFlight promise
   * 2. Identifies the stale generator from the error URL
   * 3. If the stale generator is NOT the target, removes it and retries once
   * 4. If the stale generator IS the target, throws immediately (no retry)
   */
  private async switchGeneratorSafe(targetGeneratorId: string): Promise<void> {
    try {
      await this.renderer!.switchGenerator(targetGeneratorId)
    } catch (error: any) {
      const errorMsg = String(error?.message || error || '')
      const is404 = errorMsg.includes('404') || errorMsg.includes('Not Found')

      if (!is404) {
        throw error
      }

      logger.warn(workerCtx, 'switchGenerator hit 404', { targetGeneratorId, error: errorMsg })

      // Clear the poisoned promise so subsequent calls don't re-throw
      this.clearSwitchInFlight()

      // Try to extract the stale generator ID from the error URL
      // Typical mesh URLs: https://cdn.fourthwall.com/.../{generatorId}/.../*.glb
      const staleGeneratorId = this.extractGeneratorIdFromError(errorMsg)

      if (staleGeneratorId && staleGeneratorId === targetGeneratorId) {
        // The requested generator's own assets are 404 — no point retrying
        throw new Error(
          `Generator '${targetGeneratorId}' has missing CDN assets (404). ` +
          `The product's mesh/texture files may have been deleted. Original: ${errorMsg}`
        )
      }

      if (staleGeneratorId) {
        logger.info(workerCtx, 'Removing stale generator and retrying', { staleGeneratorId, targetGeneratorId })
        this.removeGenerator(staleGeneratorId, true)
      } else {
        logger.warn(workerCtx, 'Could not identify stale generator from error, retrying', { targetGeneratorId })
      }

      // Retry once
      try {
        await this.renderer!.switchGenerator(targetGeneratorId)
      } catch (retryError: any) {
        // Clear again in case the retry also poisons _switchInFlight
        this.clearSwitchInFlight()
        throw retryError
      }
    }
  }

  /**
   * Try to extract a generator ID from a 404 error message/URL.
   * Generator config IDs appear in CDN URLs as path segments.
   * Returns the matching generator ID, or undefined if none found.
   */
  private extractGeneratorIdFromError(errorMsg: string): string | undefined {
    for (const gen of this.generatorConfig) {
      const genId = (gen as any).id
      if (genId && errorMsg.includes(genId)) {
        return genId
      }
    }
    return undefined
  }

  /**
   * Clear region textures that are not in the current render's region set.
   * Prevents stale textures from previous renders from leaking into new renders.
   *
   * GeneratorInstance.regionTextureMap accumulates entries across render calls —
   * setRegionTexture() adds to the map but never removes old entries. This causes
   * activateRegionTextures() to make meshes visible for regions from prior renders.
   */
  private clearStaleRegionTextures(keepRegionIds: Set<string>): void {
    const activeGen = (this.renderer as any)?.state?.activeGenerator

    if (!activeGen?.regionTextureMap) {
      return
    }

    const mapEntries = [...activeGen.regionTextureMap.keys()]

    let clearedCount = 0
    for (const [regionId, texture] of activeGen.regionTextureMap) {
      if (!keepRegionIds.has(regionId)) {
        texture.dispose()
        activeGen.regionTextureMap.delete(regionId)
        clearedCount++
      }
    }
    if (clearedCount > 0) {
      logger.debug(workerCtx, 'Cleared stale region textures', { cleared: clearedCount, total: mapEntries.length })
    }
  }

  private forceGLCleanup(): void {
    if (!this.glContext || !this.renderer) return
    const renderer = this.renderer as any
    const gl = this.glContext as any
    if (renderer._renderer?.properties) {
      renderer._renderer.properties.dispose()
    }
    gl.flush()
    gl.finish()
  }

  private disposeCanvas(canvas: Canvas | null): void {
    if (!canvas) return
    try {
      canvas.width = 1
      canvas.height = 1
    } catch {
      // ignore
    }
  }

  private patchCanvas(): void {
    if (!this.canvas || !this.glContext) {
      throw new Error('Canvas or GL context not initialized')
    }

    // Patch getContext to return our headless GL context
    const originalGetContext = this.canvas.getContext.bind(this.canvas)
    const glContext = this.glContext
    ;(this.canvas as any).getContext = function (contextType: string, options?: any) {
      if (contextType === 'webgl' || contextType === 'webgl2') {
        return glContext
      }
      return originalGetContext(contextType as any, options)
    }

    // Add addEventListener stub (required by Three.js)
    if (!(this.canvas as any).addEventListener) {
      (this.canvas as any).addEventListener = function (type: string, listener: any) {
        // Stub - no-op for headless mode
      }
    }

    // Add removeEventListener stub (required by Three.js)
    if (!(this.canvas as any).removeEventListener) {
      (this.canvas as any).removeEventListener = function (type: string, listener: any) {
        // Stub - no-op for headless mode
      }
    }

    // Add style property (required by Three.js)
    if (!(this.canvas as any).style) {
      (this.canvas as any).style = {}
    }

    // Add clientWidth and clientHeight (used by Three.js for resizing)
    Object.defineProperty(this.canvas, 'clientWidth', {
      get: () => this.canvasSize,
    })
    Object.defineProperty(this.canvas, 'clientHeight', {
      get: () => this.canvasSize,
    })

    // Add toBlob method which is used by ProductRendererV2
    // IMPORTANT: This must be SYNCHRONOUS to capture the correct GL framebuffer state
    // before the next render overwrites it
    const self = this
    if (!(this.canvas as any).toBlob) {
      ;(this.canvas as any).toBlob = (
        callback: (blob: Blob | null) => void,
        mimeType = 'image/png',
        quality = 0.92
      ) => {
        try {
          // SYNC: Read pixels from WebGL context immediately after render
          // This MUST happen synchronously before any other render calls
          const glCtx = self.glContext as any
          if (glCtx) {
            // Query actual GL viewport — Three.js renderer.setSize() changes this
            // during bulkDrawActiveGenerator (setCameraAspectRatio sets non-square viewport)
            const viewport = glCtx.getParameter(glCtx.VIEWPORT)
            const width = viewport[2]
            const height = viewport[3]
            const pixels = new Uint8Array(width * height * 4)

            // Synchronous readPixels - required to capture correct frame
            glCtx.readPixels(0, 0, width, height, glCtx.RGBA, glCtx.UNSIGNED_BYTE, pixels)

            // Create a temporary canvas at the correct viewport size
            const tempCanvas = createCanvas(width, height)
            const ctx = tempCanvas.getContext('2d')
            const imgData = ctx.createImageData(width, height)
            const rowSize = width * 4
            for (let y = 0; y < height; y++) {
              const sourceRow = y * rowSize
              const targetRow = (height - 1 - y) * rowSize
              imgData.data.set(pixels.subarray(sourceRow, sourceRow + rowSize), targetRow)
            }
            ctx.putImageData(imgData, 0, 0)

            let buffer: ReturnType<typeof tempCanvas.toBuffer>
            if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
              buffer = tempCanvas.toBuffer('image/jpeg', { quality })
            } else {
              buffer = tempCanvas.toBuffer('image/png', { compressionLevel: 6 })
            }

            // Create a Blob-like object from buffer
            const blob = new Blob([new Uint8Array(buffer)], { type: mimeType })
            self.disposeCanvas(tempCanvas)
            callback(blob)
          } else {
            callback(null)
          }
        } catch (error) {
          logger.error(workerCtx, 'Error in toBlob', { error })
          callback(null)
        }
      }
    }
  }

  /**
   * Render a single image with given parameters
   */
  async renderSingle(params: RenderParams, ctx: LogContext = workerCtx): Promise<Buffer> {
    if (!this.renderer || !this.initialized) {
      throw new Error('HeadlessRenderer not initialized. Call initialize() first.')
    }

    logger.info(ctx, 'Rendering single', { generatorId: params.generatorId, view: params.viewId, color: params.colorName })
    logMemory('before-switch', ctx)
    this.resetAssetLoadTime()

    const isDynamic = !this.initialGeneratorIds.has(params.generatorId)
    const t0 = Date.now()
    let switchGeneratorMs = 0, loadImagesMs = 0, gpuUploadMs = 0, renderMs = 0, exportMs = 0

    try {
      // Start asset loading phase timing
      this.startAssetPhase()

      // 1. Switch to requested generator/view/color (loads meshes and textures)
      const tSwitch0 = Date.now()
      await this.switchGeneratorSafe(params.generatorId)
      switchGeneratorMs = Date.now() - tSwitch0
      this.hideSobelProcessingPlane()
      this.clearStaleRegionTextures(new Set([params.regionId]))
      this.renderer.switchView(params.viewId)
      this.renderer.switchColor(params.colorName)

      // 2. Load image to canvas
      const tLoad0 = Date.now()
      const imageCanvas = await this.loadImageToCanvas(params.imageData)
      loadImagesMs = Date.now() - tLoad0
      logger.debug(ctx, 'Image loaded to canvas', { width: imageCanvas.width, height: imageCanvas.height })

      // 3. Upload texture to GPU
      const tGpu0 = Date.now()
      this.renderer.regionCanvasToActiveGeneratorTexture(
        imageCanvas as unknown as HTMLCanvasElement,
        params.regionId
      )
      gpuUploadMs = Date.now() - tGpu0
      logger.debug(ctx, 'Texture uploaded to region', { regionId: params.regionId })
      logMemory('after-textures', ctx)

      // End asset loading phase timing
      this.endAssetPhase()

      // Update region uniforms to apply the textures
      if (this.renderer.state.activeGenerator) {
        this.renderer.state.activeGenerator.updateRegionUniforms()
        logger.debug(ctx, 'Updated region uniforms')
      }

      // 4. Render
      const tRender0 = Date.now()
      this.renderer.update()
      renderMs = Date.now() - tRender0
      logMemory('after-render', ctx)

      // 5. Export to PNG buffer (toBlob + blobToBuffer)
      const tExport0 = Date.now()
      const buf = await new Promise<Buffer>((resolve, reject) => {
        ;(this.canvas as any).toBlob((blob: Blob | null) => {
          if (!blob) {
            reject(new Error('Failed to create blob'))
            return
          }
          this.blobToBuffer(blob).then((b) => {
            logMemory('after-cleanup', ctx)
            logger.debug(ctx, 'GL objects after renderSingle', { textures: liveTextures, framebuffers: liveFramebuffers, buffers: liveBuffers })
            resolve(b)
          }).catch(reject)
        }, 'image/png')
      })
      exportMs = Date.now() - tExport0
      return buf
    } catch (error) {
      logger.error(ctx, 'Single render failed', { error })
      throw error
    } finally {
      // Mirror renderBatch(): clean up dynamically-added generators
      if (isDynamic) {
        this.removeGenerator(params.generatorId)
      }
      // 6. GC
      const tGc0 = Date.now()
      if (global.gc) global.gc()
      const gcMs = Date.now() - tGc0
      const totalWorkerMs = Date.now() - t0
      this.lastTiming = { queueWaitMs: 0, switchGeneratorMs, loadImagesMs, gpuUploadMs, renderMs, exportMs, gcMs, totalWorkerMs }
      logger.info(ctx, 'Single render timing', { switchMs: switchGeneratorMs, loadMs: loadImagesMs, gpuMs: gpuUploadMs, renderMs, exportMs, gcMs, totalWorkerMs })
    }
  }

  /**
   * Render batch of images using bulkDrawActiveGenerator
   */
  async renderBatch(params: BatchRenderParams, ctx: LogContext = workerCtx): Promise<RenderResult[]> {
    if (!this.renderer || !this.initialized) {
      throw new Error('HeadlessRenderer not initialized. Call initialize() first.')
    }

    logger.info(ctx, 'Batch rendering', { colors: params.colors.length, views: params.views.length })
    logMemory('before-switch', ctx)
    this.resetAssetLoadTime()

    const isDynamic = !this.initialGeneratorIds.has(params.generatorId)
    const t0 = Date.now()
    let switchGeneratorMs = 0, loadImagesMs = 0, gpuUploadMs = 0, renderMs = 0, exportMs = 0

    try {
      logger.debug(ctx, 'Generator config state', {
        configCount: this.generatorConfig.length,
        generatorIds: this.generatorConfig.map((g:any) => g.id),
        initialIds: [...this.initialGeneratorIds],
      })

      // Start asset loading phase timing
      this.startAssetPhase()

      // 1. Switch to requested generator (loads meshes and textures)
      const tSwitch0 = Date.now()
      await this.switchGeneratorSafe(params.generatorId)
      switchGeneratorMs = Date.now() - tSwitch0
      this.hideSobelProcessingPlane()
      this.clearStaleRegionTextures(new Set(params.images.map(img => img.region)))

      // Upload all region textures (with optional artwork processing)
      const artworkQuality = params.artworkQuality ?? 1
      const autoCenter = params.autoCenter ?? true

      for (const image of params.images) {
        // Look up region dimensions from generatorData if provided
        const regionDimensions = params.generatorData
          ? this.getRegionDimensions(params.generatorData, image.region)
          : undefined

        if (regionDimensions) {
          logger.debug(ctx, 'Region dimensions', { region: image.region, width: regionDimensions.pixelsWidth, height: regionDimensions.pixelsHeight })
        }

        // 2. Load and process artwork (accumulated per image)
        const tLoad0 = Date.now()
        const imageCanvas = await this.loadImageToCanvasProcessed(
          image.data,
          regionDimensions,
          artworkQuality,
          autoCenter
        )
        loadImagesMs += Date.now() - tLoad0

        // 3. Upload texture to GPU (accumulated per image)
        const tGpu0 = Date.now()
        this.renderer.regionCanvasToActiveGeneratorTexture(
          imageCanvas as unknown as HTMLCanvasElement,
          image.region
        )
        gpuUploadMs += Date.now() - tGpu0
      }

      // End asset loading phase timing
      this.endAssetPhase()
      logMemory('after-textures', ctx)

      logger.debug(ctx, 'Asset timing', { networkMs: this.lastAssetNetworkMs, processingMs: this.lastAssetProcessingMs, totalMs: this.getLastAssetLoadTime() })

      // Extract regionsDimensions for sticker margin calculations
      const regionsDimensions = params.generatorData
        ? this.getRegionsDimensions(params.generatorData)
        : undefined

      // Map external view names to unique internal view IDs (handles duplicate names)
      const pickedViews = this.mapViewNamesToIds(params.generatorId, params.views)

      // 4. Batch render all colors × views
      const tRender0 = Date.now()
      const results: BulkDrawResolve[] = await this.renderer.bulkDrawActiveGenerator({
        pickedColors: params.colors,
        pickedViews,
        finalRenderSize: params.renderSize || 2048,
        finalImageFormat: params.imageFormat || 'image/png',
        finalImageQuality: params.imageQuality || 0.92,
        finalImageCropRatio: 0,
        regionsBySize: [],
        regionsDimensions,
        background: false,
      })
      renderMs = Date.now() - tRender0

      logger.info(ctx, 'Batch render complete', { imageCount: results.length })
      logMemory('after-bulkdraw', ctx)

      // 5. Convert blobs to buffers
      const tExport0 = Date.now()
      const renderResults = await Promise.all(
        results.map(async (r) => ({
          buffer: await this.blobToBuffer(r.blob),
          color: r.color.name,
          view: params.views[r.position] || '',
          region: r.region,
        }))
      )
      exportMs = Date.now() - tExport0

      return renderResults
    } catch (error) {
      logger.error(ctx, 'Batch render failed', { error })
      throw error
    } finally {
      // Clean up dynamically-added generator to prevent state accumulation.
      // Workers persist across requests — without this, generatorConfig grows
      // indefinitely and stale generators with deleted CDN assets cause 404s.
      if (isDynamic) {
        this.removeGenerator(params.generatorId)
      }
      // 6. GC
      const tGc0 = Date.now()
      if (global.gc) {
        global.gc()
        logger.debug(ctx, 'Forced GC after batch render')
      }
      const gcMs = Date.now() - tGc0
      logMemory('after-cleanup', ctx)
      logger.debug(ctx, 'GL objects after renderBatch', { textures: liveTextures, framebuffers: liveFramebuffers, buffers: liveBuffers })
      const totalWorkerMs = Date.now() - t0
      this.lastTiming = { queueWaitMs: 0, switchGeneratorMs, loadImagesMs, gpuUploadMs, renderMs, exportMs, gcMs, totalWorkerMs }
      logger.info(ctx, 'Batch render timing', { switchMs: switchGeneratorMs, loadMs: loadImagesMs, gpuMs: gpuUploadMs, renderMs, exportMs, gcMs, totalWorkerMs })
    }
  }

  /**
   * Process artwork: scale to fit within region dimensions (contain mode)
   * Preserves aspect ratio, centers image, with transparent letterboxing
   * NON-NEGOTIABLE: aspect ratio must be preserved exactly
   */
  private processArtwork(
    sourceCanvas: Canvas,
    regionDimensions: { pixelsWidth: number; pixelsHeight: number } | undefined,
    quality: number = 1,
    autoCenter: boolean = true
  ): Canvas {
    // If no region dimensions or auto-center disabled, return as-is
    if (!regionDimensions || !autoCenter) {
      logger.debug(workerCtx, 'processArtwork: no region dimensions or autoCenter disabled, using raw image')
      return sourceCanvas
    }

    const targetWidth = Math.round(regionDimensions.pixelsWidth * quality)
    const targetHeight = Math.round(regionDimensions.pixelsHeight * quality)

    const sourceAspect = sourceCanvas.width / sourceCanvas.height
    const targetAspect = targetWidth / targetHeight

    logger.debug(workerCtx, 'Processing artwork (CONTAIN mode)', {
      srcW: sourceCanvas.width, srcH: sourceCanvas.height, targetW: targetWidth, targetH: targetHeight,
      sourceAspect: parseFloat(sourceAspect.toFixed(3)), targetAspect: parseFloat(targetAspect.toFixed(3)),
    })

    // Calculate scale to FIT inside target (contain mode) - use MIN
    const scaleX = targetWidth / sourceCanvas.width
    const scaleY = targetHeight / sourceCanvas.height
    const fitScale = Math.min(scaleX, scaleY)

    const scaledWidth = Math.round(sourceCanvas.width * fitScale)
    const scaledHeight = Math.round(sourceCanvas.height * fitScale)

    // Calculate centering offsets
    const offsetX = Math.round((targetWidth - scaledWidth) / 2)
    const offsetY = Math.round((targetHeight - scaledHeight) / 2)

    logger.debug(workerCtx, 'Artwork fit scale', { fitScalePct: parseFloat((fitScale * 100).toFixed(1)), scaledW: scaledWidth, scaledH: scaledHeight, offsetX, offsetY })

    // Create canvas with EXACT target dimensions
    const processedCanvas = createCanvas(targetWidth, targetHeight)
    const ctx = processedCanvas.getContext('2d')

    // Clear with transparent background
    ctx.clearRect(0, 0, targetWidth, targetHeight)

    // Draw centered and scaled image - preserving aspect ratio
    ctx.drawImage(
      sourceCanvas as any,
      0, 0, sourceCanvas.width, sourceCanvas.height,   // source (full image)
      offsetX, offsetY, scaledWidth, scaledHeight      // destination (centered, scaled)
    )

    logger.debug(workerCtx, 'Artwork processed', { scaledW: scaledWidth, scaledH: scaledHeight, canvasW: targetWidth, canvasH: targetHeight })

    return processedCanvas
  }

  /**
   * Load image data to a canvas with optional artwork processing
   */
  private async loadImageToCanvasProcessed(
    data: Buffer | string,
    regionDimensions?: { pixelsWidth: number; pixelsHeight: number },
    artworkQuality: number = 1,
    autoCenter: boolean = true
  ): Promise<Canvas> {
    // Load raw image WITHOUT nPot conversion (important for correct aspect ratio)
    const rawCanvas = await this.loadImageToCanvasRaw(data)

    // Process artwork if region dimensions provided (uses original dimensions)
    const processedCanvas = this.processArtwork(rawCanvas, regionDimensions, artworkQuality, autoCenter)
    if (processedCanvas !== rawCanvas) {
      this.disposeCanvas(rawCanvas)
    }

    // Apply nPot conversion for WebGL compatibility (SQUARE texture)
    const nPotCanvas = this.convertToNPot(processedCanvas)
    if (nPotCanvas !== processedCanvas) {
      this.disposeCanvas(processedCanvas)
    }
    logger.debug(workerCtx, 'Final texture size', { w: nPotCanvas.width, h: nPotCanvas.height })
    return nPotCanvas
  }

  /**
   * Load image to canvas without any transformations (raw dimensions)
   */
  private async loadImageToCanvasRaw(data: Buffer | string): Promise<Canvas> {
    return new Promise((resolve, reject) => {
      const img = new Image()

      img.onload = () => {
        logger.debug(workerCtx, 'Raw image loaded', { w: img.width, h: img.height })
        const canvas = createCanvas(img.width, img.height)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        resolve(canvas)
      }

      img.onerror = (err) => {
        logger.error(workerCtx, 'Failed to load image', { error: err })
        reject(new Error(`Failed to load image: ${err}`))
      }

      if (Buffer.isBuffer(data)) {
        img.src = data
      } else {
        const base64Data = data.replace(/^data:image\/\w+;base64,/, '')
        img.src = Buffer.from(base64Data, 'base64')
      }
    })
  }

  /**
   * Look up region dimensions from generator data
   */
  private getRegionDimensions(
    generatorData: any,
    regionId: string
  ): { pixelsWidth: number; pixelsHeight: number } | undefined {
    if (!generatorData?.regions) {
      logger.debug(workerCtx, 'getRegionDimensions: no regions in generatorData')
      return undefined
    }

    const region = generatorData.regions.find((r: any) => r.id === regionId)
    if (!region) {
      logger.debug(workerCtx, 'Region not found', { regionId, available: generatorData.regions.map((r: any) => r.id) })
      return undefined
    }

    if (!region?.dimensions) {
      logger.debug(workerCtx, 'Region has no dimensions', { regionId })
      return undefined
    }

    // Support both formats: dimensions.pixels.width (API format) and dimensions.pixelsWidth (legacy)
    const pixelsWidth = region.dimensions.pixels?.width ?? region.dimensions.pixelsWidth
    const pixelsHeight = region.dimensions.pixels?.height ?? region.dimensions.pixelsHeight

    if (!pixelsWidth || !pixelsHeight) {
      logger.debug(workerCtx, 'Region has incomplete dimensions', { regionId })
      return undefined
    }

    logger.debug(workerCtx, 'Found region dimensions', { regionId, w: pixelsWidth, h: pixelsHeight })

    return {
      pixelsWidth,
      pixelsHeight,
    }
  }

  /**
   * Extract regionsDimensions array from generator data for bulkDrawActiveGenerator
   */
  private getRegionsDimensions(generatorData: any): Array<{
    id: string
    dimensions: {
      dpi: number
      pixels: { width: number; height: number }
      inches: { width: number; height: number }
    }
  }> | undefined {
    if (!generatorData?.regions) {
      return undefined
    }

    return generatorData.regions
      .filter((r: any) => r.dimensions)
      .map((r: any) => {
        const dims = r.dimensions
        const dpi = dims.dpi || 300 // Default DPI if not specified

        // Get pixels - support both formats: dimensions.pixels.width and dimensions.pixelsWidth
        const pixelsWidth = dims.pixels?.width ?? dims.pixelsWidth
        const pixelsHeight = dims.pixels?.height ?? dims.pixelsHeight

        // Get inches - calculate from pixels/dpi if not provided
        const inchesWidth = dims.inches?.width ?? (pixelsWidth ? pixelsWidth / dpi : undefined)
        const inchesHeight = dims.inches?.height ?? (pixelsHeight ? pixelsHeight / dpi : undefined)

        return {
          id: r.id,
          dimensions: {
            dpi,
            pixels: { width: pixelsWidth, height: pixelsHeight },
            inches: { width: inchesWidth, height: inchesHeight },
          },
        }
      })
  }

  /**
   * Convert image to next power-of-two SQUARE size for WebGL compatibility
   * Creates a square canvas and scales the source proportionally to fit inside
   */
  private convertToNPot(sourceCanvas: Canvas, maxResolution: number = 4096): Canvas {
    const getNearestPowerOf2 = (value: number, max: number): number => {
      let power = 1
      while (power < value && power < max) {
        power *= 2
      }
      return power
    }

    const maxDimension = Math.max(sourceCanvas.width, sourceCanvas.height)
    const nPotSize = getNearestPowerOf2(maxDimension, maxResolution)

    // If already square power of 2, return as-is
    if (sourceCanvas.width === nPotSize && sourceCanvas.height === nPotSize) {
      return sourceCanvas
    }

    logger.debug(workerCtx, 'Converting to nPot square', { srcW: sourceCanvas.width, srcH: sourceCanvas.height, nPotSize })

    // Create SQUARE nPot canvas
    const nPotCanvas = createCanvas(nPotSize, nPotSize)
    const ctx = nPotCanvas.getContext('2d')

    // Clear with transparent
    ctx.clearRect(0, 0, nPotSize, nPotSize)

    // Scale ENTIRE source proportionally to fit inside square
    const scale = nPotSize / maxDimension
    const scaledWidth = sourceCanvas.width * scale
    const scaledHeight = sourceCanvas.height * scale

    // Center the scaled image in the nPot canvas
    const offsetX = (nPotSize - scaledWidth) / 2
    const offsetY = (nPotSize - scaledHeight) / 2

    // Draw source canvas centered and scaled proportionally
    ctx.drawImage(
      sourceCanvas as any,
      0, 0, sourceCanvas.width, sourceCanvas.height,
      offsetX, offsetY, scaledWidth, scaledHeight
    )

    logger.debug(workerCtx, 'nPot conversion done', { scaledW: Math.round(scaledWidth), scaledH: Math.round(scaledHeight), nPotSize })

    return nPotCanvas
  }

  private async loadImageToCanvas(data: Buffer | string): Promise<Canvas> {
    return new Promise((resolve, reject) => {
      const img = new Image()

      img.onload = () => {
        logger.debug(workerCtx, 'Image loaded', { w: img.width, h: img.height })
        const canvas = createCanvas(img.width, img.height)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)

        // Convert to power-of-two size for WebGL
        const nPotCanvas = this.convertToNPot(canvas)
        if (nPotCanvas !== canvas) {
          this.disposeCanvas(canvas)
        }
        resolve(nPotCanvas)
      }

      img.onerror = (err) => {
        logger.error(workerCtx, 'Failed to load image', { error: err })
        reject(new Error(`Failed to load image: ${err}`))
      }

      // Handle both buffer and base64 string
      if (Buffer.isBuffer(data)) {
        img.src = data
      } else {
        // Remove data URL prefix if present
        const base64Data = data.replace(/^data:image\/\w+;base64,/, '')
        img.src = Buffer.from(base64Data, 'base64')
      }
    })
  }

  /**
   * Convert Blob to Buffer
   */
  private async blobToBuffer(blob: Blob): Promise<Buffer> {
    const arrayBuffer = await blob.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  /**
   * Map external view names to internal unique view IDs.
   * Handles duplicate view names by matching in order (first "New View" → "New View",
   * second "New View" → "New View_1", etc.)
   */
  private mapViewNamesToIds(generatorId: string, viewNames: string[]): string[] {
    const generator = this.generatorConfig.find((g: any) => g.id === generatorId)
    if (!generator) return viewNames

    const viewsInfo = (generator as any).views.map((v: any) => ({
      id: v.id as string,
      name: (v.name || v.id) as string,
    }))

    const claimed = new Set<number>()
    return viewNames.map(name => {
      const idx = viewsInfo.findIndex((v: { id: string; name: string }, i: number) =>
        !claimed.has(i) && (v.name === name || v.id === name)
      )
      if (idx >= 0) {
        claimed.add(idx)
        return viewsInfo[idx].id
      }
      return name // fallback: pass through as-is
    })
  }

  /**
   * Get info about loaded generators
   */
  getGeneratorInfo(): Array<{
    id: string;
    name: string;
    active: boolean;
    printMethod: string;
    viewCount: number;
    colorCount: number;
    views: string[];
    colors: string[];
  }> {
    return this.generatorConfig.map((g: any) => ({
      id: g.id,
      name: g.name || 'Unnamed Generator',
      active: g.active,
      printMethod: g.printMethod,
      viewCount: g.views.length,
      colorCount: g.colors.length,
      // Return view display names (not unique internal IDs)
      views: g.views.map((v: any) => v.name || v.id),
      colors: g.colors.map((c: any) => c.name),
    }))
  }

  /**
   * Add a generator dynamically to the renderer
   */
  async addGenerator(generatorData: any): Promise<void> {
    if (!this.renderer || !this.initialized) {
      throw new Error('HeadlessRenderer not initialized. Call initialize() first.')
    }

    // Skip if this generator already exists (batch route sends it on every request)
    const existing = this.generatorConfig.find((g: any) => g.id === generatorData.id)
    if (existing) {
      logger.debug(workerCtx, 'Generator already loaded, skipping addGenerator', { generatorId: generatorData.id })
      return
    }

    logger.debug(workerCtx, 'Adding generator dynamically', { generatorId: generatorData.id })

    // Validate views exist
    if (!generatorData.views || generatorData.views.length === 0) {
      throw new Error(`Generator ${generatorData.id} has no views — cannot add`)
    }

    // Check if this will be the first generator (need to mark it as active for setup())
    const isFirstGenerator = this.generatorConfig.length === 0

    // Transform API generator data to ProductRendererV2 format
    const printMethod = generatorData.regions[0]?.productionMethod || 'SUBLIMATION'

    // Deduplicate view IDs — some products have all views named identically (e.g., "New View")
    // which causes activateRegionTextures() to show ALL views' meshes simultaneously
    const seenViewNames = new Map<string, number>()

    const transformedGenerator = {
      active: isFirstGenerator, // First generator must be active for setup()
      id: generatorData.id,
      size: 'default',
      views: generatorData.views.map((view: any, viewIndex: number) => {
        const baseName = view.name || `view-${viewIndex}`
        const count = seenViewNames.get(baseName) || 0
        seenViewNames.set(baseName, count + 1)
        const uniqueId = count > 0 ? `${baseName}_${count}` : baseName

        return {
          id: uniqueId,
          name: view.name,
          supportsTransparency: view.supportsTransparency,
          regions: view.regions,
          images: view.images,
          mesh: view.mesh,
          camera: view.camera,
          heather: view.heather,
          embroidery: view.embroidery,
          style: view.style,
          flatPreview: view.flatPreview,
        }
      }),
      colors: generatorData.colors,
      printMethod,
      multicolorDefinitions: [],
      // Always provide options object - ProductRendererV2 expects it
      options: printMethod === 'EMBROIDERY'
        ? { stitchColor: '#000000' }
        : {},
      name: generatorData.id, // Use ID as name if not provided
    }

    // Add to config array (which IS renderer.options.generators — same reference)
    // Only push once! Previously this pushed twice because generatorConfig and
    // renderer.options.generators are the same array.
    this.generatorConfig.push(transformedGenerator as any)

    // If this is the first generator and setup() hasn't been called yet (dynamic mode)
    // we need to call setup() now to initialize the renderer properly
    if (isFirstGenerator && !this.setupCalled) {
      logger.info(workerCtx, 'First generator added, calling ProductRendererV2.setup()', { generatorId: generatorData.id })
      try {
        await this.renderer.setup()
        this.setupCalled = true
        this.patchComposerRenderTargets()
        this.hideSobelProcessingPlane()
        logger.info(workerCtx, 'ProductRendererV2 setup complete', { generatorId: generatorData.id })
      } catch (error) {
        logger.error(workerCtx, 'Failed to call setup() for first generator', { error })
        throw error
      }
    }

    logger.debug(workerCtx, 'Generator added successfully', { generatorId: generatorData.id })
  }

  /**
   * Remove a dynamically-added generator from the config array.
   * Prevents stale generators from accumulating across requests —
   * ProductRendererV2 holds the same array reference and would try to
   * load meshes for all generators on switchGenerator(), causing 404s
   * if an old generator's CDN assets have been deleted.
   */
  removeGenerator(generatorId: string, force = false): void {
    if (!force && this.initialGeneratorIds.has(generatorId)) {
      logger.debug(workerCtx, 'Skipping removal of initial generator', { generatorId })
      return
    }

    const idx = this.generatorConfig.findIndex((g: any) => g.id === generatorId)
    if (idx === -1) {
      logger.debug(workerCtx, 'Generator not found in config, nothing to remove', { generatorId })
      return
    }

    this.generatorConfig.splice(idx, 1)

    // Remove any duplicates (safety net for config corruption)
    let extraRemoved = 0
    while (true) {
      const dupIdx = this.generatorConfig.findIndex((g: any) => g.id === generatorId)
      if (dupIdx === -1) break
      this.generatorConfig.splice(dupIdx, 1)
      extraRemoved++
    }
    if (extraRemoved > 0) {
      logger.warn(workerCtx, 'Removed duplicate generator config entries', { generatorId, count: extraRemoved })
    }

    // Dispose GPU/CPU resources held by the cached GeneratorInstance.
    // Without this, textures (4096x4096 RGBA each) and mesh geometry
    // accumulate in memory across requests, causing OOM after ~15-20 generators.
    if (this.renderer) {
      const cached = (this.renderer as any).generatorCache?.get(generatorId)
      if (cached) {
        try {
          cached.deactivate()
          ;(this.renderer as any).generatorCache.delete(generatorId)
          // Reset state.activeGenerator so switchGenerator()'s early-return guard
          // ("already active, skip") doesn't fire on the next render for this same ID.
          // After deactivate(), textures=[] — if activeGenerator still points here,
          // switchView() would throw "Texture not found" on every subsequent render.
          // GeneratorInstance.id is a getter (returns this.generator.id), so we
          // replace the entire activeGenerator reference with a tombstone that has
          // id=null, which breaks the `activeGenerator.id === generatorId` check.
          const rendererState = (this.renderer as any).state
          if (rendererState?.activeGenerator?.id === generatorId) {
            rendererState.activeGenerator = { id: null }
          }
          this.forceGLCleanup()
          logger.debug(workerCtx, 'Disposed generator resources', { generatorId })
        } catch (e) {
          logger.warn(workerCtx, 'Failed to dispose generator resources', { generatorId, error: e })
        }
      }
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    logger.info(workerCtx, 'Disposing HeadlessRenderer')

    if (this.renderer) {
      // ProductRendererV2 doesn't have a dispose method, but we can clean up references
      this.renderer = null
    }

    if (this.glContext) {
      // Lose the GL context to free resources
      const loseContextExt = this.glContext.getExtension('WEBGL_lose_context')
      if (loseContextExt) {
        loseContextExt.loseContext()
      }
      this.glContext = null
    }

    this.canvas = null
    this.initialized = false

    logger.info(workerCtx, 'HeadlessRenderer disposed')
  }

  /**
   * Check if renderer is initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Set transparent background for rendering
   */
  setTransparentBackground(transparent: boolean): void {
    if (this.renderer) {
      this.renderer.setTransparentBackground(transparent)
    }
  }
}
