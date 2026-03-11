#!/bin/bash

# Renderer Server Transfer Script
# This script creates a portable zip of the renderer-server with all dependencies
# Usage: ./zip-for-transfer.sh [output-name]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory (repo root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_NAME="${1:-renderer-server-portable}"
TEMP_DIR="/tmp/renderer-server-package-$$"
OUTPUT_ZIP="$SCRIPT_DIR/$OUTPUT_NAME.zip"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Fourthwall Renderer Server Packager${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Clean up any existing temp directory
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR/renderer-server"

echo -e "${YELLOW}Step 1: Copying renderer-server source...${NC}"

# Copy renderer-server (excluding node_modules, dist, large files)
rsync -av --progress "$SCRIPT_DIR/" "$TEMP_DIR/renderer-server/" \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '*.png' \
    --exclude '*.jpg' \
    --exclude '*.jpeg' \
    --exclude 'server.log' \
    --exclude '.env' \
    --exclude 'assets/cdn/' \
    --exclude '.DS_Store' \
    --exclude '*.md' \
    --exclude '*.zip' \
    2>/dev/null || true

echo -e "${GREEN}  Done!${NC}"

echo -e "${YELLOW}Step 2: Bundling product-renderer library...${NC}"

# Copy product-renderer from node_modules (installed via npm from GitLab registry)
# In monorepo, npm hoists to root node_modules; fall back to local
PRODUCT_RENDERER_SRC="$SCRIPT_DIR/../../node_modules/@fourthwall/product-renderer"
if [ ! -d "$PRODUCT_RENDERER_SRC/dist" ]; then
    PRODUCT_RENDERER_SRC="$SCRIPT_DIR/node_modules/@fourthwall/product-renderer"
fi
if [ -d "$PRODUCT_RENDERER_SRC/dist" ]; then
    mkdir -p "$TEMP_DIR/product-renderer"
    cp -r "$PRODUCT_RENDERER_SRC"/* "$TEMP_DIR/product-renderer/"
    echo -e "${GREEN}  Copied product-renderer from node_modules ($(ls "$PRODUCT_RENDERER_SRC/dist"/*.js | wc -l | tr -d ' ') JS files)${NC}"
else
    echo -e "${RED}  ERROR: product-renderer not found in node_modules!${NC}"
    echo -e "${RED}  Run 'npm install' first to fetch @fourthwall/product-renderer from the registry.${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 2b: Bundling shared package...${NC}"

SHARED_SRC="$SCRIPT_DIR/../../packages/shared"
if [ ! -d "$SHARED_SRC/dist" ]; then
    echo -e "${YELLOW}  Building @fourthwall/shared first...${NC}"
    (cd "$SHARED_SRC" && npm run build)
fi

if [ -d "$SHARED_SRC/dist" ]; then
    mkdir -p "$TEMP_DIR/shared"
    cp -r "$SHARED_SRC"/dist "$TEMP_DIR/shared/"
    cp "$SHARED_SRC"/package.json "$TEMP_DIR/shared/"
    echo -e "${GREEN}  Copied @fourthwall/shared ($(ls "$SHARED_SRC/dist"/*.js 2>/dev/null | wc -l | tr -d ' ') JS files)${NC}"
else
    echo -e "${RED}  ERROR: @fourthwall/shared dist not found!${NC}"
    echo -e "${RED}  Run 'npm run build' in packages/shared/ first.${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 3: Setting up product-renderer as local package...${NC}"

# Instead of rewriting imports, we remove the private npm dependency and
# symlink the bundled product-renderer into node_modules so the original
# '@fourthwall/product-renderer' imports resolve via the local copy.

# Remove @fourthwall/product-renderer npm dep (it points to private GitLab registry)
RENDERER_PKG="$TEMP_DIR/renderer-server/package.json"
if [ -f "$RENDERER_PKG" ] && command -v node &>/dev/null; then
    node -e "
      const pkg = JSON.parse(require('fs').readFileSync('$RENDERER_PKG','utf8'));
      delete pkg.dependencies['@fourthwall/product-renderer'];
      delete pkg.dependencies['@fourthwall/shared'];
      if (pkg.devDependencies) delete pkg.devDependencies['@fourthwall/typescript-config'];
      require('fs').writeFileSync('$RENDERER_PKG', JSON.stringify(pkg, null, 2) + '\n');
    "
    echo -e "${GREEN}  Removed @fourthwall/product-renderer, @fourthwall/shared, @fourthwall/typescript-config from package.json${NC}"
fi

# Remove .npmrc files that reference private registries
rm -f "$TEMP_DIR/renderer-server/.npmrc"
rm -f "$TEMP_DIR/.npmrc"

echo -e "${YELLOW}Step 4: Creating standalone package.json (no workspaces)...${NC}"

# Create root package.json with shared dependencies (product-renderer needs lodash-es and three)
cat > "$TEMP_DIR/package.json" << 'ROOTPKG_EOF'
{
  "name": "renderer-server-standalone",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "cd renderer-server && npm run dev",
    "start": "cd renderer-server && npm run start",
    "build": "cd renderer-server && npm run build"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "lodash-es": "4.17.21",
    "three": "0.158.0"
  }
}
ROOTPKG_EOF

# Write a self-contained tsconfig that doesn't depend on @fourthwall/typescript-config
cat > "$TEMP_DIR/renderer-server/tsconfig.json" << 'TSCONFIG_EOF'
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "moduleResolution": "NodeNext",
    "module": "NodeNext",
    "resolveJsonModule": true,
    "allowJs": false,
    "checkJs": false,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": false,
    "noImplicitAny": false,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noImplicitReturns": false,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"],
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "src/__tests__/__legacy__"]
}
TSCONFIG_EOF

echo -e "${GREEN}  Done!${NC}"

echo -e "${YELLOW}Step 5: Creating setup.sh (one-click setup & run)...${NC}"

# Create the magic setup.sh script
cat > "$TEMP_DIR/setup.sh" << 'SETUP_EOF'
#!/bin/bash

# Fourthwall Renderer Server - One-Click Setup & Run
# Just run: ./setup.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     ${BLUE}Fourthwall Renderer Server - Auto Setup${CYAN}              ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check Node.js
echo -e "${YELLOW}[1/5]${NC} Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}ERROR: Node.js is not installed!${NC}"
    echo "Please install Node.js 18+ from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}ERROR: Node.js 18+ required (found v$NODE_VERSION)${NC}"
    exit 1
fi
echo -e "${GREEN}  ✓ Node.js $(node -v) detected${NC}"

# Always use npm for standalone setup (simpler, no workspace issues)
echo -e "${YELLOW}[2/5]${NC} Using npm for installation..."
echo -e "${GREEN}  ✓ Using npm${NC}"

# Install dependencies at root level (for product-renderer shared deps like lodash-es)
echo -e "${YELLOW}[3/6]${NC} Installing shared dependencies..."
npm install
echo -e "${GREEN}  ✓ Shared dependencies installed${NC}"

# Install dependencies in renderer-server folder
echo -e "${YELLOW}[4/6]${NC} Installing renderer-server dependencies (this may take a while)..."
cd renderer-server
npm install
cd ..
echo -e "${GREEN}  ✓ Renderer dependencies installed${NC}"

# Copy bundled product-renderer into node_modules so @fourthwall/product-renderer imports resolve
echo -e "${YELLOW}[4b/6]${NC} Installing local product-renderer..."
mkdir -p renderer-server/node_modules/@fourthwall/product-renderer
cp -r product-renderer/* renderer-server/node_modules/@fourthwall/product-renderer/
echo -e "${GREEN}  ✓ Copied @fourthwall/product-renderer into node_modules${NC}"

# Verify product-renderer
if [ ! -f "renderer-server/node_modules/@fourthwall/product-renderer/dist/index.d.ts" ]; then
    echo -e "${RED}  ERROR: product-renderer/dist/index.d.ts not found!${NC}"
    echo -e "${RED}  Contents of product-renderer/:${NC}"
    ls -la product-renderer/ 2>/dev/null || echo "    (directory missing)"
    ls -la product-renderer/dist/ 2>/dev/null || echo "    (dist/ missing)"
    exit 1
fi

# Copy bundled shared package into node_modules so @fourthwall/shared imports resolve
echo -e "${YELLOW}[4c/6]${NC} Installing local shared package..."
mkdir -p renderer-server/node_modules/@fourthwall/shared
cp -r shared/* renderer-server/node_modules/@fourthwall/shared/
echo -e "${GREEN}  ✓ Copied @fourthwall/shared into node_modules${NC}"

# Verify shared
if [ ! -f "renderer-server/node_modules/@fourthwall/shared/dist/index.js" ]; then
    echo -e "${RED}  ERROR: shared/dist/index.js not found!${NC}"
    ls -la shared/ 2>/dev/null || echo "    (directory missing)"
    ls -la shared/dist/ 2>/dev/null || echo "    (dist/ missing)"
    exit 1
fi

# Setup environment
echo -e "${YELLOW}[5/6]${NC} Setting up environment..."
if [ ! -f "renderer-server/.env" ]; then
    cat > "renderer-server/.env" << 'ENVFILE'
# Auto-generated environment configuration
PORT=3000
NODE_ENV=development
CANVAS_SIZE=2048
API_KEY=dev-api-key
USE_LOCAL_ASSETS=true

# Supabase Analytics (optional - uncomment and fill to enable)
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ENVFILE
    echo -e "${GREEN}  ✓ Created renderer-server/.env with default config${NC}"
else
    echo -e "${GREEN}  ✓ Using existing renderer-server/.env${NC}"
fi

# Create assets directory
mkdir -p renderer-server/assets/cdn
echo -e "${GREEN}  ✓ Created assets directories${NC}"

# Start the server
echo -e "${YELLOW}[6/6]${NC} Starting renderer server..."
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${GREEN}Server starting on port 3000...${NC}"
echo ""
echo -e "  ${BLUE}API Docs:${NC}     http://localhost:3000/api-docs"
echo -e "  ${BLUE}Health:${NC}       http://localhost:3000/api/v1/health"
echo -e "  ${BLUE}API Key:${NC}      dev-api-key"
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${YELLOW}Press Ctrl+C to stop the server${NC}"
echo ""

cd renderer-server
npm run dev
SETUP_EOF

chmod +x "$TEMP_DIR/setup.sh"

# Also create start.sh as an alias (some users expect this name)
cp "$TEMP_DIR/setup.sh" "$TEMP_DIR/start.sh"
chmod +x "$TEMP_DIR/start.sh"

echo -e "${GREEN}  Done!${NC}"

echo -e "${YELLOW}Step 6: Creating stop.sh helper...${NC}"

# Create stop script
cat > "$TEMP_DIR/stop.sh" << 'STOP_EOF'
#!/bin/bash
# Stop any running renderer server
pkill -f "tsx watch src/server.ts" 2>/dev/null || true
pkill -f "node dist/server.js" 2>/dev/null || true
echo "Renderer server stopped."
STOP_EOF

chmod +x "$TEMP_DIR/stop.sh"

echo -e "${GREEN}  Done!${NC}"

echo -e "${YELLOW}Step 7: Creating .env template...${NC}"

# Create .env.example in renderer-server
cat > "$TEMP_DIR/renderer-server/.env.example" << 'ENV_EOF'
# Server Configuration
PORT=3000
NODE_ENV=development

# Rendering Configuration
CANVAS_SIZE=2048

# API Authentication (change in production!)
API_KEY=dev-api-key

# Asset Configuration
USE_LOCAL_ASSETS=true
CDN_BASE_URL=https://cdn.fourthwall.com

# Generator Configuration (optional - path to JSON config file)
# GENERATOR_CONFIG_PATH=./config/generators.json

# Supabase Analytics (optional - if not set, analytics are silently skipped)
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ENV_EOF

echo -e "${GREEN}  Done!${NC}"

echo -e "${YELLOW}Step 8: Creating zip archive...${NC}"

# Remove old zip if exists
rm -f "$OUTPUT_ZIP"

# Create zip
cd "$TEMP_DIR"
zip -r "$OUTPUT_ZIP" . -x "*.DS_Store" -x "__MACOSX/*"

echo -e "${GREEN}  Done!${NC}"

echo -e "${YELLOW}Step 9: Verifying zip contents...${NC}"

VERIFY_DIR="/tmp/renderer-server-verify-$$"
rm -rf "$VERIFY_DIR"
mkdir -p "$VERIFY_DIR"
unzip -q "$OUTPUT_ZIP" -d "$VERIFY_DIR"

VERIFY_FAILED=0

# Check shared/dist/index.js exists
if [ ! -f "$VERIFY_DIR/shared/dist/index.js" ]; then
    echo -e "${RED}  FAIL: shared/dist/index.js missing${NC}"
    VERIFY_FAILED=1
else
    echo -e "${GREEN}  ✓ shared/dist/index.js exists${NC}"
fi

# Check product-renderer/dist/ exists
if [ ! -d "$VERIFY_DIR/product-renderer/dist" ]; then
    echo -e "${RED}  FAIL: product-renderer/dist/ missing${NC}"
    VERIFY_FAILED=1
else
    echo -e "${GREEN}  ✓ product-renderer/dist/ exists${NC}"
fi

# Check renderer-server/package.json does NOT contain @fourthwall/shared or @fourthwall/product-renderer
if grep -q '"@fourthwall/shared"' "$VERIFY_DIR/renderer-server/package.json"; then
    echo -e "${RED}  FAIL: renderer-server/package.json still contains @fourthwall/shared${NC}"
    VERIFY_FAILED=1
else
    echo -e "${GREEN}  ✓ @fourthwall/shared removed from renderer-server/package.json${NC}"
fi

if grep -q '"@fourthwall/product-renderer"' "$VERIFY_DIR/renderer-server/package.json"; then
    echo -e "${RED}  FAIL: renderer-server/package.json still contains @fourthwall/product-renderer${NC}"
    VERIFY_FAILED=1
else
    echo -e "${GREEN}  ✓ @fourthwall/product-renderer removed from renderer-server/package.json${NC}"
fi

# Check renderer-server/tsconfig.json does NOT reference @fourthwall/typescript-config
if grep -q '@fourthwall/typescript-config' "$VERIFY_DIR/renderer-server/tsconfig.json"; then
    echo -e "${RED}  FAIL: renderer-server/tsconfig.json still references @fourthwall/typescript-config${NC}"
    VERIFY_FAILED=1
else
    echo -e "${GREEN}  ✓ tsconfig.json is self-contained (no @fourthwall/typescript-config)${NC}"
fi

# Check root package.json contains @supabase/supabase-js
if ! grep -q '"@supabase/supabase-js"' "$VERIFY_DIR/package.json"; then
    echo -e "${RED}  FAIL: root package.json missing @supabase/supabase-js${NC}"
    VERIFY_FAILED=1
else
    echo -e "${GREEN}  ✓ root package.json contains @supabase/supabase-js${NC}"
fi

# Check .env.example contains SUPABASE_URL
if ! grep -q 'SUPABASE_URL' "$VERIFY_DIR/renderer-server/.env.example"; then
    echo -e "${RED}  FAIL: .env.example missing SUPABASE_URL${NC}"
    VERIFY_FAILED=1
else
    echo -e "${GREEN}  ✓ .env.example contains Supabase variables${NC}"
fi

rm -rf "$VERIFY_DIR"

if [ "$VERIFY_FAILED" -eq 1 ]; then
    echo -e "${RED}  Verification FAILED — zip may be incomplete!${NC}"
    rm -f "$OUTPUT_ZIP"
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo -e "${GREEN}  All checks passed!${NC}"

# Clean up
rm -rf "$TEMP_DIR"

# Get zip size
ZIP_SIZE=$(du -h "$OUTPUT_ZIP" | cut -f1)

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Package created successfully!                 ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Output: ${BLUE}$OUTPUT_ZIP${NC}"
echo -e "  Size:   ${BLUE}$ZIP_SIZE${NC}"
echo ""
echo -e "${YELLOW}On target machine, just run:${NC}"
echo ""
echo -e "  ${CYAN}unzip $OUTPUT_NAME.zip -d renderer${NC}"
echo -e "  ${CYAN}cd renderer${NC}"
echo -e "  ${CYAN}./setup.sh${NC}"
echo ""
echo -e "  That's it! Server will auto-install and start."
echo -e "  Swagger docs at: ${BLUE}http://localhost:3000/api-docs${NC}"
echo ""
