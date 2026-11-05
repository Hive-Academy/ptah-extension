/**
 * Backend-owned follow-up queue (TASK_2026_884).
 *
 * A follow-up the user sends while a turn runs is handed to the backend at
 * once, with `AIMessageOptions.queueIntent: 'next-turn'` and a required
 * `clientMessageId`. The provider adapter holds it for that exact session and
 * admits it as the next turn when the running turn ends, whether or not any
 * renderer shows the session. It is never handed to a different session.
 */
import type { SessionId } from './branded.types';

/** Lifecycle of one queued follow-up, keyed by its `clientMessageId`. */
export type QueuedFollowUpState =
  | 'queued'
  | 'delivered'
  | 'withdrawn'
  | 'failed'
  | 'steered';

export interface QueuedFollowUpStateChange {
  readonly sessionId: SessionId;
  readonly clientMessageId: string;
  readonly state: QueuedFollowUpState;
  /** Safe, user-presentable reason for `failed` (never raw error text). */
  readonly reason?: string;
}

/** A follow-up still held (not yet claimed by a turn). */
export interface QueuedFollowUpSnapshot {
  readonly clientMessageId: string;
  readonly content: string;
  readonly files?: readonly string[];
  readonly images?: ReadonlyArray<{ data: string; mediaType: string }>;
}

export type SteerQueuedFollowUpResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | 'TURN_CHANGED'
        | 'DELIVERY_UNCERTAIN'
        | 'NOT_QUEUED'
        | 'UNSUPPORTED'
        | 'SESSION_ENDED';
    };

/**
 * Optional provider operations on `IAgentAdapter`. An adapter that does not
 * implement them keeps today's behaviour; callers must feature-check.
 */
export interface FollowUpQueueOperations {
  /** Subscribe to state changes for every session of this adapter. */
  onQueuedFollowUpState?(
    listener: (change: QueuedFollowUpStateChange) => void,
  ): () => void;
  /** Remove a held follow-up. True only when it was removed before claim. */
  withdrawQueuedFollowUp?(
    sessionId: SessionId,
    clientMessageId: string,
  ): Promise<boolean>;
  /** Held follow-ups of one session, in FIFO order. */
  listQueuedFollowUps?(sessionId: SessionId): readonly QueuedFollowUpSnapshot[];
  /**
   * Codex only: move a held follow-up into the running turn with
   * `turn/steer` + `expectedTurnId`. On `TURN_CHANGED` the item stays queued.
   */
  steerQueuedFollowUp?(
    sessionId: SessionId,
    clientMessageId: string,
  ): Promise<SteerQueuedFollowUpResult>;
}
