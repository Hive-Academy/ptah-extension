import type { AgentDeliveryReceipt, AgentId, LaneCompletionVerdict, LaneStopReason } from '../agent-process.types';

/** Payload for `agent-monitor:message-receipt`. */
export interface AgentMonitorMessageReceiptPayload {
  readonly receipt: AgentDeliveryReceipt;
}

/** `expired`: the envelope was evicted or timed out before the parent took it. */
export type AgentParentDeliveryState = 'pending' | 'delivered' | 'expired';

/** Delivery state for a completion or report envelope sent to the parent. */
export interface AgentMonitorParentDeliveryPayload {
  readonly agentId: AgentId;
  readonly kind: 'completion' | 'report';
  readonly state: AgentParentDeliveryState;
  readonly deliveryId?: string;
  readonly createdAt?: number;
  readonly preview?: string;
  readonly verdict?: LaneCompletionVerdict;
  readonly stopReason?: LaneStopReason;
}

/**
 * Payload for `agent-monitor:reparented` (TASK_2026_876).
 *
 * Sent once when a kept handoff settles lane adoption. `parentSessionId` is
 * the successor tab id. The existing resolve path later rewrites it to the
 * successor SDK id.
 */
export interface AgentMonitorReparentedPayload {
  readonly agentIds: readonly string[];
  readonly parentSessionId: string;
}
