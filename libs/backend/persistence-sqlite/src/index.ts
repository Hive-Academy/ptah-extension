/**
 * @ptah-extension/persistence-sqlite — public API.
 *
 * Owns the single shared `~/.ptah/ptah.db` SQLite connection and the
 * forward-only migration runner shared by memory-curator, skill-synthesis,
 * cron-scheduler, and messaging-gateway. Defines the `IEmbedder` contract
 * that those libraries consume; the implementation is registered by
 * memory-curator.
 */
export { SqliteConnectionService } from './lib/sqlite-connection.service';
export type {
  SqliteDatabase,
  SqliteStatement,
  SqliteDatabaseFactory,
  SqliteVecPathResolver,
} from './lib/sqlite-connection.service';

export type {
  VecLoadDiagnostic,
  VecLoadReason,
  VecLoadAttemptError,
} from './lib/vec-load-diagnostic';
export {
  resolveVecPackageName,
  resolveVecBinaryName,
} from './lib/vec-load-diagnostic';

export type { IBackupService, BackupKind } from './lib/backup.service';
export { SqliteBackupService } from './lib/backup.service';

export { VecStatusService } from './lib/vec-status.service';
export type {
  VecStatusSnapshot,
  VecStatusChangeListener,
  Disposable as VecStatusDisposable,
} from './lib/vec-status.service';

export { SqliteMigrationRunner } from './lib/migration-runner';
export type { MigrationRunResult } from './lib/migration-runner';

export { MIGRATIONS } from './lib/migrations';
export type { Migration } from './lib/migrations';

export type { IEmbedder } from './lib/embedder/embedder.interface';

export { PERSISTENCE_TOKENS } from './lib/di/tokens';
export type { PersistenceDIToken } from './lib/di/tokens';

export { registerPersistenceSqliteServices } from './lib/di/register';
