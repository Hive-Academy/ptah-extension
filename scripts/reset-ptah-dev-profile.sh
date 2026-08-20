#!/bin/bash
# =============================================================================
# Ptah Dev Profile Reset
# =============================================================================
# Moves the config Ptah reads at boot out of the way so `npm run electron:serve`
# starts on the real first-run path — for demos, videos and onboarding captures.
#
# Nothing is deleted. Every item is MOVED into a timestamped backup directory
# alongside a manifest, and `--restore` puts it all back.
#
# Usage:
#   ./scripts/reset-ptah-dev-profile.sh --dry-run
#   ./scripts/reset-ptah-dev-profile.sh --reset
#   ./scripts/reset-ptah-dev-profile.sh --list
#   ./scripts/reset-ptah-dev-profile.sh --restore latest
#   ./scripts/reset-ptah-dev-profile.sh --restore ~/.ptah-backup-20260812-143000
#
# Flags:
#   --dry-run           Print the plan, touch nothing. Combine with any mode.
#   --include-content   Also move plugins/ skills/ templates/ models/, forcing a
#                       live re-download on first run. Off by default — it is a
#                       network fetch that can stall on camera.
#   --include-claude    Also move ~/.claude, which logs you out of Claude and
#                       makes the video open on the auth flow. Off by default.
#   --force             Skip the running-process guard.
#
# Scope note: ~/.ptah/settings.json and the secret envelopes are NOT dev-scoped.
# The installed Ptah and the VS Code extension read the same files
# (libs/backend/platform-electron/src/settings/electron-settings-registration.ts:58).
# That is why this script moves rather than deletes.
# =============================================================================

set -euo pipefail

MODE=""
DRY_RUN=0
INCLUDE_CONTENT=0
INCLUDE_CLAUDE=0
FORCE=0
RESTORE_TARGET=""

# --- Never-touch guard ------------------------------------------------------
# Production data lives beside the dev database. ptah.sqlite is ~858 MB of real
# state and the pre-migration snapshots are the only copies of prior schemas.
FORBIDDEN_PATTERNS='^ptah\.sqlite|pre-migration|\.backup-pre-purge'

# --- Arg parsing ------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --reset)           MODE="reset" ;;
    --list)            MODE="list" ;;
    --restore)         MODE="restore"; RESTORE_TARGET="${2:-latest}"; [ $# -gt 1 ] && shift ;;
    --dry-run)         DRY_RUN=1 ;;
    --include-content) INCLUDE_CONTENT=1 ;;
    --include-claude)  INCLUDE_CLAUDE=1 ;;
    --force)           FORCE=1 ;;
    -h|--help)         sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

# --dry-run alone means "show me the reset plan".
[ -z "$MODE" ] && [ "$DRY_RUN" -eq 1 ] && MODE="reset"

if [ -z "$MODE" ]; then
  echo "No mode given. Use --reset, --restore, --list or --dry-run." >&2
  echo "Run with --help for the full usage." >&2
  exit 2
fi

# --- Path resolution --------------------------------------------------------
PTAH_DIR="$HOME/.ptah"

resolve_appdata() {
  if [ -n "${APPDATA:-}" ]; then
    if command -v cygpath >/dev/null 2>&1; then
      cygpath -u "$APPDATA"
    else
      echo "$APPDATA"
    fi
  else
    echo "$HOME/AppData/Roaming"
  fi
}
APPDATA_DIR="$(resolve_appdata)"
ELECTRON_DEV_USERDATA="$APPDATA_DIR/Ptah Dev"

# --- Item table -------------------------------------------------------------
# Each entry is an absolute source path. Order is cosmetic only; restore reads
# the manifest, not this list.
ITEMS=()

add_item() { ITEMS+=("$1"); }

