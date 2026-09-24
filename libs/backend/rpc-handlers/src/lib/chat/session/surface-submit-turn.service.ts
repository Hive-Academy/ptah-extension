/**
 * SurfaceSubmitTurnService — starts exactly one agent turn from an accepted
 * surface submit (TASK_2026_538, Req 10).
 *
 * The caller (the `surface:action` submit branch) has already validated the
 * submit, reserved its operation and frozen the formatted message. This service
 * only answers one question: did the chat runtime take the message as the next
 * turn of the session the surface is routed to? The answer is one of three:
 *
 *  - `applied`: `sendMessageToSession` resolved. The named runtime acceptance
 *    point is `SessionStreamPump.sendMessage` passing its `require-idle`
 *    admission check and pushing onto the session queue of the same, live,
 *    idle record. Acceptance-only, in the sense of
 *    `PeerSessionMessenger.send`: the pump yields the message on its next
 *    iteration, but this service does not observe the turn itself.
 *  - `rejected`: nothing was pushed. The record is missing or not live
 *    (`session-unavailable`), or it is busy (`busy`), either by the fast path
 *    here or by the pump's typed `SessionAdmissionRefusedError`.
 *  - `indeterminate`: any other failure, or no answer within
 *    `SURFACE_SUBMIT_DISPATCH_DEADLINE_MS`. The host cannot tell whether a push
 *    happened, so it never redispatches.
 *
 * Busy is rejected rather than held (plan Q1): a held message lives only in
 * the record's queue and is dropped silently on teardown, which would leave an
 * `applied` operation naming a turn that never ran.
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  SessionAdmissionRefusedError,
  type SessionLifecycleManager,
} from '@ptah-extension/agent-sdk';
import type {
  IAgentAdapter,
  SessionId,
  SurfaceRejectReason,
} from '@ptah-extension/shared';

import { CHAT_TOKENS } from '../tokens';
import type { ChatStreamBroadcaster } from '../streaming/chat-stream-broadcaster.service';

/**
 * The session record as the lifecycle manager hands it out. `SessionRecord`
 * itself is not exported from the `agent-sdk` barrel, so it is derived from
 * the public `find` signature instead of widening that barrel.
 */
type SessionRecordView = NonNullable<
  ReturnType<SessionLifecycleManager['find']>
>;

/**
 * The runtime reasons this service can reject with. Each member must be a
 * `SurfaceRejectReason` from the shared surface contract, because the submit
 * handler passes it through unchanged. The `satisfies` clause fails to compile
 * if a contract literal is renamed or removed; an `Extract` alone would
 * silently narrow to `never` instead.
 */
export const SURFACE_SUBMIT_TURN_REJECT_REASONS = [
  'busy',
  'session-unavailable',
] as const satisfies readonly SurfaceRejectReason[];

export type SurfaceSubmitTurnRejectReason =
  (typeof SURFACE_SUBMIT_TURN_REJECT_REASONS)[number];

export type SurfaceSubmitTurnOutcome =
  | { readonly status: 'applied' }
  | {
      readonly status: 'rejected';
      readonly reason: SurfaceSubmitTurnRejectReason;
      readonly detail: string;
    }
  | { readonly status: 'indeterminate'; readonly detail: string };

/**
 * Fixed, caller-safe explanation for an `indeterminate` outcome. The raw error
 * stays in the host log; its text is never forwarded across the RPC boundary.
 */
export const SURFACE_SUBMIT_INDETERMINATE_DETAIL =
  'The chat runtime failed while taking the submit. The message may have ' +
  'started a turn; it was not resent.';

