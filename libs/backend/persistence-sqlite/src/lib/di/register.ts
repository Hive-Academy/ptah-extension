/**
 * persistence-sqlite DI registration helper.
 *
 * Mirrors the contract of `registerSdkServices` in
 * `libs/backend/agent-sdk/src/lib/di/register.ts`: callers must already have
 * `TOKENS.LOGGER` registered (vscode-core / electron container Phase 1) plus
 * a `useValue` registration for `PERSISTENCE_TOKENS.SQLITE_DB_PATH` (set by
 * `phase-3-storage.ts` in the Electron host).
 *
 * Track 1 (memory-curator) is responsible for registering
 * `PERSISTENCE_TOKENS.EMBEDDER` later — this function deliberately does NOT
 * touch that token.
 */
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from './tokens';
import { SqliteConnectionService } from '../sqlite-connection.service';

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
 *    (Electron's `wire-runtime.ts` Phase 4.51 calls `openAndMigrate()`).
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
  logger.info('[persistence-sqlite] services registered', {
    tokens: Object.keys(PERSISTENCE_TOKENS),
  });
}
