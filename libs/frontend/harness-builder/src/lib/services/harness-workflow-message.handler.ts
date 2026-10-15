import { Injectable, inject } from '@angular/core';
import { LoggingService, type MessageHandler } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  isNewProjectStack,
  type HarnessConfigProposedPayload,
  type HarnessOpenWorkflowPayload,
  type NewProjectIntake,
} from '@ptah-extension/shared';
import { canonicalHarnessRoot } from './harness-builder-records.service';
import { HarnessProposalHydrationService } from './harness-proposal-hydration.service';
import { HarnessWorkflowRequestService } from './harness-workflow-request.service';
import { NEW_PROJECT_PLATFORM_OPTIONS } from './new-project-intake';

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

function isIntake(value: unknown): value is NewProjectIntake {
  if (!isRecord(value)) return false;
  const audience = value['audience'];
  const stack = value['stack'];
  const platform = value['platform'];
  return (
    typeof value['what'] === 'string' &&
    !!value['what'].trim() &&
    (audience === 'b2b' ||
      audience === 'b2c' ||
      audience === 'internal' ||
      audience === 'unsure') &&
    typeof stack === 'string' &&
    isNewProjectStack(stack) &&
    (platform === undefined ||
      NEW_PROJECT_PLATFORM_OPTIONS.some(
        (option) => option.value === platform,
      )) &&
    (value['constraints'] === undefined ||
      typeof value['constraints'] === 'string') &&
    (stack !== 'other' ||
      (typeof value['stackOther'] === 'string' && !!value['stackOther'].trim()))
  );
}

@Injectable({ providedIn: 'root' })
export class HarnessWorkflowMessageHandler implements MessageHandler {
  private readonly logger = inject(LoggingService);
  private readonly requests = inject(HarnessWorkflowRequestService);
  private readonly proposals = inject(HarnessProposalHydrationService);

  readonly handledMessageTypes = [
    MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW,
    MESSAGE_TYPES.HARNESS_CONFIG_PROPOSED,
  ] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type === MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW) {
      this.handleOpenWorkflow(message.payload);
    } else if (message.type === MESSAGE_TYPES.HARNESS_CONFIG_PROPOSED) {
      if (isProposalPush(message.payload)) {
        this.proposals.handlePush(message.payload);
      }
    }
  }

  private handleOpenWorkflow(payload: unknown): void {
    const root = this.requests.workspaceRoot;
    if (
      !isRecord(payload) ||
      (payload['mode'] !== 'new-project' &&
        payload['mode'] !== 'configure-harness') ||
      !root ||
      (payload['workspaceRoot'] !== undefined &&
        (typeof payload['workspaceRoot'] !== 'string' ||
          canonicalHarnessRoot(payload['workspaceRoot']) !== root)) ||
      (payload['mode'] === 'new-project' &&
        !isIntake(payload['intake']) &&
        !this.requests.hasResumableMode('new-project'))
    ) {
      const error = new Error('Malformed builder relay or workspace');
      this.logger.error(
        'HarnessWorkflowMessageHandler',
        'Invalid workflow request',
        error,
      );
      this.requests.reportHubError(
        'The workspace sent an invalid builder request. Try again.',
      );
      return;
    }
    const data: HarnessOpenWorkflowPayload = {
      mode: payload['mode'],
      ...(typeof payload['seedPrompt'] === 'string'
        ? { seedPrompt: payload['seedPrompt'] }
        : {}),
      ...(isIntake(payload['intake']) ? { intake: payload['intake'] } : {}),
    };
    void this.requests.requestAndNavigate(data).then(
      (outcome) => {
        if (outcome !== 'failed') return;
        this.logger.error(
          'HarnessWorkflowMessageHandler',
          'Workflow navigation failed',
          new Error('Navigation did not land'),
        );
        this.requests.reportHubError(
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
        this.requests.reportHubError(
          'The harness builder could not be opened. Try again.',
        );
      },
    );
  }
}
