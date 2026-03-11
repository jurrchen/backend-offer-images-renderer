# Fourthwall Offer Images Renderer

Turborepo monorepo for headless product image rendering and customization management.

## Monorepo Structure

```
apps/
  renderer-server/    Headless rendering service (Express + headless-gl + canvas)
  dashboard/          Analytics & orchestration dashboard (Next.js)
packages/
  shared/             Shared types + analytics type definitions
  typescript-config/  Shared tsconfig presets
```

## Quick Start

```bash
npm install           # Install all dependencies
npm run dev           # Dev mode for all apps (Turborepo)
npm run build         # Build all packages in dependency order
npm run test          # Run all tests
npm run lint          # Lint all packages
npm run type-check    # Type-check all packages
```

## Apps

### Renderer Server (`:3000`)

Headless Node.js rendering service that wraps `@fourthwall/product-renderer` (Three.js) using headless-gl. Renders product images server-side with full WebGL pipeline support.

```bash
cd apps/renderer-server
npm run dev           # Build + hot-reload with tsx watch
npm test              # Vitest (all tests)
```

**Endpoints:**
- `POST /api/v1/render` — Single image render (returns PNG)
- `POST /api/v1/render/batch` — Batch render (returns JSON with base64 PNGs)
- `POST /api/v1/jobs` — Async render job (202 + poll URL); accepts `generators[]{generatorData, sizes[]}` + `images[]{region, url}`
- `GET /api/v1/jobs/:id` — Poll async job status; completed jobs include `result.images[]` with URLs + metadata
- `GET /api/v1/events/stream` — SSE stream of job completion events (requires `DATABASE_URL` + `LOCAL_OUTPUT_DIR`)
- `GET /api/v1/generators/resolve` — Resolve generator from product slug/type/query
- `GET /api/v1/fixtures` / `GET /api/v1/fixtures/:name` — Generator fixtures
- `POST /api/v1/test-runs` — Test run lifecycle
- `GET /api/v1/analytics/*` — Analytics data endpoints (renders, errors, workers, cache, API metrics, test runs)
- `POST /api/v1/design` — Artwork centering + XAST V4 state generation
- `GET /api/v1/health` — Health status
- `GET /api-docs` — Swagger UI

### Dashboard (`:3001`)

Next.js analytics dashboard. Reads analytics data from renderer-server REST endpoints. Auth via Firebase (Keycloak OIDC).

```bash
cd apps/dashboard
npm run dev           # Next.js dev server
```

**Pages:**
- `/` — Overview (stats + recent test runs)
- `/analytics` — Charts with date/server/method filters
- `/errors` — Error analytics with category breakdown
- `/infrastructure` — Worker pool + cache metrics
- `/monitor` — Live memory monitor
- `/test-runner` — Run tests against any renderer server
- `/history` — All test runs with filtering
- `/designer` — Artwork design: load generator, upload artwork, get XAST state
- `/jobs` — Submit async render jobs; load generators from fixtures or product slug; real-time image grid via SSE

## Environment Setup

### Renderer Server
Copy `apps/renderer-server/.env.example` to `.env`. Key variables: `PORT` (3000), `CANVAS_SIZE` (2048), `WORKER_COUNT` (1), `DATABASE_URL` (PostgreSQL — serves both pg-boss queue and analytics), `API_KEY`, `LOCAL_OUTPUT_DIR` (set to `./output` for local async jobs + SSE).

### Dashboard
Copy `apps/dashboard/.env.local.example` to `.env.local`. Key variables: `RENDERER_SERVER_URL` (http://localhost:3000), `RENDERER_SERVER_API_KEY`. Firebase auth variables (`NEXT_PUBLIC_FIREBASE_*`) are optional — when absent, the login gate is bypassed automatically.

### Async jobs: local vs GCP

Storage and pub/sub are selected by env vars at startup:

| Scenario | Storage | Pub/Sub | SSE stream (`/api/v1/events/stream`) |
|----------|---------|---------|--------------------------------------|
| **`npm run dev` — no Docker** | `LOCAL_OUTPUT_DIR` → files to `./output/` | **Disabled** — `LocalPubSubService` needs `DATABASE_URL`; warns and skips | Silent; fall back to polling `GET /api/v1/jobs/:id` |
| **`npm run dev` + `docker compose up postgres -d`** | Same local file storage | `LocalPubSubService` → row in `analytics.renderer_pubsub_events` | Works — polled every 2s, emits to connected clients |
| **GCP** (`LOCAL_OUTPUT_DIR` unset) | `GCS_BUCKET_NAME` → GCS bucket | `GCP_PROJECT_ID` → GCP Pub/Sub topic | Unused — consumers subscribe to Pub/Sub topic directly |

`LOCAL_OUTPUT_DIR` is the master switch — it takes priority over `GCS_BUCKET_NAME`/`GCP_PROJECT_ID`. Never leave it set in GCP deployments.

## Architecture

### Worker Pool (Renderer Server)

Uses `child_process.fork()` — each worker runs in a separate OS process with its own V8 isolate and EGL display. `WORKER_COUNT` controls pool size (default: 1, ~300MB RSS per process). Workers auto-respawn on crash.

### Asset Caching (Renderer Server)

HeadlessRenderer overrides global `fetch` to intercept asset requests. Two-tier LRU caching: textures (50 entries, 500MB, 30min TTL) and meshes (30 entries, 100MB, 30min TTL). Asset proxy at `/assets/cdn/*` serves Fourthwall CDN with local disk cache.

### headless-gl Constraints

- `HalfFloatType` not supported — use `FloatType`
- EffectComposer ping-pong doesn't work — use manual `setRenderTarget`
- Canvas polyfill required for Three.js DOM method checks
- Single GL context per process (SEGFAULT on create/destroy/create)
- `premultipliedAlpha: false` must match ProductRendererV2

## Docker

```bash
cd apps/renderer-server && ./docker.sh build|start|stop|logs|restart
```

## License

Private - Fourthwall Internal