build_item_list() {
  ITEMS=()

  # Shared config — read by dev, by the installed app, and by the extension.
  add_item "$PTAH_DIR/settings.json"
  add_item "$PTAH_DIR/secrets.enc.json"
  add_item "$PTAH_DIR/secrets.enc"
  add_item "$PTAH_DIR/master-key-ref.json"
  add_item "$PTAH_DIR/global-state.json"
  add_item "$PTAH_DIR/.machine-uuid"
  add_item "$PTAH_DIR/.content-cache.json"
  add_item "$PTAH_DIR/migrations"

  # Dev-scoped only.
  add_item "$ELECTRON_DEV_USERDATA"
  add_item "$PTAH_DIR/state/ptah-dev.sqlite"
  add_item "$PTAH_DIR/state/ptah-dev.sqlite-shm"
  add_item "$PTAH_DIR/state/ptah-dev.sqlite-wal"

  if [ "$INCLUDE_CONTENT" -eq 1 ]; then
    add_item "$PTAH_DIR/plugins"
    add_item "$PTAH_DIR/skills"
    add_item "$PTAH_DIR/templates"
    add_item "$PTAH_DIR/models"
  fi

  if [ "$INCLUDE_CLAUDE" -eq 1 ]; then
    add_item "$HOME/.claude"
  fi
}

assert_not_forbidden() {
  local path="$1"
  local base
  base="$(basename "$path")"
  if echo "$base" | grep -qE "$FORBIDDEN_PATTERNS"; then
    echo "REFUSING: '$path' matches the production never-touch guard." >&2
    exit 1
  fi
}

human_size() {
  local path="$1"
  if [ -e "$path" ]; then
    du -sh "$path" 2>/dev/null | cut -f1
  else
    echo "-"
  fi
}

# --- Running-process guard --------------------------------------------------
check_processes() {
  # A dry run moves nothing, so a live process cannot undo it.
  [ "$DRY_RUN" -eq 1 ] && return 0
  [ "$FORCE" -eq 1 ] && return 0

  local running=""
  if command -v tasklist >/dev/null 2>&1; then
    running="$(tasklist 2>/dev/null | grep -iE '^(ptah|electron)' || true)"
  elif command -v pgrep >/dev/null 2>&1; then
    running="$(pgrep -il 'ptah|electron' 2>/dev/null || true)"
  fi

  if [ -n "$running" ]; then
    echo "Ptah or Electron appears to be running:" >&2
    echo "$running" | head -5 >&2
    echo "" >&2
    echo "A live process rewrites these files on exit and will undo the move." >&2
    echo "Close every Ptah surface (Electron dev, installed Ptah, VS Code), then re-run." >&2
    echo "Override with --force if you are certain." >&2
    exit 1
  fi
}

# --- Modes ------------------------------------------------------------------
latest_backup() {
  ls -d "$HOME"/.ptah-backup-* 2>/dev/null | sort | tail -1
}

do_list() {
  local found=0
  for dir in "$HOME"/.ptah-backup-*; do
    [ -d "$dir" ] || continue
    found=1
    local count
    count="$(wc -l < "$dir/MANIFEST" 2>/dev/null | tr -d ' ' || echo 0)"
    printf '%s  %s items  %s\n' "$dir" "$count" "$(human_size "$dir")"
  done
  [ "$found" -eq 0 ] && echo "No backups found in $HOME"
  return 0
}

