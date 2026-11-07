import type {
  AgentId,
  EffectiveLaneCapabilities,
  LaneCompletionVerdict,
  LaneStopReason,
} from './agent-process.types';

/** Identity of the caller that sent a message to a lane. */
export type AgentMessageSender =
  | { readonly kind: 'user' }
  | { readonly kind: 'parent'; readonly sessionId?: string }
  | {
      readonly kind: 'lane';
      readonly agentId: AgentId;
      readonly name?: string;
      readonly parentSessionId?: string;
      /** True only when the sender came from a verified caller binding. */
      readonly verified: boolean;
    };

/**
 * The mechanism that actually delivered a message to a running agent.
 *
 * - `steer` — injected mid-turn; the current turn continues and absorbs it.
 * - `interrupt-resume` — the current turn was aborted and the message re-submitted
 *   on the SAME session. **Discards the aborted turn's partial work**, which is why
 *   the mode is always reported back to the caller rather than presented as a plain
 *   success.
 * - `queue-next-turn` — held and delivered as the next full turn.
 * - `unsupported` — nothing was delivered; `detail` carries the reason.
 */
export type AgentMessagingMode =
  | 'steer'
  | 'interrupt-resume'
  | 'queue-next-turn'
  | 'start-turn'
  | 'unsupported';

/**
 * The best mechanism a CLI can offer, as reported by agent listings.
 *
 * This is the declared capability, not the outcome of a delivery — see
 * {@link AgentMessagingMode} for the latter.
 */
export type AgentMessagingCapability = 'steer' | 'interrupt' | 'queue' | 'none';

export type AgentMessageDelivery = 'queue' | 'now';
/** MCP compatibility input. `steer` never selects interrupt-resume. */
export type AgentMessageRequestDelivery = AgentMessageDelivery | 'steer';
export type AgentMessagePreviewMode =
  | 'steer'
  | 'queue-next-turn'
  | 'interrupt-resume'
  | 'start-turn'
  | 'unsupported';

export interface AgentMessageRequest {
  readonly agentId: AgentId;
  readonly message: string;
  readonly delivery?: AgentMessageRequestDelivery;
  /** Required only when the selected plan is interrupt-resume. */
  readonly allowPartialTurnLoss?: boolean;
  /** Caller-chosen; unique per (sender, target). 1–128 chars, [A-Za-z0-9._:-]. */
  readonly idempotencyKey?: string;
}

export interface AgentMessagePreviewRequest {
  readonly agentId: AgentId;
  readonly delivery?: AgentMessageDelivery;
}

export interface AgentMessagePreview {
  readonly agentId: AgentId;
  readonly delivery: AgentMessageDelivery;
  readonly mode: AgentMessagePreviewMode;
  readonly supported: boolean;
  readonly reason?: string;
  readonly usesResume: boolean;
  readonly lossDisclosure?: {
    readonly kind: 'partial-turn-work-lost';
    readonly confirmationRequired: true;
    readonly text: string;
  };
  readonly effectiveCapabilities: EffectiveLaneCapabilities;
}

/** Durable transport state of one message to a lane. */
export type AgentMessageEnvelopeState =
  | 'not-started'
  | 'dispatching'
  | 'started'
  | 'settled'
  | 'blocked-retryable'
  | 'outcome-unknown'
  | 'failed'
  | 'expired'
  | 'cancelled';

/** Single message-size limit, in UTF-16 code units (`string.length`). */
export const AGENT_MESSAGE_MAX_CHARS = 102_400;
/** Lower limit for lane-to-lane senders, in UTF-16 code units. */
export const AGENT_LANE_MESSAGE_MAX_CHARS = 32_768;

export type AgentMessageAckState =
  | 'pending'
  | 'read'
  | 'acted'
  | 'rejected'
  | 'unavailable';

export type AgentMessageReasonCode =
  | 'host-restarted'
  | 'awaiting-resume'
  | 'resume-failed'
  | 'queue-full'
  | 'continuation_transient'
  | 'continuation_rejected'
  | 'session_changed'
  | 'agent_stopped'
  | 'subprocess_released'
  | 'agent_expired'
  | 'lane-at-limit'
  | 'account_refused'
  | 'interrupted-undelivered'
  | 'cancelled-by-user'
  | 'cancelled-by-sender'
  | 'parent-session-deleted'
  | 'dispatch-interrupted'
  | 'idempotency-key-requires-identity'
  | 'storage-unavailable'
  | 'storage-capacity'
  | 'index-lost'
  | 'body-unavailable'
  | 'body-too-large'
  | 'not_found'
  | 'capability_metadata_unavailable'
  | 'delivery-refused'
  | 'delivery-failed'
  | 'identity-missing'
  | 'sender-unknown'
  | 'self-target'
  | 'parent-missing'
  | 'different-parent'
  | 'workspace-missing'
  | 'different-workspace'
  | 'rate-limited';

