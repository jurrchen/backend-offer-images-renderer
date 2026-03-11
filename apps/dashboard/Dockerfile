# Dockerfile for Fourthwall Dashboard (Next.js)
#
# Build context should be the repo root:
#   docker build -f apps/dashboard/Dockerfile --build-arg GITLAB_AUTH_TOKEN=... -t dashboard .

# ==================== BUILDER STAGE ====================
FROM node:20-bookworm AS builder

# GitLab registry auth for @fourthwall/product-renderer (hoisted install)
ARG GITLAB_AUTH_TOKEN
ENV GITLAB_AUTH_TOKEN=${GITLAB_AUTH_TOKEN}

# NEXT_PUBLIC_ vars are baked at build time
ARG NEXT_PUBLIC_DEFAULT_SERVER_URL=http://localhost:3000
ENV NEXT_PUBLIC_DEFAULT_SERVER_URL=${NEXT_PUBLIC_DEFAULT_SERVER_URL}

WORKDIR /app

# Copy .npmrc for GitLab registry access
COPY .npmrc ./.npmrc

# Set up workspace structure for npm to resolve @fourthwall/shared
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/typescript-config/package.json ./packages/typescript-config/package.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json

RUN sed -i "s|\${GITLAB_AUTH_TOKEN}|${GITLAB_AUTH_TOKEN}|g" .npmrc && npm ci

# Build shared package
COPY packages/shared/src ./packages/shared/src
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY packages/typescript-config/ ./packages/typescript-config/
RUN cd packages/shared && npx tsc

# Replace shared symlink with real directory (same as renderer Dockerfile)
RUN rm -f node_modules/@fourthwall/shared \
    && cp -r packages/shared node_modules/@fourthwall/shared

# Copy dashboard source and build
COPY apps/dashboard ./apps/dashboard
RUN cd apps/dashboard && npm run build

# ==================== PRODUCTION STAGE ====================
FROM node:20-bookworm-slim

WORKDIR /app

# Standalone output includes only required node_modules
COPY --from=builder /app/apps/dashboard/.next/standalone ./
COPY --from=builder /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder /app/apps/dashboard/public ./apps/dashboard/public

ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

EXPOSE 3001

# next start in standalone mode
CMD ["node", "apps/dashboard/server.js"]
