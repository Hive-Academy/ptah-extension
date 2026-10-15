/**
 * SubagentHandoffDelivery — hands the parent the handoff of a subagent
 * stopped by the `SubagentBudgetMonitor`.
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
 *   the handoff is posted once more to the notice queue for the next
 *   main-thread tool result; if the queue drops that notice, delivery ends.
 *
 * Delivery is best effort and keeps no state: the durable copy is the
 * handoff record (`subagent-handoff-record.ts`), which stays `pending` until
 * the parent sets its status, and every main-thread prompt names it.
 *
 * A push that timed out (`SEND_TIMEOUT`) counts as delivered: it is not
 * retried. The dispatcher's timeout only stops waiting; the SDK's
 * `streamInput` has already written the message to the CLI input (or
 * buffered it until the process is ready) and keeps running, so a second
 * copy would be a duplicate handoff.
 *
 * Released session: each attempt resolves the session's current id first
 * (rekeys move it); once the session is released the handoff is dropped.
 *
 * Logs carry ids, attempt counts and the error type, never handoff text.
 */
import { RpcUserError, type Logger } from '@ptah-extension/vscode-core';
import type { HandoffSubject } from './subagent-handoff-message';

/** `pushParentMessage` calls per user-turn delivery: the first and two retries. */
export const PARENT_PUSH_ATTEMPTS = 3;
/** Wait before retry n is n times this (500 ms, then 1 s). */
export const PARENT_PUSH_RETRY_DELAY_MS = 500;

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

/** A stopped subagent's handoff message and where its record is. */
export interface Handoff {
  /** The handoff message (`handoffMessage`). */
  readonly text: string;
  /** The subagent and task the handoff names. */
  readonly subject: HandoffSubject;
  /** The handoff record; absent when a safety stop could not write one. */
  readonly recordPath?: string;
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
  constructor(
    private readonly logger: Logger,
    private readonly port: HandoffDeliveryPort,
    /** The id a session lives on as now, `undefined` once it was released. */
    private readonly liveSessionId: (sessionId: string) => string | undefined,
  ) {}

  /** Queue the handoff for the spawning tool result; a dropped notice is sent as a user turn. */
  post(sessionId: string, toolCallId: string, handoff: Handoff): void {
    this.port.postMainThreadNotice(
      sessionId,
      handoff.text,
      () => void this.send(sessionId, toolCallId, handoff),
    );
  }

  /**
   * Send the handoff as a user turn, with bounded retries. When they all
   * fail it is posted once to the notice queue, with no further fallback.
   * Never rejects.
   */
  async send(
    sessionId: string,
    toolCallId: string,
    handoff: Handoff,
  ): Promise<void> {
    const outcome = await this.push(sessionId, toolCallId, handoff.text);
    const liveId = this.liveSessionId(sessionId);
    if (outcome.settled || !liveId) {
      return;
    }
    this.port.postMainThreadNotice(liveId, handoff.text);
    this.logger.warn(
      handoff.recordPath
        ? '[SubagentBudgetMonitor] Handoff not pushed; the record stays pending, the notice waits for the next main-thread tool result'
        : '[SubagentBudgetMonitor] Handoff not pushed and no durable record; the notice waits for the next main-thread tool result',
      {
        sessionId: liveId,
        toolCallId,
        attempts: PARENT_PUSH_ATTEMPTS,
        errorType: outcome.errorType,
      },
    );
  }

  /** Up to {@link PARENT_PUSH_ATTEMPTS} pushes with the linear backoff; never rejects. */
  private async push(
    sessionId: string,
    toolCallId: string,
    text: string,
  ): Promise<PushOutcome> {
    let lastErrorType = 'unknown';
    for (let attempt = 1; attempt <= PARENT_PUSH_ATTEMPTS; attempt += 1) {
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
