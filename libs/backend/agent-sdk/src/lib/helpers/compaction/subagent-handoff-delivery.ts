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
 *   main-thread tool result carries it; if that notice is dropped as well,
 *   one last send runs, with no further fallback.
 *
 * A push that timed out (`SEND_TIMEOUT`) is neither retried nor queued: the
 * dispatcher leaves that write pending, so the session can still read it,
 * and a second copy would be a duplicate handoff.
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
  post(sessionId: string, toolCallId: string, text: string): void {
    this.port.postMainThreadNotice(
      sessionId,
      text,
      () => void this.send(sessionId, toolCallId, text),
    );
  }

  /**
   * Send the handoff as a user turn, with bounded retries. When they all
   * fail and `keepPending` is set, it waits in the notice queue instead.
   * Never rejects.
   */
  async send(
    sessionId: string,
    toolCallId: string,
    text: string,
    keepPending = true,
  ): Promise<void> {
    let lastErrorType = 'unknown';
    for (let attempt = 1; attempt <= PARENT_PUSH_ATTEMPTS; attempt += 1) {
      if (attempt > 1) {
        await wait(PARENT_PUSH_RETRY_DELAY_MS * (attempt - 1));
      }
      const liveId = this.liveSessionId(sessionId);
      if (!liveId) {
        return;
      }
      try {
        await this.port.pushParentMessage(liveId, text);
        this.logger.info(
          '[SubagentBudgetMonitor] Handoff sent to the parent as a user turn',
          { sessionId: liveId, toolCallId, attempt },
        );
        return;
      } catch (error: unknown) {
        lastErrorType = errorType(error);
        if (
          error instanceof RpcUserError &&
          error.errorCode === 'SEND_TIMEOUT'
        ) {
          this.logger.warn(
            '[SubagentBudgetMonitor] Handoff not read by the parent in time; left pending on its input, not resent',
            { sessionId: liveId, toolCallId, attempt },
          );
          return;
        }
      }
    }
    const liveId = this.liveSessionId(sessionId);
    if (!liveId) {
      return;
    }
    const failure = {
      sessionId: liveId,
      toolCallId,
      attempts: PARENT_PUSH_ATTEMPTS,
      errorType: lastErrorType,
    };
    if (!keepPending) {
      this.logger.warn(
        '[SubagentBudgetMonitor] Handoff message not delivered to the parent',
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
}
