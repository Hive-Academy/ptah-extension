import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import {
  AGENT_GENERATION_TOKENS,
  type UserLayerMirrorService,
} from '@ptah-extension/agent-generation';
import { DIContainer } from '../di/container';

/**
 * Propagate user-layer skills/commands to installed rival CLIs at the
 * WORKSPACE level. Source = ~/.ptah/user/; skipped entirely when no workspace
 * is open. Fire-and-forget, non-fatal.
 */
export function syncCliSkillsOnActivation(
  workspaceRoot: string | undefined,
  logger: Logger,
): void {
  try {
    const cliPluginSync = DIContainer.getContainer().resolve(
      TOKENS.CLI_PLUGIN_SYNC_SERVICE,
    ) as {
      initialize: (globalState: IStateStorage) => void;
      syncOnActivation: (
        sources: { skillsRoot: string; commandsRoot: string },
        workspaceRoot: string | undefined,
      ) => Promise<unknown[]>;
    };

    const globalStateStorage = DIContainer.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );
    cliPluginSync.initialize(globalStateStorage);

    const mirror = DIContainer.getContainer().resolve<UserLayerMirrorService>(
      AGENT_GENERATION_TOKENS.USER_LAYER_MIRROR_SERVICE,
    );
    const roots = mirror.getUserLayerRoots();

    cliPluginSync
      .syncOnActivation(
        { skillsRoot: roots.skills, commandsRoot: roots.commands },
        workspaceRoot,
      )
      .then((results) => {
        logger.info('CLI skill sync complete', { results: results.length });
      })
      .catch((syncError) => {
        logger.debug('CLI skill sync failed (non-blocking)', {
          error:
            syncError instanceof Error ? syncError.message : String(syncError),
        });
      });
  } catch (cliSyncError) {
    logger.debug('CLI skill sync setup failed (non-blocking)', {
      error:
        cliSyncError instanceof Error
          ? cliSyncError.message
          : String(cliSyncError),
    });
  }
}
