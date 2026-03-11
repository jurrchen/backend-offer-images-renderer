/**
 * WorkerPoolManager - Manages a pool of render child processes
 *
 * Responsibilities:
 * - Spawns N child processes via fork() (default: 1, configurable via WORKER_COUNT)
 * - Maintains an in-memory job queue
 * - Routes jobs to idle workers
 * - Handles worker crash recovery with automatic respawn
 * - Provides pool status for health checks
 *
 * Uses child_process.fork() instead of worker_threads because native modules
 * (canvas, gl) cannot be loaded in multiple threads but work fine in separate
 * OS processes, each with its own V8 isolate and EGL display.
 */

import { fork, ChildProcess } from 'node:child_process'
import { cpus, totalmem } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { config } from '../config/index.js'
import { logger, rootCtx, withContext } from '../logger/index.js'
import type {
  RenderJob,
  JobResult,
  QueuedJob,
  WorkerMessage,
  WorkerResponse,
  WorkerInfo,
  WorkerStatus,
  PoolStatus,
  SingleRenderResult,
  BatchRenderResult,
  CacheStatsResult,
  RenderParams,
  BatchRenderParams,
} from './types.js'

// Get the directory of current module for worker script path
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Determine if we're running from src (dev mode with tsx) or dist (production)
const isDevMode = __dirname.includes('/src/')

// Get the worker script path - always use bundled JS from dist
// The worker is bundled with esbuild to resolve all imports (including product-renderer)
const getWorkerScriptPath = (): string => {
  if (isDevMode) {
    // Running from src with tsx - need to use bundled dist/workers/RenderWorker.bundle.js
    const projectRoot = __dirname.replace('/src/workers', '')
    return path.join(projectRoot, 'dist', 'workers', 'RenderWorker.bundle.js')
  } else {
    // Running from dist - use relative path to bundled worker
    return path.join(__dirname, 'RenderWorker.bundle.js')
  }
}

// Configuration from centralized config
const DEFAULT_WORKER_COUNT = 1
const JOB_TIMEOUT_MS = config.worker.jobTimeoutMs
const MAX_QUEUE_DEPTH = config.worker.maxQueueDepth
const NODE_HEAP_LIMIT_MB = config.worker.nodeHeapLimitMb
const MAX_RESPAWNS = config.worker.maxRespawns
const MAX_JOBS_PER_WORKER = config.worker.maxJobsPerWorker
const RESPAWN_COUNTER_RESET_MS = 60_000 // reset respawn counter after 60s of stability
const MEMORY_PER_WORKER_MB = 400 // estimated RSS per worker for budget calculation
const MAIN_PROCESS_OVERHEAD_MB = 350 // main process + OS overhead
const WATCHDOG_INTERVAL_MS = 30_000 // check for stuck workers every 30s
const WATCHDOG_GRACE_MS = 15_000 // kill worker if busy for JOB_TIMEOUT_MS + this grace period

export class WorkerPoolManager {
  private workers: Map<number, ChildProcess> = new Map()
  private workerInfo: Map<number, WorkerInfo> = new Map()
  private jobQueue: QueuedJob[] = []
  private workerCount: number
  private canvasSize: number
  private generatorConfig: any[]
  private totalJobsProcessed = 0
  private isShuttingDown = false
  private hasEverInitialized = false
  private watchdogTimer?: ReturnType<typeof setInterval>
  private initializationPromises: Map<number, { resolve: () => void; reject: (err: Error) => void }> = new Map()

  constructor(options?: { workerCount?: number; canvasSize?: number }) {
    this.workerCount = options?.workerCount ?? (config.worker.count || DEFAULT_WORKER_COUNT)
    this.canvasSize = options?.canvasSize ?? config.canvasSize
    this.generatorConfig = []

    // Validate worker count against available memory
    this.workerCount = this.validateWorkerCount(this.workerCount)

    logger.info(rootCtx, 'WorkerPoolManager configured', { workerCount: this.workerCount, cpus: cpus().length })
  }

  /**
   * Validate worker count against available system memory.
   * Clamps to a safe maximum if the requested count would likely cause OOM.
   */
  private validateWorkerCount(requested: number): number {
    const totalMemMb = Math.floor(totalmem() / (1024 * 1024))
    const availableMb = Math.floor(totalMemMb * 0.85) - MAIN_PROCESS_OVERHEAD_MB
    const maxSafe = Math.max(1, Math.floor(availableMb / MEMORY_PER_WORKER_MB))

    if (requested > maxSafe) {
      logger.warn(rootCtx, 'WORKER_COUNT exceeds safe memory limit, clamping', {
        requested, maxSafe, totalMemMb, availableMb, memPerWorkerMb: MEMORY_PER_WORKER_MB,
      })
      return maxSafe
    }
    return requested
  }

