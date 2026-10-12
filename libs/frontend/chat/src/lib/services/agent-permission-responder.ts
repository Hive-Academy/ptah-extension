import { inject, Injectable } from '@angular/core';
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

  respondLane(
    agentId: string,
    requestId: string,
    decision: 'allow' | 'deny',
    reason?: string,
  ): void {
    this.vscode.postMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload: {
        requestId,
        decision,
        ...(reason === undefined ? {} : { reason }),
      },
    });
    this.agentStore.clearPermission(agentId, requestId);
  }

  respondSession(
    request: PermissionRequest,
    decision: PermissionResponse['decision'],
    tabId: string,
  ): void {
    this.permissionHandler.handlePermissionResponse(
      { id: request.id, decision },
      tabId,
    );
  }
}
