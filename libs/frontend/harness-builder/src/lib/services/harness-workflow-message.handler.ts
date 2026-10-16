import { Injectable, Injector, inject } from '@angular/core';
import { LoggingService, type MessageHandler } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  type HarnessConfigProposedPayload,
  type HarnessOpenWorkflowPayload,
} from '@ptah-extension/shared';
import {
  canonicalHarnessRoot,
  isNewProjectIntake,
} from './harness-workflow-utils';
import type { HarnessProposalHydrationService } from './harness-proposal-hydration.service';
import type { HarnessWorkflowRequestService } from './harness-workflow-request.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProposalPush(value: unknown): value is HarnessConfigProposedPayload {
  return (
    isRecord(value) &&
    typeof value['sessionId'] === 'string' &&
    isRecord(value['configUpdates'])
  );
}

@Injectable({ providedIn: 'root' })
export class HarnessWorkflowMessageHandler implements MessageHandler {
  private readonly logger = inject(LoggingService);
  private readonly injector = inject(Injector);
  private requests?: HarnessWorkflowRequestService;
  private proposals?: HarnessProposalHydrationService;
  private pending: Promise<void> = Promise.resolve();

  readonly handledMessageTypes = [
    MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW,
    MESSAGE_TYPES.HARNESS_CONFIG_PROPOSED,
  ] as const;

  handleMessage(message: { type: string; payload?: unknown }): Promise<void> {
    if (
      message.type !== MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW &&
      (message.type !== MESSAGE_TYPES.HARNESS_CONFIG_PROPOSED ||
        !isProposalPush(message.payload))
    ) {
      return this.pending;
    }
    // The router does not await handlers. Chain work here so imports in flight
    // cannot allow a later message to overtake an earlier one.
    this.pending = this.pending
      .then(() => this.dispatch(message))
      .catch((cause: unknown) => {
        this.logger.error(
          'HarnessWorkflowMessageHandler',
          'Workflow message failed',
          cause instanceof Error ? cause : new Error(String(cause)),
        );
      });
    return this.pending;
  }

  private async dispatch(message: {
    type: string;
    payload?: unknown;
  }): Promise<void> {
    if (message.type === MESSAGE_TYPES.HARNESS_CONFIG_PROPOSED) {
      if (!this.proposals) {
        const { HarnessProposalHydrationService } =
          await import('./harness-proposal-hydration.service');
        this.proposals = this.injector.get(HarnessProposalHydrationService);
      }
      this.proposals.handlePush(
        message.payload as HarnessConfigProposedPayload,
      );
      return;
    }
    if (!this.requests) {
      const { HarnessWorkflowRequestService } =
        await import('./harness-workflow-request.service');
      this.requests = this.injector.get(HarnessWorkflowRequestService);
    }
    this.handleOpenWorkflow(message.payload, this.requests);
  }

  private handleOpenWorkflow(
    payload: unknown,
    requests: HarnessWorkflowRequestService,
  ): void {
    const root = requests.workspaceRoot;
    if (
      !isRecord(payload) ||
      (payload['mode'] !== 'new-project' &&
        payload['mode'] !== 'configure-harness') ||
      !root ||
      (payload['workspaceRoot'] !== undefined &&
        (typeof payload['workspaceRoot'] !== 'string' ||
          canonicalHarnessRoot(payload['workspaceRoot']) !== root)) ||
      (payload['mode'] === 'new-project' &&
        !isNewProjectIntake(payload['intake']) &&
        !requests.hasResumableMode('new-project'))
    ) {
      const error = new Error('Malformed builder relay or workspace');
      this.logger.error(
        'HarnessWorkflowMessageHandler',
        'Invalid workflow request',
        error,
      );
      requests.reportHubError(
        'The workspace sent an invalid builder request. Try again.',
      );
      return;
    }
    const data: HarnessOpenWorkflowPayload = {
      mode: payload['mode'],
      ...(typeof payload['seedPrompt'] === 'string'
        ? { seedPrompt: payload['seedPrompt'] }
        : {}),
      ...(isNewProjectIntake(payload['intake'])
        ? { intake: payload['intake'] }
        : {}),
    };
    void requests.requestAndNavigate(data).then(
      (outcome) => {
        if (outcome !== 'failed') return;
        this.logger.error(
          'HarnessWorkflowMessageHandler',
          'Workflow navigation failed',
          new Error('Navigation did not land'),
        );
        requests.reportHubError(
          'The harness builder could not be opened. Try again.',
        );
      },
      (cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        this.logger.error(
          'HarnessWorkflowMessageHandler',
          'Workflow request failed',
          error,
        );
        requests.reportHubError(
          'The harness builder could not be opened. Try again.',
        );
      },
    );
  }
}
