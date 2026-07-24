#!/bin/bash
# =============================================================================
# Discourse Dev Container — Stop
# =============================================================================
# Stops the local `discourse_dev` container (the Rails server stops with it).
# Data persists in the container's Postgres volume, so `discourse:dev:up`
# (scripts/discourse-dev-up.sh) brings it straight back. See
# docs/deploy/local-testing-setup.md (Workstream A).
#
# NON-FATAL: `discourse_dev` is NOT part of our docker-compose.yml (it is driven
# by Discourse's own `d/boot_dev` in WSL). When the container is absent or already
# stopped, this script warns and exits 0 so it never breaks `docker:down`.
# =============================================================================

set -uo pipefail

CONTAINER="discourse_dev"

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "[discourse-dev-down] '$CONTAINER' not found — nothing to stop."
  exit 0
fi

if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" != "true" ]; then
  echo "[discourse-dev-down] '$CONTAINER' already stopped."
  exit 0
fi

echo "[discourse-dev-down] stopping $CONTAINER..."
docker stop "$CONTAINER" >/dev/null
echo "[discourse-dev-down] stopped (data persists; bring it back with: npm run discourse:dev:up)."
exit 0
