# Deployment Guide — Mac Mini

Deploy renderer-server + renderer-api to `fourthwall@100.77.56.109` (Tailscale).

**Architecture on the Mac Mini:**
```
Internet → renderer-api:3004 (public) → renderer-server:3000 (internal)
                ↕
           Redis:6379 (job queue)
```

Only **renderer-api (port 3004)** is exposed. renderer-server and Redis are internal.

## Prerequisites

### On your Mac (build machine)

```bash
# Tailscale (to reach the Mac Mini)
brew install tailscale
tailscale login

# Verify connectivity
ssh fourthwall@100.77.56.109 "echo ok"
```

### On the Mac Mini (first time)

**For zip deployment** — needs Node, Redis:
```bash
# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node 20 and Redis
brew install node@20 redis
brew services start redis

# Verify
node -v    # v20.x
redis-cli ping   # PONG
```

**For Docker deployment** — just needs Docker:
```bash
# Install Docker Desktop for Mac (or via brew)
brew install --cask docker
```

---

## Method A: Zip Transfer (non-Docker)

### One-command deploy

```bash
./deploy.sh zip
```

This will:
1. Build the monorepo (`npm run build`)
2. Create portable zips for both services
3. `scp` them to `~/deploy/` on the Mac Mini
4. Unzip on the remote

### Start services on the Mac Mini

```bash
ssh fourthwall@100.77.56.109
```

**Start renderer-server** (must start first):
```bash
cd ~/deploy/renderer-server
# Edit .env if needed (API_KEY, Supabase, etc.)
nano renderer-server/.env

# Run in foreground (for testing):
./setup.sh

# Or background with nohup:
nohup ./setup.sh > server.log 2>&1 &
```

**Start renderer-api**:
```bash
cd ~/deploy/renderer-api
# Edit .env — set FW_BEARER_TOKEN and API_KEY
nano renderer-api/.env

# Run in foreground:
./setup.sh

# Or background:
nohup ./setup.sh > api.log 2>&1 &
```

### Using pm2 (recommended for production)

```bash
npm install -g pm2

# Start both
cd ~/deploy/renderer-server/renderer-server
pm2 start "npm run dev" --name renderer-server

cd ~/deploy/renderer-api/renderer-api
pm2 start "node dist/server.js" --name renderer-api

# Auto-restart on reboot
pm2 save
pm2 startup
```

### Manual zip creation (without deploy.sh)

```bash
# From repo root
npm run build
cd apps/renderer-server && ./zip-for-transfer.sh
cd ../renderer-api && ./zip-for-transfer.sh

# Transfer
scp apps/renderer-server/renderer-server-portable.zip fourthwall@100.77.56.109:~/deploy/
scp apps/renderer-api/renderer-api-portable.zip fourthwall@100.77.56.109:~/deploy/
```

---

## Method B: Docker

### One-command deploy

```bash
./deploy.sh docker
```

This will:
1. Build Docker images using `docker-compose.production.yml`
2. Save images to a tarball
3. `scp` tarball + compose file to the Mac Mini
4. `docker load` + `docker compose up -d` on the remote

### Manual Docker deployment

**Build locally and transfer:**
```bash
# Build
docker compose -f docker-compose.production.yml build

# Save images
docker save $(docker compose -f docker-compose.production.yml config --images) -o fourthwall-images.tar

# Transfer
scp fourthwall-images.tar fourthwall@100.77.56.109:~/deploy/
scp docker-compose.production.yml fourthwall@100.77.56.109:~/deploy/docker-compose.yml
```

**On the Mac Mini:**
```bash
cd ~/deploy
docker load -i fourthwall-images.tar

# Set secrets in environment (or create .env file)
export FW_BEARER_TOKEN="your-token"
export API_KEY="your-api-key"

docker compose up -d
```

**Or build directly on the Mac Mini** (if it has internet + git):
```bash
git clone <repo-url> ~/renderer
cd ~/renderer
docker compose -f docker-compose.production.yml up -d
```

### Docker management

```bash
ssh fourthwall@100.77.56.109

cd ~/deploy
docker compose ps              # Status
docker compose logs -f         # Follow logs
docker compose logs renderer-api   # Single service
docker compose restart         # Restart all
docker compose down            # Stop all
docker compose up -d           # Start all
```

---

## Configuration

### Environment Variables

**renderer-server** (`.env` or Docker env):
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port (internal) |
| `CANVAS_SIZE` | `2048` | Render canvas size |
| `WORKER_COUNT` | `1` | Render worker processes (~300MB each) |
| `JOB_TIMEOUT_MS` | `120000` | Per-job timeout |
| `API_KEY` | `dev-api-key` | API authentication key |

**renderer-api** (`.env` or Docker env):
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3004` | Server port (exposed) |
| `API_KEY` | `dev-api-key` | API authentication key |
| `FW_API_BASE_URL` | `https://api.fourthwall.com` | Fourthwall API |
| `FW_BEARER_TOKEN` | — | **Required** — Fourthwall auth token |
| `RENDERER_SERVER_URL` | `http://localhost:3000` | Internal renderer URL |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |

### Ports

| Service | Port | Exposure |
|---------|------|----------|
| renderer-api | 3004 | **Public** — the only externally accessible port |
| renderer-server | 3000 | Internal only |
| Redis | 6379 | Internal only |

---

## Verification

```bash
# Health check (from your Mac, via Tailscale)
curl http://100.77.56.109:3004/api/v1/health

# API docs
open http://100.77.56.109:3004/api-docs

# Test design endpoint
curl -X POST http://100.77.56.109:3004/api/v1/design \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"productSlug": "test-product", "artworkUrl": "https://example.com/art.png"}'

# Check renderer-server is reachable internally (from Mac Mini)
ssh fourthwall@100.77.56.109 "curl -s http://localhost:3000/api/v1/health"

# Check Redis
ssh fourthwall@100.77.56.109 "redis-cli ping"
```

## Troubleshooting

**Can't reach Mac Mini:**
- Check Tailscale: `tailscale status` — is 100.77.56.109 online?
- Try `ping 100.77.56.109`

**renderer-api starts but jobs fail:**
- Check Redis: `redis-cli ping` should return PONG
- Check RENDERER_SERVER_URL points to running renderer-server

**renderer-server crashes:**
- Check `WORKER_COUNT` — each worker needs ~300MB RAM
- Check logs: `pm2 logs renderer-server` or `docker compose logs renderer-server`

**Docker: renderer-server unhealthy:**
- It needs ~60s to start (headless GL initialization)
- Check: `docker compose logs renderer-server`
