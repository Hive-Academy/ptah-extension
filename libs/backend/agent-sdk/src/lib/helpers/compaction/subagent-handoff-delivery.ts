/**
 * SubagentHandoffDelivery — gets the handoff of a subagent stopped by the
 * `SubagentBudgetMonitor` to the parent exactly once.
 *
 * Routes:
 *
 * - {@link SubagentHandoffDelivery.post} (foreground subagent): the handoff
 *   waits in the main-thread notice queue for the spawning tool result. If
 *   the queue drops it undelivered (past its bound, or cleared at turn or
 *   session end), it is sent as a user turn instead.
 * - {@link SubagentHandoffDelivery.send} (background subagent, or a notice
 *   withdrawn undrained): a host-authored user turn (`pushParentMessage`),
 *   tried up to {@link PARENT_PUSH_ATTEMPTS} times with a linear backoff of
 *   {@link PARENT_PUSH_RETRY_DELAY_MS} per attempt. When every attempt fails,
 *   the handoff is kept pending in the main-thread notice queue, so the next
 *   main-thread tool result carries it; if that notice is dropped as well and
 *   its send fails too, it becomes a pending record (below).
 * - Pending record: one per spawning tool call, owned by its session. The
 *   monitor calls {@link SubagentHandoffDelivery.retryPending} on each later
 *   main-thread message of the session (the parent is running again), which
 *   pushes the record once; after {@link PENDING_HANDOFF_MAX_RETRIES} failed
 *   retries it is dropped with one warn. Session end drops it too
 *   ({@link SubagentHandoffDelivery.release}).
 *
 * A push that timed out (`SEND_TIMEOUT`) counts as delivered: it is neither
 * retried nor kept pending. The dispatcher's timeout only stops waiting; the
 * SDK's `streamInput` has already written the message to the CLI input (or
 * buffered it until the process is ready) and keeps running, so a second
 * copy would be a duplicate handoff.
 *
 * Released session: each attempt resolves the session's current id first
 * (rekeys move it); once the session is released the handoff is dropped.
 *
 * Logs carry ids, attempt counts and the error type, never handoff text.
 */
import { RpcUserError, type Logger } from '@ptah-extension/vscode-core';

/** `pushParentMessage` calls per user-turn delivery: the first and two retries. */
export const PARENT_PUSH_ATTEMPTS = 3;
/** Wait before retry n is n times this (500 ms, then 1 s). */
export const PARENT_PUSH_RETRY_DELAY_MS = 500;
/** Later main-thread messages a pending record is retried on before it is dropped. */
export const PENDING_HANDOFF_MAX_RETRIES = 5;

/** The dispatcher and main-thread notice queue operations delivery uses. */
export interface HandoffDeliveryPort {
  /** Stream a host-authored user turn to the parent session. */
  pushParentMessage(sessionId: string, content: string): Promise<void>;
  /**
   * Queue a notice for the parent's next main-thread tool result
   * (`MainThreadNoticeQueue.post`); `onDropped` runs if the queue drops it
   * undelivered.
   */
  postMainThreadNotice(
    sessionId: string,
    text: string,
    onDropped?: () => void,
  ): void;
}

/** A handoff whose user-turn sends and queued notice all failed so far. */
interface PendingHandoff {
  sessionId: string;
  toolCallId: string;
  text: string;
  retries: number;
  inFlight: boolean;
}

