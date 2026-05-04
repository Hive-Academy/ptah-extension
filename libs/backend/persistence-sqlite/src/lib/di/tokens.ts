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
} as const;

export type PersistenceDIToken = keyof typeof PERSISTENCE_TOKENS;
