/**
 * Copy sessions from the per-workspace stores into the global session store
 * (Plane PTAH-35, MP-1), once workspace restore has registered every folder.
 *
 * Every folder under `<userData>/workspace-storage` is a source, registered or
 * not, so sessions of a project that is no longer open are not lost. A folder
 * with a live store is read through that instance, never a second worker on
 * the same folder. Any other v2 store is opened without migrations, which
 * only reads. A v1-only store is read straight from its JSON file. Nothing is
 * written to any of them; the previous build keeps working on them.
 */

import { existsSync, promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { DependencyContainer } from 'tsyringe';
import {
  LegacySessionStoreMigrator,
  openReadOnlyJsonStateFile,
  type LegacySessionSource,
} from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
  type ISessionBlobStore,
  type ISessionRecordRepository,
  type IStateStorage,
} from '@ptah-extension/platform-core';
import { ElectronStateStorage } from '@ptah-extension/platform-electron';
import type { SessionStoreGate } from '@ptah-extension/persistence-sqlite';
import {
  TURN_CHANGE_SETS_BLOB,
  TURN_CHANGE_SETS_KEY_PREFIX,
} from '@ptah-extension/rpc-handlers';
import type { Logger } from '@ptah-extension/vscode-core';

const LEGACY_FILE = 'workspace-state.json';
const V2_POINTER = path.join('workspace-state.v2', 'CURRENT');

export interface LiveWorkspaceStorage {
  getDefaultStorage(): IStateStorage;
  getStorageForWorkspace(workspacePath: string): IStateStorage | undefined;
}

export interface CollectedLegacySources {
  readonly sources: LegacySessionSource[];
  /** Close the read-only stores opened for this run. */
  release(): Promise<void>;
}

export async function collectLegacySessionSources(options: {
  workspaceStorageRoot: string;
  liveStorage: LiveWorkspaceStorage;
  openReadOnlyV2: (
    dir: string,
  ) => Promise<{ storage: IStateStorage; dispose: () => Promise<void> }>;
  logger?: Pick<Logger, 'warn'>;
}): Promise<CollectedLegacySources> {
  const sources: LegacySessionSource[] = [];
  const opened: Array<() => Promise<void>> = [];
  // No workspace storage yet: nothing to copy.
  const entries = existsSync(options.workspaceStorageRoot)
    ? (await fsp.readdir(options.workspaceStorageRoot, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
    : [];

  for (const name of entries) {
    const dir = path.join(options.workspaceStorageRoot, name);
    const live =
      name === 'default'
        ? options.liveStorage.getDefaultStorage()
        : options.liveStorage.getStorageForWorkspace(
            Buffer.from(name, 'base64url').toString('utf8'),
          );
    // One unreadable store must not stop the copy of every other project.
    try {
      if (live) {
        sources.push({ sourcePath: dir, storage: live });
      } else if (existsSync(path.join(dir, V2_POINTER))) {
        const store = await options.openReadOnlyV2(dir);
        opened.push(store.dispose);
        sources.push({ sourcePath: dir, storage: store.storage });
      } else if (existsSync(path.join(dir, LEGACY_FILE))) {
        sources.push({
          sourcePath: dir,
          storage: await openReadOnlyJsonStateFile(path.join(dir, LEGACY_FILE)),
        });
      }
    } catch (error: unknown) {
      options.logger?.warn(
        '[Electron] Skipped an unreadable legacy session store',
        {
          sourcePath: dir,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  return {
    sources,
    // A store that fails to close must not keep the others open.
    release: async () => {
      await Promise.allSettled(opened.map((dispose) => dispose()));
    },
  };
}

/**
 * Run the copy-forward and open the session store gate, whatever happens.
 * Started after workspace restore; not awaited by boot.
 */
export async function runSessionStoreMigration(
  container: DependencyContainer,
  options: {
    userDataPath: string;
    stateStorageWorkerPath?: string;
    liveStorage: LiveWorkspaceStorage;
    logger: Logger;
  },
): Promise<void> {
  const { logger } = options;
  const gate = container.isRegistered(PLATFORM_TOKENS.SESSION_STORE_GATE)
    ? container.resolve<SessionStoreGate>(PLATFORM_TOKENS.SESSION_STORE_GATE)
    : null;
  if (!gate) return;
  let release: (() => Promise<void>) | null = null;
  try {
    const collected = await collectLegacySessionSources({
      workspaceStorageRoot: path.join(
        options.userDataPath,
        'workspace-storage',
      ),
      liveStorage: options.liveStorage,
      openReadOnlyV2: async (dir) => {
        const storage = new ElectronStateStorage(
          dir,
          LEGACY_FILE,
          options.stateStorageWorkerPath
            ? { workerPath: options.stateStorageWorkerPath }
            : undefined,
        );
        try {
          await storage.whenReady();
        } catch (error: unknown) {
          await storage.dispose().catch(() => undefined);
          throw error;
        }
        return { storage, dispose: () => storage.dispose() };
      },
      logger,
    });
    release = collected.release;
    const migrator = new LegacySessionStoreMigrator(
      container.resolve<ISessionRecordRepository>(
        PLATFORM_TOKENS.SESSION_RECORD_REPOSITORY,
      ),
      container.resolve<ISessionBlobStore>(PLATFORM_TOKENS.SESSION_BLOB_STORE),
      logger,
      [
        {
          keyPrefix: TURN_CHANGE_SETS_KEY_PREFIX,
          blobName: TURN_CHANGE_SETS_BLOB,
        },
      ],
    );
    const result = await migrator.migrate(collected.sources);
    logger.info('[Electron] Session store copy-forward finished', result);
  } catch (error: unknown) {
    logger.warn('[Electron] Session store copy-forward failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await release?.();
    gate.markReady();
  }
}
