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

echo "[discourse-dev-up] waiting for Discourse to accept connections on localhost:3001..."
for i in $(seq 1 12); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3001/srv/status 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then
    echo "[discourse-dev-up] Discourse is up (localhost:3001/srv/status -> 200)."
    exit 0
  fi
  sleep 10
done

echo "[discourse-dev-up] WARNING: Discourse did not report healthy within the timeout."
echo "[discourse-dev-up] Check: docker exec $CONTAINER tail -n 40 /src/log/railss.log"
exit 0
