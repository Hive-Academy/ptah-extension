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
 *   main-thread tool result carries it. If that notice is dropped as well,
 *   it becomes a pending record (below) before it is sent again.
 * - Pending record: one per spawning tool call, owned by its session. It is
 *   registered before the drop-triggered send starts. The monitor calls
 *   {@link SubagentHandoffDelivery.retryPending} on each later main-thread
 *   message of the session (the parent is running again), which pushes the
 *   record once. A message that arrives while the record's push is in flight
 *   is remembered and gets one retry right after that push fails. After
 *   {@link PENDING_HANDOFF_MAX_RETRIES} failed retries the record is replaced
 *   by a short undelivered notice in the main-thread notice queue
 *   ({@link undeliveredHandoffNotice}). If the queue drops that notice too,
 *   the record comes back and the next main-thread message posts the notice
 *   again; it is never pushed again. Session end drops the record
 *   ({@link SubagentHandoffDelivery.release}).
 *
 * Exactly once: a record pushes from one caller at a time (`inFlight`), and
 * a handoff is never queued and kept as a record at the same time.
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
import type { HandoffSubject } from './subagent-handoff-message';

/** `pushParentMessage` calls per user-turn delivery: the first and two retries. */
export const PARENT_PUSH_ATTEMPTS = 3;
/** Wait before retry n is n times this (500 ms, then 1 s). */
export const PARENT_PUSH_RETRY_DELAY_MS = 500;
/** Failed retries of a pending record before the undelivered notice replaces it. */
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

/** A stopped subagent's handoff message and where its work is. */
export interface Handoff {
  /** The handoff message (`handoffMessage`). */
  readonly text: string;
  /** The subagent and task the handoff names. */
  readonly subject: HandoffSubject;
  /** Its progress notes path as the handoff names it; absent without a workspace. */
  readonly notesPath?: string;
}

/**
 * The notice that replaces a handoff whose deliveries all failed: who was
 * stopped and where its notes and output are, as the handoff names them.
 * No task or prompt text.
 */
export function undeliveredHandoffNotice(handoff: Handoff): string {
  const { subject, notesPath } = handoff;
  const name = subject.teammateName
    ? `\`${subject.agentType}\` ('${subject.teammateName}')`
    : `\`${subject.agentType}\``;
  return [
    `Ptah's subagent budget monitor stopped subagent ${name}, but its ` +
      `handoff message could not be delivered to you.`,
    notesPath
      ? `Its progress notes file, if it was written: ${notesPath}.`
      : 'Its progress notes file: unavailable (workspace unknown).',
    subject.outputFile
      ? `Its output so far is in ${subject.outputFile} (task ${subject.taskId}).`
      : `Its output file: not yet known; it is in the task notification for task ${subject.taskId}.`,
  ].join('\n');
}

/** A handoff whose user-turn sends and queued notice all failed so far. */
interface PendingHandoff {
  readonly sessionId: string;
  readonly toolCallId: string;
  readonly handoff: Handoff;
  retries: number;
  inFlight: boolean;
  /** A main-thread message arrived while a push was in flight. */
  missed: boolean;
  /** Retries are exhausted and the undelivered notice was dropped: post it again. */
  noticeDue: boolean;
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
  post(sessionId: string, toolCallId: string, handoff: Handoff): void {
    this.port.postMainThreadNotice(
      sessionId,
      handoff.text,
      () => void this.send(sessionId, toolCallId, handoff),
    );
  }

  /**
   * Send the handoff as a user turn, with bounded retries. When they all
   * fail it waits in the notice queue; once the queue has dropped it, it is
   * a pending record. Never rejects.
   */
  async send(
    sessionId: string,
    toolCallId: string,
    handoff: Handoff,
  ): Promise<void> {
    const outcome = await this.push(
      sessionId,
      toolCallId,
      handoff.text,
      PARENT_PUSH_ATTEMPTS,
    );
    const liveId = this.liveSessionId(sessionId);
    if (outcome.settled || !liveId) {
      return;
    }
    this.port.postMainThreadNotice(
      liveId,
      handoff.text,
      () => void this.sendDropped(liveId, toolCallId, handoff),
    );
    this.logger.warn(
      '[SubagentBudgetMonitor] Handoff not delivered as a user turn; kept pending for the next main-thread tool result',
      {
        sessionId: liveId,
        toolCallId,
        attempts: PARENT_PUSH_ATTEMPTS,
        errorType: outcome.errorType,
      },
    );
  }

