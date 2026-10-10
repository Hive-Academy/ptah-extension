/**
 * Copy the CLI's per-workspace session stores into the global session store
 * (Plane PTAH-35, MP-1). Each workspace the CLI ever ran in has a plain JSON
 * store at `<userData>/workspaces/<hash>/workspace-state.json`; all of them
 * are read, none is written.
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
} from '@ptah-extension/platform-core';
import type { SessionStoreGate } from '@ptah-extension/persistence-sqlite';
import {
  TURN_CHANGE_SETS_BLOB,
  TURN_CHANGE_SETS_KEY_PREFIX,
} from '@ptah-extension/rpc-handlers';
import type { Logger } from '@ptah-extension/vscode-core';

export async function collectCliSessionSources(
  workspacesRoot: string,
): Promise<LegacySessionSource[]> {
  if (!existsSync(workspacesRoot)) return [];
  const names = (await fsp.readdir(workspacesRoot, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const sources: LegacySessionSource[] = [];
  for (const name of names) {
    const dir = path.join(workspacesRoot, name);
    try {
      sources.push({
        sourcePath: dir,
        storage: await openReadOnlyJsonStateFile(
          path.join(dir, 'workspace-state.json'),
        ),
      });
    } catch {
      // No store, or one that cannot be parsed: nothing to copy from it.
    }
  }
  return sources;
}

/** Run the copy-forward and open the session store gate, whatever happens. */
export async function runCliSessionStoreMigration(
  container: DependencyContainer,
  options: { userDataPath: string; logger: Logger },
): Promise<void> {
  if (!container.isRegistered(PLATFORM_TOKENS.SESSION_STORE_GATE)) return;
  const gate = container.resolve<SessionStoreGate>(
    PLATFORM_TOKENS.SESSION_STORE_GATE,
  );
  try {
    const migrator = new LegacySessionStoreMigrator(
      container.resolve<ISessionRecordRepository>(
        PLATFORM_TOKENS.SESSION_RECORD_REPOSITORY,
      ),
      container.resolve<ISessionBlobStore>(PLATFORM_TOKENS.SESSION_BLOB_STORE),
      options.logger,
      [
        {
          keyPrefix: TURN_CHANGE_SETS_KEY_PREFIX,
          blobName: TURN_CHANGE_SETS_BLOB,
        },
      ],
    );
    const result = await migrator.migrate(
      await collectCliSessionSources(
        path.join(options.userDataPath, 'workspaces'),
      ),
    );
    options.logger.info('[CLI] Session store copy-forward finished', result);
  } catch (error: unknown) {
    options.logger.warn('[CLI] Session store copy-forward failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    gate.markReady();
  }
}
