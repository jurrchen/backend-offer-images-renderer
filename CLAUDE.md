# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Turborepo monorepo with three main components:

- **apps/renderer-server/** — Headless Node.js rendering service (Express + headless-gl + canvas) that wraps `@fourthwall/product-renderer`
- **apps/dashboard/** — Next.js analytics dashboard with Firebase auth, test runner, and designer
- **packages/shared/** — Shared types (analytics, database schema)
- **packages/typescript-config/** — Shared TypeScript configuration presets

The core rendering library `@fourthwall/product-renderer` (Three.js) is an npm package from the Gitlab registry.

## Monorepo Commands (from root)

```bash
npm run build            # Turborepo: build all packages in dependency order
npm run dev              # Turborepo: dev mode for all apps
npm run test             # Turborepo: run all tests
npm run lint             # Turborepo: lint all packages
npm run type-check       # Turborepo: type-check all packages
```

## Renderer Server Commands (from `apps/renderer-server/`)

```bash
npm run build            # TypeScript compile + bundle worker
npm run dev              # Build then hot-reload with tsx watch
npm start                # Run production build (node dist/server.js)
npm test                 # Vitest (all tests)
npm run test:watch       # Vitest watch mode
npm run lint             # ESLint on .ts files
npm run type-check       # tsc --noEmit
```

Worker build step (`build:worker`) bundles `RenderWorker.js` with esbuild — required because `child_process.fork()` needs a plain `.js` file.

Docker: `cd apps/renderer-server && ./docker.sh build|start|stop|logs|restart`

## Dashboard Commands (from `apps/dashboard/`)

```bash
npm run dev              # Next.js dev on port 3001
npm run build            # Next.js production build
npm start                # Serve production build
```

## Environment Setup

### Renderer Server
Copy `apps/renderer-server/.env.example` to `.env`. Key variables: `PORT` (3000), `CANVAS_SIZE` (2048), `WORKER_COUNT` (1), `JOB_TIMEOUT` (120000), `API_KEY`, `DATABASE_URL` (PostgreSQL — pg-boss + Drizzle analytics), `LOCAL_OUTPUT_DIR` (local dev: saves PNGs to disk + enables SSE stream via `renderer_pubsub_events`).

### Dashboard
Copy `apps/dashboard/.env.local.example` to `.env.local`. Needs: `RENDERER_SERVER_URL`, `RENDERER_SERVER_API_KEY`, Firebase vars (`NEXT_PUBLIC_FIREBASE_API_KEY` etc.).

## Architecture

### Request Flow (Renderer Server)
```
POST /api/v1/render → auth middleware → Zod validation → WorkerPoolManager
  → child process (fork) → HeadlessRenderer → ProductRendererV2 → PNG buffer → Response
```

### Key Files

| File | Role |
|------|------|
| `apps/renderer-server/src/server.ts` | Express app entry — middleware, asset proxy, route setup |
| `apps/renderer-server/src/rendering/HeadlessRenderer.ts` | headless-gl integration — canvas polyfill, GL context, asset caching |
| `apps/renderer-server/src/workers/WorkerPoolManager.ts` | Child process pool with job queue, crash recovery, configurable pool size |
| `apps/renderer-server/src/workers/RenderWorker.ts` | Child process entry point (bundled with esbuild) |
| `apps/renderer-server/src/services/FourthwallApiService.ts` | Fourthwall API client — generator resolution, product search, color auto-selection |
| `apps/renderer-server/src/api/routes/render.ts` | Single render endpoint |
| `apps/renderer-server/src/api/routes/batch.ts` | Batch render endpoint — auto-resolves generators, colors, views, regions |
| `apps/renderer-server/src/api/routes/generators.ts` | Generator resolution endpoint |
| `apps/renderer-server/src/api/routes/fixtures.ts` | Serves generator fixtures from `fixtures/*.json` |
| `apps/renderer-server/src/api/routes/jobs.ts` | Async job endpoints (`POST /api/v1/jobs`, `GET /api/v1/jobs/:id`) |
| `apps/renderer-server/src/api/routes/events.ts` | SSE endpoint — polls `renderer_pubsub_events` every 2s |
| `apps/renderer-server/src/queue/PgJobQueue.ts` | pg-boss async queue — PostgreSQL persistence, storage upload, Pub/Sub publish |
| `apps/renderer-server/src/queue/resolveRenderParams.ts` | Shared resolver — generator resolution + auto-population for async workers |
| `apps/renderer-server/src/jobs/job-store.ts` | In-memory job store — fallback when `DATABASE_URL` is not set |
| `apps/renderer-server/src/storage/` | `StorageService` interface + `LocalStorageService` (disk) + `GcsStorageService` (GCS) |
| `apps/renderer-server/src/pubsub/` | `PubSubService` interface + `LocalPubSubService` (Postgres) + `GcpPubSubService` (GCP) |
| `apps/renderer-server/src/api/routes/test-runs.ts` | Test run lifecycle |
| `apps/renderer-server/src/api/routes/health.ts` | Health and readiness probes |
| `apps/renderer-server/src/utils/analytics.ts` | Analytics manager — logs to PostgreSQL via Drizzle (optional, requires DATABASE_URL) |
| `apps/renderer-server/src/db/schema.ts` | Drizzle table definitions for `analytics` schema |
| `apps/renderer-server/src/db/client.ts` | Singleton pg.Pool + `getAnalyticsDb()` + `runMigrations()` |
| `apps/renderer-server/src/db/migrations/` | SQL migration files (applied at startup via `runMigrations()`) |
| `apps/renderer-server/src/api/routes/analytics.ts` | 6 GET endpoints for analytics data |
| `apps/renderer-server/src/api/routes/design.ts` | Artwork centering + XAST state generation endpoint |
| `apps/dashboard/src/app/page.tsx` | Dashboard overview — stat cards, recent runs |
| `apps/dashboard/src/app/test-runner/page.tsx` | Active test execution against any renderer instance |
| `apps/dashboard/src/app/analytics/page.tsx` | 7 chart types with filters |
| `apps/dashboard/src/app/designer/page.tsx` | Artwork design & XAST state generation |
| `apps/dashboard/src/app/design-sim/page.tsx` | Design simulation — product picker → generator → multi-size XAST state → live editor preview |
| `apps/dashboard/src/components/design-sim/EditorPreview.tsx` | ProductEditor wrapper (controllers.output, SSR-disabled) |
| `packages/shared/src/types/analytics.ts` | Shared analytics + test run types |
| `packages/shared/migrations/001_analytics_schema.sql` | Database schema |

### API Endpoints (Renderer Server)
- `POST /api/v1/render` — Single image render (returns PNG)
- `POST /api/v1/render/batch` — Batch render (returns JSON with base64 PNGs); accepts `generatorId`, `generatorData`, `productSlug`, `productType`, or `productQuery`; auto-populates colors/views/regions if omitted
- `POST /api/v1/jobs` — Async render job; accepts `generators[]{generatorData, sizes[]}` + `images[]{region, url}` + `type: preview|offer`; returns 202 `{id, status, pollUrl}`
- `GET /api/v1/jobs/:id` — Poll job status; completed jobs include `result.images[]` with URLs + size/color/region metadata
- `GET /api/v1/events/stream` — SSE stream of job completion events; query param `jobId` to filter; requires `DATABASE_URL`
- `POST /api/v1/design` — Artwork centering + XAST V4 state generation (moved from renderer-api)
- `GET /api/v1/generators/resolve` — Resolve generator from product slug/type/query
- `GET /api/v1/fixtures` — List available generator fixtures
- `GET /api/v1/fixtures/:name` — Get specific fixture JSON
- `POST /api/v1/test-runs` — Test run lifecycle management
- `GET /api/v1/analytics/renders` — Render analytics (filter: limit, server_url, source_type, print_method, test_run_id, from, to)
- `GET /api/v1/analytics/errors` — Error analytics (filter: limit, service, error_category, from, to)
- `GET /api/v1/analytics/api-metrics` — API metrics (filter: limit, endpoint, from, to)
- `GET /api/v1/analytics/workers` — Worker pool metrics (filter: limit, from, to)
- `GET /api/v1/analytics/cache` — Cache analytics (filter: limit, cache_type, from, to)
- `GET /api/v1/analytics/test-runs` — Test runs (filter: limit, status, server_url)
- `GET /api/v1/health` — Full health status
- `GET /api/v1/health/ready` and `/live` — Kubernetes probes
- `GET /api-docs` — Swagger UI (spec in `swagger.yaml`)

### Dashboard Pages
- `/` — Overview (stats + recent test runs)
- `/analytics` — Charts with date/server/method filters
- `/errors` — Error analytics
- `/infrastructure` — Worker pool + cache metrics
- `/monitor` — Live memory monitor
- `/test-runner` — Run tests against any renderer server
- `/history` — All test runs with filtering
- `/designer` — Artwork design: load generator, upload artwork, pick region, get XAST V4 state
- `/design-sim` — Design simulation: product picker → generator resolve → multi-size CustomizationState v4 → live ProductEditor preview per size
- `/jobs` — Submit async render jobs; real-time image grid via SSE event stream

### Dashboard API Routes (Next.js)
- `POST /api/designer` — Proxy to renderer-server `POST /api/v1/design` (uses `RENDERER_SERVER_API_KEY`)
- `POST /api/custom-batch` — Proxy to renderer batch endpoint
- `GET /api/fixtures` — Proxy to renderer fixtures endpoint
- `GET /api/analytics` — Proxy to renderer-server `GET /api/v1/analytics/renders`
- `GET|POST /api/test-run` — Test run management
- `POST /api/jobs` — Proxy to renderer-server `POST /api/v1/jobs`
- `GET /api/events/stream` — Pipe SSE stream from renderer-server `GET /api/v1/events/stream`

### FourthwallApiService

Singleton service (`apps/renderer-server/src/services/FourthwallApiService.ts`) with LRU cache (500 entries, 5-min TTL):
- `resolveGenerator(params)` — Priority chain: `generatorData` → `productSlug` → `productType` → `productQuery` → `generatorId`
- `getAutoColors(data)` — Returns one light + one dark color (brightness formula)
- `getDefaultRegion(data)` — Priority: "default" > "front" > "back" > first
- `getAvailableViews(data)` — All view IDs from generator
- `validateRegions(data, regions)` — Throws if requested regions are not in the generator

### Analytics Storage
Analytics are stored in PostgreSQL (AlloyDB in production) under schema `analytics`, managed by Drizzle ORM. Tables: `renderer_render_analytics`, `renderer_error_analytics`, `renderer_worker_pool_metrics`, `renderer_api_metrics`, `renderer_cache_analytics`, `renderer_test_runs`, `renderer_pubsub_events`. Migrations run automatically at renderer-server startup via `runMigrations()`. If `DATABASE_URL` is not set, analytics logging is silently skipped.

`renderer_pubsub_events` — stores `JobCompletedEvent` JSON when `LOCAL_OUTPUT_DIR` is set; polled by SSE endpoint every 2s. One row per completed job.

pg-boss job queue uses the same `DATABASE_URL` but schema `pgboss_renderer` (auto-created by pg-boss).

### Worker Pool
Uses `child_process.fork()` — each worker runs in a separate OS process with its own V8 isolate and EGL display. This allows true multi-worker concurrency (native modules `canvas` and `gl` work in separate processes but not in `worker_threads`).

- `WORKER_COUNT` env var controls pool size (default: 1). ~300MB RSS per process.
- `JOB_TIMEOUT_MS` — execution timeout per job (default: 120s), starts when worker picks up the job
- `MAX_QUEUE_DEPTH` — returns 503 if exceeded (default: 500)
- Workers auto-respawn on crash. Shutdown: `SIGTERM` → 5s timeout → `SIGKILL`.

### Asset Caching
HeadlessRenderer overrides global `fetch` to intercept asset requests. Two-tier caching:
- **Texture cache**: LRU, 50 entries, 500MB max, 30 min TTL
- **Mesh cache**: LRU, 30 entries, 100MB max, 30 min TTL
- **Asset proxy**: `/assets/cdn/*` routes proxy Fourthwall CDN with local disk cache

### Generator Configuration
Generators describe products (meshes, views, colors, regions, print methods). Loaded from `config/generators.json` (static mode) or on-demand via API request payload (dynamic mode). The batch endpoint also supports resolving generators from `productSlug`, `productType`, or `productQuery` via FourthwallApiService.

## Conventions

- **Module system**: ESM (`"type": "module"`, NodeNext resolution) — explicit `.js` imports required
- **TypeScript**: not strict (`strict: false`)
- **Three.js**: version 0.158.0
- **Node**: ES2022 target, >= 18
- **Test runner**: Vitest with pixelmatch for visual regression
- **Validation**: Zod schemas for all API requests
- **Monorepo**: Turborepo with npm workspaces

## Embroidery Multi-Pass Pipeline

```
Pass 0: BUFFER — Render artwork on 3D mesh → textures.buffer (4096x4096)
Pass 1: EMBROIDERY PATTERN — embroideryPatternFragmentShader → textures.embroidery
Pass 2: SOBEL — fxSobelFragmentShader(buffer.texture) → textures.blurred (1024x1024)
Pass 3: BLUR — fxBlurFragmentShader(blurred.texture) → textures.processed (1024x1024)
Pass 4: BLEND — embroideryShaderBlend(embroidery + processed + user) → final output
```

### Two Pipeline Modes (ProductRendererV2.ts)

Controlled by `forceFloatTextures`:
- **`true`** (headless) — Manual `setRenderTarget` pipeline: sceneRT (UnsignedByteType) → sobelRT (FloatType) → blurRT (FloatType). Achieves 0% pixel diff with browser output.
- **`false`** (browser) — EffectComposer with HalfFloatType ping-pong buffers.

## Regression Validation

When asked to **"run regression validation"** or **"check regression"**, execute this workflow:

1. Run snapshot tests: `cd apps/renderer-server && npx vitest run src/__tests__/snapshot-regression.test.ts`
2. If any test fails:
   - Read the diff images in `apps/renderer-server/src/__tests__/__diffs__/snapshot/` to visually inspect
   - Report which production methods pass/fail and the diff percentages
3. If all tests pass: report "All N production methods pass regression"

To update baselines after an intentional change:
`cd apps/renderer-server && UPDATE_SNAPSHOTS=1 npx vitest run src/__tests__/snapshot-regression.test.ts`

**NEVER update baselines without inspecting the visual diff first.**

## Regression Testing Protocol

**MANDATORY**: Before and after ANY code change that touches rendering, run regression validation (see above).

- Generator fixtures: `apps/renderer-server/fixtures/*.json` (real API payloads)
- Baselines: `apps/renderer-server/src/__tests__/__snapshots__/regression/*.png`
- Diffs output: `apps/renderer-server/src/__tests__/__diffs__/snapshot/`
- Production methods tested: DTG, SUBLIMATION, EMBROIDERY, UV, ALL_OVER_PRINT, PRINTED, KNITTED

## Critical headless-gl Constraints

1. **HalfFloatType NOT supported** — use FloatType (`OES_texture_float`)
2. **EffectComposer ping-pong doesn't work** in headless-gl WebGL1 — use manual `setRenderTarget`
3. **Canvas polyfill required** — Three.js checks for DOM methods: `getContext`, `addEventListener`, `removeEventListener`, `style`, `clientWidth/Height`, `toBlob`
4. **SEGFAULT on multiple GL contexts** — cannot create→destroy→create in one process, use singleton
5. **`dispose()` crash** — `cancelAnimationFrame` is null in headless, wrap in try/catch
6. **`premultipliedAlpha: false`** must match ProductRendererV2's setting
