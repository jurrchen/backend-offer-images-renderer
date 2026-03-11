import Fastify from 'fastify'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import fastifyCors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod'
import path from 'node:path'
import fs from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { config } from './config/index.js'
import { WorkerPoolManager } from './workers/WorkerPoolManager.js'
import { PgJobQueue } from './queue/PgJobQueue.js'
import { createStorageService } from './storage/index.js'
import { createPubSubService } from './pubsub/index.js'
import { requestIdPlugin } from './api/middleware/request-id.js'
import { apiMetricsPlugin } from './api/middleware/api-metrics.js'
import { setupErrorHandler } from './api/middleware/error.js'
import { healthRoutes } from './api/routes/health.js'
import { fixtureRoutes } from './api/routes/fixtures.js'
import { testRunRoutes } from './api/routes/test-runs.js'
import { generatorRoutes } from './api/routes/generators.js'
import { jobsRoutes } from './api/routes/jobs.js'
import { designRoutes } from './api/routes/design.js'
import { analyticsRoutes } from './api/routes/analytics.js'
import { renderRoutes } from './api/routes/render.js'
import { batchRoutes } from './api/routes/batch.js'
import { analytics } from './utils/analytics.js'
import { runMigrations } from './db/client.js'
import { logger, rootCtx } from './logger/index.js'

