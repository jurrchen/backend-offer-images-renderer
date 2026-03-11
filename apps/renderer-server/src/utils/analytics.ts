import { config } from '../config/index.js'
import { getAnalyticsDb } from '../db/client.js'
import { logger, rootCtx } from '../logger/index.js'

type ErrorCategory =
  | 'validation' | 'timeout' | 'worker_crash' | 'queue_full'
  | 'asset_fetch' | 'gl_context' | 'authentication' | 'upload_failed'
  | 'api_upstream' | 'unknown'
import {
  renderAnalytics,
  errorAnalytics,
  workerPoolMetrics,
  apiMetrics,
  cacheAnalytics,
} from '../db/schema.js'

export interface RenderAnalytics {
  id: string;
  timestamp: string;
  type: 'single' | 'batch';
  renderer: 'typescript' | 'rust';
  generatorId: string;
  viewId?: string;
  colorName?: string;
  imageCount: number;
  durationMs: number;
  resolution?: number;
  assetLoadMs?: number;
  assetNetworkMs?: number;
  assetProcessingMs?: number;
  memoryUsage: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  outputDir?: string;
  status: 'success' | 'failed';
  error?: string;
  printMethod?: string;
  testRunId?: string;
}

type LogEntry = Omit<RenderAnalytics, 'id' | 'timestamp' | 'memoryUsage' | 'renderer'> & {
  queueDepth?: number;
  requestId?: string;
  regionTimings?: Record<string, number>;
};

/**
 * Categorize an error into a known ErrorCategory for analytics.
 */
export function categorizeError(error: Error | string): ErrorCategory {
  const msg = typeof error === 'string' ? error.toLowerCase() : error.message.toLowerCase()

  if (/zod|validation|invalid|schema/.test(msg)) return 'validation'
  if (/timeout|timed out/.test(msg)) return 'timeout'
  if (/crashed|worker|respawn/.test(msg)) return 'worker_crash'
  if (/queue|server busy/.test(msg)) return 'queue_full'
  if (/fetch|cdn|404|asset/.test(msg)) return 'asset_fetch'
  if (/gl|webgl|context/.test(msg)) return 'gl_context'
  if (/auth|unauthorized|401|api key/.test(msg)) return 'authentication'
  if (/upload/.test(msg)) return 'upload_failed'
  if (/upstream|api|502|503/.test(msg)) return 'api_upstream'
  return 'unknown'
}

class AnalyticsManager {
  private serverUrl: string = '';
  private initialized = false;
  private enabled = false;

  private init(): void {
    if (this.initialized) return;
    this.initialized = true;

    if (config.database.url) {
      this.enabled = true;
    }

    this.serverUrl = config.serverUrl || `http://localhost:${config.port}`;
  }

  async log(entry: LogEntry): Promise<RenderAnalytics> {
    this.init();
    const memory = process.memoryUsage();
    const fullEntry: RenderAnalytics = {
      ...entry,
      id: Math.random().toString(36).substring(2, 11),
      timestamp: new Date().toISOString(),
      renderer: 'typescript',
      memoryUsage: {
        rss: Math.round(memory.rss / 1024 / 1024),
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
        external: Math.round(memory.external / 1024 / 1024),
      },
    };

    if (!this.enabled) return fullEntry;

    try {
      await getAnalyticsDb().insert(renderAnalytics).values({
        timestamp: new Date(fullEntry.timestamp),
        type: fullEntry.type,
        renderer: fullEntry.renderer,
        generator_id: fullEntry.generatorId,
        view_id: fullEntry.viewId,
        color_name: fullEntry.colorName,
        image_count: fullEntry.imageCount,
        duration_ms: fullEntry.durationMs,
        resolution: fullEntry.resolution,
        asset_load_ms: fullEntry.assetLoadMs,
        asset_network_ms: fullEntry.assetNetworkMs,
        asset_processing_ms: fullEntry.assetProcessingMs,
        memory_rss_mb: fullEntry.memoryUsage.rss,
        memory_heap_total_mb: fullEntry.memoryUsage.heapTotal,
        memory_heap_used_mb: fullEntry.memoryUsage.heapUsed,
        memory_external_mb: fullEntry.memoryUsage.external,
        status: fullEntry.status,
        error: fullEntry.error,
        server_url: this.serverUrl,
        source_type: 'local',
        print_method: fullEntry.printMethod,
        test_run_id: fullEntry.testRunId,
        queue_depth: entry.queueDepth ?? null,
        request_id: entry.requestId,
        region_timings: entry.regionTimings,
      } as any)
    } catch (err) {
      logger.error(rootCtx, 'Failed to save analytics', { error: err })
    }

    return fullEntry;
  }