  /**
   * Initialize the worker pool
   */
  async initialize(): Promise<void> {
    logger.info(rootCtx, 'WorkerPoolManager: initializing workers', { workerCount: this.workerCount })

    // Verify worker script exists before spawning
    const workerScript = getWorkerScriptPath()
    if (!existsSync(workerScript)) {
      const errorMsg = isDevMode
        ? `Worker script not found at ${workerScript}. Run 'npm run build' first to compile TypeScript.`
        : `Worker script not found at ${workerScript}. Ensure the project is built correctly.`
      throw new Error(errorMsg)
    }
    logger.debug(rootCtx, 'Worker script path', { path: workerScript })

    // Spawn workers sequentially — each is a separate OS process so no native module conflicts
    for (let i = 0; i < this.workerCount; i++) {
      await this.spawnWorker(i)
    }

    this.startWatchdog()
    this.hasEverInitialized = true

    logger.info(rootCtx, 'WorkerPoolManager: all workers initialized', { workerCount: this.workerCount })
  }

  /**
   * Spawn a single worker child process
   */
  private async spawnWorker(workerId: number): Promise<void> {
    logger.info(rootCtx, 'Spawning worker', { workerID: `render-worker-${workerId}` })

    // Worker script path (always compiled JS, even in dev mode)
    const workerScript = getWorkerScriptPath()

    const child = fork(workerScript, [], {
      serialization: 'advanced',
      execArgv: [`--max-old-space-size=${NODE_HEAP_LIMIT_MB}`],
      env: {
        ...process.env,
        WORKER_ID: String(workerId),
        CANVAS_SIZE: String(this.canvasSize),
      },
      stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
    })

    // Track worker info (preserve respawn counters across respawns)
    const existingInfo = this.workerInfo.get(workerId)
    this.workerInfo.set(workerId, {
      id: workerId,
      status: 'starting',
      jobsCompleted: existingInfo?.jobsCompleted ?? 0,
      lastActivityAt: Date.now(),
      respawnCount: existingInfo?.respawnCount ?? 0,
      lastRespawnAt: existingInfo?.lastRespawnAt ?? 0,
    })

    this.workers.set(workerId, child)

    // Create a promise that resolves when worker is ready
    const readyPromise = new Promise<void>((resolve, reject) => {
      this.initializationPromises.set(workerId, { resolve, reject })
    })

    // Setup message handler
    child.on('message', (response: WorkerResponse) => {
      this.handleWorkerResponse(workerId, response)
    })

    // Setup error handler
    child.on('error', (error) => {
      logger.error(rootCtx, 'Worker process error', { workerID: `render-worker-${workerId}`, error })
      this.handleWorkerError(workerId, error)
    })

    // Setup exit handler for crash recovery.
    // Compare against `child` reference: if the worker was recycled/respawned, the map already
    // holds a different ChildProcess for this id, so we skip crash handling for the old child.
    child.on('exit', (code) => {
      if (this.workers.get(workerId) !== child) {
        // This is an old child that was intentionally replaced (recycled or crashed+respawned).
        // The new child's handlers are already set up — nothing more to do here.
        return
      }
      if (code !== 0 && !this.isShuttingDown) {
        logger.warn(rootCtx, 'Worker exited unexpectedly, respawning', { workerID: `render-worker-${workerId}`, exitCode: code })
        this.handleWorkerCrash(workerId)
      }
    })

    // Wait for worker to be ready
    await readyPromise

    // Initialize the renderer in the worker
    await this.initializeWorkerRenderer(workerId)
  }

