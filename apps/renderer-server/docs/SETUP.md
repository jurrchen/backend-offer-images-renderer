# Renderer Server Setup Guide

## System Dependencies

The renderer-server requires native dependencies for headless rendering. These must be installed before running `yarn install`.

### macOS

```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install required libraries
brew install pkg-config cairo pango libpng jpeg giflib librsvg pixman
brew install glew

# For M1/M2 Macs, you may need to set these env vars:
export PKG_CONFIG_PATH="/opt/homebrew/lib/pkgconfig:$PKG_CONFIG_PATH"
export LDFLAGS="-L/opt/homebrew/lib"
export CPPFLAGS="-I/opt/homebrew/include"
```

### Ubuntu/Debian

```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  libgl1-mesa-dev \
  libxi-dev \
  libglew-dev \
  pkg-config \
  python3
```

### Docker (Recommended for Production)

Use the provided Dockerfile which includes all necessary dependencies:

```bash
docker-compose up --build
```

## Installation

After installing system dependencies:

```bash
# From the project root
yarn install

# Or from renderer-server directory
cd packages/renderer-server
yarn install
```

## Common Issues

### Issue: canvas or gl build fails

**Solution**: Ensure all system dependencies are installed. On macOS M1/M2, set PKG_CONFIG_PATH:

```bash
export PKG_CONFIG_PATH="/opt/homebrew/lib/pkgconfig:$PKG_CONFIG_PATH"
yarn install
```

### Issue: "WebGL not available" error

**Solution**: The gl package provides headless WebGL. Ensure it built successfully. Check build logs:

```bash
yarn install --verbose
```

### Issue: Out of memory during rendering

**Solution**: Reduce CANVAS_SIZE in .env or increase Node.js heap size:

```bash
NODE_OPTIONS="--max-old-space-size=4096" yarn start
```

## Development Setup

1. Install system dependencies (see above)
2. Install Node.js dependencies:
   ```bash
   yarn install
   ```

3. Create .env file:
   ```bash
   cp .env.example .env
   ```

4. Create generator config:
   ```bash
   cp config/generators.example.json config/generators.json
   # Edit config/generators.json with your actual generator data
   ```

5. Run tests:
   ```bash
   yarn tsx src/test-setup.ts
   ```

6. Start development server:
   ```bash
   yarn dev
   ```

## Production Deployment

### Option 1: Docker

```bash
# Build and run with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f renderer-server
```

### Option 2: Kubernetes

See `infrastructure/k8s/` directory for Kubernetes manifests (to be created in Week 5).

## Verification

Test the server is running:

```bash
# Health check
curl http://localhost:3000/api/v1/health

# Should return:
# {
#   "status": "healthy",
#   "version": "1.0.0-phase1",
#   "renderer": "js",
#   ...
# }
```

## Next Steps

After successful installation:

1. Configure generator data in `config/generators.json`
2. Run test script: `yarn tsx src/test-setup.ts`
3. Start server: `yarn dev`
4. Test single render endpoint
5. Test batch render endpoint

## Support

For issues, check:
- Build logs in `/tmp/xfs-*/build.log`
- Server logs (console output)
- System requirements match your OS
