/**
 * Shared types for db:health and db:reset RPC methods.
 *
 * Moved here so the inline registry shape in rpc.types.ts and the export in
 * persistence-rpc.handlers.ts resolve to the same compile-time identity.
 */

export type VecLoadReasonWire =
  | 'ok'
  | 'binary-missing'
  | 'load-failed'
  | 'extensions-disabled'
  | 'no-resolver'
  | 'not-attempted';

export interface VecLoadAttemptErrorWire {
  readonly strategy: string;
  readonly code?: string;
  readonly message: string;
}

export interface VecLoadDiagnosticWire {
  readonly ok: boolean;
  readonly reason: VecLoadReasonWire;
  readonly attemptedPath?: string;
  readonly packageName?: string;
  readonly fsExists?: boolean;
  readonly electronVersion: string;
  readonly processArch: string;
  readonly processPlatform: string;
  readonly error?: { code?: string; message: string };
  readonly errorChain?: readonly VecLoadAttemptErrorWire[];
}

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
  /**
   * Structured diagnostic for the most recent sqlite-vec load attempt.
   * Null when the connection is unavailable. Renderer-safe — PII-bearing
   * fields (raw stack, absolute paths beyond packageName) are not surfaced.
   */
  vecDiagnostic: VecLoadDiagnosticWire | null;
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

/**
 * Result shape returned by `db:reloadVec` — user-triggered retry of the
 * sqlite-vec extension load. The renderer surfaces this through the
 * Thoth DB Health "Retry vec" button so a user can attempt recovery
 * after fixing an AV quarantine, missing redistributable, or stale
 * native binding without restarting the app.
 */
export interface DbReloadVecResult {
  /** Whether vec is loaded after the retry attempt. */
  ok: boolean;
  /** Renderer-safe diagnostic snapshot after the attempt. */
  diagnostic: VecLoadDiagnosticWire;
  /** Human-readable summary safe to display in a toast. */
  message: string;
}

/**
 * Result shape returned by `db:openBindingFolder` — opens the native
 * binding directory in the platform file manager so the user can
 * inspect, replace, or unblock the sqlite-vec binary.
 */
export interface DbOpenBindingFolderResult {
  /** Whether the platform shell accepted the open request. */
  opened: boolean;
  /** Folder that was targeted (renderer-safe, basename only). */
  folder: string | null;
  /** Human-readable message safe to display in a toast. */
  message: string;
}

/**
 * Wire shape mirroring `EmbedderStatusSnapshot`. Read by the renderer
 * DB Health panel and emitted via `embedder:statusChanged` push events.
 */
export interface EmbedderStatusWire {
  /** Whether the embedder is warm and ready to embed. */
  readonly ready: boolean;
  /** True while the ONNX model is being downloaded or initialised. */
  readonly downloading: boolean;
  /** Optional download progress 0..1 — undefined when not downloading. */
  readonly progress?: number;
  /** Sanitised most-recent failure, if any. */
  readonly error?: { readonly code?: string; readonly message: string };
}

/** Params for `embedder:status` — empty, but kept for shape consistency. */
export type EmbedderStatusParams = Record<string, never>;

/** Result for `embedder:status`. */
export interface EmbedderStatusResult {
  readonly status: EmbedderStatusWire;
}

/** Params for `embedder:retry` — empty. */
export type EmbedderRetryParams = Record<string, never>;

/**
 * Result for `embedder:retry`. `ok` reflects the post-retry readiness;
 * `message` is renderer-safe for the toast.
 */
export interface EmbedderRetryResult {
  readonly ok: boolean;
  readonly status: EmbedderStatusWire;
  readonly message: string;
}
