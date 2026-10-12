import type { DependencyContainer } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  type SessionRecordHost,
} from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { FileSessionBlobStore } from './file-session-blob-store';
import {
  resolveSessionBlobRoot,
  resolveSessionStoreDbPath,
} from './session-store-db-path';
import { SessionStoreDatabase } from './session-store-database';
import { SessionStoreGate } from './session-store-gate';
import { SqliteSessionRecordRepository } from './sqlite-session-record-repository';

export interface RegisteredSessionStore {
  readonly database: SessionStoreDatabase;
  readonly repository: SqliteSessionRecordRepository;
  readonly blobs: FileSessionBlobStore;
  /** Mark ready once the host's legacy copy-forward has run. */
  readonly gate: SessionStoreGate;
}

/**
 * Bind the session store ports (PTAH-35). Call it early, before anything
 * resolves the session metadata store: unlike ptah.sqlite, sessions are read
 * and written from the first seconds of boot. The file opens on first use.
 * Session reads wait on the returned gate until the host releases it.
 */
export function registerSessionStoreServices(
  container: DependencyContainer,
  logger: Logger,
  options: { host: SessionRecordHost; isDev?: boolean; dbPath?: string },
): RegisteredSessionStore {
  const dbPath =
    options.dbPath ?? resolveSessionStoreDbPath({ isDev: options.isDev });
  const database = new SessionStoreDatabase(dbPath, logger);
  const repository = new SqliteSessionRecordRepository(database, options.host);
  const blobs = new FileSessionBlobStore(resolveSessionBlobRoot(dbPath));
  const gate = new SessionStoreGate(logger);
  container.register(PLATFORM_TOKENS.SESSION_RECORD_REPOSITORY, {
    useValue: repository,
  });
  container.register(PLATFORM_TOKENS.SESSION_BLOB_STORE, { useValue: blobs });
  container.register(PLATFORM_TOKENS.SESSION_STORE_GATE, { useValue: gate });
  logger.info('[persistence-sqlite] session store registered', {
    dbPath,
    host: options.host,
  });
  return { database, repository, blobs, gate };
}
