import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { LaneRoutingLogger } from '../lane-routing-logger';

/** Reads the live effective rotation mode for each routing decision. */
export class LaneRotationSetting {
  constructor(private readonly workspace: IWorkspaceProvider, private readonly logger: LaneRoutingLogger) {}

  isEnabled(): boolean {
    try {
      return this.workspace.getConfiguration<unknown>('ptah', 'agentOrchestration.laneRotation') !== false;
    } catch (error: unknown) {
      // degradation-audit: reported - unreadable settings preserve the existing rotation default.
      this.logger.warn('Lane rotation setting read failed', { code: error instanceof Error ? error.name : 'UNKNOWN' });
      return true;
    }
  }
}
