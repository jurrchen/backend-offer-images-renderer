#!/bin/bash

# Deploy to Mac Mini (fourthwall@100.77.56.109 via Tailscale)
#
# Usage:
#   ./deploy.sh zip --v 0       — Zip deploy as deploy-renderer-v0
#   ./deploy.sh zip --v 1       — Zip deploy as deploy-renderer-v1
#   ./deploy.sh docker --v 0    — Docker deploy as deploy-renderer-v0
#
# The --v flag is REQUIRED. Remote directory: ~/deploy-renderer-v<N>/

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

REMOTE_HOST="fourthwall@100.77.56.109"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Parse arguments ──────────────────────────────────────────

MODE=""
VERSION=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        zip|docker)
            MODE="$1"
            shift
            ;;
        --v)
            VERSION="$2"
            shift 2
            ;;
        *)
            echo -e "${RED}Unknown argument: $1${NC}"
            echo "Usage: ./deploy.sh [zip|docker] --v <version>"
            echo "Example: ./deploy.sh zip --v 0"
            exit 1
            ;;
    esac
done

MODE="${MODE:-zip}"

if [ -z "$VERSION" ]; then
    echo -e "${RED}Missing required --v flag${NC}"
    echo "Usage: ./deploy.sh [zip|docker] --v <version>"
    echo "Example: ./deploy.sh zip --v 0"
    exit 1
fi

DEPLOY_NAME="deploy-renderer-v${VERSION}"
REMOTE_DIR="~/${DEPLOY_NAME}"

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Fourthwall Deployment${NC}"
echo -e "${CYAN}  Mode: $MODE | Version: v$VERSION${NC}"
echo -e "${CYAN}  Remote: $REMOTE_HOST:$REMOTE_DIR${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# ─── Verify connectivity ───────────────────────────────────────

echo -e "${YELLOW}[0/N]${NC} Checking SSH connectivity to $REMOTE_HOST..."
if ! ssh -o ConnectTimeout=5 "$REMOTE_HOST" "echo ok" &>/dev/null; then
    echo -e "${RED}Cannot reach $REMOTE_HOST — is Tailscale running?${NC}"
    echo -e "  brew install tailscale && tailscale login"
    exit 1
fi
echo -e "${GREEN}  Connected!${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════
# ZIP DEPLOYMENT
# ═══════════════════════════════════════════════════════════════

deploy_zip() {
    echo -e "${BLUE}=== Zip Deployment → $DEPLOY_NAME ===${NC}"
    echo ""

    # Step 1: Build everything
    echo -e "${YELLOW}[1/5]${NC} Building monorepo (Turborepo)..."
    cd "$SCRIPT_DIR"
    npm run build
    echo -e "${GREEN}  Build complete${NC}"
    echo ""

    # Step 2: Create zip packages
    echo -e "${YELLOW}[2/5]${NC} Creating zip packages..."
    bash apps/renderer-server/zip-for-transfer.sh renderer-server-portable
    bash apps/renderer-api/zip-for-transfer.sh renderer-api-portable
    echo -e "${GREEN}  Zips created${NC}"
    echo ""

    # Step 3: Transfer to remote
    echo -e "${YELLOW}[3/5]${NC} Transferring to $REMOTE_HOST:$REMOTE_DIR..."
    ssh "$REMOTE_HOST" "mkdir -p $REMOTE_DIR"
    scp apps/renderer-server/renderer-server-portable.zip "$REMOTE_HOST:$REMOTE_DIR/"
    scp apps/renderer-api/renderer-api-portable.zip "$REMOTE_HOST:$REMOTE_DIR/"
    echo -e "${GREEN}  Transfer complete${NC}"
    echo ""

    # Step 4: Unzip on remote
    echo -e "${YELLOW}[4/5]${NC} Setting up on remote..."
    ssh "$REMOTE_HOST" << REMOTE_SETUP
set -e
cd $REMOTE_DIR

# Unzip renderer-server
rm -rf renderer-server
mkdir -p renderer-server
cd renderer-server
unzip -o ../renderer-server-portable.zip
cd ..

# Unzip renderer-api
rm -rf renderer-api
mkdir -p renderer-api
cd renderer-api
unzip -o ../renderer-api-portable.zip
cd ..

# Clean up zips
rm -f renderer-server-portable.zip renderer-api-portable.zip

echo "Unzipped both packages into $DEPLOY_NAME/"
REMOTE_SETUP
    echo -e "${GREEN}  Unpacked on remote${NC}"
    echo ""

    # Step 5: Instructions
    echo -e "${YELLOW}[5/5]${NC} Next steps on the Mac Mini:"
    echo ""
    echo -e "  ${CYAN}ssh $REMOTE_HOST${NC}"
    echo ""
    echo -e "  # Install prerequisites (first time only):"
    echo -e "  ${CYAN}/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"${NC}"
    echo -e "  ${CYAN}brew install node@20${NC}"
    echo ""
    echo -e "  # Start renderer-server (background):"
    echo -e "  ${CYAN}cd ~/$DEPLOY_NAME/renderer-server && nohup ./setup.sh > server.log 2>&1 &${NC}"
    echo ""
    echo -e "  # Start renderer-api (background):"
    echo -e "  ${CYAN}cd ~/$DEPLOY_NAME/renderer-api && nohup ./setup.sh > api.log 2>&1 &${NC}"
    echo ""
    echo -e "${GREEN}  Done! After starting, verify:${NC}"
    echo -e "  ${CYAN}curl http://100.77.56.109:3004/api/v1/health${NC}"
}

