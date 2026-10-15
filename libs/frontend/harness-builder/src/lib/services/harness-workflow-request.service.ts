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

@Injectable({ providedIn: 'root' })
export class HarnessWorkflowRequestService {
  private readonly appState = inject(AppStateManager);
  private readonly surfaceRouter = inject(SurfaceRouterService);
  private readonly state = inject(HarnessBuilderStateService);
  private readonly workflow = inject(HarnessWorkflowService);

  /** Returns false when navigation fails; the pending request is cleared first. */
  async requestAndNavigate(data: HarnessOpenWorkflowPayload): Promise<boolean> {
    if (this.workflow.isActive()) {
      if (this.workflow.mode() === data.mode) {
        return this.navigateToBuilder();
      }
      await this.workflow.abortAndDispose();
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
  ): Promise<boolean> {
    try {
      const result =
        await this.surfaceRouter.navigateToSurface('harness-builder');
      if (surfaceNavigationLanded(result)) return true;
      if (request) this.appState.clearHarnessWorkflowRequest(request);
      return false;
    } catch (error: unknown) {
      if (request) this.appState.clearHarnessWorkflowRequest(request);
      throw error;
    }
  }
}
