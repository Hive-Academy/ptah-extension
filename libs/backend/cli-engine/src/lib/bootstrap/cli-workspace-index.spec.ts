import 'reflect-metadata';
import type { DependencyContainer } from 'tsyringe';

import type { Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { CODE_SYMBOL_INDEXER } from '@ptah-extension/workspace-intelligence';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';

import { startWorkspaceIndexLifecycle } from './cli-workspace-index';

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

describe('startWorkspaceIndexLifecycle', () => {
  function harness() {
    let resolveOpen: (() => void) | undefined;
    const connection = {
      isOpen: false,
      dbPath: 'D:/ws/.ptah/ptah.sqlite',
      openAndMigrate: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveOpen = () => {
              connection.isOpen = true;
              resolve();
            };
          }),
      ),
      close: jest.fn(() => {
        connection.isOpen = false;
      }),
    };
    const indexer = {
      indexWorkspace: jest.fn().mockResolvedValue(undefined),
      reindexFile: jest.fn().mockResolvedValue(undefined),
    };
    const registrations = new Map<unknown, unknown>([
      [PLATFORM_TOKENS.WORKSPACE_PROVIDER, { getWorkspaceRoot: () => 'D:/ws' }],
      [CODE_SYMBOL_INDEXER, indexer],
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, connection],
    ]);
    const container = {
      isRegistered: (token: unknown) => registrations.has(token),
      resolve: (token: unknown) => {
        if (!registrations.has(token)) {
          throw new Error(`not registered: ${String(token)}`);
        }
        return registrations.get(token);
      },
    } as unknown as DependencyContainer;
    const logger = { warn: jest.fn(), error: jest.fn() } as unknown as Logger;
    return {
      connection,
      indexer,
      container,
      logger,
      resolveOpen: () => resolveOpen,
    };
  }

  it('returns before openAndMigrate settles, and dispose before settle never starts', async () => {
    const { connection, indexer, container, logger, resolveOpen } = harness();

    const handle = startWorkspaceIndexLifecycle(container, logger);

    expect(connection.openAndMigrate).toHaveBeenCalledTimes(1);
    expect(indexer.indexWorkspace).not.toHaveBeenCalled();

    handle.dispose();
    resolveOpen()?.();
    await flush();
    await flush();

    expect(indexer.indexWorkspace).not.toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs an open failure once and still returns before the caller continues', async () => {
    const { connection, indexer, container, logger } = harness();
    connection.openAndMigrate.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          setImmediate(() => {
            reject(new Error('migrate failed'));
          });
        }),
    );
    const handle = startWorkspaceIndexLifecycle(container, logger);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(indexer.indexWorkspace).not.toHaveBeenCalled();

    await flush();
    await flush();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[CLI Thoth] Workspace index SQLite open failed (non-fatal)',
      { error: 'migrate failed' },
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(indexer.indexWorkspace).not.toHaveBeenCalled();
    expect(connection.close).not.toHaveBeenCalled();
    handle.dispose();
    expect(indexer.indexWorkspace).not.toHaveBeenCalled();
  });
});
