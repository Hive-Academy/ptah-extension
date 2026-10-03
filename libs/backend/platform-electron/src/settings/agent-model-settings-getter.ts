/**
 * Lazy getter for the `AgentModelSettings` repository.
 *
 * The harness-sync source resolver reads `agentGeneration.models` through this
 * getter on each manifest build. It lives in the platform adapter so the app
 * composition root never imports `@ptah-extension/settings-core` directly.
 *
 * Lazy because `registerElectronSettings` may run after the resolver is built;
 * returns null while the repository is unregistered.
 */

import type { DependencyContainer } from 'tsyringe';
import {
  SETTINGS_TOKENS,
  type AgentModelSettings,
} from '@ptah-extension/settings-core';

export function createAgentModelSettingsGetter(
  container: DependencyContainer,
): () => AgentModelSettings | null {
  return () =>
    container.isRegistered(SETTINGS_TOKENS.AGENT_MODEL_SETTINGS)
      ? container.resolve<AgentModelSettings>(
          SETTINGS_TOKENS.AGENT_MODEL_SETTINGS,
        )
      : null;
}