/**
 * How long a dispatch may wait for `sendMessageToSession` before its outcome is
 * `indeterminate` (review F1, batch 11). No stated timeout exists in the plan
 * or requirements (Revision 6 item 3 only makes a UI-side timeout non-final),
 * so the value is chosen conservatively:
 *  - The awaited step is acceptance only (message preparation, then a
 *    synchronous admission check and enqueue), not the agent's turn, so a
 *    healthy send takes milliseconds; two minutes is far outside normal.
 *  - It is above the renderer's 30 s RPC budget, so a UI that timed out first
 *    polls `surface:operation` and sees `pending`, then the terminal outcome.
 *  - It is well inside `SURFACE_STORE_LIMITS.operationRetentionMs` (10 min),
 *    so the `indeterminate` record stays queryable after the deadline.
 */
export const SURFACE_SUBMIT_DISPATCH_DEADLINE_MS = 120_000;

/** Caller-safe detail when the deadline passes before the runtime answered. */
export const SURFACE_SUBMIT_DEADLINE_DETAIL =
  'The chat runtime did not confirm the submit in time. The message may ' +
  'still start a turn; it was not resent.';

/**
 * Optional construction options. Never registered in production, so every
 * host runs `SURFACE_SUBMIT_DISPATCH_DEADLINE_MS`; specs pass a shorter one.
 */
export const SURFACE_SUBMIT_TURN_OPTIONS = Symbol.for(
  'SurfaceSubmitTurnOptions',
);

export interface SurfaceSubmitTurnOptions {
  /** Positive, finite milliseconds; anything else uses the default. */
  readonly dispatchDeadlineMs?: number;
}

