/**
 * Shared session handover contract. Transport never exposes queued inputs.
 * One exception: `draftText` returns the user's own captured composer text in
 * a terminal phase (`cancelled`/`failed`) so the composer can show it again.
 */
export type SessionHandoverReason = 'budget-limit' | 'successor';

export type SessionHandoverPhase =
  | 'waiting-for-turn-end'
  | 'armed'
  | 'awaiting-confirmation'
  | 'writing-handoff'
  | 'starting-successor'
  | 'successor-confirmed'
  | 'closing'
  | 'closed'
  | 'failed'
  | 'cancelled';

/** Phases after which an operation is over: nothing is pending or carried. */
export const ENDED_HANDOVER_PHASES: ReadonlySet<SessionHandoverPhase> =
  new Set<SessionHandoverPhase>(['closed', 'failed', 'cancelled']);

export interface SessionHandoverState {
  readonly operationId: string;
  readonly sourceSessionId: string;
  readonly reason: SessionHandoverReason;
  readonly phase: SessionHandoverPhase;
  readonly revision: number;
  readonly heldInputCount: number;
  /** Present once the replacement tab has started and remains visible through close. */
  readonly successorTabId?: string;
  /** Inputs that could not be restored because the source no longer existed. */
  readonly lostInputCount?: number;
  /** UI-safe recovery hint for a composer that needs the lost text re-entered. */
  readonly lostInputsMessage?: string;
  /** Bounded source texts that could not be restored after the source ended. */
  readonly lostInputTexts?: readonly string[];
  /**
   * Work still running on the source while a user-started handover waits in
   * `waiting-for-turn-end`: in-flight subagents and CLI agent lanes. `lanes`
   * is `null` when the lane status is unknown (the lane provider failed).
   */
  readonly waitingFor?: {
    readonly subagents: number;
    readonly lanes: number | null;
  };
  /** Present while the operation is an agent's request awaiting the user's approval. */
  readonly requestedBy?: 'agent';
  /**
   * The user's own composer text captured with the handover request. Published
   * only in `cancelled`/`failed`, so it can return to the composer as a draft.
   */
  readonly draftText?: string;
  readonly error?: string;
}

export interface GetSessionHandoverStateParams {
  readonly sourceSessionId: string;
}

export interface GetSessionHandoverStateResult {
  readonly state?: SessionHandoverState;
}

export interface BeginSessionHandoverParams {
  readonly sourceSessionId: string;
  readonly sourceTabId: string;
  readonly handoff?: string;
  /**
   * Composer text captured with the explicit handover request. It becomes the
   * operation's draft: delivered to the successor on success, returned as
   * `draftText` on cancel or failure, never sent to the source.
   */
  readonly queuedInput?: string;
  /** Skip the work-in-flight wait ("Continue now anyway"). */
  readonly continueNow?: boolean;
}

/** Frontend acknowledgement after it bound and focused a successor tab. */
export interface SuccessorBoundParams {
  readonly operationId: string;
  readonly sourceTabId: string;
  readonly successorTabId: string;
}

export interface SuccessorBoundResult {
  readonly acknowledged: boolean;
}

export type BeginSessionHandoverResult =
  | {
      readonly accepted: true;
      readonly state: SessionHandoverState;
      /**
       * True only when the operation now owns the `queuedInput` text (as its
       * draft / for the successor). Absent or false means the caller must
       * keep its composer text.
       */
      readonly draftCaptured?: boolean;
    }
  | {
      readonly accepted: false;
      /** `source-unavailable`: the source session no longer exists. */
      readonly error: 'unavailable' | 'source-unavailable';
    };

export interface CancelSessionHandoverParams {
  readonly sourceSessionId: string;
  readonly operationId: string;
}

export interface CancelSessionHandoverResult {
  readonly cancelled: boolean;
  readonly state?: SessionHandoverState;
}

export const SESSION_HANDOVER_HELD = 'SESSION_HANDOVER_HELD' as const;
export const SESSION_HANDOVER_IN_PROGRESS =
  'SESSION_HANDOVER_IN_PROGRESS' as const;

export type SessionHandoverResponseCode =
  | typeof SESSION_HANDOVER_HELD
  | typeof SESSION_HANDOVER_IN_PROGRESS;
