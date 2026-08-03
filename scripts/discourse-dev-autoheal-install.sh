#!/bin/bash
# =============================================================================
# Discourse Dev Autoheal — WSL systemd unit installer
# =============================================================================
# Installs (or refreshes) the systemd unit inside the WSL distro that keeps the
# discourse_dev container's Rails server AND Rolldown frontend watcher alive
# across container/WSL/Windows restarts (both are injected via `docker exec -d`
# and die with the container — see docs/deploy/local-testing-setup.md §A5).
#
# Companion to discourse-dev-up.sh (one-shot bring-up); this makes recovery
# automatic (~40-60s) with no manual step.
#
#   npm run discourse:dev:autoheal:install   # install/refresh + enable at boot
#   npm run discourse:dev:autoheal:status    # unit state + recent heal activity
#
# Runs from Git Bash on the Windows host. File content crosses into WSL via
# stdin (windows path args get mangled by the wsl.exe boundary). Override the
# distro with DISCOURSE_WSL_DISTRO if yours isn't Ubuntu-24.04.
# =============================================================================
set -euo pipefail

DISTRO="${DISCOURSE_WSL_DISTRO:-Ubuntu-24.04}"
REPO_SCRIPT="$(cd "$(dirname "$0")" && pwd)/discourse-dev-autoheal.sh"

if [ "${1:-install}" = "status" ]; then
  wsl.exe -d "$DISTRO" -- bash -lc \
    "systemctl is-active discourse-dev-autoheal.service && journalctl -u discourse-dev-autoheal -n 8 --no-pager"
  exit 0
fi

if [ ! -f "$REPO_SCRIPT" ]; then
  echo "[autoheal-install] missing $REPO_SCRIPT" >&2
  exit 1
fi

echo "[autoheal-install] copying supervisor script into $DISTRO..."
wsl.exe -d "$DISTRO" -u root -- bash -c \
  "cat > /usr/local/bin/discourse-dev-autoheal.sh && sed -i 's/\r\$//' /usr/local/bin/discourse-dev-autoheal.sh && chmod +x /usr/local/bin/discourse-dev-autoheal.sh" \
  < "$REPO_SCRIPT"

echo "[autoheal-install] writing + enabling systemd unit..."
wsl.exe -d "$DISTRO" -u root -- bash -s <<'WSLEOF'
set -e
cat > /etc/systemd/system/discourse-dev-autoheal.service <<'UNIT'
[Unit]
Description=Keep Rails + frontend watcher alive inside the discourse_dev container
After=docker.service
Wants=docker.service

[Service]
ExecStart=/usr/local/bin/discourse-dev-autoheal.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now discourse-dev-autoheal.service
systemctl restart discourse-dev-autoheal.service
systemctl is-active discourse-dev-autoheal.service
WSLEOF

echo "[autoheal-install] unit installed, enabled at boot, and running."
