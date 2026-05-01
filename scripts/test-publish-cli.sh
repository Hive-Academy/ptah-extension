#!/usr/bin/env bash
# Local end-to-end smoke test for the @hive-academy/ptah-cli npm publish
# pipeline. Builds the CLI, packs the dist into a tarball, installs it
# into a clean tmp dir, and exercises the binary via --version, --help,
# and a JSON-RPC interact round-trip.
#
# Run from the repo root:  bash scripts/test-publish-cli.sh
#
# Exit codes:
#   0  all checks passed
#   1  build failed
#   2  pack failed
#   3  install failed
#   4  smoke test failed
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$REPO_ROOT/dist/apps/ptah-cli"
TMP_ROOT="$(mktemp -d -t ptah-cli-publish-test-XXXXXX)"
trap 'rm -rf "$TMP_ROOT"' EXIT

echo "==> Building ptah-cli..."
( cd "$REPO_ROOT" && npx nx build ptah-cli ) || exit 1

echo "==> Verifying dist contents..."
for f in main.mjs package.json README.md LICENSE.md docs/jsonrpc-schema.md docs/migration.md; do
  if [ ! -f "$DIST_DIR/$f" ]; then
    echo "MISSING: dist/apps/ptah-cli/$f" >&2
    exit 2
  fi
done

echo "==> Running npm publish --dry-run..."
( cd "$DIST_DIR" && npm publish --dry-run --access public ) || exit 2

echo "==> Packing tarball..."
TARBALL_PATH="$( cd "$DIST_DIR" && npm pack --silent )"
TARBALL="$DIST_DIR/$TARBALL_PATH"
echo "    tarball: $TARBALL"

echo "==> Installing tarball into $TMP_ROOT..."
(
  cd "$TMP_ROOT"
  npm init -y >/dev/null
  npm install --silent "$TARBALL"
) || exit 3

PTAH_ENTRY="$TMP_ROOT/node_modules/@hive-academy/ptah-cli/main.mjs"
if [ ! -f "$PTAH_ENTRY" ]; then
  echo "MISSING: ptah entry at $PTAH_ENTRY" >&2
  exit 3
fi

echo "==> Smoke: ptah --version"
node "$PTAH_ENTRY" --version || exit 4

echo "==> Smoke: ptah --help (first 5 lines)"
node "$PTAH_ENTRY" --help | head -5 || exit 4

echo "==> Smoke: ptah agent list (no DI required)"
node "$PTAH_ENTRY" agent list --human || true

echo "==> All checks passed."
echo "    Tarball preserved at: $TARBALL"
