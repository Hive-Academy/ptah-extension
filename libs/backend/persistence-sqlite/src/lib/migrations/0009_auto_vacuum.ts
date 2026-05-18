/**
 * Migration 0009 — Enable incremental auto-vacuum.
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
 *
 * VACUUM INTO strategy
 * --------------------
 * The spec requires `VACUUM INTO` when auto_vacuum is currently NONE, because
 * plain `VACUUM` rewrites the DB file in-place:
 *   - Requires free disk space equal to the DB size (risk on small SSDs).
 *   - Holds a full write lock for the duration (seconds to minutes on large DBs).
 *   - On NTFS with journal=WAL, a crash mid-VACUUM can leave a partially-written
 *     file that SQLite cannot recover without the pre-migration backup.
 *
 * `VACUUM INTO '<dest>'` instead streams pages to a new file without touching
 * the original. We then atomically replace the original with the vacuumed copy
 * via `fs.renameSync`. If any step fails the original DB is untouched.
 *
 * When `dbPath` is not provided (test mode / :memory: path), we fall back to
 * plain `VACUUM` because there is no meaningful file to rename into.
 */
import * as fs from 'node:fs';
import type { SqliteDatabase } from '../sqlite-connection.service';

/** Numeric code SQLite returns for INCREMENTAL auto_vacuum mode. */
const INCREMENTAL_MODE = 2;

/**
 * Detects the current auto_vacuum mode and switches to INCREMENTAL if needed,
 * followed by VACUUM INTO (preferred) to rebuild the file. No-op when already
 * INCREMENTAL.
 *
 * Must be invoked OUTSIDE a transaction (called by the migration runner via
 * the `run` interface, never via the transactional `sql` interface).
 *
 * @param db - The open database handle.
 * @param dbPath - Absolute path to the database file. When provided (production),
 *   VACUUM INTO is used and the result atomically replaces the original. When
 *   omitted or set to ':memory:' (tests), falls back to plain VACUUM.
 */
export function run(db: SqliteDatabase, dbPath?: string): void {
  const currentMode = db.pragma('auto_vacuum', { simple: true }) as number;
  if (currentMode === INCREMENTAL_MODE) {
    return;
  }
  db.pragma('auto_vacuum = INCREMENTAL');
  const useVacuumInto = dbPath && dbPath !== ':memory:';

  if (useVacuumInto) {
    const vacuumedPath = dbPath + '.vacuumed';
    try {
      if (fs.existsSync(vacuumedPath)) {
        fs.unlinkSync(vacuumedPath);
      }
    } catch {
    }
    const escapedPath = vacuumedPath.replace(/'/g, "''");
    const vacuumSql = "VACUUM INTO '" + escapedPath + "'";
    db.exec(vacuumSql);
    fs.renameSync(vacuumedPath, dbPath);
  } else {
    db.exec('VACUUM');
  }
}
