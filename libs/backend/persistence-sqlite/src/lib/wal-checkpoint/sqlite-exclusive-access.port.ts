/**
 * Exclusive access to the database FILE, for work that closes the shared
 * connection and renames or replaces the file (`db:reset`).
 *
 * While a lease is held, nothing this lib owns opens the file from another
 * process: the WAL checkpoint worker finishes or is killed, and no new
 * checkpoint starts until `release()`. On Windows an open handle in another
 * process makes the rename fail (review-11 finding 1).
 *
 * Bound to `PERSISTENCE_TOKENS.SQLITE_EXCLUSIVE_ACCESS`. A host without a
 * checkpoint worker gets a pause that resolves at once.
 */
export interface SqliteExclusiveAccessLease {
  /** End the pause. Idempotent. Call it only after reopen and migrations. */
  release(): void;
}

export interface ISqliteExclusiveAccess {
  /** Resolves once no checkpoint is running. Never rejects. */
  pauseForExclusiveAccess(): Promise<SqliteExclusiveAccessLease>;
}