/** Public receipt state projected from the durable message envelope. */
export type AgentDeliveryReceiptState =
  | 'accepted'
  | 'dispatching'
  | 'started'
  | 'settled'
  | 'failed'
  | 'expired'
  | 'interrupted-undelivered'
  | 'blocked-retryable'
  | 'outcome-unknown'
  | 'cancelled';

export interface AgentDeliveryReceipt {
  readonly id: string;
  /** Target as addressed at accept time. */
  readonly agentId: AgentId;
  /** Resolved lane after a cold resume. */
  readonly actualAgentId?: AgentId;
  readonly state: AgentDeliveryReceiptState;
  readonly mode: AgentMessagePreviewMode;
  readonly delivery: AgentMessageDelivery;
  /** Coarse sender kind, kept flat for existing `=== 'user'` checks. */
  readonly sender?: 'user' | 'parent' | 'lane';
  readonly senderAgentId?: AgentId;
  readonly senderSessionId?: string;
  /** True only when derived from a verified caller binding. */
  readonly senderVerified?: boolean;
  /** Owning parent of the target lane. */
  readonly parentSessionId?: string;
  /** At most 160 characters; live only, not persisted in the index. */
  readonly preview?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly turnSeq?: number;
  readonly cliSessionId?: string;
  /** AgentMessageReasonCode or adapter detail. */
  readonly reason?: string;
  readonly partialTurnLost?: boolean;
  /** Turn outcome is separate from delivery outcome. */
  readonly turnOutcome?: 'completed' | 'failed' | 'stopped';
  readonly attemptCount?: number;
  /** True once any attempt reached `dispatching`. */
  readonly everDispatched?: boolean;
  /** At most 200 characters; never contains message body text. */
  readonly lastError?: string;
  readonly nextRetryAt?: number;
  readonly limit?: { readonly known: boolean; readonly resetAt?: number };
  readonly hasRecoverableBody?: boolean;
  readonly ackState?: AgentMessageAckState;
  readonly ackAt?: number;
  /** At most 500 characters. */
  readonly ackNote?: string;
}

/**
 * What actually happened to a message aimed at a live agent.
 *
 * `mode` is never inferred by the caller and never omitted: an `unsupported`
 * outcome means NOTHING was delivered, and `detail` carries the reason in
 * words the caller (often a model) can act on.
 */
export interface AgentMessageOutcome {
  readonly mode: AgentMessagingMode;
  readonly detail?: string;
  /** Stable refusal reason; safe to persist or send across host boundaries. */
  readonly reasonCode?:
    | AgentMessageReasonCode
    | 'no-session'
    | 'steer-rejected'
    | 'steer-unavailable'
    | 'interrupt-failed'
    | 'confirmation-required'
    | 'immediate-unavailable'
    | 'continuation-unavailable'
    | 'start-turn-failed';
  readonly messageId?: string;
  /** Optional until the legacy router migrates to receipt-producing sends. */
  readonly receipt?: AgentDeliveryReceipt;
  /** Id the caller addressed. */
  readonly requestedAgentId?: AgentId;
  /** Id that now owns the message; differs after a cold resume. Wire form is unbranded. */
  readonly agentId?: string;
  /** True when an idempotency key matched an existing message. */
  readonly deduplicated?: boolean;
}

export type ParentDeliveryState =
  | 'pending'
  | 'sending'
  | 'delivered'
  | 'blocked-retryable'
  | 'outcome-unknown'
  | 'cancelled'
  /** View-only: a completion whose live enqueue failed; never persisted. */
  | 'not-saved';

/**
 * Public parent-delivery view. Delivery ids retain both current opaque formats:
 * `lane-delivery:report:<agentId>:<turnSeq>:<hash>` and
 * `lane-delivery:<agentId>:<completedAt ISO>`.
 */
export interface ParentDeliveryView {
  readonly deliveryId: `lane-delivery:${string}`;
  readonly agentId: string;
  readonly parentSessionId: string;
  readonly kind: 'report' | 'completion';
  readonly state: ParentDeliveryState;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly attempts: number;
  readonly lastError?: string;
  readonly nextRetryAt?: number;
  readonly waitingReason?: 'parent-offline';
  /** Retry of an outcome-unknown delivery requires confirmDuplicateRisk. */
  readonly everDispatched?: boolean;
  /** At most 160 characters. */
  readonly preview?: string;
  readonly verdict?: LaneCompletionVerdict;
  readonly stopReason?: LaneStopReason;
}
