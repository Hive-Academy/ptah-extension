// Phase 4.55 + 4.56 plugin loader + skill junction activation.

import * as os from 'os';
import * as path from 'path';
import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import {
  SDK_TOKENS,
  type PluginLoaderService,
  type SkillJunctionService,
} from '@ptah-extension/agent-sdk';

/** Phase 4.55: initialize plugin loader. Non-fatal on failure. */
export function initPluginLoader(
  container: DependencyContainer,
  pluginsPath: string,
): void {
  try {
    const pluginLoader = container.resolve<PluginLoaderService>(
      SDK_TOKENS.SDK_PLUGIN_LOADER,
    );
    const workspaceStateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
    );
    pluginLoader.initialize(pluginsPath, workspaceStateStorage);

    const pluginConfig = pluginLoader.getWorkspacePluginConfig();
    const pluginPaths = pluginLoader.resolvePluginPaths(
      pluginConfig.enabledPluginIds,
    );

    // Command discovery reads from .claude/commands/ and .claude/skills/
    // (junctioned by SkillJunctionService) — no plugin path wiring needed.
    console.log(
      `[Ptah Electron] Plugin loader initialized (${pluginPaths.length} plugin paths)`,
    );
  } catch (error) {
    console.warn(
      '[Ptah Electron] Plugin loader initialization failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Phase 4.56: activate skill junctions and return the service handle so the
 * caller can deactivate it during will-quit. Non-fatal on failure.
 */
export function activateSkillJunctions(
  container: DependencyContainer,
  pluginsPath: string,
): { deactivateSync: () => void } | null {
  try {
    const skillJunction = container.resolve<SkillJunctionService>(
      SDK_TOKENS.SDK_SKILL_JUNCTION,
    );
    const synthesizedSkillsRoot = path.join(os.homedir(), '.ptah', 'skills');
    skillJunction.initialize(pluginsPath, synthesizedSkillsRoot);

    const pluginLoader = container.resolve<PluginLoaderService>(
      SDK_TOKENS.SDK_PLUGIN_LOADER,
    );
    const config = pluginLoader.getWorkspacePluginConfig();
    const paths = pluginLoader.resolvePluginPaths(config.enabledPluginIds);

    const junctionResult = skillJunction.activate({
      pluginPaths: paths,
      disabledSkillIds: config.disabledSkillIds,
      getPluginPaths: () => pluginLoader.resolveCurrentPluginPaths(),
      getDisabledSkillIds: () => pluginLoader.getDisabledSkillIds(),
    });

    if (junctionResult.created > 0 || junctionResult.errors.length > 0) {
      console.log(
        `[Ptah Electron] Skill junctions: ${junctionResult.created} created, ${junctionResult.skipped} skipped, ${junctionResult.removed} removed, ${junctionResult.errors.length} errors`,
      );
    } else {
      console.log('[Ptah Electron] Skill junctions activated');
    }

    return skillJunction;
  } catch (error) {
    console.warn(
      '[Ptah Electron] Skill junction activation failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
