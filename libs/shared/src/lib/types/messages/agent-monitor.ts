import type { AgentDeliveryReceipt, AgentId } from '../agent-process.types';

/** Payload for `agent-monitor:message-receipt`. */
export interface AgentMonitorMessageReceiptPayload {
  readonly receipt: AgentDeliveryReceipt;
}

export type AgentParentDeliveryState = 'pending' | 'delivered';

/** Delivery state for a completion or report envelope sent to the parent. */
export interface AgentMonitorParentDeliveryPayload {
  readonly agentId: AgentId;
  readonly kind: 'completion' | 'report';
  readonly state: AgentParentDeliveryState;
  readonly deliveryId?: string;
  readonly createdAt?: number;
  readonly preview?: string;
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
