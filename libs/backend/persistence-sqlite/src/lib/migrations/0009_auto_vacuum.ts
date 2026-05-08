/**
 * Migration 0009 — Enable incremental auto-vacuum.
 *
 * TASK_2026_THOTH_PERSISTENCE_HARDENING D9
 *
 * Prevents unbounded DB file growth by switching auto_vacuum from NONE to
 * INCREMENTAL mode. Because changing auto_vacuum requires a full page rewrite,
 * VACUUM must be executed immediately after setting the pragma — and VACUUM
 * cannot run inside a transaction. This migration therefore uses the `run(db)`
 * interface which executes outside any BEGIN/COMMIT boundary.
 *
 * auto_vacuum modes returned by `PRAGMA auto_vacuum`:
 *   0 = NONE        — no automatic reclaiming of free pages (default)
 *   1 = FULL        — reclaims on every commit (high overhead)
 *   2 = INCREMENTAL — reclaims on demand via `PRAGMA incremental_vacuum`
 *
 * Idempotent: if mode is already INCREMENTAL (2), the migration is a no-op.
 * If mode is FULL (1), also switches to INCREMENTAL to standardise behaviour.
 */
import type { SqliteDatabase } from '../sqlite-connection.service';

/** Numeric code SQLite returns for INCREMENTAL auto_vacuum mode. */
const INCREMENTAL_MODE = 2;

/**
 * Detects the current auto_vacuum mode and switches to INCREMENTAL if needed,
 * followed by VACUUM to rebuild the file in place. No-op when already
 * INCREMENTAL.
 *
 * Must be invoked OUTSIDE a transaction (called by the migration runner via
 * the `run` interface, never via the transactional `sql` interface).
 */
export function run(db: SqliteDatabase): void {
  const currentMode = db.pragma('auto_vacuum', { simple: true }) as number;
  if (currentMode === INCREMENTAL_MODE) {
    // Already INCREMENTAL — no-op. The runner will still record bookkeeping.
    return;
  }
  // Switch to INCREMENTAL then VACUUM to apply the mode change in-place.
  // VACUUM rewrites every page so the new auto_vacuum setting takes effect.
  db.pragma('auto_vacuum = INCREMENTAL');
  db.exec('VACUUM');
}
