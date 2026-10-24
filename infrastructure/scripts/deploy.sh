#!/usr/bin/env bash
# Staged production deploy for /opt/socialpulse, encoding the rollout order
# from LIVE_DEPLOY_RULES.md: backend services -> gateway -> web apps, each
# step gated on docker reporting the recreated containers healthy before the
# next step starts. Run as a user with passwordless sudo for docker (e.g.
# "deploy" on socialpulse-server).
#
# Usage: deploy.sh <path-to-synced-source-tree>
#
# Does NOT touch .env or .env.local in the target directory — those are
# server-managed secrets, never part of the synced source.
set -euo pipefail

SRC_DIR="${1:?Usage: deploy.sh <path-to-synced-source-tree>}"
TARGET_DIR="/opt/socialpulse"
HEALTH_TIMEOUT_SECS=90
HEALTH_POLL_SECS=3

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

log "Syncing $SRC_DIR -> $TARGET_DIR (excluding .env, .env.local, and server-local data)"
sudo rsync -a --delete \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.instagram-media' \
  --exclude='.media-assets' \
  --exclude='.whapi-media' \
  --exclude='backups' \
  --exclude='*.tokens.json' \
  --exclude='canva-sessions.json' \
  --exclude='facebook-tokens.json' \
  --exclude='linkedin-tokens.json' \
  --exclude='scheduled-posts.json' \
  --exclude='whapi-events.log' \
  --exclude='whatsapp-events.log' \
  "$SRC_DIR"/ "$TARGET_DIR"/

cd "$TARGET_DIR"

# Services in dependency/rollout order. db is never rebuilt by this script —
# schema changes go through migrations, not an image rebuild.
BACKEND_SERVICES=(media-service user-service ai-service integrations-service publishing-service scheduler-service auth-service admin-service analytics-service)
GATEWAY_SERVICE=(gateway)
WEB_SERVICES=(socialpulse socialpulse-superadmin-app)

wait_healthy() {
  local compose_service="$1"
  local container
  container=$(sudo docker compose ps -q "$compose_service")
  if [ -z "$container" ]; then
    log "ERROR: no container found for service $compose_service"
    return 1
  fi
  local waited=0
  while [ "$waited" -lt "$HEALTH_TIMEOUT_SECS" ]; do
    local status
    status=$(sudo docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "none")
    if [ "$status" = "healthy" ]; then
      log "$compose_service is healthy (${waited}s)"
      return 0
    fi
    if [ "$status" = "unhealthy" ]; then
      log "ERROR: $compose_service reported unhealthy"
      return 1
    fi
    sleep "$HEALTH_POLL_SECS"
    waited=$((waited + HEALTH_POLL_SECS))
  done
  log "ERROR: $compose_service did not become healthy within ${HEALTH_TIMEOUT_SECS}s"
  return 1
}

deploy_stage() {
  local stage_name="$1"
  shift
  local services=("$@")
  log "Building: ${services[*]}"
  sudo docker compose build "${services[@]}"
  log "Recreating: ${services[*]}"
  sudo docker compose up -d --no-deps "${services[@]}"
  for svc in "${services[@]}"; do
    wait_healthy "$svc"
  done
  log "Stage '$stage_name' complete: ${services[*]}"
}

deploy_stage "backend" "${BACKEND_SERVICES[@]}"
deploy_stage "gateway" "${GATEWAY_SERVICE[@]}"
deploy_stage "web" "${WEB_SERVICES[@]}"

log "Verifying live site..."
if ! curl -fsS -o /dev/null -w "%{http_code}" https://socialpulse.dotstark.tech/ | grep -q "200"; then
  log "ERROR: https://socialpulse.dotstark.tech/ did not return 200 after deploy"
  exit 1
fi

log "Deploy complete. All stages healthy, site reachable."