class RendererServer {
  private server = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 })
  private workerPool: WorkerPoolManager
  private pgJobQueue?: PgJobQueue

  constructor() {
    this.workerPool = new WorkerPoolManager({ canvasSize: config.canvasSize })
  }

  private async setupServer(): Promise<void> {
    const server = this.server

    // Zod validation + serialization (schema → validation + swagger)
    server.setValidatorCompiler(validatorCompiler)
    server.setSerializerCompiler(serializerCompiler)

    // Error + 404 handlers
    setupErrorHandler(server)

    // Request ID / tracing (must be first)
    await server.register(requestIdPlugin)

    // API metrics
    await server.register(apiMetricsPlugin)

    // Swagger (auto-generated from route schemas)
    await server.register(fastifySwagger, {
      openapi: {
        info: { title: 'Fourthwall Renderer Server API', version: '1.0.0' },
      },
      transform: jsonSchemaTransform,
    } as any)
    await server.register(fastifySwaggerUi, {
      routePrefix: '/api-docs',
      uiConfig: {
        persistAuthorization: true,
        displayRequestDuration: true,
      },
    } as any)

    // CORS
    await server.register(fastifyCors, { origin: '*' } as any)

    // Static assets
    const assetsDir = path.join(process.cwd(), 'assets')
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true })

    await server.register(fastifyStatic, {
      root: assetsDir,
      prefix: '/assets/',
    } as any)

    // Bulk output static files
    const bulkOutputDir = path.join(process.cwd(), '../../bulk-output')
    await server.register(fastifyStatic, {
      root: bulkOutputDir,
      prefix: '/outputs/',
      decorateReply: false,
    } as any)

    // Local job output PNGs
    const localOutputDir = config.storage.localOutputDir
    if (localOutputDir) {
      const outputDir = path.isAbsolute(localOutputDir)
        ? localOutputDir
        : path.join(process.cwd(), localOutputDir)
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
      await server.register(fastifyStatic, {
        root: outputDir,
        prefix: '/output/',
        decorateReply: false,
      } as any)
      logger.info(rootCtx, 'Local output dir mounted at /output', { outputDir })
    }

    // CDN proxy & cache
    server.get('/assets/cdn/*', async (request, reply) => {
      const cdnPath = (request.params as any)['*']
      const cdnUrl = `https://cdn.fourthwall.com/${cdnPath}`
      const localPath = path.join(assetsDir, 'cdn', cdnPath)

      if (fs.existsSync(localPath)) {
        return (reply as any).sendFile(localPath.replace(assetsDir + '/', ''))
      }

      try {
        logger.debug(rootCtx, 'Proxying & caching CDN asset', { cdnUrl })
        const response = await fetch(cdnUrl)
        if (!response.ok) throw new Error(`CDN returned ${response.status}`)

        const buffer = await response.arrayBuffer()

        await mkdir(path.dirname(localPath), { recursive: true })
        await writeFile(localPath, Buffer.from(buffer))

        return reply
          .type(response.headers.get('Content-Type') || 'application/octet-stream')
          .send(Buffer.from(buffer))
      } catch (error) {
        logger.error(rootCtx, 'Asset proxy failed', { cdnUrl, error })
        return reply.code(500).send('Failed to fetch asset from CDN')
      }
    })

    // Health
    await server.register(healthRoutes, { prefix: '/api/v1/health', workerPool: this.workerPool } as any)

    // Fixtures
    await server.register(fixtureRoutes, { prefix: '/api/v1/fixtures' })

    // Routes
    await server.register(renderRoutes, { prefix: '/api/v1/render', workerPool: this.workerPool } as any)
    await server.register(batchRoutes, { prefix: '/api/v1/render/batch', workerPool: this.workerPool } as any)
    await server.register(jobsRoutes, { prefix: '/api/v1/jobs', workerPool: this.workerPool, pgJobQueue: this.pgJobQueue } as any)
    await server.register(designRoutes, { prefix: '/api/v1/design' })
    await server.register(analyticsRoutes, { prefix: '/api/v1/analytics' })
    await server.register(generatorRoutes, { prefix: '/api/v1/generators' })
    await server.register(testRunRoutes, { prefix: '/api/v1/test-runs' })

    // Root info endpoint
    server.get('/', async () => ({
      name: '@fourthwall/renderer-server',
      version: '1.0.0-phase1',
      status: 'running',
      endpoints: {
        health: '/api/v1/health',
        fixtures: '/api/v1/fixtures',
        design: 'POST /api/v1/design',
        render: 'POST /api/v1/render',
        batch: 'POST /api/v1/render/batch',
        docs: '/api-docs',
      },
    }))
  }

  async initialize(): Promise<void> {
    logger.info(rootCtx, 'Initializing Renderer Server with Worker Pool')
    logger.info(rootCtx, 'Dynamic mode — generators loaded on-demand per request')

    try {
      if (config.database.url && config.database.runMigrationsOnStartup) {
        await runMigrations()
      }

      await this.workerPool.initialize()
      logger.info(rootCtx, 'Worker pool initialized successfully')

      if (config.database.url) {
        const [storageService, pubSubService] = await Promise.all([
          createStorageService(),
          createPubSubService(),
        ])

        if (storageService) {
          logger.info(rootCtx, 'Storage service initialized', { type: config.storage.type })
        } else {
          logger.info(rootCtx, 'Storage service disabled (no storage configured)')
        }

        this.pgJobQueue = new PgJobQueue(this.workerPool, storageService, pubSubService)
        await this.pgJobQueue.start()
        logger.info(rootCtx, 'PgJobQueue started — accepting async render jobs')
      } else {
        logger.info(rootCtx, 'PgJobQueue disabled (DATABASE_URL not set) — using in-memory job store')
      }

      // Setup routes AFTER pgJobQueue is created (jobs routes need it)
      await this.setupServer()
    } catch (error) {
      logger.error(rootCtx, 'Failed to initialize', { error })
      throw error
    }
  }

  async start(): Promise<void> {
    await this.initialize()

    await this.server.listen({ port: config.port, host: '0.0.0.0' })
    logger.info(rootCtx, 'Renderer Server listening', { port: config.port })

    // Periodic memory logging (every 30s, unref so it doesn't block exit)
    const memoryLogInterval = setInterval(() => {
      const mem = process.memoryUsage()
      const poolStatus = this.workerPool.getStatus()
      const rssMb = Math.round(mem.rss / 1024 / 1024)
      const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024)
      const heapTotalMb = Math.round(mem.heapTotal / 1024 / 1024)
      const externalMb = Math.round(mem.external / 1024 / 1024)

      const memFields: Record<string, unknown> = {
        rssMb, heapUsedMb, heapTotalMb, externalMb,
        workers: poolStatus.workers,
        idle: poolStatus.workerStatus.idle,
        busy: poolStatus.workerStatus.busy,
        queueDepth: poolStatus.queueDepth,
        totalJobsProcessed: poolStatus.totalJobsProcessed,
      }

      try {
        const { readFileSync } = fs
        const cgroupCurrent = readFileSync('/sys/fs/cgroup/memory.current', 'utf-8').trim()
        const cgroupMax = readFileSync('/sys/fs/cgroup/memory.max', 'utf-8').trim()
        if (cgroupMax !== 'max') {
          const usedMb = Math.round(parseInt(cgroupCurrent, 10) / 1024 / 1024)
          const limitMb = Math.round(parseInt(cgroupMax, 10) / 1024 / 1024)
          memFields.containerUsedMb = usedMb
          memFields.containerLimitMb = limitMb
          memFields.containerPct = Math.round((usedMb / limitMb) * 100)
        }
      } catch {
        // Not in a cgroup v2 environment — skip container stats
      }

      logger.debug(rootCtx, 'memory', memFields)
    }, 30_000)
    memoryLogInterval.unref()

    // Periodic worker pool + cache metrics (every 30s)
    const metricsInterval = setInterval(async () => {
      try {
        const poolStatus = this.workerPool.getStatus()
        const mem = process.memoryUsage()

        const lagStart = Date.now()
        await new Promise<void>(resolve => setImmediate(resolve))
        const eventLoopLagMs = Date.now() - lagStart

        analytics.logWorkerPoolMetrics({
          workersTotal: poolStatus.workers,
          workersIdle: poolStatus.workerStatus.idle,
          workersBusy: poolStatus.workerStatus.busy,
          workersError: poolStatus.workerStatus.error,
          queueDepth: poolStatus.queueDepth,
          totalJobsProcessed: poolStatus.totalJobsProcessed,
          memoryRssMb: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
          memoryHeapUsedMb: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
          eventLoopLagMs,
        }).catch(() => {})

        const cacheStats = await this.workerPool.getCacheStats()
        if (cacheStats) {
          const { stats } = cacheStats
          analytics.logCacheMetrics([
            {
              cacheType: 'texture_memory',
              entries: stats.texture.entries,
              maxEntries: stats.texture.maxEntries,
              sizeBytes: stats.texture.size,
              maxSizeBytes: stats.texture.maxSize,
              utilizationPct: stats.texture.maxEntries > 0 ? Math.round(stats.texture.entries / stats.texture.maxEntries * 1000) / 10 : 0,
              hits: stats.texture.hits,
              misses: stats.texture.misses,
              evictions: stats.texture.evictions,
              hitRatePct: (stats.texture.hits + stats.texture.misses) > 0
                ? Math.round(stats.texture.hits / (stats.texture.hits + stats.texture.misses) * 1000) / 10
                : undefined,
            },
            {
              cacheType: 'mesh_memory',
              entries: stats.mesh.entries,
              maxEntries: stats.mesh.maxEntries,
              sizeBytes: stats.mesh.size,
              maxSizeBytes: stats.mesh.maxSize,
              utilizationPct: stats.mesh.maxEntries > 0 ? Math.round(stats.mesh.entries / stats.mesh.maxEntries * 1000) / 10 : 0,
              hits: stats.mesh.hits,
              misses: stats.mesh.misses,
              evictions: stats.mesh.evictions,
              hitRatePct: (stats.mesh.hits + stats.mesh.misses) > 0
                ? Math.round(stats.mesh.hits / (stats.mesh.hits + stats.mesh.misses) * 1000) / 10
                : undefined,
            },
          ]).catch(() => {})
        }
      } catch {
        // Metrics collection should never crash the server
      }
    }, 30_000)
    metricsInterval.unref()
  }

  async shutdown(): Promise<void> {
    logger.info(rootCtx, 'Shutting down gracefully')

    // Close Fastify (stops accepting new connections)
    await this.server.close()

    // Stop pg-boss FIRST: drains the active render job
    if (this.pgJobQueue) {
      await this.pgJobQueue.shutdown()
    }

    // Shutdown worker pool (terminates all workers)
    await this.workerPool.shutdown()

    logger.info(rootCtx, 'Shutdown complete')
    process.exit(0)
  }
}

// Main execution
const server = new RendererServer()

server.start().catch((error) => {
  logger.error(rootCtx, 'Failed to start server', { error })
  process.exit(1)
})

process.on('SIGTERM', () => server.shutdown())
process.on('SIGINT', () => server.shutdown())

export { RendererServer }
