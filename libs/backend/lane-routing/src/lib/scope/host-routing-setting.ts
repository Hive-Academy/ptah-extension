import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

import type { DecisionModelConfig } from '../decision-model/decision-model.config';

/** Live effective-enable rule shared by the coordinator and reuse cache. */
export class HostRoutingSetting {
  constructor(
    private readonly workspace: IWorkspaceProvider,
    private readonly config: DecisionModelConfig,
  ) {}

  isEnabled(): boolean {
    try {
      const stored = this.workspace.getConfiguration<unknown>(
        'ptah',
        'agentOrchestration.hostRouting',
      );
      return stored !== false && this.config.getSelection().kind !== 'unset';
    } catch (_error: unknown) {
      // degradation-audit: reported - an unreadable setting disables advisory routing.
      return false;
    }
  }
}