  /**
   * Initialize HeadlessRenderer in the worker
   */
  private async initializeWorkerRenderer(workerId: number): Promise<void> {
    const child = this.workers.get(workerId)
    if (!child) {
      throw new Error(`Worker #${workerId} not found`)
    }

    // Create initialization job
    const initJob: QueuedJob = {
      id: `init-${workerId}-${Date.now()}`,
      job: {
        type: 'initialize',
        params: {
          generators: this.generatorConfig,
          canvasSize: this.canvasSize,
        },
      },
      createdAt: Date.now(),
      resolve: () => {},
      reject: () => {},
    }

    return new Promise<void>((resolve, reject) => {
      initJob.resolve = (result) => {
        if (result.type === 'initialize' && result.success) {
          const info = this.workerInfo.get(workerId)
          if (info) {
            info.status = 'idle'
            info.lastActivityAt = Date.now()
          }
          resolve()
        } else {
          reject(new Error('Worker initialization failed'))
        }
      }
      initJob.reject = reject

      // Set timeout
      initJob.timeoutId = setTimeout(() => {
        reject(new Error(`Worker #${workerId} initialization timeout`))
      }, JOB_TIMEOUT_MS)

      // Store job temporarily for response handling
      this.jobQueue.push(initJob)

      // Send to worker
      const message: WorkerMessage = {
        type: 'job',
        jobId: initJob.id,
        job: initJob.job,
      }
      child.send(message)
    })
  }

  /**
   * Handle response from worker
   */
  private handleWorkerResponse(workerId: number, response: WorkerResponse): void {
    const info = this.workerInfo.get(workerId)

    if (response.type === 'ready') {
      // Worker process is ready (before renderer initialization)
      const initPromise = this.initializationPromises.get(workerId)
      if (initPromise) {
        initPromise.resolve()
        this.initializationPromises.delete(workerId)
      }
      return
    }

    if (response.type === 'recycle-request') {
      const rssGb = ((response.rss ?? 0) / 1024 / 1024 / 1024).toFixed(2)
      logger.warn(rootCtx, 'Worker requested recycle (high RSS)', { workerID: `render-worker-${workerId}`, rssGb })
      this.recycleWorker(workerId)
      return
    }

    if (response.type === 'result' || response.type === 'error') {
      const jobId = response.jobId
      if (!jobId) return

      // Find the job in queue
      const jobIndex = this.jobQueue.findIndex((j) => j.id === jobId)
      if (jobIndex === -1) {
        logger.warn(rootCtx, 'Received response for unknown job', { workerID: `render-worker-${workerId}`, jobId })
        return
      }

      const job = this.jobQueue[jobIndex]

      // Clear timeout
      if (job.timeoutId) {
        clearTimeout(job.timeoutId)
      }

      // Remove from queue
      this.jobQueue.splice(jobIndex, 1)

      // Only 'single' and 'batch' are actual render jobs that count toward the recycle limit.
      // Infrastructure jobs ('initialize', 'get_cache_stats') must not trigger recycling.
      const isRenderJob = job.job.type === 'single' || job.job.type === 'batch'

      // Update worker info
      if (info) {
        info.status = 'idle'
        info.currentJobId = undefined
        info.lastActivityAt = Date.now()
        if (response.type === 'result' && isRenderJob) {
          info.jobsCompleted++
          this.totalJobsProcessed++
        }
      }

      // Resolve or reject the job promise
      if (response.type === 'result' && response.result) {
        const result = response.result
        // Backfill queueWaitMs now that we know totalWorkerMs
        if ((result.type === 'single' || result.type === 'batch') && result.timing) {
          const queueWaitMs = Math.max(0, Date.now() - job.createdAt - result.timing.totalWorkerMs)
          result.timing.queueWaitMs = queueWaitMs
          const jobCtx = job.traceID ? { traceID: job.traceID } : rootCtx
          logger.debug(jobCtx, 'Job timing', {
            workerID: `render-worker-${workerId}`,
            jobId: jobId!.slice(0, 8),
            queueWaitMs,
            workerMs: result.timing.totalWorkerMs,
          })
        }
        job.resolve(result)
      } else {
        job.reject(new Error(response.error || 'Unknown worker error'))
      }

      // Recycle worker if it has reached the job limit, otherwise process next job
      if (isRenderJob && info && MAX_JOBS_PER_WORKER > 0 && info.jobsCompleted >= MAX_JOBS_PER_WORKER) {
        this.recycleWorker(workerId) // async, non-blocking
      } else {
        this.processNextJob()
      }
    }
  }

  /**
   * Handle worker error
   */
  private handleWorkerError(workerId: number, error: Error): void {
    const info = this.workerInfo.get(workerId)
    if (info) {
      info.status = 'error'

      // Reject any current job
      if (info.currentJobId) {
        const jobIndex = this.jobQueue.findIndex((j) => j.id === info.currentJobId)
        if (jobIndex !== -1) {
          const job = this.jobQueue[jobIndex]
          if (job.timeoutId) clearTimeout(job.timeoutId)
          this.jobQueue.splice(jobIndex, 1)
          job.reject(error)
        }
      }
    }

    // Reject initialization promise if pending
    const initPromise = this.initializationPromises.get(workerId)
    if (initPromise) {
      initPromise.reject(error)
      this.initializationPromises.delete(workerId)
    }
  }

