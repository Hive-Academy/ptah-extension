// Steps 7.1.5 + 7.1.5.1 plugin loader + skill junction activation.
// Extracted from wire-runtime.ts to keep that file within its line budget.
// Mirrors the Electron sibling (apps/ptah-electron/src/activation/plugin-activation.ts).

import type { Logger } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  PluginLoaderService,
  SkillJunctionService,
} from '@ptah-extension/agent-sdk';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { DIContainer } from '../di/container';

/** Step 7.1.5: initialize plugin loader with extension path (TASK_2025_153). Non-fatal. */
export function initPluginLoader(pluginsPath: string, logger: Logger): void {
  try {
    const pluginLoader = DIContainer.resolve<PluginLoaderService>(
      SDK_TOKENS.SDK_PLUGIN_LOADER,
    );
    // TASK_2025_199: Resolve IStateStorage from DI container instead of passing
    // raw context.workspaceState (vscode.Memento). The VscodeStateStorage wrapper
    // is registered as PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE in Phase 0.5.
    const workspaceStateStorage = DIContainer.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
    );
    pluginLoader.initialize(pluginsPath, workspaceStateStorage);
    logger.info('Plugin loader initialized');
  } catch (pluginLoaderError) {
    logger.warn('Plugin loader initialization failed', {
      error:
        pluginLoaderError instanceof Error
          ? pluginLoaderError.message
          : String(pluginLoaderError),
    });
  }
}

/**
 * Step 7.1.5.1: create workspace skill junctions (TASK_2025_201).
 * Project skill files from extension assets into workspace .ptah/skills/ via junctions
 * So third-party providers (Copilot, Codex) can find skills via MCP workspace search.
 * Non-fatal on failure.
 */
export function activateSkillJunctions(
  pluginsPath: string,
  logger: Logger,
): void {
  try {
    const skillJunction = DIContainer.resolve<SkillJunctionService>(
      SDK_TOKENS.SDK_SKILL_JUNCTION,
    );
    skillJunction.initialize(pluginsPath);

    // Reuse the same pluginLoader singleton resolved in Step 7.1.5
    const junctionPluginLoader = DIContainer.resolve<PluginLoaderService>(
      SDK_TOKENS.SDK_PLUGIN_LOADER,
    );
    const junctionPluginConfig =
      junctionPluginLoader.getWorkspacePluginConfig();
    const junctionPluginPaths = junctionPluginLoader.resolvePluginPaths(
      junctionPluginConfig.enabledPluginIds,
    );

    // Always call activate() even with zero plugins, so the workspace change
    // subscription is registered for future plugin enablement
    const junctionResult = skillJunction.activate({
      pluginPaths: junctionPluginPaths,
      disabledSkillIds: junctionPluginConfig.disabledSkillIds,
      getPluginPaths: () => junctionPluginLoader.resolveCurrentPluginPaths(),
      getDisabledSkillIds: () => junctionPluginLoader.getDisabledSkillIds(),
    });
    if (junctionResult.created > 0 || junctionResult.errors.length > 0) {
      logger.info('Skill junctions created', {
        created: junctionResult.created,
        skipped: junctionResult.skipped,
        removed: junctionResult.removed,
        errors:
          junctionResult.errors.length > 0 ? junctionResult.errors : undefined,
      });
    }
  } catch (skillJunctionError) {
    logger.warn('Skill junction creation failed (non-blocking)', {
      error:
        skillJunctionError instanceof Error
          ? skillJunctionError.message
          : String(skillJunctionError),
    });
  }
}
