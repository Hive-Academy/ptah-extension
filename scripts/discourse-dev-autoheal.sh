#!/usr/bin/env bash
# Supervises the Rails server inside the local discourse_dev container
# (docs/deploy/local-testing-setup.md §A5). The server is injected via
# `docker exec -d`, so it dies with every container restart and never comes
# back on its own — this loop re-injects it whenever the container is running
# without a rails process.
#
# Installed as a systemd unit in WSL Ubuntu-24.04 (discourse-dev-autoheal.service):
#   sudo cp scripts/discourse-dev-autoheal.sh /usr/local/bin/
#   sudo chmod +x /usr/local/bin/discourse-dev-autoheal.sh
#   (unit file: see docs/deploy/local-testing-setup.md §A5)
set -u

while true; do
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx discourse_dev; then
    if ! docker exec discourse_dev pgrep -f "rails server" >/dev/null 2>&1; then
      docker exec -d -u discourse:discourse -w /src \
        -e RAILS_DEVELOPMENT_HOSTS=host.docker.internal \
        discourse_dev bash -lc "bin/rails server -b 0.0.0.0 -p 3000 > /src/log/railss.log 2>&1"
      echo "$(date -Is) injected rails server into discourse_dev"
    fi
  fi
  sleep 20
done