# ═══════════════════════════════════════════════════════════════
# DOCKER DEPLOYMENT
# ═══════════════════════════════════════════════════════════════

deploy_docker() {
    echo -e "${BLUE}=== Docker Deployment → $DEPLOY_NAME ===${NC}"
    echo ""

    COMPOSE_FILE="docker-compose.production.yml"
    TARBALL="fourthwall-images.tar"

    # Step 1: Build Docker images
    echo -e "${YELLOW}[1/4]${NC} Building Docker images..."
    cd "$SCRIPT_DIR"
    docker compose -f "$COMPOSE_FILE" build
    echo -e "${GREEN}  Images built${NC}"
    echo ""

    # Step 2: Save images to tarball
    echo -e "${YELLOW}[2/4]${NC} Saving images to tarball..."
    docker save \
        $(docker compose -f "$COMPOSE_FILE" config --images) \
        -o "$TARBALL"

    TARBALL_SIZE=$(du -h "$TARBALL" | cut -f1)
    echo -e "${GREEN}  Saved $TARBALL ($TARBALL_SIZE)${NC}"
    echo ""

    # Step 3: Transfer to remote
    echo -e "${YELLOW}[3/4]${NC} Transferring to $REMOTE_HOST:$REMOTE_DIR (this may take a while)..."
    ssh "$REMOTE_HOST" "mkdir -p $REMOTE_DIR"
    scp "$TARBALL" "$REMOTE_HOST:$REMOTE_DIR/"
    scp "$COMPOSE_FILE" "$REMOTE_HOST:$REMOTE_DIR/docker-compose.yml"
    echo -e "${GREEN}  Transfer complete${NC}"
    echo ""

    # Step 4: Load and start on remote
    echo -e "${YELLOW}[4/4]${NC} Loading images and starting on remote..."
    ssh "$REMOTE_HOST" << REMOTE_DOCKER
set -e
cd $REMOTE_DIR

echo "Loading Docker images..."
docker load -i $TARBALL
rm -f $TARBALL

echo "Starting stack..."
docker compose -f docker-compose.yml up -d

echo "Waiting for health checks..."
sleep 10
docker compose -f docker-compose.yml ps

echo ""
echo "Stack is running in $DEPLOY_NAME/"
REMOTE_DOCKER
    echo -e "${GREEN}  Stack started!${NC}"
    echo ""

    # Clean up local tarball
    rm -f "$TARBALL"

    echo -e "${GREEN}  Verify:${NC}"
    echo -e "  ${CYAN}curl http://100.77.56.109:3004/api/v1/health${NC}"
    echo ""
    echo -e "  ${BLUE}Manage remotely:${NC}"
    echo -e "  ${CYAN}ssh $REMOTE_HOST 'cd ~/$DEPLOY_NAME && docker compose logs -f'${NC}"
    echo -e "  ${CYAN}ssh $REMOTE_HOST 'cd ~/$DEPLOY_NAME && docker compose restart'${NC}"
    echo -e "  ${CYAN}ssh $REMOTE_HOST 'cd ~/$DEPLOY_NAME && docker compose down'${NC}"
}

# ═══════════════════════════════════════════════════════════════

case "$MODE" in
    zip)    deploy_zip ;;
    docker) deploy_docker ;;
    *)
        echo -e "${RED}Unknown mode: $MODE${NC}"
        echo "Usage: ./deploy.sh [zip|docker] --v <version>"
        echo "Example: ./deploy.sh zip --v 0"
        exit 1
        ;;
esac
