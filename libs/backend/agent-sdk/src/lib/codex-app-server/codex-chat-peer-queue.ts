import type { Logger } from '@ptah-extension/vscode-core';
import type { CodexChatSession } from './codex-chat-turn-stream';
import { CodexChatAdapterError } from './codex-chat-adapter-error';
import { SessionAdmissionRefusedError } from '../errors/session-admission-refused.error';

const MAX_PEER_MESSAGES = 32;
type QueueSession = Pick<CodexChatSession, 'busy' | 'blocked' | 'closing' | 'abort'>;

interface PeerMessage {
  run(): Promise<void>;
  resolve(): void;
  reject(error: Error): void;
  admissionId: string | undefined;
  admitted: boolean;
  idle: boolean;
}

/** Starts one peer turn at a time; admission settles the caller, idle advances FIFO. */
export class CodexChatPeerQueue {
  private readonly queued = new Map<QueueSession, PeerMessage[]>();
  private readonly active = new Map<QueueSession, PeerMessage>();

  constructor(private readonly logger: Logger) {}

  hasPending(session: QueueSession): boolean {
    return this.active.has(session) || (this.queued.get(session)?.length ?? 0) > 0;
  }

  send(session: QueueSession, run: () => Promise<void>, admissionId?: string): Promise<void> {
    if (session.closing || session.abort.signal.aborted) {
      return Promise.reject(admissionId
        ? new SessionAdmissionRefusedError('session-ended', admissionId)
        : new CodexChatAdapterError('unavailable', 'peerMessage'));
    }
    if (admissionId && (session.busy || session.blocked || this.hasPending(session)))
      return Promise.reject(new SessionAdmissionRefusedError('busy', admissionId));
    const pending = this.queued.get(session) ?? [];
    if (pending.length + Number(this.active.has(session)) >= MAX_PEER_MESSAGES)
      return Promise.reject(admissionId
        ? new SessionAdmissionRefusedError('busy', admissionId)
        : new CodexChatAdapterError('busy', 'peerQueueFull'));

    const result = new Promise<void>((resolve, reject) => {
      pending.push({ run, resolve, reject, admitted: false, idle: false, admissionId });
    });
    this.queued.set(session, pending);
    this.startNext(session);
    return result;
  }

  onIdle(session: QueueSession): void {
    if (session.closing || session.abort.signal.aborted) {
      this.rejectPending(session);
      return;
    }
    const active = this.active.get(session);
    if (active) {
      active.idle = true;
      if (active.admitted) this.finish(session, active);
    } else {
      this.startNext(session);
    }
  }

  rejectPending(session: QueueSession): void {
    const pending = this.queued.get(session) ?? [];
    const active = this.active.get(session);
    if (active && !active.admitted) pending.unshift(active);
    this.queued.delete(session);
    this.active.delete(session);
    for (const entry of pending) {
      const error = entry.admissionId
        ? new SessionAdmissionRefusedError('session-ended', entry.admissionId)
        : new CodexChatAdapterError('unavailable', 'peerMessage');
      this.logger.error(
        '[CodexChatAdapter] Queued peer message rejected: session unavailable.',
        error,
      );
      entry.reject(error);
    }
  }

  private startNext(session: QueueSession): void {
    if (this.active.has(session) || session.busy) return;
    if (session.closing || session.abort.signal.aborted) {
      this.rejectPending(session);
      return;
    }
    if (session.blocked) return;
    const pending = this.queued.get(session);
    const entry = pending?.shift();
    if (!entry) {
      this.queued.delete(session);
      return;
    }
    this.active.set(session, entry);
    void Promise.resolve().then(() => {
      if (this.active.get(session) !== entry) return;
      return entry.run();
    }).then(
      () => {
        if (this.active.get(session) !== entry) return;
        entry.admitted = true;
        entry.resolve();
        if (entry.idle || !session.busy) this.finish(session, entry);
      },
      (error: unknown) => {
        if (this.active.get(session) !== entry) return;
        if (
          error instanceof CodexChatAdapterError &&
          error.code === 'busy' && error.operation === 'turn' &&
          !entry.admissionId &&
          !session.closing && !session.abort.signal.aborted
        ) {
          // A non-queue turn claimed busy after this entry was selected.
          // Restore the head and wait for that turn's release notification.
          this.active.delete(session);
          entry.idle = false;
          this.queued.get(session)?.unshift(entry);
          this.startNext(session);
          return;
        }
        entry.admitted = true;
        if (entry.admissionId && error instanceof CodexChatAdapterError &&
            error.operation === 'turn' &&
            (error.code === 'busy' || error.code === 'unavailable')) {
          entry.reject(new SessionAdmissionRefusedError(
            session.closing || session.abort.signal.aborted ? 'session-ended' : 'busy',
            entry.admissionId,
            { cause: error },
          ));
        } else {
          entry.reject(error instanceof CodexChatAdapterError
            ? error
            : new CodexChatAdapterError('runtime-failed', 'peerMessage', { cause: error }));
        }
        if (entry.idle || !session.busy) this.finish(session, entry);
      },
    );
  }

  private finish(session: QueueSession, entry: PeerMessage): void {
    if (this.active.get(session) !== entry) return;
    this.active.delete(session);
    this.startNext(session);
  }
}
