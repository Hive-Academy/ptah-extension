#!/bin/bash
# =============================================================================
# Discourse Dev Container — Bring-Up / Restart Recovery
# =============================================================================
# Restarts the local `discourse_dev` container (re-resolving its /src bind mount)
# and starts the Rails server on host :3001, so the DiscourseConnect SSO round-trip
# and admin group-sync work locally. See docs/deploy/local-testing-setup.md
# (Workstream A).
#
# The Rails server is launched with `docker exec -d`, so it does NOT survive a
# container restart — hence this helper, chained into `npm run docker:up`.
#
# NON-FATAL: `discourse_dev` is NOT part of our docker-compose.yml (it is driven
# by Discourse's own `d/boot_dev` in WSL). When the container is absent — CI, a
# fresh machine, or before Workstream A is set up — this script warns and exits 0
# so it never breaks `docker:up`.
# =============================================================================

set -uo pipefail

CONTAINER="discourse_dev"

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "[discourse-dev-up] '$CONTAINER' not found — skipping (see docs/deploy/local-testing-setup.md Workstream A)."
  exit 0
fi

echo "[discourse-dev-up] restarting $CONTAINER (re-resolves /src bind mount)..."
docker restart "$CONTAINER" >/dev/null
sleep 6

echo "[discourse-dev-up] starting Rails server (detached) on :3001..."
docker exec -d -u discourse:discourse \
  -e RAILS_DEVELOPMENT_HOSTS=host.docker.internal,localhost \
  "$CONTAINER" bash -lc "cd /src && bin/rails server -b 0.0.0.0 -p 3000 > /src/log/railss.log 2>&1"

# The full forum SPA (topic list, categories, themed chrome) needs Discourse's
# Ember/rolldown frontend dev server IN ADDITION to Rails — without it, app
# routes render a "Frontend build error" (only the API + SSO work on Rails
# alone). Also detached, so it does not survive a container restart either.
echo "[discourse-dev-up] starting Ember frontend dev server (detached)..."
docker exec -d -u discourse:discourse \
  "$CONTAINER" bash -lc "cd /src && pnpm --dir frontend/discourse start > /src/log/ember.log 2>&1"

echo "[discourse-dev-up] waiting for Rails on localhost:3001..."
rails_up=false
for i in $(seq 1 12); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3001/srv/status 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then
    echo "[discourse-dev-up] Rails is up (localhost:3001/srv/status -> 200)."
    rails_up=true
    break
  fi
  sleep 10
done
if [ "$rails_up" != "true" ]; then
  echo "[discourse-dev-up] WARNING: Rails did not report healthy in time."
  echo "[discourse-dev-up] Check: docker exec $CONTAINER tail -n 40 /src/log/railss.log"
  exit 0
fi

echo "[discourse-dev-up] waiting for the frontend build (first Ember build ~30s)..."
for i in $(seq 1 20); do
  if docker exec "$CONTAINER" bash -lc "test -f /src/frontend/discourse/dist/manifest/manifest.json" 2>/dev/null; then
    echo "[discourse-dev-up] Discourse is fully up — forum UI at http://localhost:3001/latest"
    exit 0
  fi
  sleep 15
done

echo "[discourse-dev-up] WARNING: Rails is up but the Ember frontend build did not appear in time."
echo "[discourse-dev-up] API/SSO work; the forum UI may show 'Frontend build error' until it finishes."
echo "[discourse-dev-up] Check: docker exec $CONTAINER tail -n 40 /src/log/ember.log"
exit 0
