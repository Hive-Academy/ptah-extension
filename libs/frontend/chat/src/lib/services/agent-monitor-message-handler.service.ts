/**
 * Agent Monitor Message Handler
 *
 * Routes AGENT_MONITOR_* messages from the extension backend to AgentMonitorStore.
 * Implements the MessageHandler interface (same pattern as ChatMessageHandler).
 */

import { Injectable, inject } from '@angular/core';
import { type MessageHandler } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  type AgentProcessInfo,
  type AgentOutputDelta,
  type AgentPermissionRequest,
} from '@ptah-extension/shared';
import { AgentMonitorStore } from './agent-monitor.store';

@Injectable({ providedIn: 'root' })
export class AgentMonitorMessageHandler implements MessageHandler {
  private readonly store = inject(AgentMonitorStore);

  readonly handledMessageTypes = [
    MESSAGE_TYPES.AGENT_MONITOR_SPAWNED,
    MESSAGE_TYPES.AGENT_MONITOR_OUTPUT,
    MESSAGE_TYPES.AGENT_MONITOR_EXITED,
    MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST,
  ] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    switch (message.type) {
      case MESSAGE_TYPES.AGENT_MONITOR_SPAWNED:
        this.store.onAgentSpawned(message.payload as AgentProcessInfo);
        break;
      case MESSAGE_TYPES.AGENT_MONITOR_OUTPUT:
        this.store.onAgentOutput(message.payload as AgentOutputDelta);
        break;
      case MESSAGE_TYPES.AGENT_MONITOR_EXITED:
        this.store.onAgentExited(message.payload as AgentProcessInfo);
        break;
      case MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST:
        this.store.onPermissionRequest(
          message.payload as AgentPermissionRequest
        );
        break;
    }
  }
}