@injectable()
export class SurfaceSubmitTurnService {
  /**
   * Tab id -> the token of the dispatch currently awaiting
   * `sendMessageToSession` on that record. Keyed by `tabId` because it is
   * immutable on the record and is the same whether the caller routed by tab
   * id or by real session id. A second dispatch to the same record while one
   * is in flight is `busy` without a second send.
   *
   * The entry is released when the send settles OR when the deadline passes.
   * Releasing it while a stalled send may still be live is safe because the
   * runtime, not this map, is the authoritative protection: with
   * `admission: 'require-idle'`, `SessionStreamPump.sendMessage` re-checks
   * `turnInFlight` and `messageQueue.length === 0` synchronously immediately
   * before the push (Batch 3), and returns synchronously after it. Whichever of
   * two live sends reaches that point second is refused `busy` and pushes
   * nothing. A late settlement never touches this map, and the token makes
   * sure only the dispatch that set an entry can release it.
   */
  private readonly inFlight = new Map<string, symbol>();
  private readonly deadlineMs: number;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.AGENT_ADAPTER)
    private readonly agentAdapter: IAgentAdapter,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly lifecycle: SessionLifecycleManager,
    @inject(CHAT_TOKENS.STREAM_BROADCASTER)
    private readonly streamBroadcaster: ChatStreamBroadcaster,
    @inject(SURFACE_SUBMIT_TURN_OPTIONS, { isOptional: true })
    options?: SurfaceSubmitTurnOptions,
  ) {
    const requested = options?.dispatchDeadlineMs;
    this.deadlineMs =
      requested !== undefined && Number.isFinite(requested) && requested > 0
        ? requested
        : SURFACE_SUBMIT_DISPATCH_DEADLINE_MS;
  }

  /**
   * Send `content` as the next turn of the session routed by `routingId` (a
   * tab id or a real session id). Resolves with the outcome and never
   * rejects: every collaborator call and every diagnostic runs inside the
   * outcome boundary. One call sends at most once and never retries.
   *
   * Bounded: if the send has not settled within the deadline, the call
   * resolves `indeterminate` (never an invented failure) and releases the
   * per-record guard. A late settlement of that send is only logged; this
   * call has already returned its one outcome, so nothing is settled twice
   * and nothing is sent again.
   */
  async dispatch(
    routingId: string,
    content: string,
  ): Promise<SurfaceSubmitTurnOutcome> {
    const admission = this.admit(routingId);
    if (admission.kind === 'refused') {
      return admission.outcome;
    }

    // Acquired by THIS call only after the preflight passed; released below
    // only while it is still this call's token.
    const inFlightKey = admission.tabId;
    const token = Symbol(inFlightKey);
    this.inFlight.set(inFlightKey, token);
    const send = this.send(routingId, content);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'deadline'>((resolve) => {
      timer = setTimeout(() => resolve('deadline'), this.deadlineMs);
    });
    let outcome: SurfaceSubmitTurnOutcome;
    try {
      const first = await Promise.race([send, deadline]);
      if (first === 'deadline') {
        this.fenceLateOutcome(routingId, send);
        return {
          status: 'indeterminate',
          detail: SURFACE_SUBMIT_DEADLINE_DETAIL,
        };
      }
      outcome = first;
    } finally {
      clearTimeout(timer);
      if (this.inFlight.get(inFlightKey) === token) {
        this.inFlight.delete(inFlightKey);
      }
    }

    if (outcome.status === 'applied') {
      // Decided above; a failing logger cannot turn it into a throw.
      this.safeLog(
        'info',
        '[SurfaceSubmitTurn] submit accepted as the next turn',
        {
          routingId,
          contentLength: content.length,
          observed: 'acceptance-only',
        },
      );
    }
    return outcome;
  }

  /**
   * Record lookup, liveness and the busy fast path. A throw from any of the
   * collaborators it reads is `rejected: session-unavailable`: nothing has
   * been sent at this point, so the outcome is known and is not
   * `indeterminate`, and the host could not establish a live session to send
   * to. The busy check is a fast path only; the authoritative one is the
   * pump's `require-idle` admission, re-run after message preparation.
   */
  private admit(routingId: string): Admission {
    try {
      const record = this.lifecycle.find(routingId);
      if (!record) {
        return refused(
          rejected(
            'session-unavailable',
            'No chat session is registered for this surface.',
          ),
        );
      }
      if (!this.isLive(routingId, record)) {
        return refused(
          rejected(
            'session-unavailable',
            'The chat session for this surface is not live.',
          ),
        );
      }
      const tabId = record.tabId;
      if (
        record.turnInFlight ||
        record.messageQueue.length > 0 ||
        this.inFlight.has(tabId)
      ) {
        return refused(rejected('busy', BUSY_DETAIL));
      }
      return { kind: 'admitted', tabId };
    } catch (error: unknown) {
      this.safeLog('warn', '[SurfaceSubmitTurn] submit preflight failed', {
        routingId,
        ...describeError(error),
      });
      return refused(
        rejected(
          'session-unavailable',
          'The chat session for this surface could not be checked.',
        ),
      );
    }
  }

  /**
   * Registered AND attached to a broadcast loop. A record whose stream loop
   * has exited still answers `isSessionActive`, and a message sent to it sits
   * on a queue with no consumer. The stream is keyed by tab id for a session
   * started via `chat:start` and by the real session id once resumed, so both
   * keys count (same rule as `ChatSessionService.hasLiveSessionStream`).
   */
  private isLive(routingId: string, record: SessionRecordView): boolean {
    if (!this.agentAdapter.isSessionActive(routingId as SessionId)) {
      return false;
    }
    const realSessionId = record.realSessionId;
    return (
      (realSessionId !== null &&
        this.streamBroadcaster.isStreaming(realSessionId)) ||
      this.streamBroadcaster.isStreaming(record.tabId)
    );
  }

  /** The one send of a dispatch, classified. Never rejects. */
  private async send(
    routingId: string,
    content: string,
  ): Promise<SurfaceSubmitTurnOutcome> {
    try {
      // Origin is left to the default human turn: the user pressed submit.
      await this.agentAdapter.sendMessageToSession(
        routingId as SessionId,
        content,
        { admission: 'require-idle' },
      );
      return { status: 'applied' };
    } catch (error: unknown) {
      const outcome = classifySendFailure(error);
      this.logSendFailure(routingId, outcome, error);
      return outcome;
    }
  }

  /**
   * After the deadline, the send's eventual outcome is diagnostics only: the
   * dispatch already returned `indeterminate`, and the operation was settled
   * from that. Nothing here settles, retries or sends.
   */
  private fenceLateOutcome(
    routingId: string,
    send: Promise<SurfaceSubmitTurnOutcome>,
  ): void {
    this.safeLog(
      'warn',
      '[SurfaceSubmitTurn] submit not confirmed before the deadline',
      { routingId, deadlineMs: this.deadlineMs },
    );
    void send.then((late) =>
      this.safeLog(
        'info',
        '[SurfaceSubmitTurn] late submit outcome ignored after the deadline',
        { routingId, lateStatus: late.status },
      ),
    );
  }

  private logSendFailure(
    routingId: string,
    outcome: SurfaceSubmitTurnOutcome,
    error: unknown,
  ): void {
    if (outcome.status === 'rejected') {
      this.safeLog('info', '[SurfaceSubmitTurn] submit refused by admission', {
        routingId,
        reason: outcome.reason,
      });
      return;
    }
    this.safeLog('warn', '[SurfaceSubmitTurn] submit outcome indeterminate', {
      routingId,
      ...describeError(error),
    });
  }

  /**
   * Host diagnostics are best-effort: a logger that throws must never replace
   * an outcome that has already been decided, so its failure is swallowed.
   */
  private safeLog(
    level: 'info' | 'warn',
    message: string,
    meta: Record<string, unknown>,
  ): void {
    try {
      this.logger[level](message, meta);
    } catch {
      // Deliberately ignored: see the doc comment.
    }
  }
}

