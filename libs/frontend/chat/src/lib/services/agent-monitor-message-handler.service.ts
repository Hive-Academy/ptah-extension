/**
 * Agent Monitor Message Handler
 *
 * Routes AGENT_MONITOR_* messages from the extension backend to AgentMonitorStore,
 * and receipt / parent-delivery pushes to AgentDeliveryStore.
 * Implements the MessageHandler interface (same pattern as ChatMessageHandler).
 *
 * It also hydrates the delivery store on renderer start and on every session
 * selection, so queued, held and pending-parent items survive a reload.
 */

import { Injectable, effect, inject, untracked } from '@angular/core';
import { type MessageHandler } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  type AgentProcessInfo,
  type AgentOutputDelta,
  type AgentPermissionRequest,
  type AgentMonitorReparentedPayload,
  AgentMonitorMessageReceiptPayloadSchema,
  AgentMonitorParentDeliveryPayloadSchema,
  AgentId,
} from '@ptah-extension/shared';
import { AgentDeliveryStore, AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';

/**
 * rAF does not fire while the window is hidden or occluded, so a timer also
 * flushes, or output from a background window would pile up unseen.
 */
const OUTPUT_FLUSH_FALLBACK_MS = 100;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate an `agent-monitor:reparented` payload (TASK_2026_876): a non-empty
 * `parentSessionId` and an `agentIds` array of non-empty strings. Returns
 * `null` for anything else; the caller logs the shape and drops it.
 * Hand-written to keep Zod out of the initial bundle (TASK_2026_187 Unit 10).
 */
export function parseAgentMonitorReparented(
  value: unknown,
): AgentMonitorReparentedPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  const agentIds = p['agentIds'];
  const parentSessionId = p['parentSessionId'];
  if (
    !isNonEmptyString(parentSessionId) ||
    !Array.isArray(agentIds) ||
    !agentIds.every(isNonEmptyString)
  ) {
    return null;
  }
  return { agentIds: [...agentIds], parentSessionId };
}

/** Type and top-level keys of a refused payload; never its values. */
function describePayload(payload: unknown): string {
  if (payload === null) return 'null';
  if (Array.isArray(payload)) return `array(${payload.length})`;
  if (typeof payload !== 'object') return typeof payload;
  const name = (payload as object).constructor?.name ?? 'object';
  return `${name}{${Object.keys(payload as object).join(',')}}`;
}

@Injectable({ providedIn: 'root' })
export class AgentMonitorMessageHandler implements MessageHandler {
  private readonly store = inject(AgentMonitorStore);
  private readonly delivery = inject(AgentDeliveryStore);
  private readonly tabManager = inject(TabManagerService);

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
    MESSAGE_TYPES.AGENT_MONITOR_REPARENTED,
    MESSAGE_TYPES.AGENT_MONITOR_MESSAGE_RECEIPT,
    MESSAGE_TYPES.AGENT_MONITOR_PARENT_DELIVERY,
  ] as const;

  constructor() {
    // Renderer start (no session yet) and each session selection.
    effect(() => {
      const sessionId = this.tabManager.activeTabSessionId();
      untracked(() => void this.delivery.hydrate(sessionId ?? undefined));
    });
  }

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
      case MESSAGE_TYPES.AGENT_MONITOR_REPARENTED: {
        const parsed = parseAgentMonitorReparented(message.payload);
        if (!parsed) {
          console.warn(
            '[AgentMonitorMessageHandler] agent-monitor:reparented payload rejected — dropped',
            describePayload(message.payload),
          );
          break;
        }
        this.store.reparentAgents(parsed.agentIds, parsed.parentSessionId);
        break;
      }
      case MESSAGE_TYPES.AGENT_MONITOR_MESSAGE_RECEIPT: {
        const parsed = AgentMonitorMessageReceiptPayloadSchema.safeParse(message.payload);
        if (parsed.success) this.delivery.onMessageReceipt({
          ...parsed.data.receipt,
          agentId: AgentId.from(parsed.data.receipt.agentId),
        });
        break;
      }
      case MESSAGE_TYPES.AGENT_MONITOR_PARENT_DELIVERY: {
        const parsed = AgentMonitorParentDeliveryPayloadSchema.safeParse(message.payload);
        if (parsed.success) this.delivery.onParentDelivery({
          ...parsed.data,
          agentId: AgentId.from(parsed.data.agentId),
        });
        break;
      }
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
