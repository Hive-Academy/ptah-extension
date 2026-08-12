/**
 * Error predicates for the shared better-sqlite3 connection.
 *
 * This lives here rather than beside the first store that needed it because
 * "did SQLite reject that INSERT for a UNIQUE violation?" is a property of the
 * driver, not of cron, and a second lib now needs the same answer. Keeping the
 * predicate in `cron-scheduler` would have forced `skill-synthesis` to depend
 * on `cron-scheduler` to ask a question about SQLite — a dependency edge with
 * no meaning behind it. Both libs already depend on `persistence-sqlite`.
 */

/**
 * better-sqlite3 surfaces UNIQUE constraint violations with
 * `err.code === 'SQLITE_CONSTRAINT_UNIQUE'`. We deliberately match *only*
 * that code — every other error must propagate.
 *
 * Callers use this to implement at-most-once claims: the INSERT *is* the
 * claim, and a UNIQUE violation means another worker already took the slot.
 * That is success-by-other-worker, not failure — and it is why there is no
 * `INSERT OR IGNORE` and no UPSERT anywhere on those paths. Both would swallow
 * the collision and hand back a row the caller has no right to act on.
 */
export function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE';
}
