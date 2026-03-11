# Dockerfile for Fourthwall Renderer Server
# Uses tsx for TypeScript execution (handles ESM/CJS properly)
#
# Build context should be the repo root:
#   docker build -f apps/renderer-server/Dockerfile --build-arg GITLAB_AUTH_TOKEN=... -t renderer-server .

# ==================== BUILDER STAGE ====================
FROM node:20-bookworm AS builder

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y \
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
    python3 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/python3 /usr/bin/python

# GitLab registry auth for @fourthwall/product-renderer
ARG GITLAB_AUTH_TOKEN
ENV GITLAB_AUTH_TOKEN=${GITLAB_AUTH_TOKEN}

WORKDIR /app

# Copy .npmrc for GitLab registry access
COPY .npmrc ./.npmrc

# Set up workspace structure for npm to resolve @fourthwall/shared
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/typescript-config/package.json ./packages/typescript-config/package.json
COPY apps/renderer-server/package.json ./apps/renderer-server/package.json

# Install all workspace dependencies (need devDeps for building shared)
RUN sed -i "s|\${GITLAB_AUTH_TOKEN}|${GITLAB_AUTH_TOKEN}|g" .npmrc && npm install

# Copy shared package source and build it
COPY packages/shared/src ./packages/shared/src
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY packages/typescript-config/ ./packages/typescript-config/
RUN cd packages/shared && npx tsc

# Rebuild native modules for current architecture (hoisted to root node_modules)
RUN npm rebuild gl canvas sharp

# Remove the @fourthwall/shared symlink and replace with real directory
# (Docker COPY preserves symlinks which would break in production stage)
RUN rm -f node_modules/@fourthwall/shared \
    && cp -r packages/shared node_modules/@fourthwall/shared

# Build the worker bundle (child_process.fork needs a plain .js file)
# 1. Copy renderer-server source + build config
COPY apps/renderer-server/src ./apps/renderer-server/src
COPY apps/renderer-server/tsconfig.json ./apps/renderer-server/tsconfig.json
COPY apps/renderer-server/scripts ./apps/renderer-server/scripts
# 2. Compile TypeScript → dist/
RUN cd apps/renderer-server && npx tsc
# 3. Bundle worker with esbuild → dist/workers/RenderWorker.bundle.js
RUN cd apps/renderer-server && node scripts/build-worker.mjs

# ==================== PRODUCTION STAGE ====================
FROM node:20-bookworm-slim

# Install RUNTIME dependencies only (no build tools)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    libgl1 \
    libxi6 \
    libglew2.2 \
    libgl1-mesa-dri \
    libx11-6 \
    libxext6 \
    xvfb \
    xauth \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

WORKDIR /app

# Copy hoisted node_modules from builder (lodash-es, three, shared, product-renderer, etc.)
COPY --from=builder /app/node_modules ./node_modules

# Copy renderer-server local node_modules (packages not hoisted to root, e.g. drizzle-orm)
COPY --from=builder /app/apps/renderer-server/node_modules ./apps/renderer-server/node_modules

# Copy renderer-server source (tsx runs TypeScript directly)
COPY apps/renderer-server/src ./apps/renderer-server/src
COPY apps/renderer-server/config ./apps/renderer-server/config
COPY apps/renderer-server/package.json ./apps/renderer-server/package.json

# Copy the bundled worker from builder (child_process.fork needs plain .js)
COPY --from=builder /app/apps/renderer-server/dist/workers/RenderWorker.bundle.js ./apps/renderer-server/dist/workers/RenderWorker.bundle.js

# Set working directory
WORKDIR /app/apps/renderer-server

# Create directories for runtime data
RUN mkdir -p ./assets/cdn ./data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV USE_LOCAL_ASSETS=true
ENV CANVAS_SIZE=2048
# Concurrent render processes (~300MB each). Recommended: 2-3 for 4GB, 4-6 for 8GB.
ENV WORKER_COUNT=1

# Force software rendering for headless GL
ENV LIBGL_ALWAYS_SOFTWARE=1
ENV LP_NUM_THREADS=0

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:3000/api/v1/health/live', (res) => process.exit(res.statusCode === 200 ? 0 : 1));"

# Start server with xvfb-run for headless GL support
# tsx handles TypeScript execution with proper ESM/CJS support
# tsx is hoisted to root node_modules with workspace install
CMD ["sh", "-c", "xvfb-run -a -s '-screen 0 1024x768x24' node --expose-gc --max-old-space-size=2048 /app/node_modules/.bin/tsx src/server.ts"]
