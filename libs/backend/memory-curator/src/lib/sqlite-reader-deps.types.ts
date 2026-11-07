/**
 * Narrow collaborator surfaces for the SQLite-backed memory stores.
 *
 * `MemoryStore`, `ObservationQueueStore`, `MemorySearchService` and
 * `CodeSymbolStore` only use these members of their injected collaborators.
 * Typing the constructor parameters this way lets the search utility process
 * (`search-worker.ts`) pass its own read-only implementations without casts,
 * while tsyringe still injects the concrete `SqliteConnectionService`,
 * `VecStatusService` and `Logger` under the unchanged tokens.
 */
import type { Logger } from '@ptah-extension/vscode-core';
import type { SqliteDatabase } from '@ptah-extension/persistence-sqlite';

/** The connection surface the memory stores read and write through. */
export interface SqliteDbProvider {
  readonly db: SqliteDatabase;
  readonly vecExtensionLoaded: boolean;
  /** Classifies a failed write; returns whether the connection is now unavailable. */
  handleFatalWriteError(error: unknown): boolean;
}

/** Whether sqlite-vec is loaded on the connection the stores use. */
export interface VecAvailability {
  readonly available: boolean;
}

/** The logging methods the memory stores call. */
export type CuratorLogger = Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>;