do_reset() {
  build_item_list
  check_processes

  local stamp backup_dir present=0 absent=0
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup_dir="$HOME/.ptah-backup-$stamp"

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY RUN — nothing will be moved."
  fi
  echo "Backup directory: $backup_dir"
  echo ""
  printf '%-6s %-8s %s\n' "STATUS" "SIZE" "SOURCE"

  local idx=0
  local plan=()
  for src in "${ITEMS[@]}"; do
    assert_not_forbidden "$src"
    if [ -e "$src" ]; then
      idx=$((idx + 1))
      present=$((present + 1))
      printf '%-6s %-8s %s\n' "move" "$(human_size "$src")" "$src"
      plan+=("$(printf '%03d\t%s' "$idx" "$src")")
    else
      absent=$((absent + 1))
      printf '%-6s %-8s %s\n' "skip" "-" "$src (absent)"
    fi
  done

  echo ""
  echo "$present to move, $absent absent."

  # Prove the guard is live rather than asserting it.
  echo ""
  echo "Guarded (never moved, confirmed present):"
  for f in "$PTAH_DIR/state/ptah.sqlite" "$PTAH_DIR/state/ptah.sqlite-wal"; do
    [ -e "$f" ] && printf '  %-8s %s\n' "$(human_size "$f")" "$f"
  done
  ls "$PTAH_DIR/state/" 2>/dev/null | grep -c 'pre-migration' | while read -r n; do
    [ "$n" -gt 0 ] && echo "  $n pre-migration snapshot(s) untouched"
  done

  if [ "$DRY_RUN" -eq 1 ]; then
    echo ""
    echo "Re-run with --reset to apply."
    return 0
  fi

  if [ "$present" -eq 0 ]; then
    echo "Nothing to move. Already reset?"
    return 0
  fi

  mkdir -p "$backup_dir/items"
  : > "$backup_dir/MANIFEST"

  for entry in "${plan[@]}"; do
    local slot src
    slot="${entry%%$'\t'*}"
    src="${entry#*$'\t'}"
    mv "$src" "$backup_dir/items/$slot"
    printf '%s\t%s\n' "$slot" "$src" >> "$backup_dir/MANIFEST"
  done

  echo ""
  echo "Moved $present item(s) to $backup_dir"
  echo "Restore with: $0 --restore latest"
}

do_restore() {
  local backup_dir
  if [ "$RESTORE_TARGET" = "latest" ]; then
    backup_dir="$(latest_backup)"
    [ -z "$backup_dir" ] && { echo "No backup found in $HOME" >&2; exit 1; }
  else
    backup_dir="${RESTORE_TARGET/#\~/$HOME}"
  fi

  [ -d "$backup_dir" ] || { echo "Not a directory: $backup_dir" >&2; exit 1; }
  [ -f "$backup_dir/MANIFEST" ] || { echo "No MANIFEST in $backup_dir" >&2; exit 1; }

  check_processes

  [ "$DRY_RUN" -eq 1 ] && echo "DRY RUN — nothing will be moved."
  echo "Restoring from: $backup_dir"
  echo ""
  printf '%-8s %s\n' "STATUS" "DESTINATION"

  local restored=0 blocked=0
  while IFS=$'\t' read -r slot dest; do
    [ -z "$slot" ] && continue
    local stored="$backup_dir/items/$slot"
    if [ ! -e "$stored" ]; then
      printf '%-8s %s\n' "missing" "$dest (slot $slot absent)"
      blocked=$((blocked + 1))
      continue
    fi
    if [ -e "$dest" ]; then
      printf '%-8s %s\n' "BLOCKED" "$dest (already exists)"
      blocked=$((blocked + 1))
      continue
    fi
    printf '%-8s %s\n' "restore" "$dest"
    if [ "$DRY_RUN" -eq 0 ]; then
      mkdir -p "$(dirname "$dest")"
      mv "$stored" "$dest"
      restored=$((restored + 1))
    fi
  done < "$backup_dir/MANIFEST"

  echo ""
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "Re-run without --dry-run to apply."
    return 0
  fi

  echo "Restored $restored item(s). $blocked blocked."
  if [ "$blocked" -eq 0 ]; then
    rm -rf "$backup_dir/items"
    rm -f "$backup_dir/MANIFEST"
    rmdir "$backup_dir" 2>/dev/null || true
    echo "Backup directory cleared."
  else
    echo "Backup kept at $backup_dir — resolve the blocked paths by hand."
  fi
}

case "$MODE" in
  reset)   do_reset ;;
  restore) do_restore ;;
  list)    do_list ;;
esac
