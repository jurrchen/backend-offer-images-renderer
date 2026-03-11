export type SourceType = 'local' | 'external' | 'mac' | 'docker'

export interface RenderAnalyticsRow {
  id: string
  created_at: string
  timestamp: string
  type: 'single' | 'batch'
  renderer: 'typescript' | 'rust'
  generator_id: string
  view_id?: string
  color_name?: string
  image_count: number
  duration_ms: number
  resolution?: number
  asset_load_ms?: number
  asset_network_ms?: number
  asset_processing_ms?: number
  memory_rss_mb?: number
  memory_heap_total_mb?: number
  memory_heap_used_mb?: number
  memory_external_mb?: number
  status: 'success' | 'failed'
  error?: string
  server_url: string
  source_type: SourceType
  test_run_id?: string
  print_method?: string
  queue_depth?: number | null
  request_id?: string
  region_timings?: Record<string, number>
}

export interface TestRunRow {
  id: string
  created_at: string
  server_url: string
  source_type: SourceType
  name?: string
  description?: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  total_renders: number
  successful: number
  failed: number
  avg_duration_ms?: number
  total_duration_ms?: number
  avg_asset_load_ms?: number
  fixture_names: string[]
  completed_at?: string
}

export type RenderAnalyticsInsert = Omit<RenderAnalyticsRow, 'id' | 'created_at'>
export type TestRunInsert = Omit<TestRunRow, 'id' | 'created_at'>

// ============================================================================
// Error Analytics (both services)
// ============================================================================
export type ErrorCategory =
  | 'validation'
  | 'timeout'
  | 'worker_crash'
  | 'queue_full'
  | 'asset_fetch'
  | 'gl_context'
  | 'upload_failed'
  | 'api_upstream'
  | 'authentication'
  | 'unknown'

export type AnalyticsService = 'renderer' | 'offer-draft'

export interface ErrorAnalyticsRow {
  id: string
  created_at: string
  timestamp: string
  service: AnalyticsService
  endpoint: string
  error_category: ErrorCategory
  error_message: string
  error_stack?: string
  status_code: number
  generator_id?: string
  print_method?: string
  server_url: string
  source_type: SourceType
  request_id?: string
  duration_ms?: number
  retry_count?: number
}

export type ErrorAnalyticsInsert = Omit<ErrorAnalyticsRow, 'id' | 'created_at'>

// ============================================================================
// Worker Pool Metrics (renderer-server)
// ============================================================================
export interface WorkerPoolMetricsRow {
  id: string
  created_at: string
  timestamp: string
  workers_total: number
  workers_idle: number
  workers_busy: number
  workers_error?: number
  queue_depth: number
  total_jobs_processed: number
  server_url: string
  memory_rss_mb?: number
  memory_heap_used_mb?: number
  cpu_usage_percent?: number
  event_loop_lag_ms?: number
}

export type WorkerPoolMetricsInsert = Omit<WorkerPoolMetricsRow, 'id' | 'created_at'>

// ============================================================================
// Per-Endpoint API Metrics (renderer-server)
// ============================================================================
export interface RendererApiMetricsRow {
  id: string
  created_at: string
  timestamp: string
  endpoint: string
  method: string
  status_code: number
  duration_ms: number
  request_size_bytes?: number
  response_size_bytes?: number
  server_url: string
  source_type: SourceType
  request_id?: string
  user_agent?: string
}

export type RendererApiMetricsInsert = Omit<RendererApiMetricsRow, 'id' | 'created_at'>

// ============================================================================
// Cache Analytics (renderer-server)
// ============================================================================
export type CacheType = 'texture_memory' | 'mesh_memory' | 'disk'

export interface CacheAnalyticsRow {
  id: string
  created_at: string
  timestamp: string
  cache_type: CacheType
  entries: number
  max_entries: number
  size_bytes: number
  max_size_bytes: number
  utilization_pct: number
  hits?: number
  misses?: number
  evictions?: number
  hit_rate_pct?: number
  server_url: string
}

export type CacheAnalyticsInsert = Omit<CacheAnalyticsRow, 'id' | 'created_at'>

