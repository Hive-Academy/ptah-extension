/**
 * Shared types for db:health and db:reset RPC methods.
 *
 * Moved here so the inline registry shape in rpc.types.ts and the export in
 * persistence-rpc.handlers.ts resolve to the same compile-time identity.
 */

/**
 * Shape returned by `db:health`. All nullable fields are null when the
 * connection is unavailable so the UI can render an offline badge without
 * special-casing every property individually.
 */
export interface DbHealthResult {
  /** Whether the SQLite connection is currently open. */
  isOpen: boolean;
  /** Result of PRAGMA quick_check. Null if connection is closed. */
  quickCheckPassed: boolean | null;
  /** Count of foreign-key violations. Null if connection is closed. */
  foreignKeyViolations: number | null;
  /** Sample of FK-violation rows (up to 3). Empty when none. */
  foreignKeyViolationSample: Array<{
    table: string;
    rowid: number;
    parent: string;
    fkid: number;
  }>;
  /** DB file size in megabytes. Null if connection is closed. */
  dbSizeMb: number | null;
  /** Ratio of freelist pages to total pages (0.0–1.0). Null if closed. */
  freelistRatio: number | null;
  /** WAL file size in kilobytes. Null if closed or WAL absent. */
  walSizeKb: number | null;
  /** Whether the sqlite-vec extension was successfully loaded. */
  vecExtensionLoaded: boolean;
  /** Highest migration version applied (PRAGMA user_version). 0 if none. */
  lastMigrationVersion: number;
  /** True when `fullCheck=true` was requested and integrity_check ran. */
  fullCheckRun: boolean;
  /** integrity_check result. Null unless fullCheckRun=true. */
  integrityCheckPassed: boolean | null;
}

/**
 * Result shape returned by `db:reset`.
 */
export interface DbResetResult {
  /**
   * Basename of the backup file taken before reset.
   * Null if backup failed or was not taken.
   */
  backupPath: string | null;
  /** True if the 5-step reset workflow succeeded. */
  success: boolean;
  /** Human-readable message suitable for a notification. */
  message: string;
}
