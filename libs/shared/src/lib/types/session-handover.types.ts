/** Shared session handover contract. Transport never exposes queued inputs. */
export type SessionHandoverReason = 'budget-limit' | 'budget-auto' | 'successor';

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
   * Work still running on the source while an automatic handover waits in
   * `waiting-for-turn-end`: in-flight subagents and CLI agent lanes.
   */
  readonly waitingFor?: {
    readonly subagents: number;
    readonly lanes: number;
  };
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
  /** Composer text captured with the explicit handover request. */
  readonly queuedInput?: string;
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
  | { readonly accepted: true; readonly state: SessionHandoverState }
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
