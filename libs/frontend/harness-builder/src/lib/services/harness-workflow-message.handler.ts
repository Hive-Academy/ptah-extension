import { Injectable, effect, inject } from '@angular/core';
import { LoggingService, type MessageHandler } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  type HarnessConfigProposedPayload,
  type HarnessOpenWorkflowPayload,
} from '@ptah-extension/shared';
import { HarnessBuilderStateService } from './harness-builder-state.service';
import { HarnessRpcService } from './harness-rpc.service';
import { HarnessWorkflowRequestService } from './harness-workflow-request.service';
import { HarnessWorkflowService } from './harness-workflow.service';

@Injectable({ providedIn: 'root' })
export class HarnessWorkflowMessageHandler implements MessageHandler {
  private readonly logger = inject(LoggingService);
  private readonly state = inject(HarnessBuilderStateService);
  private readonly workflow = inject(HarnessWorkflowService);
  private readonly harnessRpc = inject(HarnessRpcService);
  private readonly requests = inject(HarnessWorkflowRequestService);
  private currentSurface: string | null = null;
  private knownSessions = new Set<string>();
  private hydrationQueue: string[] = [];
  private generation = 0;
  private hydrationPending = false;
  private buffered: HarnessConfigProposedPayload[] = [];

  readonly handledMessageTypes = [
    MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW,
    MESSAGE_TYPES.HARNESS_CONFIG_PROPOSED,
  ] as const;

  constructor() {
    effect(() =>
      this.syncWorkflow(this.workflow.surfaceId(), this.workflow.sessionIds()),
    );
  }

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
      this.logger.warn(
        'HarnessWorkflowMessageHandler',
        'Invalid workflow request',
      );
      this.workflow.setError(
        'The workspace sent a malformed workflow request, so it was ignored. Try starting it again.',
      );
      return;
    }
    void this.requests.requestAndNavigate(data).then(
      (outcome) => {
        if (outcome !== 'failed') return;
        this.logger.error(
          'HarnessWorkflowMessageHandler',
          'Workflow navigation failed',
          new Error('Navigation did not land'),
        );
        this.workflow.setError(
          'The harness builder could not be opened, so the workflow was not shown. Try starting it again.',
        );
      },
      (cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        this.logger.error(
          'HarnessWorkflowMessageHandler',
          'Workflow request failed',
          error,
        );
        this.workflow.setError(error.message);
      },
    );
  }

  private syncWorkflow(
    surfaceId: string | null,
    sessionIds: readonly string[],
  ): void {
    if (surfaceId !== this.currentSurface) {
      if (this.currentSurface) this.state.reset();
      this.currentSurface = surfaceId;
      this.knownSessions = new Set();
      this.hydrationQueue = [];
      this.buffered = [];
      this.hydrationPending = false;
      this.generation++;
    }
    if (!surfaceId) return;
    for (const sessionId of sessionIds) {
      if (this.knownSessions.has(sessionId)) continue;
      this.knownSessions.add(sessionId);
      this.hydrationQueue.push(sessionId);
    }
    if (this.hydrationQueue.length && !this.hydrationPending) {
      this.hydrationPending = true;
      void this.hydrate(this.generation);
    }
  }

  private async hydrate(generation: number): Promise<void> {
    while (this.hydrationQueue.length && generation === this.generation) {
      const sessionId = this.hydrationQueue.shift();
      if (!sessionId) continue;
      try {
        const { proposal } = await this.harnessRpc.getProposal(sessionId);
        if (generation !== this.generation) return;
        if (proposal && proposal.sessionId === sessionId) {
          this.state.applyConfigUpdates(proposal.configUpdates);
          if (proposal.isConfigComplete) this.state.setConfigComplete(true);
        }
      } catch (cause: unknown) {
        if (generation !== this.generation) return;
        const error = cause instanceof Error ? cause : new Error(String(cause));
        this.logger.error(
          'HarnessWorkflowMessageHandler',
          'Proposal hydration failed',
          error,
        );
      }
    }
    if (generation !== this.generation) return;
    this.hydrationPending = false;
    const buffered = this.buffered;
    this.buffered = [];
    for (const event of buffered) {
      try {
        this.applyProposal(event);
      } catch (cause: unknown) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        this.logger.error(
          'HarnessWorkflowMessageHandler',
          'Buffered proposal replay failed',
          error,
        );
      }
    }
  }

  private handleConfigProposed(payload: unknown): void {
    const sessionIds = this.workflow.sessionIds();
    this.syncWorkflow(this.workflow.surfaceId(), sessionIds);
    if (!this.currentSurface || this.workflow.mode() !== 'configure-harness')
      return;
    const data = payload as HarnessConfigProposedPayload | undefined;
    if (!data || !data.configUpdates) return;
    if (!sessionIds.some((sessionId) => sessionId === data.sessionId)) {
      this.logger.debug(
        'HarnessWorkflowMessageHandler',
        `Proposal ignored for unknown session ${data.sessionId}`,
      );
      return;
    }
    if (this.hydrationPending) this.buffered.push(data);
    else this.applyProposal(data);
  }

  private applyProposal(data: HarnessConfigProposedPayload): void {
    this.state.applyConfigUpdates(data.configUpdates);
    if (data.isConfigComplete) this.state.setConfigComplete(true);
  }
}
