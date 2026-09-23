import { Injectable } from '@angular/core';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';

interface PendingWorkflowPermission {
  readonly key: string;
  readonly agentId: string;
  readonly timestamp: number;
}

/** Per-panel queue: observing a request does not mean its controls were shown. */
@Injectable()
export class WorkflowPermissionPresenterService {
  private observed = new Set<string>();
  private shown = new Set<string>();
  private pending: PendingWorkflowPermission[] = [];
  private pausedByUser = false;

  nextAgent(
    agents: readonly MonitoredAgent[],
    shownAgentId: string | null,
  ): string | null {
    this.pending = agents
      .filter((agent) => !!agent.workflowRunId)
      .flatMap((agent) =>
        agent.permissionQueue.map((request) => ({
          key: `${agent.agentId}:${request.requestId}`,
          agentId: agent.agentId,
          timestamp: request.timestamp,
        })),
      )
      .sort((a, b) => a.timestamp - b.timestamp);
    const keys = new Set(this.pending.map((request) => request.key));
    if (this.pending.some((request) => !this.observed.has(request.key))) {
      this.pausedByUser = false;
    }
    this.observed = keys;
    this.shown = new Set([...this.shown].filter((key) => keys.has(key)));
    if (this.pausedByUser) return null;

    // Keep the current request in view even if another agent's request is older.
    if (
      this.pending.some(
        (request) =>
          request.agentId === shownAgentId && this.shown.has(request.key),
      )
    ) {
      return shownAgentId;
    }
    return (
      this.pending.find((request) => !this.shown.has(request.key))?.agentId ??
      null
    );
  }

  /** Called only after the facade has actually selected the full-body detail. */
  markShown(agentId: string): void {
    for (const request of this.pending) {
      if (request.agentId === agentId) this.shown.add(request.key);
    }
  }

  onUserNavigation(): void {
    if (this.shown.size > 0) this.pausedByUser = true;
  }
}
