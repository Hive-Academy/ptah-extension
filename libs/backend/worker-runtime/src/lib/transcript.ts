import type {
  ISessionDriverLock,
  DriverHolder,
} from '@ptah-extension/platform-core';
import {
  FlatStreamEventSchema,
  type HistoryMark,
  type WorkerMethodResult,
} from '@ptah-extension/worker-protocol';
import type { z } from 'zod';
import {
  SessionEventLog,
  TranscriptUnavailableError,
} from './session-event-log';
import { SessionLogWriter } from './session-log-writer';

type HistoryEvent = z.infer<typeof FlatStreamEventSchema>;
export interface HistoryReader {
  readForResume(sessionId: string): Promise<{ events: HistoryEvent[] }>;
}
export type AttachResult = WorkerMethodResult<'session.attach'>;

export class DriverLockUnavailableError extends Error {
  readonly code = 'DRIVER_LOCK_UNAVAILABLE';
  constructor() {
    super('The session driver lock is unavailable.');
  }
}

export function historyMark(events: readonly HistoryEvent[]): HistoryMark {
  const last = events.at(-1) as { id?: unknown } | undefined;
  return {
    count: events.length,
    lastEventId: typeof last?.id === 'string' && last.id ? last.id : null,
  };
}

function sameMark(a: HistoryMark | null, b: HistoryMark): boolean {
  return !!a && a.count === b.count && a.lastEventId === b.lastEventId;
}

export class Transcript {
  constructor(
    private readonly history: HistoryReader,
    private readonly lock: ISessionDriverLock,
    private readonly owner: DriverHolder,
  ) {}

  async baseline(sessionId: string, writer: SessionLogWriter): Promise<void> {
    const { events } = await this.read(sessionId);
    await writer.enqueue('worker:baseline', {
      events,
      historyMark: historyMark(events),
    });
  }

  async mark(
    sessionId: string,
    turnId: string,
    writer: SessionLogWriter,
  ): Promise<void> {
    const { events } = await this.read(sessionId);
    await writer.enqueue('worker:history-mark', {
      historyMark: historyMark(events),
      turnId,
    });
  }

  async attach(
    sessionId: string,
    log: SessionEventLog | null,
    writer: SessionLogWriter | null,
    afterSeq?: number,
    driving = false,
    forceSnapshot = false,
  ): Promise<AttachResult> {
    if (!log || !writer || !log.latestMark || forceSnapshot) {
      return {
        mode: 'snapshot',
        events: (await this.read(sessionId)).events,
        live: false,
      };
    }
    if (!driving) {
      let acquisition;
      try {
        acquisition = await this.lock.acquire(sessionId, this.owner, 'refresh');
      } catch {
        throw new DriverLockUnavailableError();
      }
      if (!acquisition.ok) {
        if ('unavailable' in acquisition)
          throw new DriverLockUnavailableError();
        return {
          mode: 'snapshot',
          events: (await this.read(sessionId)).events,
          live: false,
          drivenBy: acquisition.holder.label,
        };
      }
      // Release the lock on every path; an error from the refresh itself
      // takes priority over a failed release.
      let refreshError: unknown;
      let refreshFailed = false;
      try {
        const { events } = await this.read(sessionId);
        if (!sameMark(log.latestMark, historyMark(events)))
          await writer.enqueue('worker:baseline', {
            events,
            historyMark: historyMark(events),
          });
      } catch (error) {
        refreshFailed = true;
        refreshError = error;
      }
      const released = await this.lock.release(sessionId, acquisition.nonce);
      if (refreshFailed) throw refreshError;
      if (released !== 'released') throw new DriverLockUnavailableError();
    }
    const baseline = log
      .replay()
      .filter((frame) => frame.type === 'worker:baseline')
      .at(-1);
    if (!baseline) throw new TranscriptUnavailableError();
    return {
      mode: 'log',
      epoch: log.epoch,
      fromSeq:
        afterSeq === undefined || afterSeq < baseline.seq
          ? baseline.seq - 1
          : afterSeq,
      headSeq: log.head,
    };
  }

  private async read(sessionId: string): Promise<{ events: HistoryEvent[] }> {
    try {
      return await this.history.readForResume(sessionId);
    } catch {
      throw new TranscriptUnavailableError();
    }
  }
}
