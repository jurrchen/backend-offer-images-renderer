import { pgSchema, text, integer, bigint, doublePrecision, timestamp, uuid, jsonb } from 'drizzle-orm/pg-core'

export const analyticsSchema = pgSchema('analytics')

// ──────────────────────────────────────────────
// Property names match DB column names (snake_case) so API responses
// are compatible with the existing @fourthwall/shared TypeScript types.
// ──────────────────────────────────────────────

export const testRuns = analyticsSchema.table('renderer_test_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  server_url: text('server_url').notNull(),
  source_type: text('source_type').notNull().default('local'),
  name: text('name'),
  description: text('description'),
  status: text('status').notNull().default('running'),
  total_renders: integer('total_renders').default(0),
  successful: integer('successful').default(0),
  failed: integer('failed').default(0),
  avg_duration_ms: doublePrecision('avg_duration_ms'),
  total_duration_ms: bigint('total_duration_ms', { mode: 'number' }),
  avg_asset_load_ms: doublePrecision('avg_asset_load_ms'),
  fixture_names: text('fixture_names').array(),
  completed_at: timestamp('completed_at', { withTimezone: true }),
})

export const renderAnalytics = analyticsSchema.table('renderer_render_analytics', {
  id: uuid('id').primaryKey().defaultRandom(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  type: text('type').notNull(),
  renderer: text('renderer').notNull().default('typescript'),
  generator_id: text('generator_id').notNull(),
  view_id: text('view_id'),
  color_name: text('color_name'),
  image_count: integer('image_count').notNull().default(1),
  duration_ms: integer('duration_ms').notNull(),
  resolution: integer('resolution'),
  asset_load_ms: integer('asset_load_ms'),
  asset_network_ms: integer('asset_network_ms'),
  asset_processing_ms: integer('asset_processing_ms'),
  memory_rss_mb: doublePrecision('memory_rss_mb'),
  memory_heap_total_mb: doublePrecision('memory_heap_total_mb'),
  memory_heap_used_mb: doublePrecision('memory_heap_used_mb'),
  memory_external_mb: doublePrecision('memory_external_mb'),
  status: text('status').notNull().default('success'),
  error: text('error'),
  server_url: text('server_url').notNull(),
  source_type: text('source_type').notNull().default('local'),
  test_run_id: uuid('test_run_id'),
  print_method: text('print_method'),
  queue_depth: integer('queue_depth'),
  request_id: text('request_id'),
  region_timings: jsonb('region_timings'),
})

export const errorAnalytics = analyticsSchema.table('renderer_error_analytics', {
  id: uuid('id').primaryKey().defaultRandom(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  service: text('service').notNull(),
  endpoint: text('endpoint').notNull(),
  error_category: text('error_category').notNull(),
  error_message: text('error_message').notNull(),
  error_stack: text('error_stack'),
  status_code: integer('status_code').notNull(),
  generator_id: text('generator_id'),
  print_method: text('print_method'),
  server_url: text('server_url').notNull(),
  source_type: text('source_type').notNull().default('local'),
  request_id: text('request_id'),
  duration_ms: integer('duration_ms'),
  retry_count: integer('retry_count').default(0),
})

export const workerPoolMetrics = analyticsSchema.table('renderer_worker_pool_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  workers_total: integer('workers_total').notNull(),
  workers_idle: integer('workers_idle').notNull(),
  workers_busy: integer('workers_busy').notNull(),
  workers_error: integer('workers_error').default(0),
  queue_depth: integer('queue_depth').notNull(),
  total_jobs_processed: bigint('total_jobs_processed', { mode: 'number' }).notNull(),
  server_url: text('server_url').notNull(),
  memory_rss_mb: doublePrecision('memory_rss_mb'),
  memory_heap_used_mb: doublePrecision('memory_heap_used_mb'),
  cpu_usage_percent: doublePrecision('cpu_usage_percent'),
  event_loop_lag_ms: doublePrecision('event_loop_lag_ms'),
})

export const apiMetrics = analyticsSchema.table('renderer_api_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  endpoint: text('endpoint').notNull(),
  method: text('method').notNull(),
  status_code: integer('status_code').notNull(),
  duration_ms: integer('duration_ms').notNull(),
  request_size_bytes: integer('request_size_bytes'),
  response_size_bytes: integer('response_size_bytes'),
  server_url: text('server_url').notNull(),
  source_type: text('source_type').notNull().default('local'),
  request_id: text('request_id'),
  user_agent: text('user_agent'),
})

export const cacheAnalytics = analyticsSchema.table('renderer_cache_analytics', {
  id: uuid('id').primaryKey().defaultRandom(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  cache_type: text('cache_type').notNull(),
  entries: integer('entries').notNull(),
  max_entries: integer('max_entries').notNull(),
  size_bytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  max_size_bytes: bigint('max_size_bytes', { mode: 'number' }).notNull(),
  utilization_pct: doublePrecision('utilization_pct').notNull(),
  hits: integer('hits').default(0),
  misses: integer('misses').default(0),
  evictions: integer('evictions').default(0),
  hit_rate_pct: doublePrecision('hit_rate_pct'),
  server_url: text('server_url').notNull(),
})
