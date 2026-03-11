#!/bin/bash
# Native macOS runner for Fourthwall Renderer Server
# Uses Apple Silicon GPU via Metal (no Docker, no software rendering)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🍎 Fourthwall Renderer Server - Native macOS${NC}"
echo ""

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${YELLOW}⚠️  Node.js 18+ required. Current: $(node -v)${NC}"
    exit 1
fi

# Check if node_modules exists, install if not
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    npm install
fi

# Create assets directory if needed
mkdir -p assets/cdn

# Ensure .env exists (copy from .env.example if not)
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}📝 Creating .env from .env.example...${NC}"
    cp .env.example .env
fi

# Export environment variables for native GPU rendering
# IMPORTANT: Do NOT set LIBGL_ALWAYS_SOFTWARE - let it use native GPU
export NODE_ENV="${NODE_ENV:-development}"
export PORT="${PORT:-3000}"
export CANVAS_SIZE="${CANVAS_SIZE:-2048}"
export USE_LOCAL_ASSETS="${USE_LOCAL_ASSETS:-true}"

# Unset software rendering flags (in case they're set in shell)
unset LIBGL_ALWAYS_SOFTWARE
unset LP_NUM_THREADS

echo -e "${GREEN}🚀 Starting server with native GPU support...${NC}"
echo ""
echo -e "   Port:        ${BLUE}$PORT${NC}"
echo -e "   Canvas Size: ${BLUE}$CANVAS_SIZE${NC}"
echo -e "   GPU:         ${GREEN}Apple Silicon (Metal)${NC}"
echo ""

# Run the server
exec npx tsx src/server.ts
