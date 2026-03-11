/**
 * RenderWorker - Child process entry point
 *
 * Each child process creates its own HeadlessRenderer with an isolated WebGL context.
 * Using child_process.fork() instead of worker_threads because native modules
 * (canvas, gl) cannot be loaded in multiple threads but work fine in separate processes.
 */

import { HeadlessRenderer, getCacheStats } from '../rendering/HeadlessRenderer.js'
import { logger, rootCtx, withContext } from '../logger/index.js'
import type {
  WorkerMessage,
  WorkerResponse,
  RenderJob,
  SingleRenderResult,
  BatchRenderResult,
  InitializeResult,
  CacheStatsResult,
} from './types.js'

// Ensure we're running as a forked child process with IPC
if (typeof process.send !== 'function') {
  throw new Error('RenderWorker must be run as a child process with IPC (child_process.fork)')
}

// Worker configuration from environment variables (set by WorkerPoolManager via fork())
const workerId = parseInt(process.env.WORKER_ID || '0', 10)
const canvasSize = parseInt(process.env.CANVAS_SIZE || '2048', 10)

// Module-level worker context (startup logs before any job context)
const workerCtx = withContext(rootCtx, { workerID: `render-worker-${workerId}` })

// Worker's own HeadlessRenderer instance
let renderer: HeadlessRenderer | null = null
let isInitialized = false

// Graceful shutdown state
let isProcessingJob = false
let pendingShutdown = false

function performShutdown(): void {
  logger.info(workerCtx, 'Worker shutting down')
  if (renderer) {
    renderer.dispose()
    renderer = null
  }
  process.exit(0)
}

/**
 * Initialize the HeadlessRenderer for this worker
 */
async function initializeRenderer(generators: any[], size: number): Promise<void> {
  logger.info(workerCtx, 'Initializing HeadlessRenderer', { canvasSize: size })

  try {
    renderer = new HeadlessRenderer(size)
    await renderer.initialize(generators)
    isInitialized = true
    logger.info(workerCtx, 'HeadlessRenderer initialized successfully')
  } catch (error) {
    logger.error(workerCtx, 'Failed to initialize HeadlessRenderer', { error })
    throw error
  }
}

/**
 * Process a render job
 */
async function processJob(
  job: RenderJob,
  jobCtx: ReturnType<typeof withContext>
): Promise<SingleRenderResult | BatchRenderResult | InitializeResult | CacheStatsResult> {
  switch (job.type) {
    case 'initialize': {
      await initializeRenderer(job.params.generators, job.params.canvasSize)
      return { type: 'initialize', success: true }
    }

    case 'get_cache_stats': {
      const stats = getCacheStats()
      return { type: 'cache_stats', stats }
    }

    case 'single': {
      if (!renderer || !isInitialized) {
        throw new Error('Worker renderer not initialized')
      }

      logger.info(jobCtx, 'Processing single render job')
      const buffer = await renderer.renderSingle(job.params, jobCtx)

      return {
        type: 'single',
        buffer,
        assetLoadMs: renderer.getLastAssetLoadTime(),
        assetNetworkMs: renderer.getLastAssetNetworkTime(),
        assetProcessingMs: renderer.getLastAssetProcessingTime(),
        timing: renderer.getLastTiming() ?? undefined,
      }
    }

    case 'batch': {
      if (!renderer || !isInitialized) {
        throw new Error('Worker renderer not initialized')
      }

      logger.info(jobCtx, 'Processing batch render job')

      // Add generator dynamically if provided
      if (job.generatorToAdd) {
        logger.debug(jobCtx, 'Adding generator dynamically', { generatorId: job.generatorToAdd.id })
        await renderer.addGenerator(job.generatorToAdd)
      }

      const results = await renderer.renderBatch(job.params, jobCtx)

      return {
        type: 'batch',
        results,
        assetLoadMs: renderer.getLastAssetLoadTime(),
        assetNetworkMs: renderer.getLastAssetNetworkTime(),
        assetProcessingMs: renderer.getLastAssetProcessingTime(),
        timing: renderer.getLastTiming() ?? undefined,
      }
    }

    default:
      throw new Error(`Unknown job type: ${(job as any).type}`)
  }
}

/**
 * Send response to parent process via IPC
 */
function sendResponse(response: WorkerResponse): void {
  process.send!(response)
}

/**
 * Handle incoming messages from parent process
 */
process.on('message', async (message: WorkerMessage) => {
  if (message.type !== 'job') {
    logger.warn(workerCtx, 'Unknown message type', { messageType: message.type })
    return
  }

  const { jobId, job, traceID } = message
  const jobCtx = withContext(workerCtx, {
    traceID,
    renderID: jobId,
  })

  isProcessingJob = true
  try {
    const result = await processJob(job, jobCtx)
    sendResponse({
      type: 'result',
      jobId,
      result,
    })
    const memUsage = process.memoryUsage()
    const RSS_RECYCLE_THRESHOLD_MB = 1500
    if (memUsage.rss > RSS_RECYCLE_THRESHOLD_MB * 1024 * 1024) {
      logger.warn(jobCtx, 'RSS exceeds threshold, requesting recycle', {
        rssMb: Math.round(memUsage.rss / 1024 / 1024),
        thresholdMb: RSS_RECYCLE_THRESHOLD_MB,
      })
      process.send?.({ type: 'recycle-request', rss: memUsage.rss })
    }
  } catch (error) {
    logger.error(jobCtx, 'Job failed', { error })
    sendResponse({
      type: 'error',
      jobId,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    isProcessingJob = false
    if (pendingShutdown) {
      performShutdown()
    }
  }
})

/**
 * Graceful shutdown on SIGTERM (sent by WorkerPoolManager during shutdown)
 */
process.on('SIGTERM', () => {
  logger.info(workerCtx, 'Received SIGTERM, shutting down')
  pendingShutdown = true
  if (!isProcessingJob) {
    performShutdown()
  } else {
    logger.info(workerCtx, 'Active render in progress — deferring exit until job completes')
  }
})

/**
 * Cleanup on exit
 */
process.on('exit', () => {
  if (renderer) {
    renderer.dispose()
    renderer = null
  }
})

// Signal that worker is ready
logger.info(workerCtx, 'Worker started and ready to receive jobs')
sendResponse({ type: 'ready' })
