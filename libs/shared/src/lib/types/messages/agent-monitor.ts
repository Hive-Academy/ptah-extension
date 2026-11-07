import type {
  AgentDeliveryReceipt,
  AgentId,
  LaneCompletionVerdict,
  LaneStopReason,
  ParentDeliveryState,
} from '../agent-process.types';

/** Payload for `agent-monitor:message-receipt`. */
export interface AgentMonitorMessageReceiptPayload {
  readonly receipt: AgentDeliveryReceipt;
}

/** Delivery state for a completion or report envelope sent to the parent. */
export interface AgentMonitorParentDeliveryPayload {
  readonly agentId: AgentId;
  readonly kind: 'completion' | 'report';
  readonly state: ParentDeliveryState;
  readonly deliveryId?: string;
  readonly parentSessionId?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly attempts?: number;
  readonly lastError?: string;
  readonly nextRetryAt?: number;
  readonly waitingReason?: 'parent-offline';
  readonly everDispatched?: boolean;
  /** Set on a view-only `not-saved` push that withdraws the earlier notice. */
  readonly removed?: true;
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
