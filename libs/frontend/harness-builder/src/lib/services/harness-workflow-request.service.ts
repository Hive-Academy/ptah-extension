import { Injectable, inject } from '@angular/core';
import {
  AppStateManager,
  SurfaceRouterService,
  surfaceNavigationLanded,
  type HarnessWorkflowRequest,
} from '@ptah-extension/core';
import type { HarnessOpenWorkflowPayload } from '@ptah-extension/shared';
import { HarnessBuilderStateService } from './harness-builder-state.service';
import { HarnessWorkflowService } from './harness-workflow.service';

export type HarnessWorkflowRequestOutcome = 'landed' | 'cancelled' | 'failed';

@Injectable({ providedIn: 'root' })
export class HarnessWorkflowRequestService {
  private readonly appState = inject(AppStateManager);
  private readonly surfaceRouter = inject(SurfaceRouterService);
  private readonly state = inject(HarnessBuilderStateService);
  private readonly workflow = inject(HarnessWorkflowService);

  /** A cancelled or failed navigation clears the pending request. */
  async requestAndNavigate(
    data: HarnessOpenWorkflowPayload,
  ): Promise<HarnessWorkflowRequestOutcome> {
    if (this.workflow.isActive()) {
      if (this.workflow.mode() === data.mode) {
        return this.navigateToBuilder();
      }
      try {
        await this.workflow.abortAndDispose();
      } catch (cause: unknown) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `Could not stop the workflow already running, so the new one was not started: ${message}`,
          { cause },
        );
      }
      this.state.reset();
    }

    const request: HarnessWorkflowRequest = {
      mode: data.mode,
      ...(data.seedPrompt ? { seedPrompt: data.seedPrompt } : {}),
      ...(data.intake ? { intake: data.intake } : {}),
    };
    this.appState.requestHarnessWorkflow(request);
    return this.navigateToBuilder(request);
  }

  private async navigateToBuilder(
    request?: HarnessWorkflowRequest,
  ): Promise<HarnessWorkflowRequestOutcome> {
    try {
      const result =
        await this.surfaceRouter.navigateToSurface('harness-builder');
      if (surfaceNavigationLanded(result)) return 'landed';
      if (request) this.appState.clearHarnessWorkflowRequest(request);
      return result === 'cancelled' ? 'cancelled' : 'failed';
    } catch (error: unknown) {
      if (request) this.appState.clearHarnessWorkflowRequest(request);
      throw error;
    }
  }
}
