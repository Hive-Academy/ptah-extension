#!/usr/bin/env bash
#
# test-publish-cli.sh — local end-to-end publish smoke for @hive-academy/ptah-cli
#
# TASK_2026_108 T4 (Task 4.3). Build the CLI, pack the npm tarball, install
# it into a clean `mktemp -d` prefix, and run the basic command surface
# (`ptah --version`, `ptah --help`, `ptah agent list --human`) against the
# installed binary. Exits non-zero on any failure. Cleans up the temp prefix
# on success and on failure (trap EXIT).
#
# Compatibility: POSIX bash + Git Bash on Windows. Forward-slash paths only.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DIST_DIR="$REPO_ROOT/dist/apps/ptah-cli"

TMP_PREFIX=""
TARBALL=""

cleanup() {
  set +e
  if [ -n "${TMP_PREFIX:-}" ] && [ -d "$TMP_PREFIX" ]; then
    rm -rf "$TMP_PREFIX" 2>/dev/null || true
  fi
  if [ -n "${TARBALL:-}" ] && [ -f "$DIST_DIR/$TARBALL" ]; then
    rm -f "$DIST_DIR/$TARBALL" 2>/dev/null || true
  fi
  set -e
}
trap cleanup EXIT INT TERM

echo "[test-publish] Building ptah-cli..." >&2
( cd "$REPO_ROOT" && npx nx build ptah-cli >/dev/null )

if [ ! -f "$DIST_DIR/main.mjs" ]; then
  echo "[test-publish] FAIL: dist/apps/ptah-cli/main.mjs missing after build" >&2
  exit 1
fi

echo "[test-publish] Packing tarball..." >&2
PACK_OUT="$(cd "$DIST_DIR" && npm pack 2>/dev/null | tail -1)"
TARBALL="$(printf '%s' "$PACK_OUT" | tr -d '\r\n')"
if [ -z "$TARBALL" ] || [ ! -f "$DIST_DIR/$TARBALL" ]; then
  echo "[test-publish] FAIL: npm pack did not produce a tarball ($TARBALL)" >&2
  exit 1
fi
TARBALL_ABS="$DIST_DIR/$TARBALL"

echo "[test-publish] Tarball: $TARBALL_ABS" >&2

# Assert the second bundle (tui.mjs) ships in the tarball.
echo "[test-publish] Asserting tui.mjs is packed..." >&2
if ! tar -tzf "$TARBALL_ABS" | grep -q '^package/tui\.mjs$'; then
  echo "[test-publish] FAIL: tui.mjs missing from tarball" >&2
  exit 1
fi

# Assert the packed manifest is the CLI manifest (clobber regression). The
# ptah-tui esbuild build copies its own package.json into the shared dist
# dir; the restore step must leave @hive-academy/ptah-cli with a single
# `ptah` bin -> ./main.mjs behind.
echo "[test-publish] Asserting packed manifest name/bin..." >&2
PACKED_MANIFEST="$DIST_DIR/package.json"
if ! cat "$PACKED_MANIFEST" | node -e '
  let buf = "";
  process.stdin.on("data", (c) => { buf += c; });
  process.stdin.on("end", () => {
    try {
      const p = JSON.parse(buf);
      if (p.name !== "@hive-academy/ptah-cli") { process.exit(1); }
      if (!p.bin || p.bin.ptah !== "./main.mjs" || Object.keys(p.bin).length !== 1) {
        process.exit(1);
      }
    } catch { process.exit(1); }
  });
'; then
  echo "[test-publish] FAIL: dist package.json clobbered (expected @hive-academy/ptah-cli + single ptah bin)" >&2
  exit 1
fi

# Resolve mktemp for both POSIX and Git Bash.
TMP_PREFIX="$(mktemp -d 2>/dev/null || mktemp -d -t ptahcli)"
if [ -z "$TMP_PREFIX" ] || [ ! -d "$TMP_PREFIX" ]; then
  echo "[test-publish] FAIL: mktemp -d returned no directory" >&2
  exit 1
fi

echo "[test-publish] Installing tarball into $TMP_PREFIX..." >&2
( cd "$TMP_PREFIX" && npm init -y >/dev/null 2>&1 && npm install "$TARBALL_ABS" --no-audit --no-fund --silent >/dev/null )

# Resolve the installed `ptah` binary. node_modules/.bin/ptah on POSIX,
# node_modules/.bin/ptah.cmd on Windows.
PTAH_BIN="$TMP_PREFIX/node_modules/.bin/ptah"
if [ ! -f "$PTAH_BIN" ] && [ -f "$PTAH_BIN.cmd" ]; then
  PTAH_BIN="$PTAH_BIN.cmd"
fi
if [ ! -e "$PTAH_BIN" ]; then
  echo "[test-publish] FAIL: ptah binary not found in $TMP_PREFIX/node_modules/.bin/" >&2
  exit 1
fi

echo "[test-publish] Running ptah --version..." >&2
VERSION_OUT="$("$PTAH_BIN" --version)"
if ! printf '%s' "$VERSION_OUT" | tr -d '[:space:]' | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "[test-publish] FAIL: ptah --version did not print semver: '$VERSION_OUT'" >&2
  exit 1
fi
echo "[test-publish]   version: $VERSION_OUT" >&2

echo "[test-publish] Running ptah --help..." >&2
HELP_OUT="$("$PTAH_BIN" --help)"
if ! printf '%s' "$HELP_OUT" | grep -q 'session'; then
  echo "[test-publish] FAIL: ptah --help missing 'session' subcommand" >&2
  exit 1
fi

echo "[test-publish] Running ptah agent list --human..." >&2
if ! "$PTAH_BIN" agent list --human >/dev/null 2>&1; then
  echo "[test-publish] FAIL: ptah agent list --human exited non-zero" >&2
  exit 1
fi

echo "[test-publish] Running ptah tui under piped stdin (TTY guard)..." >&2
TUI_STDOUT="$(mktemp)"
TUI_STDERR="$(mktemp)"
set +e
echo | "$PTAH_BIN" tui >"$TUI_STDOUT" 2>"$TUI_STDERR"
TUI_RC=$?
set -e
if [ "$TUI_RC" -eq 0 ]; then
  rm -f "$TUI_STDOUT" "$TUI_STDERR"
  echo "[test-publish] FAIL: ptah tui with piped stdin exited 0 (expected non-zero)" >&2
  exit 1
fi
if [ -s "$TUI_STDOUT" ]; then
  rm -f "$TUI_STDOUT" "$TUI_STDERR"
  echo "[test-publish] FAIL: ptah tui wrote to stdout under piped stdin" >&2
  exit 1
fi
if ! grep -qi 'interactive terminal' "$TUI_STDERR"; then
  rm -f "$TUI_STDOUT" "$TUI_STDERR"
  echo "[test-publish] FAIL: ptah tui stderr missing TTY guard message" >&2
  exit 1
fi
rm -f "$TUI_STDOUT" "$TUI_STDERR"

echo "[test-publish] PASS — installed tarball runs cleanly." >&2
