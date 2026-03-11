.PHONY: dev docker docker-stop docker-logs db-up db-down db-reset ps help

## Run renderer-server locally (starts postgres if needed)
dev:
	docker compose up -d postgres
	cd apps/renderer-server && npm run dev

## Run everything in Docker (build + start postgres + renderer)
docker:
	docker compose up -d --build

## Stop all Docker services
docker-stop:
	docker compose down

## Tail Docker logs
docker-logs:
	docker compose logs -f

## Start only postgres
db-up:
	docker compose up -d postgres

## Stop postgres
db-down:
	docker compose stop postgres

## Stop postgres + delete volume (full reset)
db-reset:
	docker compose down -v

## Show container status
ps:
	docker compose ps

## Show help
help:
	@echo "Available targets:"
	@echo ""
	@echo "Local development (DB in Docker, app on host):"
	@echo "  make db-up       - Start PostgreSQL"
	@echo "  make dev         - Run renderer-server locally (npm run dev)"
	@echo "  make db-down     - Stop PostgreSQL"
	@echo "  make db-reset    - Stop PostgreSQL + delete volume"
	@echo ""
	@echo "Docker (everything in containers):"
	@echo "  make docker      - Build and start all services"
	@echo "  make docker-stop - Stop all services"
	@echo "  make docker-logs - Tail logs from all services"
	@echo ""
	@echo "  make ps          - Show container status"
