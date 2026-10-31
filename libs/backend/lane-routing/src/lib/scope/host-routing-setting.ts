import type {
  IDisposable,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';

import type { DecisionModelConfig } from '../decision-model/decision-model.config';
import {
  DECISION_MODEL_CONFIG_KEY,
  DECISION_MODEL_CONFIG_SECTION,
} from '../decision-model/decision-model.types';

const HOST_ROUTING_SECTION = 'ptah';
const HOST_ROUTING_KEY = 'agentOrchestration.hostRouting';

/** Live effective-enable rule shared by the coordinator and reuse cache. */
export class HostRoutingSetting {
  constructor(
    private readonly workspace: IWorkspaceProvider,
    private readonly config: DecisionModelConfig,
  ) {}

  isEnabled(): boolean {
    try {
      const stored = this.workspace.getConfiguration<unknown>(
        HOST_ROUTING_SECTION,
        HOST_ROUTING_KEY,
      );
      return stored !== false && this.config.getSelection().kind !== 'unset';
    } catch (_error: unknown) {
      // degradation-audit: reported - an unreadable setting disables advisory routing.
      return false;
    }
  }

  getConfigurationGeneration(): number {
    // Every host provider implements this. A provider without it reads a constant 0, which
    // turns off stale-work detection for host routing.
    return this.workspace.getRoutingConfigurationGeneration?.() ?? 0;
  }

  /**
   * Fires after a host-routing switch or decision-model write.
   */
  onDidChange(listener: () => void): IDisposable {
    return this.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration(
          `${HOST_ROUTING_SECTION}.${HOST_ROUTING_KEY}`,
        ) ||
        event.affectsConfiguration(
          `${DECISION_MODEL_CONFIG_SECTION}.${DECISION_MODEL_CONFIG_KEY}`,
        )
      ) {
        listener();
      }
    });
  }
}