  /**
   * Handle worker crash with respawn limiting
   */
  private async handleWorkerCrash(workerId: number): Promise<void> {
    const info = this.workerInfo.get(workerId)

    // Mark any current job as failed
    if (info?.currentJobId) {
      const jobIndex = this.jobQueue.findIndex((j) => j.id === info.currentJobId)
      if (jobIndex !== -1) {
        const job = this.jobQueue[jobIndex]
        if (job.timeoutId) clearTimeout(job.timeoutId)
        this.jobQueue.splice(jobIndex, 1)
        job.reject(new Error(`Worker #${workerId} crashed during job execution`))
      }
    }

    // Remove old worker
    this.workers.delete(workerId)

    // Check respawn limits
    if (info) {
      // Reset counter if worker was stable for long enough
      const timeSinceLastRespawn = Date.now() - info.lastRespawnAt
      if (timeSinceLastRespawn > RESPAWN_COUNTER_RESET_MS) {
        info.respawnCount = 0
      }

      info.respawnCount++
      info.lastRespawnAt = Date.now()

      if (info.respawnCount > MAX_RESPAWNS) {
        logger.error(rootCtx, 'Worker exceeded max respawns, permanently terminated', {
          workerID: `render-worker-${workerId}`, respawnCount: info.respawnCount, maxRespawns: MAX_RESPAWNS,
        })
        info.status = 'terminated'
        return
      }

      info.status = 'terminated'
      logger.warn(rootCtx, 'Worker crashed, respawning', {
        workerID: `render-worker-${workerId}`, respawnCount: info.respawnCount, maxRespawns: MAX_RESPAWNS,
      })
    }

    // Respawn worker
    try {
      await this.spawnWorker(workerId)
      logger.info(rootCtx, 'Worker respawned successfully', { workerID: `render-worker-${workerId}` })

      // Process any pending jobs
      this.processNextJob()
    } catch (error) {
      logger.error(rootCtx, 'Failed to respawn worker', { workerID: `render-worker-${workerId}`, error })
    }
  }

  /**
   * Gracefully recycle a worker after it has processed MAX_JOBS_PER_WORKER jobs.
   * Kills the process and immediately spawns a fresh replacement to prevent memory accumulation.
   */
  private async recycleWorker(workerId: number): Promise<void> {
    const child = this.workers.get(workerId)
    const info = this.workerInfo.get(workerId)
    if (!child || !info) return

    logger.info(rootCtx, 'Recycling worker', { workerID: `render-worker-${workerId}`, jobsCompleted: info.jobsCompleted, maxJobsPerWorker: MAX_JOBS_PER_WORKER })
    info.recycling = true
    info.status = 'terminated'
    info.jobsCompleted = 0  // reset so the fresh process gets a clean counter
    this.workers.delete(workerId)

    // Graceful kill — exit event handler will see recycling=true and skip crash counting
    child.kill('SIGTERM')
    setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 5000)

