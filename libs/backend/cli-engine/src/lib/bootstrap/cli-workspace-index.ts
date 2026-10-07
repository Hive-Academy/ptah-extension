import type { DependencyContainer } from 'tsyringe';

import type { Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IWorkspaceWatcher,
} from '@ptah-extension/platform-core';
import { MEMORY_CONTRACT_TOKENS } from '@ptah-extension/memory-contracts';
import type { ISymbolSink } from '@ptah-extension/memory-contracts';
import { CODE_SYMBOL_INDEXER } from '@ptah-extension/workspace-intelligence';
import type { CodeSymbolIndexer } from '@ptah-extension/workspace-intelligence';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import {
  WorkspaceIndexLifecycleService,
  workspaceSymbolIndexFrom,
} from '@ptah-extension/thoth-runtime';

/**
 * Open SQLite when this host has not already (thoth `'off'`), then start the
 * governed index. The open and `lifecycle.start()` run on a background
 * promise: this function returns a dispose handle before `openAndMigrate`
 * settles, and it does not await `indexWorkspace`. It does not start cron,
 * gateways, memory triggers, or skill synthesis.
 *
 * `dispose` before that background start finishes prevents `start()`.
 * Closes SQLite on dispose only when this call opened it.
 */
export function startWorkspaceIndexLifecycle(
  container: DependencyContainer,
  logger: Logger,
): { dispose(): void } {
  let disposed = false;
  let openedHere = false;
  let openFailureLogged = false;
  let connection: SqliteConnectionService | undefined;
  let handle: { dispose(): void } | null = null;

  const logOpenFailure = (error: unknown): void => {
    if (openFailureLogged) return;
    openFailureLogged = true;
    logger.warn('[CLI Thoth] Workspace index SQLite open failed (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  };

  const closeOpened = (): void => {
    if (!openedHere || !connection) return;
    openedHere = false;
    try {
      connection.close();
    } catch (error: unknown) {
      logger.warn(
        '[CLI Thoth] Workspace index SQLite close failed (non-fatal)',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  };

  const pending = (async (): Promise<void> => {
    const workspaceRoot = resolveWorkspaceRoot(container);
    if (
      disposed ||
      !workspaceRoot ||
      !container.isRegistered(CODE_SYMBOL_INDEXER) ||
      !container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    ) {
      return;
    }
    try {
      connection = container.resolve<SqliteConnectionService>(
        PERSISTENCE_TOKENS.SQLITE_CONNECTION,
      );
      if (!connection.isOpen) {
        await connection.openAndMigrate();
        openedHere = true;
      }
    } catch (error: unknown) {
      logOpenFailure(error);
      return;
    }
    if (disposed || !connection.isOpen) {
      closeOpened();
      return;
    }
    handle = attachWorkspaceIndex(container, workspaceRoot, logger);
    if (!handle) {
      closeOpened();
      return;
    }
    if (disposed) {
      handle.dispose();
      handle = null;
      closeOpened();
    }
  })();
  void pending.catch((error: unknown) => {
    logOpenFailure(error);
  });

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const current = handle;
      handle = null;
      current?.dispose();
      closeOpened();
    },
  };
}

/**
 * Governed background index. The watcher subscription is optional: both
 * adapters bind `IWorkspaceWatcher` only when a watch host was supplied, and
 * a missing watcher still gets the boot run. `start()` does not await the scan.
 */
export function attachWorkspaceIndex(
  container: DependencyContainer,
  workspaceRoot: string,
  logger: Logger,
): { dispose(): void } | null {
  try {
    const indexer = container.resolve<CodeSymbolIndexer>(CODE_SYMBOL_INDEXER);
    const watcher = container.isRegistered(PLATFORM_TOKENS.WORKSPACE_WATCHER)
      ? container.resolve<IWorkspaceWatcher>(PLATFORM_TOKENS.WORKSPACE_WATCHER)
      : undefined;
    const sink = container.isRegistered(MEMORY_CONTRACT_TOKENS.SYMBOL_SINK)
      ? container.resolve<ISymbolSink>(MEMORY_CONTRACT_TOKENS.SYMBOL_SINK)
      : undefined;
    const lifecycle = new WorkspaceIndexLifecycleService({
      indexer: workspaceSymbolIndexFrom(indexer, sink),
      watcher,
      workspaceRoot,
      databasePath: readSymbolDatabasePath(container),
      onError: (message, error) => {
        logger.warn(message, {
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
    lifecycle.start();
    return lifecycle;
  } catch (error: unknown) {
    logger.warn('[CLI Thoth] Workspace index lifecycle skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * The lifecycle has no container. `SqliteConnectionService.dbPath` is the
 * path the indexer already opens; persistence-sqlite is already a dependency
 * of this package. A resolve failure leaves the filter off.
 */
function readSymbolDatabasePath(
  container: DependencyContainer,
): string | undefined {
  try {
    if (!container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)) {
      return undefined;
    }
    return container.resolve<SqliteConnectionService>(
      PERSISTENCE_TOKENS.SQLITE_CONNECTION,
    ).dbPath;
  } catch {
    return undefined;
  }
}

export function resolveWorkspaceRoot(
  container: DependencyContainer,
): string | undefined {
  try {
    const workspaceProvider = container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    return workspaceProvider.getWorkspaceRoot();
  } catch {
    return undefined;
  }
}
