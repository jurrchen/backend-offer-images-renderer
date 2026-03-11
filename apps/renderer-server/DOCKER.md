# 🐳 Docker Deployment Guide

## Quick Start

### 1. Build the Image

```bash
cd packages/renderer-server
docker-compose build
```

### 2. Start the Server

```bash
docker-compose up -d
```

### 3. Check Status

```bash
docker-compose ps
docker-compose logs -f renderer
```

### 4. Test the API

```bash
curl http://localhost:3000/api/v1/health
```

---

## 🎯 How It Works

### **Persistent Asset Caching**

The Docker setup includes persistent volumes that survive container restarts:

```yaml
volumes:
  # ✅ Assets downloaded once, reused forever
  renderer-assets:/app/packages/renderer-server/assets/cdn
  
  # ✅ Analytics data persists
  renderer-data:/app/packages/renderer-server/data
  
  # ✅ Rendered images accessible on host
  ../../bulk-output:/app/bulk-output
```

**How it works:**
1. **First Render**: Fetches assets from `cdn.fourthwall.com` → saves to `/app/packages/renderer-server/assets/cdn/generator/GEN_ID/`
2. **Second Render**: Reads from local cache (0ms network time!)
3. **Container Restart**: Volume persists → cache still there
4. **Deploy Update**: Build new image → mount same volume → **warm cache from the start**

---

## 📊 Asset Caching Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Request: Render gen_ABC with color X, view Y                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Backend: addGenerator(generatorData from API)               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Renderer: Load assets for gen_ABC                           │
│   - Mesh: gen_ABC/mesh.glb                                  │
│   - Main Image: gen_ABC/main.jpeg                           │
│   - Mask: gen_ABC/mask.png                                  │
│   - Optional Mask: gen_ABC/optional-mask.png                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Global Fetch Polyfill (HeadlessRenderer.ts:14-65)          │
│                                                              │
│ 1. Check: Does assets/cdn/generator/gen_ABC/mesh.glb exist?│
│    ├─ YES → Read from disk (0ms network) ✅                 │
│    └─ NO → Fetch from cdn.fourthwall.com                    │
│              └─ Save to assets/cdn/generator/gen_ABC/       │
│                 └─ Next time: 0ms ✅                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Usage

### Start Container

```bash
docker-compose up -d
```

### Stop Container

```bash
docker-compose down
```

### View Logs

```bash
docker-compose logs -f renderer
```

### Restart Container

```bash
docker-compose restart renderer
```

### Rebuild After Code Changes

```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

---

## 🔧 Configuration

### Environment Variables

Edit `docker-compose.yml` or create a `.env` file:

```env
# API Key
RENDER_API_KEY=your-secret-key

# Canvas Resolution (512, 1024, 2048, 4096)
CANVAS_SIZE=2048

# Enable local asset caching
USE_LOCAL_ASSETS=true

# Generator config file
GENERATOR_CONFIG_PATH=config/generators.json

# PostgreSQL connection (pg-boss job queue + Drizzle analytics)
DATABASE_URL=postgresql://renderer:renderer_dev@postgres:5432/offer-renderer

# Local storage: rendered PNGs saved to ./output, served at /output/
# Also enables SSE job completion stream (GET /api/v1/events/stream)
# Mount this directory as a Docker volume to access files on the host
LOCAL_OUTPUT_DIR=./output
```

### Resource Limits

Adjust in `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      cpus: '2.0'      # Max 2 CPU cores
      memory: 4G       # Max 4GB RAM
    reservations:
      cpus: '1.0'      # Min 1 CPU core
      memory: 2G       # Min 2GB RAM
```

---

## 📁 Volume Management

### View Volume Location

```bash
docker volume inspect renderer-server_renderer-assets
```

### Backup Assets

```bash
# Create backup
tar -czf renderer-assets-backup.tar.gz packages/renderer-server/assets/cdn

# Restore backup
tar -xzf renderer-assets-backup.tar.gz
```

### Clear Cache

```bash
# Stop container
docker-compose down

# Remove cached assets
rm -rf packages/renderer-server/assets/cdn/*

# Restart (will re-download)
docker-compose up -d
```

---

## 🧪 Testing

### Health Check

```bash
curl http://localhost:3000/api/v1/health
```

### Test Render (Single)

```bash
curl -X POST http://localhost:3000/api/v1/render \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-api-key" \
  -d '{
    "generatorId": "gen_0ERTerUrS_ey6TKh-ZgUXA",
    "image": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
    "region": "front",
    "color": "Carbon Grey",
    "view": "view-0"
  }' \
  --output test-output.png
```

### Analytics

```bash
curl http://localhost:3000/api/v1/analytics \
  -H "Authorization: Bearer dev-api-key"
```

---

## 🔍 Debugging

### Shell into Container

```bash
docker-compose exec renderer sh
```

### Check Asset Cache

```bash
docker-compose exec renderer ls -lah /app/packages/renderer-server/assets/cdn/generator/
```

### View Logs

```bash
# All logs
docker-compose logs renderer

# Live tail
docker-compose logs -f renderer

# Last 100 lines
docker-compose logs --tail=100 renderer
```

---

## 🐛 Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose logs renderer

# Check health
docker-compose ps
```

### Out of Memory

Increase memory limit in `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      memory: 8G  # Increase to 8GB
```

### Asset Caching Not Working

Check environment variable:

```bash
docker-compose exec renderer printenv USE_LOCAL_ASSETS
# Should output: true
```

Check fetch polyfill logs:

```bash
docker-compose logs renderer | grep "Local cache hit"
docker-compose logs renderer | grep "Asset Cache Miss"
```

---

## 📈 Performance Tips

1. **Pre-cache Popular Generators**: Run bulk renders for common products before going live
2. **Monitor Memory**: Use `docker stats` to watch resource usage
3. **Scale Horizontally**: Run multiple containers behind a load balancer
4. **Persistent Volumes**: Always use volumes for `assets/cdn` and `data`

---

## 🚢 Production Deployment

### 1. Build Production Image

```bash
docker build -t fourthwall-renderer:latest -f packages/renderer-server/Dockerfile .
```

### 2. Tag for Registry

```bash
docker tag fourthwall-renderer:latest your-registry/fourthwall-renderer:v1.0.0
```

### 3. Push to Registry

```bash
docker push your-registry/fourthwall-renderer:v1.0.0
```

### 4. Deploy

```bash
docker pull your-registry/fourthwall-renderer:v1.0.0
docker run -d \
  --name fourthwall-renderer \
  -p 3000:3000 \
  -v $(pwd)/assets/cdn:/app/packages/renderer-server/assets/cdn \
  -v $(pwd)/data:/app/packages/renderer-server/data \
  -v $(pwd)/bulk-output:/app/bulk-output \
  -e RENDER_API_KEY=your-production-key \
  -e USE_LOCAL_ASSETS=true \
  --restart unless-stopped \
  your-registry/fourthwall-renderer:v1.0.0
```

---

## 📚 Additional Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Docker Volumes Guide](https://docs.docker.com/storage/volumes/)
- [Node.js Docker Best Practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md)