  /**
   * A main-thread message of `sessionId` arrived: push each of its pending
   * records once, or post the undelivered notice again for a record whose
   * retries are exhausted. A record in flight is marked so it retries once
   * when that push fails. Never rejects.
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
      // Skip a record an earlier await of this loop saw delivered or replaced.
      if (
        this.pending.get(record.toolCallId) !== record ||
        this.liveSessionId(record.sessionId) !== liveId
      ) {
        continue;
      }
      if (record.inFlight) {
        record.missed = true;
      } else if (record.noticeDue) {
        this.postUndeliveredNotice(record);
      } else {
        await this.retryRecord(record);
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

  /**
   * The queue dropped the fallback notice. The record is registered before
   * the send starts, so a main-thread message during its backoff is
   * remembered instead of missed.
   */
  private async sendDropped(
    sessionId: string,
    toolCallId: string,
    handoff: Handoff,
  ): Promise<void> {
    const liveId = this.liveSessionId(sessionId);
    if (!liveId) {
      return;
    }
    const record: PendingHandoff = {
      sessionId: liveId,
      toolCallId,
      handoff,
      retries: 0,
      inFlight: false,
      missed: false,
      noticeDue: false,
    };
    this.pending.set(toolCallId, record);
    const outcome = await this.pushRecord(record, PARENT_PUSH_ATTEMPTS);
    if (outcome.settled) {
      return;
    }
    this.logger.warn(
      '[SubagentBudgetMonitor] Handoff not delivered as a user turn; kept pending for the next main-thread message',
      {
        sessionId: liveId,
        toolCallId,
        attempts: PARENT_PUSH_ATTEMPTS,
        errorType: outcome.errorType,
      },
    );
    await this.retryIfMissed(record);
  }

  /** One retry; at the cap the undelivered notice replaces the record. */
  private async retryRecord(record: PendingHandoff): Promise<void> {
    record.retries += 1;
    const outcome = await this.pushRecord(record, 1);
    if (outcome.settled) {
      return;
    }
    if (record.retries < PENDING_HANDOFF_MAX_RETRIES) {
      await this.retryIfMissed(record);
      return;
    }
    record.missed = false;
    this.logger.warn(
      '[SubagentBudgetMonitor] Handoff message not delivered to the parent; pending retries exhausted, undelivered notice queued',
      {
        sessionId: record.sessionId,
        toolCallId: record.toolCallId,
        retries: record.retries,
        errorType: outcome.errorType,
      },
    );
    this.postUndeliveredNotice(record);
  }

  /** A main-thread message arrived during the failed push: use it now. */
  private async retryIfMissed(record: PendingHandoff): Promise<void> {
    if (record.missed && this.pending.get(record.toolCallId) === record) {
      record.missed = false;
      await this.retryRecord(record);
    }
  }

  /** Push a record's handoff; the record is dropped once the push settled. */
  private async pushRecord(
    record: PendingHandoff,
    attempts: number,
  ): Promise<PushOutcome> {
    record.inFlight = true;
    const outcome = await this.push(
      record.sessionId,
      record.toolCallId,
      record.handoff.text,
      attempts,
    );
    record.inFlight = false;
    if (outcome.settled || !this.liveSessionId(record.sessionId)) {
      this.pending.delete(record.toolCallId);
      return { settled: true };
    }
    return outcome;
  }

  /**
   * Replace the record by the undelivered notice in the main-thread notice
   * queue. If the queue drops that notice while the session is live, the
   * record comes back (`noticeDue`) for the next main-thread message.
   */
  private postUndeliveredNotice(record: PendingHandoff): void {
    this.pending.delete(record.toolCallId);
    record.noticeDue = false;
    const liveId = this.liveSessionId(record.sessionId);
    if (!liveId) {
      return;
    }
    this.port.postMainThreadNotice(
      liveId,
      undeliveredHandoffNotice(record.handoff),
      () => {
        if (!this.liveSessionId(record.sessionId)) {
          return;
        }
        record.noticeDue = true;
        this.pending.set(record.toolCallId, record);
        this.logger.warn(
          '[SubagentBudgetMonitor] Undelivered-handoff notice dropped; kept for the next main-thread message',
          { sessionId: liveId, toolCallId: record.toolCallId },
        );
      },
    );
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
