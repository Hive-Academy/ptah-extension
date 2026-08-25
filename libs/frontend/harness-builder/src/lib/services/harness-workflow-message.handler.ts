import { Injectable, inject } from '@angular/core';
import {
  AppStateManager,
  WebviewNavigationService,
  type MessageHandler,
} from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  type HarnessConfigProposedPayload,
  type HarnessOpenWorkflowPayload,
} from '@ptah-extension/shared';
import { HarnessBuilderStateService } from './harness-builder-state.service';
import { HarnessWorkflowService } from './harness-workflow.service';

@Injectable({ providedIn: 'root' })
export class HarnessWorkflowMessageHandler implements MessageHandler {
  private readonly appState = inject(AppStateManager);
  private readonly navigation = inject(WebviewNavigationService);
  private readonly state = inject(HarnessBuilderStateService);
  private readonly workflow = inject(HarnessWorkflowService);

  readonly handledMessageTypes = [
    MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW,
    MESSAGE_TYPES.HARNESS_CONFIG_PROPOSED,
  ] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    switch (message.type) {
      case MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW:
        this.handleOpenWorkflow(message.payload);
        break;
      case MESSAGE_TYPES.HARNESS_CONFIG_PROPOSED:
        this.handleConfigProposed(message.payload);
        break;
    }
  }

  private handleOpenWorkflow(payload: unknown): void {
    const data = payload as HarnessOpenWorkflowPayload | undefined;
    if (
      !data ||
      (data.mode !== 'new-project' && data.mode !== 'configure-harness')
    ) {
      console.warn(
        '[HarnessWorkflowMessageHandler] HARNESS_OPEN_WORKFLOW with invalid payload — dropped',
      );
      this.workflow.setError(
        'The workspace sent a malformed workflow request, so it was ignored. Try starting it again.',
      );
      return;
    }
    if (this.workflow.isActive()) {
      // Only a request for the mode ALREADY running is a duplicate. Treating a
      // cross-mode request as one discarded the user's New Project intake
      // without a word whenever a Configure Harness run happened to be open.
      if (this.workflow.mode() === data.mode) {
        console.info(
          '[HarnessWorkflowMessageHandler] Workflow already active in the same mode — resuming it instead of starting a second run',
        );
        this.navigateToBuilder();
        return;
      }
      void this.replaceActiveWorkflow(data);
      return;
    }
    this.requestAndNavigate(data);
  }

  /**
   * Swap a running workflow for one in the other mode.
   *
   * The user has already confirmed the discard upstream (the Setup Hub asks
   * before it sends this), so by the time it arrives the decision is made. Stop
   * the agent first — disposing alone leaves it running with no surface to
   * stream to — then clear the config the discarded run produced so the new
   * workflow doesn't inherit it.
   */
  private async replaceActiveWorkflow(
    data: HarnessOpenWorkflowPayload,
  ): Promise<void> {
    try {
      await this.workflow.abortAndDispose();
      this.state.reset();
      this.requestAndNavigate(data);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error stopping it';
      console.error(
        '[HarnessWorkflowMessageHandler] Failed to replace the active workflow:',
        message,
      );
      this.workflow.setError(
        `Could not stop the workflow already running, so the new one was not started: ${message}`,
      );
    }
  }

  private requestAndNavigate(data: HarnessOpenWorkflowPayload): void {
    this.appState.requestHarnessWorkflow({
      mode: data.mode,
      ...(data.seedPrompt ? { seedPrompt: data.seedPrompt } : {}),
      ...(data.intake ? { intake: data.intake } : {}),
    });
    this.navigateToBuilder();
  }

  private navigateToBuilder(): void {
    this.navigation
      .navigateToView('harness-builder')
      .catch((error: unknown) => {
        console.error(
          '[HarnessWorkflowMessageHandler] navigateToView failed:',
          error instanceof Error ? error.message : String(error),
        );
      });
  }

  private handleConfigProposed(payload: unknown): void {
    if (this.workflow.mode() !== 'configure-harness') return;
    const data = payload as HarnessConfigProposedPayload | undefined;
    if (!data || !data.configUpdates) return;
    this.state.applyConfigUpdates(data.configUpdates);
    if (data.isConfigComplete) {
      this.state.setConfigComplete(true);
    }
  }
}