    try {
      await this.spawnWorker(workerId)
      logger.info(rootCtx, 'Worker recycled successfully', { workerID: `render-worker-${workerId}` })
      this.processNextJob()
    } catch (error) {
      logger.error(rootCtx, 'Failed to respawn worker after recycling', { workerID: `render-worker-${workerId}`, error })
    }
  }

  /**
   * Watchdog: periodically check for workers stuck longer than timeout + grace period.
   * Safety net for edge cases where the timeout handler fails to clean up.
   */
  private startWatchdog(): void {
    this.watchdogTimer = setInterval(() => {
      const threshold = JOB_TIMEOUT_MS + WATCHDOG_GRACE_MS
      const now = Date.now()

      for (const [wId, wInfo] of this.workerInfo) {
        if (wInfo.status === 'busy' && wInfo.currentJobId && wInfo.lastActivityAt) {
          const busyMs = now - wInfo.lastActivityAt
          if (busyMs > threshold) {
            logger.error(rootCtx, 'Watchdog: worker stuck, force-killing', {
              workerID: `render-worker-${wId}`, busyMs, thresholdMs: threshold,
            })

            // Reject the stuck job if still in queue
            const jobIndex = this.jobQueue.findIndex((j) => j.id === wInfo.currentJobId)
            if (jobIndex !== -1) {
              const job = this.jobQueue[jobIndex]
              if (job.timeoutId) clearTimeout(job.timeoutId)
              this.jobQueue.splice(jobIndex, 1)
              job.reject(new Error(`Watchdog: worker #${wId} stuck for ${busyMs}ms`))
            }

            // Clear job ID before kill to prevent double-reject in handleWorkerCrash()
            wInfo.currentJobId = undefined
            const child = this.workers.get(wId)
            if (child) {
              child.kill('SIGKILL')
            }
          }
        }
      }
    }, WATCHDOG_INTERVAL_MS)
  }

  /**
   * Find an idle worker
   */
  private findIdleWorker(): number | null {
    for (const [id, info] of this.workerInfo) {
      if (info.status === 'idle') {
        return id
      }
    }
    return null
  }

  /**
   * Process next job in queue
   */
  private processNextJob(): void {
    if (this.isShuttingDown) return

    // Find a pending job (not initialization jobs, not already being processed)
    const pendingJobIndex = this.jobQueue.findIndex((j) => !j.job.type.startsWith('init') && !this.isJobInProgress(j.id))

    if (pendingJobIndex === -1) return

    const idleWorkerId = this.findIdleWorker()
    if (idleWorkerId === null) return

    const job = this.jobQueue[pendingJobIndex]
    const child = this.workers.get(idleWorkerId)
    if (!child) return

    // Update worker info
    const info = this.workerInfo.get(idleWorkerId)
    if (info) {
      info.status = 'busy'
      info.currentJobId = job.id
      info.lastActivityAt = Date.now()
    }

    // Start execution timeout NOW (when worker picks up the job, not when queued)
    const queueWaitMs = Date.now() - job.createdAt
    const jobCtx = job.traceID ? { traceID: job.traceID } : rootCtx
    logger.debug(jobCtx, 'Job picked up by worker', { jobId: job.id.slice(0, 8), queueWaitMs, workerID: `render-worker-${idleWorkerId}` })
    job.timeoutId = setTimeout(() => {
      logger.error(jobCtx, 'Job timed out, killing worker', { jobId: job.id.slice(0, 8), timeoutMs: JOB_TIMEOUT_MS, queueWaitMs })

      const jobIndex = this.jobQueue.findIndex((j) => j.id === job.id)
      if (jobIndex !== -1) {
        this.jobQueue.splice(jobIndex, 1)
      }
      job.reject(new Error(`Job timeout after ${JOB_TIMEOUT_MS}ms execution time (queued for ${queueWaitMs}ms)`))

      // Find and kill the stuck worker. Clear currentJobId so handleWorkerCrash() won't double-reject.
      for (const [wId, wInfo] of this.workerInfo) {
        if (wInfo.currentJobId === job.id) {
          wInfo.currentJobId = undefined
          const child = this.workers.get(wId)
          if (child) {
            logger.warn(jobCtx, 'Force-killing worker after job timeout', { workerID: `render-worker-${wId}` })
            child.kill('SIGKILL')
          }
          break
        }
      }
    }, JOB_TIMEOUT_MS)

    // Send job to worker
    const message: WorkerMessage = {
      type: 'job',
      jobId: job.id,
      job: job.job,
      traceID: job.traceID,
    }
    child.send(message)
  }

  /**
   * Check if a job is currently being processed by a worker
   */
  private isJobInProgress(jobId: string): boolean {
    for (const info of this.workerInfo.values()) {
      if (info.currentJobId === jobId) {
        return true
      }
    }
    return false
  }

  /**
   * Submit a render job to the pool
   */
  async submitJob(job: RenderJob, traceID?: string): Promise<JobResult> {
    if (this.isShuttingDown) {
      throw new Error('Worker pool is shutting down')
    }

    // Check queue depth — reject early with 503-able error instead of queueing for a guaranteed timeout
    const pendingCount = this.jobQueue.filter(
      (j) => !j.job.type.startsWith('init') && !this.isJobInProgress(j.id)
    ).length
    if (pendingCount >= MAX_QUEUE_DEPTH) {
      throw new Error(
        `Server busy: ${pendingCount} jobs already queued (max ${MAX_QUEUE_DEPTH}). Try again later.`
      )
    }

    return new Promise<JobResult>((resolve, reject) => {
      const queuedJob: QueuedJob = {
        id: randomUUID(),
        job,
        createdAt: Date.now(),
        traceID,
        resolve,
        reject,
      }

      // NOTE: Execution timeout is started in processNextJob() when the worker picks up
      // the job, NOT here. This prevents queued jobs from timing out while waiting.

      // Add to queue
      this.jobQueue.push(queuedJob)

      // Try to process immediately
      this.processNextJob()
    })
  }

  /**
   * Convenience method for single render
   */
  async renderSingle(params: RenderParams, traceID?: string): Promise<SingleRenderResult> {
    const result = await this.submitJob({ type: 'single', params }, traceID)
    if (result.type !== 'single') {
      throw new Error('Unexpected job result type')
    }
    return result
  }

  /**
   * Convenience method for batch render
   * @param params Batch render parameters
   * @param generatorToAdd Optional generator data to add dynamically before rendering
   */
  async renderBatch(params: BatchRenderParams, generatorToAdd?: any, traceID?: string): Promise<BatchRenderResult> {
    const result = await this.submitJob({ type: 'batch', params, generatorToAdd }, traceID)
    if (result.type !== 'batch') {
      throw new Error('Unexpected job result type')
    }
    return result
  }

  /**
   * Get cache stats from the first idle worker via IPC.
   * Returns null if no idle worker is available.
   */
  async getCacheStats(): Promise<CacheStatsResult | null> {
    const idleWorkerId = this.findIdleWorker()
    if (idleWorkerId === null) return null

    try {
      const result = await Promise.race([
        this.submitJob({ type: 'get_cache_stats' }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Cache stats timeout')), 5000)
        ),
      ])
      if (result.type === 'cache_stats') {
        return result as CacheStatsResult
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Get pool status for health checks
   */
  getStatus(): PoolStatus {
    const statusCounts: Record<WorkerStatus, number> = {
      starting: 0,
      idle: 0,
      busy: 0,
      error: 0,
      terminated: 0,
    }

    for (const info of this.workerInfo.values()) {
      statusCounts[info.status]++
    }

    // Queue depth = jobs waiting to be processed (excluding in-progress)
    const queueDepth = this.jobQueue.filter((j) => !this.isJobInProgress(j.id) && j.job.type !== 'initialize').length

    return {
      workers: this.workerCount,
      workerStatus: statusCounts,
      queueDepth,
      totalJobsProcessed: this.totalJobsProcessed,
    }
  }

  /**
   * Check if pool is initialized and ready.
   *
   * Before first initialization: only true when at least one worker is idle/busy.
   * After first initialization: also true when a worker is 'starting' (recycle/respawn in progress)
   * so that incoming requests queue up rather than immediately failing with 500.
   */
  isInitialized(): boolean {
    for (const info of this.workerInfo.values()) {
      if (info.status === 'idle' || info.status === 'busy') return true
    }
    if (this.hasEverInitialized) {
      // Pool was previously ready — 'starting' means a recycle/respawn is in progress.
      // Allow requests through so they queue in submitJob() and are processed once the
      // fresh worker is ready, instead of failing immediately with 500.
      for (const info of this.workerInfo.values()) {
        if (info.status === 'starting') return true
      }
    }
    return false
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info(rootCtx, 'WorkerPoolManager: shutting down')
    this.isShuttingDown = true

    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = undefined
    }

    // Reject all pending jobs
    for (const job of this.jobQueue) {
      if (job.timeoutId) clearTimeout(job.timeoutId)
      job.reject(new Error('Worker pool shutting down'))
    }
    this.jobQueue = []

    // Terminate all worker processes: SIGTERM → 5s timeout → SIGKILL
    const SHUTDOWN_TIMEOUT = 5000
    const terminatePromises: Promise<void>[] = []

    for (const [id, child] of this.workers) {
      logger.info(rootCtx, 'Terminating worker', { workerID: `render-worker-${id}` })
      terminatePromises.push(
        new Promise<void>((resolve) => {
          let resolved = false

          const onExit = () => {
            if (!resolved) {
              resolved = true
              clearTimeout(killTimer)
              resolve()
            }
          }

          child.once('exit', onExit)

          // Force kill if SIGTERM doesn't work within timeout
          const killTimer = setTimeout(() => {
            if (!resolved) {
              logger.warn(rootCtx, 'Worker did not exit after SIGTERM, sending SIGKILL', { workerID: `render-worker-${id}` })
              child.kill('SIGKILL')
            }
          }, SHUTDOWN_TIMEOUT)

          child.kill('SIGTERM')
        })
      )
    }

    await Promise.all(terminatePromises)

    this.workers.clear()
    this.workerInfo.clear()

    logger.info(rootCtx, 'WorkerPoolManager: shutdown complete')
  }
}
