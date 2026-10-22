import { effect, inject, Injectable } from '@angular/core';
import {
  AgentMonitorStore,
  PermissionHandlerService,
} from '@ptah-extension/chat-streaming';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  PermissionRequest,
  PermissionResponse,
} from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class AgentPermissionResponder {
  private readonly vscode = inject(VSCodeService);
  private readonly agentStore = inject(AgentMonitorStore);
  private readonly permissionHandler = inject(PermissionHandlerService);
  private readonly answeredRequestIds = new Set<string>();

  constructor() {
    effect(() => {
      const pending = new Set(this.agentStore.pendingPermissions().flatMap(agent =>
        agent.permissionQueue.map(request => request.requestId)));
      for (const id of this.answeredRequestIds) if (!pending.has(id)) this.answeredRequestIds.delete(id);
    });
  }

  respondLane(
    agentId: string,
    requestId: string,
    decision: 'allow' | 'deny',
    reason?: string,
  ): boolean {
    if (this.answeredRequestIds.has(requestId)) return false;
    if (!this.agentStore.pendingPermissions().some(agent =>
      agent.agentId === agentId && agent.permissionQueue.some(request => request.requestId === requestId)
    )) return false;
    this.answeredRequestIds.add(requestId);
    try {
      this.vscode.postMessage({
        type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
        payload: {
          requestId,
          decision,
          ...(decision === 'deny'
            ? { reason: reason ?? 'User denied' }
            : reason === undefined
              ? {}
              : { reason }),
        },
      });
      this.agentStore.clearPermission(agentId, requestId);
      return true;
    } catch (error) {
      this.answeredRequestIds.delete(requestId);
      throw error;
    }
  }

  respondSession(
    request: PermissionRequest,
    decision: PermissionResponse['decision'],
    tabId?: string,
    reason?: string,
  ): boolean {
    if (!this.isSessionPending(request.id)) return false;
    return this.permissionHandler.handlePermissionResponse(
      { id: request.id, decision, reason },
      tabId,
    );
  }

  isSessionPending(requestId: string): boolean {
    return this.permissionHandler.permissionRequests().some(pending => pending.id === requestId);
  }
}
