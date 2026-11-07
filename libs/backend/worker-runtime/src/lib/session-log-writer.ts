import type {
  EventFrame,
  SessionEventType,
} from '@ptah-extension/worker-protocol';
import { SessionEventLog } from './session-event-log';
import { SessionFanOut } from './fan-out';

export class SessionLogFailedError extends Error {
  readonly code = 'SESSION_LOG_FAILED' as const;
  constructor() {
    super(
      'The session event log failed. Restart the worker before continuing.',
    );
    this.name = 'SessionLogFailedError';
  }
}

interface PendingRecord {
  type: SessionEventType;
  payload: unknown;
  resolve: (frame: EventFrame) => void;
  reject: (error: SessionLogFailedError) => void;
}

export interface SessionLogWriterOptions {
  /** Called once, on the first append failure; implementation aborts the active turn. */
  onAppendFailed: (sessionId: string, error: unknown) => void;
  /** Test seam for a slow or failed append; production uses log.append. */
  append?: (type: SessionEventType, payload: unknown) => Promise<EventFrame>;
  now?: () => number;
}

/** The sole producer of live evt frames. A frame is published after append resolves. */
export class SessionLogWriter {
  private readonly queue: PendingRecord[] = [];
  private draining = false;
  private failed = false;
  private turnOpen = false;
  private lastSyncAt = 0;
  private readonly now: () => number;

  constructor(
    readonly log: SessionEventLog,
    /** Subscribers attach here; only this writer publishes to it. */
    readonly fanOut: SessionFanOut,
    private readonly options: SessionLogWriterOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  get head(): number {
    return this.log.head;
  }
  get latestMark() {
    return this.log.latestMark;
  }
  get degraded(): boolean {
    return this.failed;
  }

  enqueue(type: SessionEventType, payload: unknown): Promise<EventFrame> {
    if (this.failed) return Promise.reject(new SessionLogFailedError());
    if (this.queue.length >= 10_000) {
      this.fail(new Error('Session capture queue overflow'));
      return Promise.reject(new SessionLogFailedError());
    }
    return new Promise<EventFrame>((resolve, reject) => {
      this.queue.push({ type, payload, resolve, reject });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (!this.failed && this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) break;
        try {
          const append =
            this.options.append ??
            ((type: SessionEventType, payload: unknown) =>
              this.log.append(type, payload));
          const frame = await append(item.type, item.payload);
          // An overflow can fail the writer while this write is in flight.
          if (this.failed) {
            item.reject(new SessionLogFailedError());
            break;
          }
          if (frame.seq !== this.log.head)
            throw new Error('Append did not advance log head');
          if (item.type === 'worker:turn.begin') this.turnOpen = true;
          if (
            item.type === 'worker:turn.end' ||
            item.type === 'worker:turn.interrupted'
          )
            this.turnOpen = false;
          const now = this.now();
          if (!this.turnOpen || now - this.lastSyncAt >= 1000) {
            await this.log.sync();
            this.lastSyncAt = now;
          }
          if (this.failed) {
            item.reject(new SessionLogFailedError());
            break;
          }
          this.fanOut.publish(frame);
          item.resolve(frame);
        } catch (error) {
          item.reject(new SessionLogFailedError());
          this.fail(error);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private fail(error: unknown): void {
    if (this.failed) return;
    this.failed = true;
    for (const item of this.queue.splice(0))
      item.reject(new SessionLogFailedError());
    try {
      this.options.onAppendFailed(this.log.sessionId, error);
    } finally {
      this.fanOut.degraded(this.log.sessionId);
    }
  }
}
