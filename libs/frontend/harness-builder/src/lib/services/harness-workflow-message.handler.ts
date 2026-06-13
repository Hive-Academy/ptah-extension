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
      return;
    }
    this.appState.requestHarnessWorkflow({
      mode: data.mode,
      ...(data.seedPrompt ? { seedPrompt: data.seedPrompt } : {}),
    });
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
