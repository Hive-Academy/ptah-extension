import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  AGENT_GENERATION_TOKENS,
  type UserLayerMirrorService,
} from '@ptah-extension/agent-generation';
import type {
  SkillRepropagationKind,
  SkillRepropagationPort,
} from '@ptah-extension/skill-synthesis';

export class CliSkillRepropagation implements SkillRepropagationPort {
  constructor(private readonly container: DependencyContainer) {}

  async repropagate(
    kind: SkillRepropagationKind,
    slug: string,
    workspaceRoot: string,
  ): Promise<void> {
    const logger = this.resolveLogger();
    if (kind === 'agent') {
      logger?.debug(
        '[CliSkillRepropagation] agent kind has no junction surface in CLI (no-op)',
        { slug, workspaceRoot },
      );
      return;
    }
    try {
      await this.repropagateClis(workspaceRoot);
      logger?.debug('[CliSkillRepropagation] Re-propagated enhanced clone', {
        kind,
        slug,
        workspaceRoot,
      });
    } catch (error: unknown) {
      logger?.warn(
        '[CliSkillRepropagation] Re-propagation failed (non-fatal)',
        {
          kind,
          slug,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private async repropagateClis(workspaceRoot: string): Promise<void> {
    const cliPluginSync = this.container.resolve(
      TOKENS.CLI_PLUGIN_SYNC_SERVICE,
    ) as {
      initialize: (globalState: IStateStorage) => void;
      syncForce: (
        sources: { skillsRoot: string; commandsRoot: string },
        workspaceRoot: string | undefined,
      ) => Promise<unknown[]>;
    };

    const globalState = this.container.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );
    cliPluginSync.initialize(globalState);

    const mirror = this.container.resolve<UserLayerMirrorService>(
      AGENT_GENERATION_TOKENS.USER_LAYER_MIRROR_SERVICE,
    );
    const roots = mirror.getUserLayerRoots();

    await cliPluginSync.syncForce(
      { skillsRoot: roots.skills, commandsRoot: roots.commands },
      workspaceRoot,
    );
  }

  private resolveLogger(): Logger | null {
    try {
      return this.container.resolve<Logger>(TOKENS.LOGGER);
    } catch {
      return null;
    }
  }
}
