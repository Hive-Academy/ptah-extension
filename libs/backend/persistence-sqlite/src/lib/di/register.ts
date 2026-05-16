/**
 * persistence-sqlite DI registration helper.
 *
 * Mirrors the contract of `registerSdkServices` in
 * `libs/backend/agent-sdk/src/lib/di/register.ts`: callers must already have
 * `TOKENS.LOGGER` registered plus a `useValue` registration for
 * `PERSISTENCE_TOKENS.SQLITE_DB_PATH`.
 *
 * `memory-curator` is responsible for registering
 * `PERSISTENCE_TOKENS.EMBEDDER` later — this function deliberately does NOT
 * touch that token.
 */
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from './tokens';
import { SqliteConnectionService } from '../sqlite-connection.service';
import { SqliteBackupService } from '../backup.service';

/**
 * Register persistence-sqlite services in the supplied container.
 *
 * Pre-conditions:
 *  - `TOKENS.LOGGER` is registered.
 *  - `PERSISTENCE_TOKENS.SQLITE_DB_PATH` is registered with `useValue: string`.
 *
 * Post-conditions:
 *  - `PERSISTENCE_TOKENS.SQLITE_CONNECTION` resolves to a singleton
 *    `SqliteConnectionService`. The connection itself is opened lazily
 *    via a later `openAndMigrate()` call by the host.
 */
export function registerPersistenceSqliteServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[persistence-sqlite] registering services');
  container.registerSingleton(
    PERSISTENCE_TOKENS.SQLITE_CONNECTION,
    SqliteConnectionService,
  );
  container.registerSingleton(
    PERSISTENCE_TOKENS.BACKUP_SERVICE,
    SqliteBackupService,
  );
  // Wire the backup service into the connection service after both singletons
  // are registered. tsyringe 4.x does not provide @optional(), so we post-wire
  // via setBackupService() to avoid a constructor circular dependency.
  const connection = container.resolve<SqliteConnectionService>(
    PERSISTENCE_TOKENS.SQLITE_CONNECTION,
  );
  const backup = container.resolve<SqliteBackupService>(
    PERSISTENCE_TOKENS.BACKUP_SERVICE,
  );
  connection.setBackupService(backup);
  logger.info('[persistence-sqlite] services registered', {
    tokens: Object.keys(PERSISTENCE_TOKENS),
  });
}
