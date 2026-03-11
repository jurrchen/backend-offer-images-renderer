-- Analytics schema for renderer-server (managed by Drizzle)
-- Applied once at startup via drizzle-orm migrator

CREATE SCHEMA IF NOT EXISTS analytics;

-- Source type enum (used in multiple tables)
DO $$ BEGIN
  CREATE TYPE analytics.renderer_source_type AS ENUM ('local', 'external', 'mac', 'docker');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- Test runs (FK target for render_analytics)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics.renderer_test_runs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  server_url        TEXT        NOT NULL,
  source_type       analytics.renderer_source_type NOT NULL DEFAULT 'local',
  name              TEXT,
  description       TEXT,
  status            TEXT        NOT NULL DEFAULT 'running',
  total_renders     INTEGER     DEFAULT 0,
  successful        INTEGER     DEFAULT 0,
  failed            INTEGER     DEFAULT 0,
  avg_duration_ms   DOUBLE PRECISION,
  total_duration_ms BIGINT,
  avg_asset_load_ms DOUBLE PRECISION,
  fixture_names     TEXT[],
  completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_test_runs_created_at ON analytics.renderer_test_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_runs_status     ON analytics.renderer_test_runs(status);

-- ─────────────────────────────────────────────────────────────
-- Render analytics
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics.renderer_render_analytics (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  timestamp            TIMESTAMPTZ NOT NULL,
  type                 TEXT        NOT NULL,
  renderer             TEXT        NOT NULL DEFAULT 'typescript',
  generator_id         TEXT        NOT NULL,
  view_id              TEXT,
  color_name           TEXT,
  image_count          INTEGER     NOT NULL DEFAULT 1,
  duration_ms          INTEGER     NOT NULL,
  resolution           INTEGER,
  asset_load_ms        INTEGER,
  asset_network_ms     INTEGER,
  asset_processing_ms  INTEGER,
  memory_rss_mb        DOUBLE PRECISION,
  memory_heap_total_mb DOUBLE PRECISION,
  memory_heap_used_mb  DOUBLE PRECISION,
  memory_external_mb   DOUBLE PRECISION,
  status               TEXT        NOT NULL DEFAULT 'success',
  error                TEXT,
  server_url           TEXT        NOT NULL,
  source_type          analytics.renderer_source_type NOT NULL DEFAULT 'local',
  test_run_id          UUID REFERENCES analytics.renderer_test_runs(id) ON DELETE CASCADE,
  print_method         TEXT,
  queue_depth          INTEGER,
  request_id           TEXT,
  region_timings       JSONB
);

CREATE INDEX IF NOT EXISTS idx_render_analytics_created_at  ON analytics.renderer_render_analytics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_render_analytics_server_url  ON analytics.renderer_render_analytics(server_url);
CREATE INDEX IF NOT EXISTS idx_render_analytics_source_type ON analytics.renderer_render_analytics(source_type);
CREATE INDEX IF NOT EXISTS idx_render_analytics_test_run_id ON analytics.renderer_render_analytics(test_run_id);
CREATE INDEX IF NOT EXISTS idx_render_analytics_print_method ON analytics.renderer_render_analytics(print_method);
CREATE INDEX IF NOT EXISTS idx_render_analytics_request_id  ON analytics.renderer_render_analytics(request_id);

-- ─────────────────────────────────────────────────────────────
-- Error analytics
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics.renderer_error_analytics (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  timestamp       TIMESTAMPTZ NOT NULL,
  service         TEXT        NOT NULL,
  endpoint        TEXT        NOT NULL,
  error_category  TEXT        NOT NULL,
  error_message   TEXT        NOT NULL,
  error_stack     TEXT,
  status_code     INTEGER     NOT NULL,
  generator_id    TEXT,
  print_method    TEXT,
  server_url      TEXT        NOT NULL,
  source_type     analytics.renderer_source_type NOT NULL DEFAULT 'local',
  request_id      TEXT,
  duration_ms     INTEGER,
  retry_count     INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_error_created_at ON analytics.renderer_error_analytics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_category   ON analytics.renderer_error_analytics(error_category);
CREATE INDEX IF NOT EXISTS idx_error_service    ON analytics.renderer_error_analytics(service);

-- ─────────────────────────────────────────────────────────────
-- Worker pool metrics
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics.renderer_worker_pool_metrics (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  timestamp            TIMESTAMPTZ NOT NULL,
  workers_total        INTEGER     NOT NULL,
  workers_idle         INTEGER     NOT NULL,
  workers_busy         INTEGER     NOT NULL,
  workers_error        INTEGER     DEFAULT 0,
  queue_depth          INTEGER     NOT NULL,
  total_jobs_processed BIGINT      NOT NULL,
  server_url           TEXT        NOT NULL,
  memory_rss_mb        DOUBLE PRECISION,
  memory_heap_used_mb  DOUBLE PRECISION,
  cpu_usage_percent    DOUBLE PRECISION,
  event_loop_lag_ms    DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_pool_metrics_timestamp ON analytics.renderer_worker_pool_metrics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_pool_metrics_server    ON analytics.renderer_worker_pool_metrics(server_url);

-- ─────────────────────────────────────────────────────────────
-- Per-endpoint API metrics
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics.renderer_api_metrics (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  timestamp           TIMESTAMPTZ NOT NULL,
  endpoint            TEXT        NOT NULL,
  method              TEXT        NOT NULL,
  status_code         INTEGER     NOT NULL,
  duration_ms         INTEGER     NOT NULL,
  request_size_bytes  INTEGER,
  response_size_bytes INTEGER,
  server_url          TEXT        NOT NULL,
  source_type         analytics.renderer_source_type NOT NULL DEFAULT 'local',
  request_id          TEXT,
  user_agent          TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_metrics_timestamp ON analytics.renderer_api_metrics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_metrics_endpoint  ON analytics.renderer_api_metrics(endpoint);

-- ─────────────────────────────────────────────────────────────
-- Cache analytics
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics.renderer_cache_analytics (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  timestamp       TIMESTAMPTZ NOT NULL,
  cache_type      TEXT        NOT NULL,
  entries         INTEGER     NOT NULL,
  max_entries     INTEGER     NOT NULL,
  size_bytes      BIGINT      NOT NULL,
  max_size_bytes  BIGINT      NOT NULL,
  utilization_pct DOUBLE PRECISION NOT NULL,
  hits            INTEGER     DEFAULT 0,
  misses          INTEGER     DEFAULT 0,
  evictions       INTEGER     DEFAULT 0,
  hit_rate_pct    DOUBLE PRECISION,
  server_url      TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cache_timestamp ON analytics.renderer_cache_analytics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cache_type      ON analytics.renderer_cache_analytics(cache_type);