/** `settled`: sent, timed out (taken as sent), or the session was released. */
type PushOutcome = { settled: true } | { settled: false; errorType: string };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export class SubagentHandoffDelivery {
  /** Pending records by spawning tool call id. */
  private readonly pending = new Map<string, PendingHandoff>();

  constructor(
    private readonly logger: Logger,
    private readonly port: HandoffDeliveryPort,
    /** The id a session lives on as now, `undefined` once it was released. */
    private readonly liveSessionId: (sessionId: string) => string | undefined,
  ) {}

  /** Queue the handoff for the spawning tool result; a dropped notice is sent as a user turn. */
  post(sessionId: string, toolCallId: string, text: string): void {
    this.port.postMainThreadNotice(
      sessionId,
      text,
      () => void this.send(sessionId, toolCallId, text),
    );
  }

  /**
   * Send the handoff as a user turn, with bounded retries. When they all
   * fail it waits in the notice queue (`keepPending`) or, once the queue
   * has dropped it, in a pending record. Never rejects.
   */
  async send(
    sessionId: string,
    toolCallId: string,
    text: string,
    keepPending = true,
  ): Promise<void> {
    const outcome = await this.push(
      sessionId,
      toolCallId,
      text,
      PARENT_PUSH_ATTEMPTS,
    );
    const liveId = this.liveSessionId(sessionId);
    if (outcome.settled || !liveId) {
      return;
    }
    const failure = {
      sessionId: liveId,
      toolCallId,
      attempts: PARENT_PUSH_ATTEMPTS,
      errorType: outcome.errorType,
    };
    if (!keepPending) {
      this.pending.set(toolCallId, {
        sessionId: liveId,
        toolCallId,
        text,
        retries: 0,
        inFlight: false,
      });
      this.logger.warn(
        '[SubagentBudgetMonitor] Handoff not delivered as a user turn; kept pending for the next main-thread message',
        failure,
      );
      return;
    }
    this.port.postMainThreadNotice(
      liveId,
      text,
      () => void this.send(liveId, toolCallId, text, false),
    );
    this.logger.warn(
      '[SubagentBudgetMonitor] Handoff not delivered as a user turn; kept pending for the next main-thread tool result',
      failure,
    );
  }

  /**
   * A main-thread message of `sessionId` arrived: push each of its pending
   * records once. A record is dropped once delivered, once its session is
   * released, or after {@link PENDING_HANDOFF_MAX_RETRIES} failed retries
   * (one warn). Never rejects.
   */
  async retryPending(sessionId: string): Promise<void> {
    if (this.pending.size === 0) {
      return;
    }
    const liveId = this.liveSessionId(sessionId);
    if (!liveId) {
      return;
    }
    for (const record of [...this.pending.values()]) {
      if (record.inFlight || this.liveSessionId(record.sessionId) !== liveId) {
        continue;
      }
      record.inFlight = true;
      record.retries += 1;
      const outcome = await this.push(
        record.sessionId,
        record.toolCallId,
        record.text,
        1,
      );
      record.inFlight = false;
      if (outcome.settled || !this.liveSessionId(record.sessionId)) {
        this.pending.delete(record.toolCallId);
      } else if (record.retries >= PENDING_HANDOFF_MAX_RETRIES) {
        this.pending.delete(record.toolCallId);
        this.logger.warn(
          '[SubagentBudgetMonitor] Handoff message not delivered to the parent; pending retries exhausted',
          {
            sessionId: liveId,
            toolCallId: record.toolCallId,
            retries: record.retries,
            errorType: outcome.errorType,
          },
        );
      }
    }
  }

  /** Session end: drop every pending record whose session is released. */
  release(): void {
    for (const [toolCallId, record] of this.pending) {
      if (!this.liveSessionId(record.sessionId)) {
        this.pending.delete(toolCallId);
      }
    }
  }

  /** Up to `attempts` pushes with the linear backoff; never rejects. */
  private async push(
    sessionId: string,
    toolCallId: string,
    text: string,
    attempts: number,
  ): Promise<PushOutcome> {
    let lastErrorType = 'unknown';
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (attempt > 1) {
        await wait(PARENT_PUSH_RETRY_DELAY_MS * (attempt - 1));
      }
      const liveId = this.liveSessionId(sessionId);
      if (!liveId) {
        return { settled: true };
      }
      try {
        await this.port.pushParentMessage(liveId, text);
        this.logger.info(
          '[SubagentBudgetMonitor] Handoff sent to the parent as a user turn',
          { sessionId: liveId, toolCallId, attempt },
        );
        return { settled: true };
      } catch (error: unknown) {
        lastErrorType = errorType(error);
        if (
          error instanceof RpcUserError &&
          error.errorCode === 'SEND_TIMEOUT'
        ) {
          this.logger.warn(
            '[SubagentBudgetMonitor] Handoff not read by the parent in time; its write stays queued, not resent',
            { sessionId: liveId, toolCallId, attempt },
          );
          return { settled: true };
        }
      }
    }
    return { settled: false, errorType: lastErrorType };
  }
}
