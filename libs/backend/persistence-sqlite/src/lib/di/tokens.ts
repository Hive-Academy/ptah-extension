/**
 * DI Token Registry — Persistence (SQLite) Tokens
 *
 * Convention mirrors `libs/backend/agent-sdk/src/lib/di/tokens.ts`:
 * - Always `Symbol.for('Name')` (globally interned) — never plain `Symbol()`
 *   or string literals.
 * - Each description is globally unique across all token files.
 * - Frozen `as const` so consumer types narrow on the symbol values.
 */
export const PERSISTENCE_TOKENS = {
  /** SqliteConnectionService — owns the single ~/.ptah/ptah.db handle. */
  SQLITE_CONNECTION: Symbol.for('PtahSqliteConnection'),
  /** SqliteMigrationRunner — applies numbered SQL migrations on open. */
  SQLITE_MIGRATION_RUNNER: Symbol.for('PtahSqliteMigrationRunner'),
  /** Absolute path to the SQLite DB file (useValue: string). */
  SQLITE_DB_PATH: Symbol.for('PtahSqliteDbPath'),
  /** IEmbedder implementation — registered by memory-curator at runtime. */
  EMBEDDER: Symbol.for('PtahEmbedder'),
  /** Absolute path to the embedder worker entry (useValue: string). */
  EMBEDDER_WORKER_PATH: Symbol.for('PtahEmbedderWorkerPath'),
  /**
   * Absolute path to a writable directory for the `@huggingface/transformers`
   * model cache (useValue: string). Must live outside `app.asar` — the
   * library's default `<pkg>/.cache` resolves inside the asar archive (a file)
   * and fails with `ENOTDIR` when packaged. Optional; when unset the worker
   * falls back to the library default.
   */
  EMBEDDER_MODEL_CACHE_DIR: Symbol.for('PtahEmbedderModelCacheDir'),
  /**
   * IIntegrityWorkerProcessFactory — host-implemented spawner for the
   * out-of-band integrity worker. Injected `{ isOptional: true }`: a host that
   * registers none simply never runs an integrity check (VS Code registers no
   * SQLITE_CONNECTION at all, so it has no database to check).
   */
  INTEGRITY_WORKER_PROCESS_FACTORY: Symbol.for(
    'PtahIntegrityWorkerProcessFactory',
  ),
  /**
   * Absolute path to the integrity worker entry (useValue: string). Read by the
   * HOST's factory, not by this lib — the token lives here beside
   * EMBEDDER_WORKER_PATH so both worker paths are registered the same way.
   */
  INTEGRITY_WORKER_PATH: Symbol.for('PtahIntegrityWorkerPath'),
  /** SqliteIntegrityService — owns the due-decision and the worker dispatch. */
  SQLITE_INTEGRITY_SERVICE: Symbol.for('PtahSqliteIntegrityService'),
  /** IBackupService — SQLite backup + rotation. */
  BACKUP_SERVICE: Symbol.for('PtahBackupService'),
  /** VecStatusService — single source of truth for sqlite-vec availability. */
  VEC_STATUS: Symbol.for('PtahVecStatus'),
} as const;

export type PersistenceDIToken = keyof typeof PERSISTENCE_TOKENS;
