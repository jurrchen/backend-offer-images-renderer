# Renderer Server — Docker Guide

## Prerequisites

- Docker Desktop running
- `GITLAB_AUTH_TOKEN` — GitLab personal access token with `read_api` scope (for `@fourthwall/product-renderer` package)

The token is in your `.env` file as `GITLAB_AUTH_TOKEN`.

## Quick Start

```bash
cd apps/renderer-server

# Build (from the renderer-server directory — compose handles the repo root context)
docker-compose build

# Start
docker-compose up -d

# Check logs (server takes ~40s to load all generators)
docker-compose logs -f renderer

# Health check
curl http://localhost:3000/api/v1/health
```

Or use the helper script:

```bash
./docker.sh build
./docker.sh start
./docker.sh health
```

## Building

The build requires `GITLAB_AUTH_TOKEN` for the GitLab npm registry. Set it in your shell or `.env`:

```bash
# Option 1: Export in shell
export GITLAB_AUTH_TOKEN=glpat-xxxxx
docker-compose build

# Option 2: Inline
GITLAB_AUTH_TOKEN=glpat-xxxxx docker-compose build

# Option 3: Direct docker build from repo root
docker build -f apps/renderer-server/Dockerfile \
  --build-arg GITLAB_AUTH_TOKEN=glpat-xxxxx \
  -t renderer-server .
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `CANVAS_SIZE` | `2048` | Render canvas size (pixels) |
| `WORKER_COUNT` | `1` | Number of render worker processes (~300MB each) |
| `NODE_HEAP_LIMIT_MB` | `2048` | V8 heap limit per worker process |
| `API_KEY` | `dev-api-key` | API authentication key |
| `GENERATOR_CONFIG_PATH` | `config/generators.json` | Path to generator fixtures |
| `USE_LOCAL_ASSETS` | `true` | Cache assets to local disk |
| `LOG_LEVEL` | `info` | Logging level |
| `SUPABASE_URL` | — | Optional: Supabase URL for analytics |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Optional: Supabase key for analytics |

## API Endpoints

```bash
# Health
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/api/v1/health/ready
curl http://localhost:3000/api/v1/health/live

# Single render (returns PNG)
curl -X POST http://localhost:3000/api/v1/render \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-api-key" \
  -d '{
    "generatorId": "gen_0ERTerUrS_ey6TKh-ZgUXA",
    "image": "<base64-png>",
    "region": "front",
    "color": "Carbon Grey",
    "view": "view-0"
  }' --output render.png

# Batch render (returns JSON with base64 images)
curl -X POST http://localhost:3000/api/v1/render/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-api-key" \
  -d '{
    "generatorId": "gen_0ERTerUrS_ey6TKh-ZgUXA",
    "images": [{"data": "<base64-png>", "region": "front"}],
    "colors": ["Carbon Grey", "Black"],
    "views": ["view-0"]
  }'

# List generator fixtures
curl http://localhost:3000/api/v1/fixtures
```

## Management

```bash
# Logs
docker-compose logs -f renderer
./docker.sh logs

# Restart
docker-compose restart
./docker.sh restart

# Stop
docker-compose down
./docker.sh stop

# Shell into container
docker-compose exec renderer sh
./docker.sh shell

# Full cleanup (removes volumes + images)
./docker.sh clean
```

## Memory Tuning

Each worker process uses ~300MB RSS plus memory for loaded generators. With 20 generators:

| Workers | Recommended RAM | `NODE_HEAP_LIMIT_MB` |
|---------|----------------|---------------------|
| 1 | 4 GB | 2048 |
| 2 | 6 GB | 2048 |
| 3-4 | 8 GB | 2048 |

Adjust via environment variables:

```bash
WORKER_COUNT=2 NODE_HEAP_LIMIT_MB=2048 docker-compose up -d
```

## Startup Time

The server loads all generators from `config/generators.json` at startup, downloading meshes and textures from the Fourthwall CDN. First start takes ~40-60s. Subsequent starts are faster thanks to the persistent asset cache volume.