  async logError(entry: {
    endpoint: string
    errorCategory: ErrorCategory
    errorMessage: string
    errorStack?: string
    statusCode: number
    generatorId?: string
    printMethod?: string
    requestId?: string
    durationMs?: number
  }): Promise<void> {
    this.init();
    if (!this.enabled) return;

    try {
      await getAnalyticsDb().insert(errorAnalytics).values({
        timestamp: new Date(),
        service: 'renderer',
        endpoint: entry.endpoint,
        error_category: entry.errorCategory,
        error_message: entry.errorMessage,
        error_stack: entry.errorStack,
        status_code: entry.statusCode,
        generator_id: entry.generatorId,
        print_method: entry.printMethod,
        server_url: this.serverUrl,
        source_type: 'local',
        request_id: entry.requestId,
        duration_ms: entry.durationMs,
      } as any)
    } catch {
      // Fire-and-forget
    }
  }

  async logWorkerPoolMetrics(entry: {
    workersTotal: number
    workersIdle: number
    workersBusy: number
    workersError?: number
    queueDepth: number
    totalJobsProcessed: number
    memoryRssMb?: number
    memoryHeapUsedMb?: number
    cpuUsagePercent?: number
    eventLoopLagMs?: number
  }): Promise<void> {
    this.init();
    if (!this.enabled) return;

    try {
      await getAnalyticsDb().insert(workerPoolMetrics).values({
        timestamp: new Date(),
        workers_total: entry.workersTotal,
        workers_idle: entry.workersIdle,
        workers_busy: entry.workersBusy,
        workers_error: entry.workersError,
        queue_depth: entry.queueDepth,
        total_jobs_processed: entry.totalJobsProcessed,
        server_url: this.serverUrl,
        memory_rss_mb: entry.memoryRssMb,
        memory_heap_used_mb: entry.memoryHeapUsedMb,
        cpu_usage_percent: entry.cpuUsagePercent,
        event_loop_lag_ms: entry.eventLoopLagMs,
      } as any)
    } catch {
      // Fire-and-forget
    }
  }

  async logApiMetrics(entry: {
    endpoint: string
    method: string
    statusCode: number
    durationMs: number
    requestSizeBytes?: number
    responseSizeBytes?: number
    requestId?: string
    userAgent?: string
  }): Promise<void> {
    this.init();
    if (!this.enabled) return;

    try {
      await getAnalyticsDb().insert(apiMetrics).values({
        timestamp: new Date(),
        endpoint: entry.endpoint,
        method: entry.method,
        status_code: entry.statusCode,
        duration_ms: entry.durationMs,
        request_size_bytes: entry.requestSizeBytes,
        response_size_bytes: entry.responseSizeBytes,
        server_url: this.serverUrl,
        source_type: 'local',
        request_id: entry.requestId,
        user_agent: entry.userAgent,
      } as any)
    } catch {
      // Fire-and-forget
    }
  }

  async logCacheMetrics(entries: Array<{
    cacheType: 'texture_memory' | 'mesh_memory' | 'disk'
    entries: number
    maxEntries: number
    sizeBytes: number
    maxSizeBytes: number
    utilizationPct: number
    hits?: number
    misses?: number
    evictions?: number
    hitRatePct?: number
  }>): Promise<void> {
    this.init();
    if (!this.enabled) return;

    try {
      const now = new Date();
      const rows = entries.map(e => ({
        timestamp: now,
        cache_type: e.cacheType,
        entries: e.entries,
        max_entries: e.maxEntries,
        size_bytes: e.sizeBytes,
        max_size_bytes: e.maxSizeBytes,
        utilization_pct: e.utilizationPct,
        hits: e.hits,
        misses: e.misses,
        evictions: e.evictions,
        hit_rate_pct: e.hitRatePct,
        server_url: this.serverUrl,
      }))
      await getAnalyticsDb().insert(cacheAnalytics).values(rows as any)
    } catch {
      // Fire-and-forget
    }
  }
}

export const analytics = new AnalyticsManager();