type Admission =
  | { readonly kind: 'admitted'; readonly tabId: string }
  | { readonly kind: 'refused'; readonly outcome: SurfaceSubmitTurnOutcome };

const BUSY_DETAIL = 'The chat session is running a turn.';

/**
 * The fixed outcome of a rejected send, decided from the error's type alone
 * and before any diagnostic runs.
 *
 * A `SessionAdmissionRefusedError` is thrown before any push, by construction
 * of the admission check, so it is a known `rejected`. Any other failure may
 * have happened before or after the push, and nothing in an untyped error says
 * which, so it is `indeterminate` and the message is not sent again. Even the
 * type test is guarded: `instanceof` on a proxy can throw, and that too is
 * `indeterminate`.
 */
function classifySendFailure(error: unknown): SurfaceSubmitTurnOutcome {
  let refusal: 'busy' | 'session-ended' | null = null;
  try {
    if (error instanceof SessionAdmissionRefusedError) {
      refusal = error.reason;
    }
  } catch {
    refusal = null;
  }
  if (refusal === 'busy') {
    return rejected('busy', BUSY_DETAIL);
  }
  if (refusal === 'session-ended') {
    return rejected(
      'session-unavailable',
      'The chat session for this surface has ended.',
    );
  }
  return {
    status: 'indeterminate',
    detail: SURFACE_SUBMIT_INDETERMINATE_DETAIL,
  };
}

/** Constant stand-in for a thrown value that cannot be described safely. */
const UNDESCRIBABLE_ERROR = {
  errorName: 'unknown',
  error: '<unprintable thrown value>',
} as const;

/**
 * Host-log fields for a thrown value. Any value is allowed, including a
 * null-prototype object or one whose conversion throws, so every read is
 * guarded and falls back to a constant.
 */
function describeError(error: unknown): { errorName: string; error: string } {
  try {
    if (error instanceof Error) {
      return { errorName: String(error.name), error: String(error.message) };
    }
    return { errorName: typeof error, error: String(error) };
  } catch {
    return UNDESCRIBABLE_ERROR;
  }
}

function refused(outcome: SurfaceSubmitTurnOutcome): Admission {
  return { kind: 'refused', outcome };
}

function rejected(
  reason: SurfaceSubmitTurnRejectReason,
  detail: string,
): SurfaceSubmitTurnOutcome {
  return { status: 'rejected', reason, detail };
}
