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
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';

/**
 * rAF does not fire while the window is hidden or occluded, so a timer also
 * flushes, or output from a background window would pile up unseen.
 */
const OUTPUT_FLUSH_FALLBACK_MS = 100;

@Injectable({ providedIn: 'root' })
export class AgentMonitorMessageHandler implements MessageHandler {
  private readonly store = inject(AgentMonitorStore);

  /**
   * Output deltas waiting for the next frame. A CLI agent streams many small
   * chunks; applying each one copied the agent list and re-rendered its card,
   * so they are applied together once per frame (Plane PTAH-16).
   */
  private pendingOutput: AgentOutputDelta[] = [];
  private outputFrame: number | null = null;
  private outputTimer: ReturnType<typeof setTimeout> | null = null;

  readonly handledMessageTypes = [
    MESSAGE_TYPES.AGENT_MONITOR_SPAWNED,
    MESSAGE_TYPES.AGENT_MONITOR_OUTPUT,
    MESSAGE_TYPES.AGENT_MONITOR_EXITED,
    MESSAGE_TYPES.AGENT_MONITOR_EXPIRED,
    MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST,
  ] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type === MESSAGE_TYPES.AGENT_MONITOR_OUTPUT) {
      this.pendingOutput.push(message.payload as AgentOutputDelta);
      this.scheduleOutputFlush();
      return;
    }
    // Every other agent event lands after the output that preceded it.
    this.flushOutput();
    switch (message.type) {
      case MESSAGE_TYPES.AGENT_MONITOR_SPAWNED:
        this.store.onAgentSpawned(message.payload as AgentProcessInfo);
        break;
      case MESSAGE_TYPES.AGENT_MONITOR_EXITED:
        this.store.onAgentExited(message.payload as AgentProcessInfo);
        break;
      case MESSAGE_TYPES.AGENT_MONITOR_EXPIRED:
        this.store.onAgentExpired(
          (message.payload as { agentId: string } | undefined)?.agentId ?? '',
        );
        break;
      case MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST:
        this.store.onPermissionRequest(
          message.payload as AgentPermissionRequest,
        );
        break;
    }
  }

  /** Apply buffered output now. Safe to call when nothing is pending. */
  flushOutput(): void {
    if (this.outputFrame !== null) {
      cancelAnimationFrame(this.outputFrame);
      this.outputFrame = null;
    }
    if (this.outputTimer !== null) {
      clearTimeout(this.outputTimer);
      this.outputTimer = null;
    }
    if (this.pendingOutput.length === 0) return;
    const batch = this.pendingOutput;
    this.pendingOutput = [];
    this.store.onAgentOutputBatch(batch);
  }

  private scheduleOutputFlush(): void {
    if (this.outputTimer !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      this.outputFrame = requestAnimationFrame(() => this.flushOutput());
    }
    this.outputTimer = setTimeout(
      () => this.flushOutput(),
      OUTPUT_FLUSH_FALLBACK_MS,
    );
  }
}
