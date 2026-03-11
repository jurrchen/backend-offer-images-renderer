#!/bin/bash

# Fourthwall Renderer Docker Management Script
# Usage: ./docker.sh [command]

set -e

COMPOSE_FILE="docker-compose.yml"
PROJECT_NAME="fourthwall-renderer"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Commands
cmd_build() {
    print_info "Building Docker image..."
    # Export GITLAB_AUTH_TOKEN from .env so the shell env doesn't shadow a stale value
    export $(grep -E '^GITLAB_AUTH_TOKEN=' .env | xargs)
    docker-compose build --no-cache
    print_success "Build complete!"
}

cmd_start() {
    print_info "Starting renderer server..."
    docker-compose up -d
    sleep 5
    cmd_status
    print_success "Server started!"
    print_info "API available at http://localhost:3000"
    print_info "Health check: curl http://localhost:3000/api/v1/health"
}

cmd_stop() {
    print_info "Stopping renderer server..."
    docker-compose down
    print_success "Server stopped!"
}

cmd_restart() {
    print_info "Restarting renderer server..."
    docker-compose restart
    sleep 5
    cmd_status
    print_success "Server restarted!"
}

cmd_status() {
    print_info "Container status:"
    docker-compose ps
    echo ""
    
    # Check if healthy
    if docker-compose ps | grep -q "healthy"; then
        print_success "Server is healthy ✅"
    elif docker-compose ps | grep -q "Up"; then
        print_warning "Server is running but not yet healthy (starting up...)"
    else
        print_error "Server is not running"
    fi
}

cmd_logs() {
    print_info "Showing logs (Ctrl+C to exit)..."
    docker-compose logs -f renderer
}

cmd_logs_tail() {
    print_info "Last 100 log lines:"
    docker-compose logs --tail=100 renderer
}

cmd_shell() {
    print_info "Opening shell in container..."
    docker-compose exec renderer sh
}

cmd_health() {
    print_info "Checking health endpoint..."
    curl -s http://localhost:3000/api/v1/health | jq . || echo "Server not responding"
}

cmd_cache_status() {
    print_info "Asset cache status:"
    echo ""
    
    if [ -d "./assets/cdn/generator" ]; then
        GENERATOR_COUNT=$(find ./assets/cdn/generator -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
        print_info "Cached generators: ${GENERATOR_COUNT}"
        
        TOTAL_SIZE=$(du -sh ./assets/cdn/generator 2>/dev/null | cut -f1)
        print_info "Total cache size: ${TOTAL_SIZE}"
        
        echo ""
        print_info "Top 10 cached generators:"
        find ./assets/cdn/generator -mindepth 1 -maxdepth 1 -type d 2>/dev/null | \
            xargs -I {} sh -c 'echo "$(du -sh {} | cut -f1)\t$(basename {})"' | \
            sort -rh | head -10
    else
        print_warning "No cache directory found"
    fi
}

cmd_cache_clear() {
    print_warning "This will delete all cached assets!"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Clearing cache..."
        rm -rf ./assets/cdn/generator/*
        print_success "Cache cleared!"
        print_info "Assets will be re-downloaded on next render"
    else
        print_info "Cancelled"
    fi
}

cmd_analytics() {
    print_info "Fetching analytics..."
    curl -s http://localhost:3000/api/v1/analytics \
        -H "Authorization: Bearer dev-api-key" | jq . || echo "Failed to fetch analytics"
}

cmd_test_render() {
    print_info "Running test render..."
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
    
    if [ -f "test-output.png" ]; then
        SIZE=$(du -h test-output.png | cut -f1)
        print_success "Render complete! Output: test-output.png (${SIZE})"
    else
        print_error "Render failed"
    fi
}

cmd_rebuild() {
    print_info "Rebuilding Docker image and restarting..."
    # Export GITLAB_AUTH_TOKEN from .env so the shell env doesn't shadow a stale value
    export $(grep -E '^GITLAB_AUTH_TOKEN=' .env | xargs)
    docker-compose down
    docker-compose build --no-cache
    docker-compose up -d
    sleep 5
    cmd_status
    print_success "Rebuild complete!"
    print_info "API available at http://localhost:3000"
}

cmd_clean() {
    print_warning "This will remove containers, volumes, and images!"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Cleaning up..."
        docker-compose down -v
        docker rmi $(docker images | grep 'fourthwall-renderer' | awk '{print $3}') 2>/dev/null || true
        print_success "Cleanup complete!"
    else
        print_info "Cancelled"
    fi
}

cmd_prebuild() {
    print_info "product-renderer is installed as an npm package from Gitlab registry."
    print_info "No local prebuild step needed."
    print_success "Ready to build Docker image."
}

cmd_help() {
    echo "Fourthwall Renderer Docker Manager"
    echo ""
    echo "Usage: ./docker.sh [command]"
    echo ""
    echo "Commands:"
    echo "  prebuild        Build product-renderer library (required before first build)"
    echo "  build           Build Docker image"
    echo "  rebuild         Stop, rebuild image (no-cache), and start"
    echo "  start           Start the server"
    echo "  stop            Stop the server"
    echo "  restart         Restart the server"
    echo "  status          Show container status"
    echo "  logs            Follow live logs"
    echo "  logs-tail       Show last 100 lines"
    echo "  shell           Open shell in container"
    echo "  health          Check health endpoint"
    echo "  analytics       View analytics"
    echo "  test-render     Run a test render"
    echo "  cache-status    Show cache statistics"
    echo "  cache-clear     Clear asset cache"
    echo "  clean           Remove all containers and images"
    echo "  help            Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./docker.sh prebuild              # First time setup"
    echo "  ./docker.sh build && ./docker.sh start"
    echo "  ./docker.sh logs"
    echo "  ./docker.sh cache-status"
}

# Main
case "${1:-help}" in
    prebuild) cmd_prebuild ;;
    build) cmd_build ;;
    rebuild) cmd_rebuild ;;
    start) cmd_start ;;
    stop) cmd_stop ;;
    restart) cmd_restart ;;
    status) cmd_status ;;
    logs) cmd_logs ;;
    logs-tail) cmd_logs_tail ;;
    shell) cmd_shell ;;
    health) cmd_health ;;
    analytics) cmd_analytics ;;
    test-render) cmd_test_render ;;
    cache-status) cmd_cache_status ;;
    cache-clear) cmd_cache_clear ;;
    clean) cmd_clean ;;
    help|--help|-h) cmd_help ;;
    *)
        print_error "Unknown command: $1"
        echo ""
        cmd_help
        exit 1
        ;;
esac
