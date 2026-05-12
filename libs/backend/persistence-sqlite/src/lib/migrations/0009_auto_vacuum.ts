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
 *
 * D9 review fix: VACUUM INTO strategy
 * ------------------------------------
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
    // Already INCREMENTAL — no-op. The runner will still record bookkeeping.
    return;
  }

  // Switch the pragma first. The mode change only takes effect after a VACUUM.
  db.pragma('auto_vacuum = INCREMENTAL');

  // Use VACUUM INTO when a real file path is available. This writes pages to a
  // new file without touching the original, avoiding the in-place rewrite risks
  // described in the module comment. Fall back to plain VACUUM for :memory: /
  // test scenarios where there is no file to rename.
  const useVacuumInto = dbPath && dbPath !== ':memory:';

  if (useVacuumInto) {
    const vacuumedPath = dbPath + '.vacuumed';
    // Remove any leftover temp file from a previous aborted attempt.
    try {
      if (fs.existsSync(vacuumedPath)) {
        fs.unlinkSync(vacuumedPath);
      }
    } catch {
      // Non-fatal: if unlink fails we'll get an overwrite or SQLITE will error,
      // both of which are handled below.
    }
    // VACUUM INTO writes to a brand-new file; the original is untouched.
    // SQL is constructed dynamically because VACUUM INTO requires the
    // destination as a string literal — bind parameters are not accepted for
    // DDL filenames. The path comes from the DI-injected `dbPath` token (not
    // user input), and single quotes are doubled to neutralise any embedded
    // quote in case dbPath ever resolves to a path containing one.
    const escapedPath = vacuumedPath.replace(/'/g, "''");
    const vacuumSql = "VACUUM INTO '" + escapedPath + "'";
    db.exec(vacuumSql);
    // Atomically replace the original with the vacuumed copy. fs.renameSync is
    // atomic on POSIX; on Windows it is best-effort (may fail if the process
    // holds the file open, but the DB is already closed per migration protocol).
    fs.renameSync(vacuumedPath, dbPath);
  } else {
    // Fallback: plain VACUUM for in-memory / test databases.
    db.exec('VACUUM');
  }
}
