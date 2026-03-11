/**
 * Shared types for worker thread communication
 */

import type { RenderParams, BatchRenderParams, RenderResult, RenderTiming } from '../rendering/HeadlessRenderer.js'

// Re-export HeadlessRenderer types for convenience
export type { RenderParams, BatchRenderParams, RenderResult, RenderTiming }

/**
 * Job types supported by render workers
 */
export type JobType = 'single' | 'batch' | 'initialize'

/**
 * Single render job parameters
 */
export interface SingleRenderJob {
  type: 'single'
  params: RenderParams
}

/**
 * Batch render job parameters
 */
export interface BatchRenderJob {
  type: 'batch'
  params: BatchRenderParams
  /** Generator data to add dynamically before rendering */
  generatorToAdd?: any
}

/**
 * Initialize worker job (called once on worker startup)
 */
export interface InitializeJob {
  type: 'initialize'
  params: {
    generators: any[]
    canvasSize: number
  }
}

/**
 * Cache stats request job (IPC to worker)
 */
export interface CacheStatsJob {
  type: 'get_cache_stats'
}

/**
 * Union type for all job types
 */
export type RenderJob = SingleRenderJob | BatchRenderJob | InitializeJob | CacheStatsJob

/**
 * Job wrapper with metadata for queue management
 */
export interface QueuedJob {
  id: string
  job: RenderJob
  createdAt: number
  traceID?: string
  resolve: (result: JobResult) => void
  reject: (error: Error) => void
  timeoutId?: ReturnType<typeof setTimeout>
}

/**
 * Result from a single render job
 */
export interface SingleRenderResult {
  type: 'single'
  buffer: Buffer
  assetLoadMs: number
  assetNetworkMs: number
  assetProcessingMs: number
  timing?: RenderTiming
}

/**
 * Result from a batch render job
 */
export interface BatchRenderResult {
  type: 'batch'
  results: RenderResult[]
  assetLoadMs: number
  assetNetworkMs: number
  assetProcessingMs: number
  timing?: RenderTiming
}

/**
 * Result from initialization
 */
export interface InitializeResult {
  type: 'initialize'
  success: boolean
}

/**
 * Result from cache stats request
 */
export interface CacheStatsResult {
  type: 'cache_stats'
  stats: {
    texture: { size: number; maxSize: number; entries: number; maxEntries: number; hits: number; misses: number; evictions: number }
    mesh: { size: number; maxSize: number; entries: number; maxEntries: number; hits: number; misses: number; evictions: number }
  }
}

/**
 * Union type for all job results
 */
export type JobResult = SingleRenderResult | BatchRenderResult | InitializeResult | CacheStatsResult

/**
 * Message from main thread to worker
 */
export interface WorkerMessage {
  type: 'job'
  jobId: string
  job: RenderJob
  traceID?: string
}

/**
 * Response from worker to main thread
 */
export interface WorkerResponse {
  type: 'result' | 'error' | 'ready' | 'recycle-request'
  jobId?: string
  result?: JobResult
  error?: string
  rss?: number
}

/**
 * Worker status for monitoring
 */
export type WorkerStatus = 'starting' | 'idle' | 'busy' | 'error' | 'terminated'

/**
 * Worker info for pool management
 */
export interface WorkerInfo {
  id: number
  status: WorkerStatus
  currentJobId?: string
  jobsCompleted: number
  lastActivityAt: number
  respawnCount: number
  lastRespawnAt: number
  recycling?: boolean
}

/**
 * Pool status for health checks
 */
export interface PoolStatus {
  workers: number
  workerStatus: {
    starting: number
    idle: number
    busy: number
    error: number
    terminated: number
  }
  queueDepth: number
  totalJobsProcessed: number
}
