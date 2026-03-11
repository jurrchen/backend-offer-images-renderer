# Renderer Server

Headless Node.js 3D rendering service (Express + headless-gl + canvas) wrapping `@fourthwall/product-renderer`. Produces product mockup images from generator configurations, artwork, and color/view selections — all without a browser.

## Quick Start

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env — set API_KEY, optionally DATABASE_URL

# 2. Install dependencies (from monorepo root)
npm install

# 3. Development (builds worker bundle, then watches)
npm run dev              # Build + tsx watch (port 3000)

# 4. Production
npm run build            # TypeScript compile + bundle worker
npm start                # node dist/server.js

# 5. Tests
npm test                 # Vitest
npm run test:watch       # Vitest watch mode

# 6. Quality
npm run lint             # ESLint
npm run type-check       # tsc --noEmit
```

### With PostgreSQL async queue (optional)

```bash
# Start postgres (local dev)
docker compose up postgres -d

# Add to .env
DATABASE_URL=postgresql://renderer:renderer_dev@localhost:5432/offer-renderer

# Start server — pg-boss initialises its own schema automatically
npm run dev
```

### Async jobs: local vs GCP environments

The storage and pub/sub layers are selected by environment variables at startup. The key switch is `LOCAL_OUTPUT_DIR`:

| Scenario | Storage | Pub/Sub | SSE stream |
|----------|---------|---------|------------|
| **`npm run dev` (no Docker)** | `LOCAL_OUTPUT_DIR` → writes PNGs to `./output/`, served at `/output/*` | **Disabled** — `LOCAL_OUTPUT_DIR` triggers `LocalPubSubService` which needs `DATABASE_URL`; warns and skips if missing | Silent — SSE connects but never fires; fall back to polling `GET /api/v1/jobs/:id` |
| **`npm run dev` + `docker compose up postgres -d`** | Same local file storage | `LocalPubSubService` → inserts `JobCompletedEvent` JSON into `analytics.renderer_pubsub_events` in Postgres | Works — SSE endpoint polls that table every 2s and emits to connected clients |
| **GCP (Cloud Run / GKE)** — `LOCAL_OUTPUT_DIR` unset | `GCS_BUCKET_NAME` → `GcsStorageService` uploads PNG buffers to GCS bucket | `GCP_PROJECT_ID` → `GcpPubSubService` publishes to GCP Pub/Sub topic | Not backed by Postgres — SSE stream is unused; consumers subscribe to the Pub/Sub topic directly |

**Key rule:** `LOCAL_OUTPUT_DIR` is the master switch. It takes priority over `GCS_BUCKET_NAME` and `GCP_PROJECT_ID` in both factories. Never leave it set in a GCP deployment — you'd get local disk writes (which are ephemeral in Cloud Run) and no real Pub/Sub.

The `build` step runs two commands: `tsc` (compile TypeScript) then `build:worker` (esbuild bundles `RenderWorker.ts` into a standalone `.js` file). The worker bundle is required because `child_process.fork()` needs a plain JavaScript file with all imports resolved.

## Architecture

### Request Flow

```
Client
  │
  ├─ POST /api/v1/render ──────────→ auth → Zod → WorkerPoolManager
  │                                    → child_process.fork() → HeadlessRenderer
  │                                    → ProductRendererV2 → readPixels → PNG binary ← (sync)
  │
  ├─ POST /api/v1/render/batch ───→ auth → Zod → FourthwallApiService.resolveGenerator()
  │                                    → auto-populate colors/views/regions
  │                                    → WorkerPoolManager → HeadlessRenderer
  │                                    → bulkDrawActiveGenerator → base64 PNGs ← (sync)
  │
  ├─ POST /api/v1/jobs ───────────→ auth → Zod → PgJobQueue.submit()
  │      202 { id, pollUrl } ←──       → boss.send('render', payload) → PostgreSQL
  │      (instant, fire-and-forget)         ↓ (async, dequeued by pg-boss worker)
  │                                    resolveRenderParams() → WorkerPoolManager.renderBatch()
  │                                    → GCS upload → Pub/Sub publish → job.output stored
  │
  ├─ GET  /api/v1/jobs/:id ───────→ auth → PgJobQueue.getJob() → boss.getJobById()
  │      { status, result } ←──        → JobStatusResponse (pending/processing/completed/failed)
  │
  ├─ GET /api/v1/generators/resolve → auth → FourthwallApiService → JSON
  │
  ├─ GET /api/v1/fixtures[/:name] ─→ read fixtures/*.json → JSON
  │
  ├─ POST /api/v1/test-runs ───────→ auth → Zod → Drizzle (analytics schema) → JSON
  │
  ├─ GET  /api/v1/analytics/* ─────→ auth → Drizzle query → JSON
  │
  ├─ POST /api/v1/design ──────────→ auth → centerArtwork() → buildXastState() → JSON
  │
  └─ GET /api/v1/health[/ready|/live] → pool status + memory metrics → JSON
```

### Key Files

| File | Role |
|------|------|
| `src/server.ts` | Express app entry — middleware, asset proxy, route setup, graceful shutdown |
| `src/rendering/HeadlessRenderer.ts` | headless-gl integration — canvas polyfill, GL context, asset caching, render pipeline |
| `src/workers/WorkerPoolManager.ts` | Child process pool with job queue, crash recovery, watchdog, memory budget |
| `src/workers/RenderWorker.ts` | Child process entry point (bundled with esbuild) |
| `src/workers/types.ts` | Worker IPC message types and job definitions |
| `src/queue/PgJobQueue.ts` | **pg-boss async queue** — PostgreSQL persistence, storage upload, Pub/Sub publish |
| `src/queue/resolveRenderParams.ts` | **Shared resolver** — generator resolution + auto-population for async workers |
| `src/jobs/job-store.ts` | In-memory job store — fallback when `DATABASE_URL` is not set |
| `src/storage/` | `StorageService` interface + `LocalStorageService` (disk) + `GcsStorageService` (GCS) |
| `src/pubsub/` | `PubSubService` interface + `LocalPubSubService` (Postgres) + `GcpPubSubService` (GCP) |
| `src/api/routes/events.ts` | `GET /api/v1/events/stream` — SSE stream polling `renderer_pubsub_events` every 2s |
| `src/services/FourthwallApiService.ts` | Fourthwall API client — generator resolution, product search, color auto-selection |
| `src/api/routes/render.ts` | `POST /api/v1/render` — single image render |
| `src/api/routes/batch.ts` | `POST /api/v1/render/batch` — batch render with auto-resolution |
| `src/api/routes/jobs.ts` | `POST /api/v1/jobs` + `GET /api/v1/jobs/:id` — async job endpoints |
| `src/api/routes/generators.ts` | `GET /api/v1/generators/resolve` — generator resolution |
| `src/api/routes/fixtures.ts` | `GET /api/v1/fixtures[/:name]` — serve generator fixture JSON |
| `src/api/routes/test-runs.ts` | `POST /api/v1/test-runs` + `POST /api/v1/test-runs/:id/finalize` — test run lifecycle (Drizzle) |
| `src/api/routes/analytics.ts` | 6 GET endpoints for analytics data (renders, errors, workers, cache, API metrics, test runs) |
| `src/api/routes/design.ts` | `POST /api/v1/design` — artwork centering + XAST V4 state generation (moved from renderer-api) |
| `src/db/schema.ts` | Drizzle table definitions for `analytics` schema (6 tables) |
| `src/db/client.ts` | Singleton `pg.Pool` + `getAnalyticsDb()` + `runMigrations()` |
| `src/db/migrations/` | SQL migration files applied automatically on startup |
| `drizzle.config.ts` | drizzle-kit config for schema generation |
| `src/api/routes/health.ts` | Health, readiness, and liveness probes |
| `src/api/middleware/auth.ts` | Static API key authentication |
| `src/api/middleware/validate.ts` | Zod schema validation middleware |
| `src/api/middleware/error.ts` | Error handler (RenderError, AuthenticationError) |
| `src/api/middleware/request-id.ts` | Unique request ID injection |
| `src/api/middleware/api-metrics.ts` | Per-request API metrics (Drizzle) |
| `src/api/schemas.ts` | Zod schemas for all API requests/responses |
| `src/utils/analytics.ts` | Analytics manager — logs to PostgreSQL via Drizzle (optional, requires `DATABASE_URL`) |
| `swagger.yaml` | OpenAPI 3.0 spec |
| `fixtures/*.json` | Generator fixture files (real API payloads) |
| `scripts/build-worker.mjs` | esbuild script for bundling the worker |

## API Endpoints

### `POST /api/v1/render`

Renders a single product image with the specified generator, color, view, and artwork. Returns the rendered image as PNG binary data.

**Auth:** Required (Bearer token)

**Request:**

```json
{
  "generatorId": "gen_abc123",
  "image": "data:image/png;base64,iVBORw0KGgo...",
  "region": "front",
  "color": "Black",
  "view": "view-0"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `generatorId` | string | yes | Generator UUID |
| `image` | string | yes | Base64-encoded artwork (with or without data URI prefix) |
| `region` | string | yes | Region ID where artwork is placed |
| `color` | string | yes | Color name of the product variant |
| `view` | string | yes | View ID for camera angle |

**Response (200):** `image/png` binary

**Response headers:**

| Header | Description |
|--------|-------------|
| `X-Render-Duration` | Render duration in milliseconds |
| `Cache-Control` | `public, max-age=31536000` |

**Error codes:** `400` validation error, `401` auth required, `500` render error, `503` queue full

---

### `POST /api/v1/render/batch`

Renders multiple product images in a single request. Supports intelligent defaults — auto-selects colors, views, and regions if not provided.

**Auth:** Required (Bearer token)

**Generator resolution** (use exactly ONE):

| Field | Source |
|-------|--------|
| `generatorData` | Full generator configuration object (highest priority) |
| `productSlug` | Fourthwall product slug → API lookup |
| `productType` | Preset: `"bestsellers"` or `"staff-picked"` |
| `productQuery` | Free-text product search |
| `generatorId` | Direct generator UUID (lowest priority) |

**Request:**

```json
{
  "generatorId": "gen_abc123",
  "images": [
    { "region": "front", "data": "data:image/png;base64,iVBORw0KGgo..." }
  ],
  "colors": ["Black", "White"],
  "views": ["view-0", "view-1"],
  "renderSize": 2048,
  "imageFormat": "image/png",
  "imageQuality": 0.92,
  "artworkQuality": 1,
  "autoCenter": true
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `images` | array | yes | — | Artwork images with optional `region` |
| `images[].data` | string | yes | — | Base64-encoded artwork |
| `images[].region` | string | no | auto | Region ID (auto-selected if omitted) |
| `generatorId` | string | no | — | Direct generator UUID |
| `generatorData` | object | no | — | Full generator config |
| `productSlug` | string | no | — | Fourthwall product slug |
| `productType` | string | no | — | `"bestsellers"` or `"staff-picked"` |
| `productQuery` | string | no | — | Free-text product search |
| `colors` | string[] | no | auto | Color names (auto: 1 light + 1 dark) |
| `views` | string[] | no | auto | View IDs (auto: all available) |
| `renderSize` | number | no | 2048 | Output image size in pixels (256–4096) |
| `imageFormat` | string | no | `image/png` | `image/png` or `image/jpeg` |
| `imageQuality` | number | no | 0.92 | JPEG quality 0–1 (ignored for PNG) |
| `artworkQuality` | number | no | 1 | Artwork scaling quality 0.1–1 |
| `autoCenter` | boolean | no | true | Auto-center artwork within region |
| `outputDir` | string | no | — | Directory to save files (optional) |
| `testRunId` | string | no | — | Test run ID for analytics correlation |

**Response (200):**

```json
{
  "results": [
    {
      "image": "<base64-encoded PNG>",
      "color": "Black",
      "view": "view-0",
      "region": "front"
    }
  ],
  "count": 4,
  "duration": 12500
}
```

**Response headers:**

| Header | Description |
|--------|-------------|
| `X-Render-Duration` | Total render duration (ms) |
| `X-Render-Count` | Total images rendered |
| `X-Render-Returned` | Images in response (may be limited) |
| `X-Render-Truncated` | `"true"` if response was truncated |
| `X-Generator-Id` | Resolved generator ID |
| `X-Generator-Source` | Resolution method (`provided`, `fetched`, `slug-lookup`, `type-lookup`, `search`) |
| `X-Generator-Fetch-Ms` | Generator fetch time (ms) |
| `X-Colors-Used` | Comma-separated colors |
| `X-Views-Used` | Comma-separated views |
| `X-Regions-Used` | Comma-separated regions |
| `X-Colors-Auto` | `"true"` if colors were auto-selected |
| `X-Views-Auto` | `"true"` if views were auto-selected |
| `X-Regions-Auto` | `"true"` if regions were auto-selected |
| `X-Print-Method` | Production method (DTG, SUBLIMATION, etc.) |
| `X-Product-Resolved` | Product slug (if resolved from slug/type/query) |

**Response limiting:** For batches with 100+ images, only the first 20 are returned in the response JSON to prevent size errors. All images are still rendered — check `X-Render-Count` vs `X-Render-Returned`.

**Error codes:** `400` validation error, `401` auth required, `500` render error, `503` queue full

---

### `POST /api/v1/jobs`

Submits an async batch render job. Returns **202 immediately** with a job ID and poll URL. The server processes the job in the background, saves rendered PNGs to local disk or GCS, and publishes a completion event via local Postgres or GCP Pub/Sub.

Falls back to the in-memory store (`src/jobs/job-store.ts`) when `DATABASE_URL` is not set.

**Auth:** Required (Bearer token)

**Request:**

Each generator covers a set of product sizes. Artwork images are provided as pre-uploaded CDN URLs (not base64).

```json
{
  "generators": [
    {
      "generatorData": { "regions": [...], "views": [...], "colors": [...] },
      "sizes": ["S", "M", "L"]
    }
  ],
  "images": [
    { "region": "front", "url": "https://cdn.example.com/artwork.png" }
  ],
  "type": "preview",
  "colors": ["black", "white"],
  "views": ["view-0"],
  "renderSize": 2048
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `generators` | array | yes | — | One entry per product type; each covers a set of sizes |
| `generators[].generatorData` | object | yes | — | Full Fourthwall generator configuration |
| `generators[].sizes` | string[] | yes | — | Product sizes this generator applies to (e.g. `["S","M","L"]`) |
| `images` | array | yes | — | Artwork layers to apply |
| `images[].region` | string | yes | — | Region ID where artwork is placed |
| `images[].url` | string (URL) | yes | — | CDN URL of pre-uploaded artwork PNG |
| `type` | string | yes | — | `"preview"` or `"offer"` |
| `colors` | string[] | no | auto | Colors to render (auto-selected if omitted) |
| `views` | string[] | no | all | Views to render (all available if omitted) |
| `renderSize` | number | no | `2048` | Output image size in pixels |

**Response (202):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "pollUrl": "/api/v1/jobs/550e8400-e29b-41d4-a716-446655440000"
}
```

**Error codes:** `400` validation, `401` auth required, `503` queue unavailable

---

### `GET /api/v1/jobs/:id`

Polls the status of an async render job. Returns the result when completed.

**Auth:** Required (Bearer token)

**Response (200) — pending or processing:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "createdAt": "2026-02-25T10:00:00.000Z",
  "pollUrl": "/api/v1/jobs/550e8400-e29b-41d4-a716-446655440000"
}
```

**Response (200) — completed:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "createdAt": "2026-02-25T10:00:00.000Z",
  "startedAt": "2026-02-25T10:00:01.200Z",
  "completedAt": "2026-02-25T10:00:15.600Z",
  "durationMs": 14400,
  "result": {
    "images": [
      {
        "url": "https://storage.googleapis.com/my-bucket/renders/550e8400.../0-S-black-front.png",
        "size": "S",
        "region": "front",
        "color": "black",
        "style": "DTG",
        "width": 2048,
        "height": 2048
      }
    ],
    "metadata": {
      "generatorCount": 1,
      "imageCount": 6,
      "durationMs": 14400,
      "completedAt": "2026-02-25T10:00:15.600Z"
    }
  }
}
```

| Status value | Meaning |
|---|---|
| `pending` | Queued in PostgreSQL, not yet picked up |
| `processing` | Worker is actively rendering |
| `completed` | Done — `result.images[]` contains image URLs with size/color/region metadata |
| `failed` | Error — `error` field contains the message |
| `expired` | Not started within `JOB_EXPIRE_SECONDS` (default 30 min) |

**Response (404):** Job not found or purged from archive
**Response (503):** PostgreSQL connection failure

---

### `GET /api/v1/events/stream`

Server-Sent Events stream for job completion events. Requires `DATABASE_URL` to be set. Events are written to `analytics.renderer_pubsub_events` by `LocalPubSubService` (when `LOCAL_OUTPUT_DIR` is set) and polled every 2 seconds.

**Auth:** Not required

**Query parameters:**

| Param | Description |
|-------|-------------|
| `jobId` | Optional — filter to a specific job's completion event |

**Event format (SSE):**

```
data: {"jobId":"550e8400-e29b-41d4-a716-446655440000","images":[{"url":"http://localhost:3000/output/...","size":"S","region":"front","color":"black","style":"DTG","width":2048,"height":2048}]}

: heartbeat
```

Heartbeats are sent every 30 seconds to keep the connection alive. The stream stays open until the client disconnects.

**Response (503):** `DATABASE_URL` not configured

---

### `GET /api/v1/generators/resolve`

Resolves generator data from various sources.

**Auth:** Required (Bearer token)

**Query parameters:**

| Param | Description |
|-------|-------------|
| `productSlug` | Fourthwall product slug |
| `generatorId` | Direct generator UUID |
| `productType` | `"bestsellers"` or `"staff-picked"` |
| `productQuery` | Free-text search |

**Response (200):**

```json
{
  "generatorData": { "id": "gen_abc", "views": [...], "colors": [...], "regions": [...] },
  "generatorId": "gen_abc",
  "source": "slug-lookup",
  "fetchMs": 450,
  "productResolved": "premium-tee"
}
```

---

### `GET /api/v1/fixtures`

Lists available generator fixture names.

**Auth:** Not required

**Response (200):**

```json
["DTG", "SUBLIMATION", "EMBROIDERY", "UV", "ALL_OVER_PRINT", "PRINTED", "KNITTED"]
```

---

### `GET /api/v1/fixtures/:name`

Returns a specific fixture's generator JSON.

**Auth:** Not required

**Response (200):** Full generator data object

**Error codes:** `404` fixture not found

---

### `POST /api/v1/test-runs`

Creates a new test run record in PostgreSQL.

**Auth:** Required (Bearer token)

**Request:**

```json
{
  "server_url": "http://localhost:3000",
  "source_type": "local",
  "name": "Regression Test",
  "description": "Testing all production methods",
  "fixture_names": ["DTG", "SUBLIMATION", "EMBROIDERY"]
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `server_url` | string (URL) | yes | — | Server being tested |
| `source_type` | string | no | `"local"` | `"local"`, `"external"`, `"mac"`, `"docker"` |
| `name` | string | no | auto | Human-readable run name |
| `description` | string | no | — | Run description |
| `fixture_names` | string[] | yes | — | Fixture names to test |

**Response (201):**

```json
{ "id": "uuid", "status": "running" }
```

**Error codes:** `400` validation, `503` database not configured

---

### `POST /api/v1/test-runs/:id/finalize`

Aggregates analytics for a test run and marks it as completed.

**Auth:** Required (Bearer token)

**Response (200):**

```json
{ "id": "uuid", "status": "completed" }
```

---

### `GET /api/v1/analytics/renders`

Returns render analytics records.

**Auth:** Required (Bearer token)

**Query parameters:** `limit` (max 1000, default 500), `server_url`, `source_type`, `print_method`, `test_run_id`, `from` (ISO date), `to` (ISO date)

**Response (200):** Array of render analytics rows (snake_case fields matching `analytics.renderer_render_analytics`)

---

### `GET /api/v1/analytics/errors`

Returns error analytics records.

**Auth:** Required (Bearer token)

**Query parameters:** `limit`, `service`, `error_category`, `from`, `to`

---

### `GET /api/v1/analytics/workers`

Returns worker pool metrics snapshots.

**Auth:** Required (Bearer token)

**Query parameters:** `limit`, `from`, `to`

---

### `GET /api/v1/analytics/cache`

Returns cache analytics snapshots.

**Auth:** Required (Bearer token)

**Query parameters:** `limit`, `cache_type`, `from`, `to`

---

### `GET /api/v1/analytics/api-metrics`

Returns per-request HTTP metrics.

**Auth:** Required (Bearer token)

**Query parameters:** `limit`, `endpoint`, `from`, `to`

---

### `GET /api/v1/analytics/test-runs`

Returns test run records.

**Auth:** Required (Bearer token)

**Query parameters:** `limit`, `status`, `server_url`

---

### `GET /api/v1/health`

Full health check with memory metrics and worker pool status.

**Auth:** Optional

**Response (200):**

```json
{
  "status": "healthy",
  "version": "1.0.0-phase1",
  "renderer": "js",
  "workers": 2,
  "workerStatus": { "idle": 1, "busy": 1 },
  "queueDepth": 3,
  "uptime": 3600,
  "memory": {
    "rssMb": 450,
    "heapUsedMb": 120,
    "heapTotalMb": 200,
    "externalMb": 80,
    "containerUsedMb": 1200,
    "containerLimitMb": 4096,
    "containerUsagePercent": 29
  }
}
```

Returns `503` if the worker pool is not initialized.

---

### `GET /api/v1/health/ready`

Kubernetes readiness probe. Returns `503` if the worker pool is not initialized or under memory pressure (>85% of container memory limit).

**Response (200):** `{ "ready": true }`

**Response (503):** `{ "ready": false, "message": "Memory pressure: 90% of 4096MB limit" }`

---

### `GET /api/v1/health/live`

Kubernetes liveness probe. Always returns `200` if the process is running.

**Response (200):** `{ "alive": true }`

---

### `GET /api-docs`

Interactive Swagger UI served from `swagger.yaml`.

## Async Job Queue (pg-boss)

The renderer supports two job-processing modes that coexist in the same server:

| Mode | Transport | State survives restart | Storage | Pub/Sub |
|------|-----------|------------------------|---------|---------|
| **Sync** (`/render`, `/render/batch`) | HTTP response | n/a | No | No |
| **In-memory async** (`/jobs`, no `DATABASE_URL`) | In-process map | No | No | No |
| **Local async** (`/jobs`, `DATABASE_URL` + `LOCAL_OUTPUT_DIR`) | pg-boss + Postgres | **Yes** | Local disk → `/output/` | Postgres (`renderer_pubsub_events`) → SSE |
| **PostgreSQL async** (`/jobs`, `DATABASE_URL` + GCS vars) | pg-boss + Postgres | **Yes** | GCS bucket | GCP Pub/Sub |

### Job Storage

| Mode | Storage | Persistence |
|------|---------|-------------|
| `DATABASE_URL` set | pg-boss tables in `pgboss_renderer` schema | 7-day archive, 14-day deletion |
| `LOCAL_OUTPUT_DIR` set + `DATABASE_URL` | + `analytics.renderer_pubsub_events` rows | Polled by SSE endpoint every 2s |
| No `DATABASE_URL` | In-memory `Map` | Lost on restart, 15-min TTL |

### How It Works

```
Order system                     Renderer Server                    GCS / Pub/Sub
─────────────                    ───────────────                    ─────────────
POST /api/v1/jobs ────────────►  boss.send('render', payload)
◄──── 202 { id, pollUrl }        PostgreSQL INSERT ──────────────►  (job persisted)

                                 (pg-boss worker polls every 2s)
                                 resolveRenderParams()
                                 workerPool.renderBatch()
                                 uploadToGCS()  ────────────────►  PNG files stored
                                 publishMessage() ──────────────►  { jobId, gcsUrls }
                                 boss.complete(id, output)  ─────►  job.output stored

GET /api/v1/jobs/{id} ────────►  boss.getJobById(id)
◄──── { status: "completed",     PostgreSQL SELECT
         result.gcsUrls: [...] }
```

### pg-boss Configuration

pg-boss manages its own schema (`pgboss_renderer`) and creates all tables on `boss.start()`. No manual migrations required.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string. **Omit to disable** (falls back to in-memory) |
| `JOB_RETRY_LIMIT` | `0` | Retry count on failure (0 = no retries) |
| `JOB_EXPIRE_SECONDS` | `1800` | Mark job expired if not started within this window (30 min) |
| `JOB_ARCHIVE_AFTER_SECONDS` | `604800` | Archive completed jobs after 7 days |

### GCS Upload (Optional)

When `GCS_BUCKET_NAME` is set, each rendered PNG is uploaded after the render completes:

```
Filename: {GCS_KEY_PREFIX}/{jobId}/{idx}-{color}-{view}-{region}.png
URL:      {GCS_PUBLIC_URL}/{GCS_KEY_PREFIX}/{jobId}/...
```

If `GCS_PUBLIC_URL` is not set, URLs use the `gs://` scheme.

| Variable | Default | Description |
|----------|---------|-------------|
| `GCS_BUCKET_NAME` | — | GCS bucket name. Omit to skip GCS upload |
| `GCS_KEY_PREFIX` | `renders` | Prefix for GCS object keys |
| `GCS_PUBLIC_URL` | — | Public base URL (e.g. `https://storage.googleapis.com/my-bucket`) |
| `GCP_PROJECT_ID` | — | GCP project ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Path to service account key JSON |

### Pub/Sub Notifications (Optional)

When `GCP_PROJECT_ID` and `PUBSUB_TOPIC_ID` are set, a message is published on each job completion (only when GCS upload also succeeds):

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "gcsUrls": ["gs://bucket/renders/uuid/0-white-front-default.png", "..."],
  "generatorId": "gen_abc123",
  "colorsUsed": ["white", "black"],
  "viewsUsed": ["front"],
  "regionsUsed": ["default"],
  "printMethod": "DTG",
  "imageCount": 2,
  "durationMs": 14400,
  "completedAt": "2026-02-25T10:00:15.600Z"
}
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PUBSUB_TOPIC_ID` | `renderer-jobs-completed` | Pub/Sub topic to publish completion events |

### Worker Concurrency

pg-boss is configured with `teamSize: 1, teamConcurrency: 1` — it processes **one render job at a time**. This matches the underlying render worker pool which also defaults to 1 worker. Do not set `teamSize > 1` unless you also increase `WORKER_COUNT`.

### Shutdown Order

Shutdown sequence is critical to avoid killing workers mid-render:

1. `pgJobQueue.shutdown()` — pg-boss graceful stop (waits up to 10 s for the active `processJob()` to finish, which in turn calls `workerPool.renderBatch()`)
2. `workerPool.shutdown()` — terminates child processes after pg-boss has drained

### Fallback Mode

If `DATABASE_URL` is not set, the `/api/v1/jobs` endpoints use a lightweight in-memory store (`src/jobs/job-store.ts`). State is lost on server restart. This is sufficient for development and testing without PostgreSQL.

### Verifying the Queue

```bash
# Check queued/active/completed jobs
psql $DATABASE_URL -c "SELECT id, state, createdon, completedon FROM pgboss_renderer.job ORDER BY createdon DESC LIMIT 20;"

# Check job output (GCS URLs + metadata)
psql $DATABASE_URL -c "SELECT id, state, output FROM pgboss_renderer.job WHERE state = 'completed' LIMIT 5;"

# Check archived jobs (after JOB_ARCHIVE_AFTER_SECONDS)
psql $DATABASE_URL -c "SELECT id, state FROM pgboss_renderer.archive ORDER BY archivedon DESC LIMIT 10;"
```

---

## Worker Pool

### Why `child_process.fork()` Instead of `worker_threads`

Native modules (`canvas`, `gl`) cannot be loaded in multiple `worker_threads` within a single process — they bind to per-process singletons (EGL display, V8 native module registration). Each `fork()` child gets its own V8 isolate and native module space, enabling true multi-worker concurrency.

### Memory Budget

Each worker process uses ~300MB RSS. On startup, `WorkerPoolManager` validates the requested `WORKER_COUNT` against available system memory:

```
availableMb = totalMem * 0.85 - 350 (main process overhead)
maxSafe = floor(availableMb / 400)
```

If `WORKER_COUNT` exceeds `maxSafe`, it is clamped down with a warning.

### Job Queue

1. Client submits a render job via `submitJob()`
2. If `pendingCount >= MAX_QUEUE_DEPTH` (500), reject immediately with a 503-able error
3. Job is added to in-memory queue
4. `processNextJob()` finds the first idle worker and assigns the job
5. Execution timeout (`JOB_TIMEOUT_MS`) starts when the worker picks up the job, not when queued
6. Worker sends `result` or `error` back via IPC; job promise resolves/rejects

### Crash Recovery

- Workers auto-respawn on unexpected exit (non-zero exit code)
- `MAX_RESPAWNS` (default: 5) limits respawns within a 60-second window
- Respawn counter resets after 60 seconds of stability
- Workers exceeding the limit are permanently terminated to prevent crash loops

### Worker Recycling (MAX_JOBS_PER_WORKER)

Three.js and headless-gl do not release GPU/native memory back to the OS — the only guaranteed way to reclaim it is to exit the process. Set `MAX_JOBS_PER_WORKER` to automatically recycle a worker after processing N jobs:

| Value | Behavior |
|-------|----------|
| `0` (default) | Disabled — worker runs indefinitely |
| `1` | Cold-start per job — guaranteed zero memory accumulation |
| `5–10` | Good compromise — lower overhead, memory resets every N jobs |

On each recycle the worker receives `SIGTERM` → 5 s grace → `SIGKILL`, and a fresh process is spawned immediately. The `jobsCompleted` counter resets to 0 on the replacement process, and the job queue continues without interruption. The exit handler distinguishes intentional recycling from crashes, so `respawnCount` is not incremented.

Trade-off: each recycle incurs the HeadlessRenderer cold-start cost (~3–5 s). For bulk batch workloads with 200+ slugs, `MAX_JOBS_PER_WORKER=1` is recommended to prevent OOM crashes. The overhead is amortised across the render time per job (~10–30 s).

### Watchdog

A watchdog timer runs every 30 seconds, checking for workers stuck longer than `JOB_TIMEOUT_MS + 15s` grace period. If found, the stuck job is rejected and the worker is `SIGKILL`ed.

### Shutdown Sequence

1. `SIGTERM` sent to all workers
2. 5-second grace period for clean exit
3. `SIGKILL` for workers that don't terminate
4. All pending jobs rejected with "Worker pool shutting down"

## HeadlessRenderer

### Canvas + GL Context Setup

Creates a headless-gl WebGL1 context with specific options:

```typescript
gl(canvasSize, canvasSize, {
  alpha: true,
  depth: true,
  stencil: true,
  antialias: false,
  premultipliedAlpha: false,  // Must match ProductRendererV2
  preserveDrawingBuffer: true,
})
```

### Required Polyfills

The headless environment lacks browser APIs. The following are polyfilled:

| Polyfill | Reason |
|----------|--------|
| `document.createElement('canvas')` | Three.js creates offscreen canvases |
| `document.createElement('img')` | Returns a Canvas that accepts `src` setter (headless-gl accepts Canvas, not Image) |
| `FileReader` | `bulkDrawActiveGenerator` converts blobs to data URLs |
| `navigator` | Three.js texture loader checks `navigator.userAgent` |
| `ProgressEvent` | GLTFLoader creates progress events |
| `self` | Three.js GLTFLoader references `self` (Web Worker global) |
| Canvas `getContext('webgl')` | Returns the headless-gl context |
| Canvas `addEventListener`/`removeEventListener` | Stubs (no-op) |
| Canvas `style`, `clientWidth`, `clientHeight` | Three.js resize logic |
| Canvas `toBlob` | Synchronous readPixels → PNG buffer (captures correct GL framebuffer) |

### Two-Tier LRU Asset Cache

Assets (textures and meshes) are cached in two layers to minimize CDN fetches:

| Cache | Max Entries | Max Size | TTL |
|-------|-------------|----------|-----|
| Texture (memory) | 50 | 500 MB | 30 min |
| Mesh (memory) | 30 | 100 MB | 30 min |

The global `fetch` is overridden to intercept CDN and local-proxy URLs:

1. **Memory cache** (fastest) — LRU in-process buffer
2. **Disk cache** — `assets/cdn/` directory; populates memory cache on hit
3. **Network fetch** — downloads from CDN; populates both memory and disk caches

### Rendering Pipeline

**Single render** (`renderSingle`):
1. `switchGenerator()` → `switchView()` → `switchColor()`
2. Load artwork to canvas, upload as region texture
3. `updateRegionUniforms()` → `update()` → readPixels → PNG buffer

**Batch render** (`renderBatch`):
1. `switchGenerator()`
2. Upload all region textures (with optional artwork centering/scaling)
3. `bulkDrawActiveGenerator()` — iterates colors × views, produces one image per combination
4. Convert blobs to buffers

### Embroidery Multi-Pass Pipeline

```
Pass 0: BUFFER     — Render artwork on 3D mesh → textures.buffer (4096x4096)
Pass 1: EMBROIDERY — embroideryPatternFragmentShader → textures.embroidery
Pass 2: SOBEL      — fxSobelFragmentShader(buffer) → textures.blurred (1024x1024)
Pass 3: BLUR       — fxBlurFragmentShader(blurred) → textures.processed (1024x1024)
Pass 4: BLEND      — embroideryShaderBlend(embroidery + processed + user) → final
```

### headless-gl Constraints and Fixes

| Constraint | Fix |
|------------|-----|
| `HalfFloatType` not supported | `patchComposerRenderTargets()` replaces EffectComposer's HalfFloat RTs with FloatType |
| EffectComposer ping-pong broken in WebGL1 | `forceFloatTextures: true` uses manual `setRenderTarget` pipeline |
| Sobel plane overwrites embroidery stitch pattern | `hideSobelProcessingPlane()` sets the quad `visible = false` |
| Multiple GL contexts → SEGFAULT | Singleton GL context per worker process |
| `dispose()` crash (null `cancelAnimationFrame`) | Wrapped in try/catch |
| `premultipliedAlpha` mismatch → alpha artifacts | Set to `false` in both headless-gl and ProductRendererV2 |

## FourthwallApiService

Singleton service with LRU cache (500 entries, 5-min TTL) for Fourthwall API data.

### `resolveGenerator(params)`

Priority chain for resolving generator data:

1. `generatorData` — use directly (source: `provided`)
2. `productSlug` — fetch product by slug → extract generator ID → fetch generator (source: `slug-lookup`)
3. `productType` — query catalog by type → first product → generator (source: `type-lookup`)
4. `productQuery` — search products → first result → generator (source: `search`)
5. `generatorId` — fetch generator by ID (source: `fetched`)

### `getAutoColors(data)`

Returns 1–2 representative colors (one light, one dark):
- Separates colors by brightness using perceived brightness formula: `(R×299 + G×587 + B×114) / 1000`
- Threshold: brightness > 128 = light
- Prefers "White" among light colors and "Black" among dark colors

### `getDefaultRegion(data)`

Priority: `"default"` > `"front"` > `"back"` > first available region.

### `getAvailableViews(data)`

Returns all view IDs from the generator's views array.

### `validateRegions(data, regions)`

Throws an error if any requested region IDs are not in the generator's region list.

## Generator Configuration

### Static Mode

Set `GENERATOR_CONFIG_PATH` to a JSON file path (e.g., `config/generators.json`). Generators are loaded at startup and passed to all workers. On startup, the server:
- Adds missing view IDs (`view-0`, `view-1`, ...)
- Adds missing `options` object
- Sets default `stitchColor` for EMBROIDERY generators
- Optionally remaps CDN URLs to local proxy if `USE_LOCAL_ASSETS=true`

### Dynamic Mode

Without `GENERATOR_CONFIG_PATH`, the server starts with 0 generators. Generators are provided on-demand via the `generatorData` field in batch render requests. Dynamic generators are cleaned up after each request to prevent state accumulation.

### Fixture Files

Seven production methods are available as fixture files in `fixtures/`:

- `DTG.json` — Direct to Garment
- `SUBLIMATION.json` — Sublimation
- `EMBROIDERY.json` — Embroidery
- `UV.json` — UV Printing
- `ALL_OVER_PRINT.json` — All Over Print
- `PRINTED.json` — Printed
- `KNITTED.json` — Knitted

## Authentication

### Static API Key

Set `API_KEY` in `.env`. Clients send `Authorization: Bearer {API_KEY}`.

### Development Bypass

In development mode (`NODE_ENV=development`) without `API_KEY` configured, authentication is disabled entirely.

### Optional Auth

Health endpoints use optional auth — no token required, but an invalid token is still rejected.

### Auth-Protected Endpoints

| Endpoint | Auth |
|----------|------|
| `POST /api/v1/render` | Required |
| `POST /api/v1/render/batch` | Required |
| `POST /api/v1/jobs` | Required |
| `GET /api/v1/jobs/:id` | Required |
| `GET /api/v1/generators/resolve` | Required |
| `POST /api/v1/test-runs` | Required |
| `GET /api/v1/analytics/*` | Required |
| `GET /api/v1/health[/*]` | Optional |
| `GET /api/v1/fixtures[/*]` | Not required |
| `GET /api/v1/events/stream` | Not required |
| `GET /api-docs` | Not required |

## Configuration

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server listen port |
| `NODE_ENV` | `development` | Environment (`development` disables auth when no API_KEY) |
| `CANVAS_SIZE` | `2048` | Render canvas size in pixels |
| `WORKER_COUNT` | `1` | Number of worker processes (~300MB each); validated against available memory |
| `JOB_TIMEOUT` | `120000` | Job execution timeout in ms (starts when worker picks up the job) |
| `NODE_HEAP_LIMIT_MB` | `512` | V8 `--max-old-space-size` per worker process |
| `MAX_RESPAWNS` | `5` | Worker crash respawn limit in 60s window |
| `MAX_JOBS_PER_WORKER` | `0` | Recycle worker after N jobs to prevent memory accumulation (`0` = disabled; `1` = cold-start per job) |
| `MAX_QUEUE_DEPTH` | `500` | Max pending jobs before returning 503 |
| `GENERATOR_CONFIG_PATH` | — | Path to static `generators.json` (omit for dynamic mode) |
| `USE_LOCAL_ASSETS` | `false` | Remap CDN URLs to local `/assets/cdn/` proxy |
| `API_KEY` | `dev-api-key` | API key for Bearer authentication |
| `LOG_LEVEL` | `info` | Logging level |

### Async Job Queue (pg-boss)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string (omit to use in-memory fallback) |
| `JOB_RETRY_LIMIT` | `0` | Retry count on failure |
| `JOB_EXPIRE_SECONDS` | `1800` | Job expires if not started within this window (30 min) |
| `JOB_ARCHIVE_AFTER_SECONDS` | `604800` | Archive completed jobs after 7 days |

### Local Storage (Development)

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_OUTPUT_DIR` | — | Directory for rendered PNGs (e.g. `./output`). When set: files served at `/output/`, completion events stored in `analytics.renderer_pubsub_events`, SSE stream enabled. Replaces GCS in local dev. |

### GCS Upload (Production)

| Variable | Default | Description |
|----------|---------|-------------|
| `GCS_BUCKET_NAME` | — | GCS bucket for render output (omit to skip upload) |
| `GCS_KEY_PREFIX` | `renders` | GCS object key prefix |
| `GCS_PUBLIC_URL` | — | Public base URL; falls back to `gs://` scheme |
| `GCP_PROJECT_ID` | — | GCP project ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Path to GCP service account key JSON |
| `PUBSUB_TOPIC_ID` | `renderer-jobs-completed` | Pub/Sub topic for completion events |

### Analytics (PostgreSQL / Drizzle)

Analytics are stored in the same PostgreSQL database as pg-boss, in a separate `analytics` schema. Drizzle applies migrations automatically on server startup.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | Shared with pg-boss. Also drives Drizzle analytics. Omit to disable analytics entirely |
| `SERVER_URL` | `http://localhost:{PORT}` | Server URL stored in analytics records |

#### Database Schemas

| Schema | Owner | Description |
|--------|-------|-------------|
| `pgboss_renderer` | pg-boss | Job queue tables (auto-created by pg-boss) |
| `analytics` | Drizzle | 6 analytics tables + `__drizzle_migrations` tracking table |

#### Analytics Tables

| Table | Data |
|-------|------|
| `analytics.renderer_render_analytics` | Per-render metrics: type, generator, duration, asset timing, memory, status |
| `analytics.renderer_error_analytics` | Error events: category, message, stack, endpoint, status code |
| `analytics.renderer_worker_pool_metrics` | Periodic pool snapshots: workers, queue depth, memory, event loop lag |
| `analytics.renderer_api_metrics` | Per-request HTTP metrics: endpoint, method, status, duration, sizes |
| `analytics.renderer_cache_analytics` | Cache snapshots: entries, size, utilization, hit rate, evictions |
| `analytics.renderer_test_runs` | Test run records with aggregated stats |
| `analytics.renderer_pubsub_events` | Job completion events (`JobCompletedEvent` JSONB); written by `LocalPubSubService` when `LOCAL_OUTPUT_DIR` is set; polled by SSE endpoint every 2s |

#### Migrations

```bash
# Migrations run automatically on every server startup
npm run dev    # logs: ✅ Analytics migrations applied

# Generate a new migration after editing src/db/schema.ts
npx drizzle-kit generate

# Inspect applied migrations
psql $DATABASE_URL -c "SELECT * FROM analytics.__drizzle_migrations;"
```

## Docker

### Dockerfile

Two-stage build on `node:20-bookworm`:

1. **Builder stage** — installs native build deps (cairo, pango, GL, etc.), npm install, builds shared package, rebuilds native modules, compiles TypeScript, bundles worker with esbuild
2. **Production stage** — `node:20-bookworm-slim` with runtime-only libraries, copies `node_modules` and compiled output from builder

Key Docker environment variables:

| Variable | Value | Purpose |
|----------|-------|---------|
| `LIBGL_ALWAYS_SOFTWARE` | `1` | Force software rendering (LLVMpipe) |
| `LP_NUM_THREADS` | `0` | Disable LLVMpipe threading (prevents contention) |

The container runs via `xvfb-run` for headless GL support:

```
xvfb-run -a -s '-screen 0 1024x768x24' node --max-old-space-size=2048 tsx src/server.ts
```

### docker.sh

Management script with commands:

```bash
./docker.sh build         # Build Docker image
./docker.sh start         # Start container (detached)
./docker.sh stop          # Stop container
./docker.sh restart       # Restart container
./docker.sh logs          # Follow live logs
./docker.sh logs-tail     # Last 100 lines
./docker.sh shell         # Open shell in container
./docker.sh health        # curl health endpoint
./docker.sh test-render   # Run a test render
./docker.sh cache-status  # Show disk cache stats
./docker.sh cache-clear   # Clear cached assets
./docker.sh clean         # Remove containers + images
```

### docker-compose.yml

Two services: `postgres` (PostgreSQL 16) and `renderer`.

```yaml
# postgres service
postgres:
  image: postgres:16-alpine
  POSTGRES_DB: offer-renderer
  ports: ["5432:5432"]      # exposed locally for debugging
  healthcheck: pg_isready   # renderer depends_on: postgres: service_healthy

# renderer service — resource limits
memory: 4G                  # Container memory limit
cpus: 2.0                   # CPU limit
memswap_limit: 4G           # Disable swap (fail fast)

# Volumes
renderer-postgres            # PostgreSQL data directory
renderer-assets              # Persistent CDN cache
renderer-data                # Analytics data
config/generators.json       # Generator config (read-only)
secrets/gcp-key.json         # GCP service account key (optional)

# Health check
interval: 30s, timeout: 10s, retries: 3, start_period: 60s
```

#### Local dev (postgres + renderer together):

```bash
cd apps/renderer-server
docker compose up
```

#### Postgres only (renderer runs natively):

```bash
docker compose up postgres -d
# Then set DATABASE_URL in .env and npm run dev
```

#### Production:

```bash
# Compose production overlay — no exposed postgres port, required secrets
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d
```

Build context must be the repo root (the Dockerfile copies workspace dependencies):

```bash
docker build -f apps/renderer-server/Dockerfile \
  --build-arg GITLAB_AUTH_TOKEN=... \
  -t renderer-server .
```

## Testing

### Configuration

Vitest with 120-second timeout, custom plugins for `.glsl` (raw string) and `.jpg/.png` (file path) imports.

### Snapshot Regression Tests

Seven production methods are tested against baseline images:

- **DTG**, **SUBLIMATION**, **EMBROIDERY**, **UV**, **ALL_OVER_PRINT**, **PRINTED**, **KNITTED**

```bash
# Run regression tests
cd apps/renderer-server
npx vitest run src/__tests__/snapshot-regression.test.ts

# Update baselines after intentional changes
UPDATE_SNAPSHOTS=1 npx vitest run src/__tests__/snapshot-regression.test.ts
```

| Path | Contents |
|------|----------|
| `fixtures/*.json` | Generator fixtures (real API payloads) |
| `src/__tests__/__snapshots__/regression/*.png` | Baseline images |
| `src/__tests__/__diffs__/snapshot/` | Diff images (generated on failure) |

Diff images are generated with `pixelmatch` for visual inspection. **Never update baselines without inspecting the visual diff first.**

## Analytics

### Error Categories

Errors are auto-categorized for analytics:

| Category | Pattern |
|----------|---------|
| `validation` | Zod, validation, invalid, schema |
| `timeout` | timeout, timed out |
| `worker_crash` | crashed, worker, respawn |
| `queue_full` | queue, server busy |
| `asset_fetch` | fetch, cdn, 404, asset |
| `gl_context` | gl, webgl, context |
| `authentication` | auth, unauthorized, 401, api key |
| `upload_failed` | upload |
| `api_upstream` | upstream, api, 502, 503 |
| `unknown` | everything else |

### Metrics Collection Intervals

- **Memory logging**: every 60 seconds (RSS, heap, external)
- **Worker pool + cache metrics**: every 30 seconds
