import { randomUUID } from 'node:crypto';
import { mkdir, open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import {
  checkSessionRecord,
  type EventFrame,
  type HistoryMark,
  type SessionEventType,
} from '@ptah-extension/worker-protocol';
import type { WorkerPaths } from './paths';

interface Header {
  h: 1;
  epoch: string;
  sessionId: string;
  createdAt: string;
}

interface RecordLine {
  s: number;
  t: SessionEventType;
  ts: number;
  p: unknown;
}

/** Corrupt completed records cannot be replayed safely. */
export class TranscriptUnavailableError extends Error {
  readonly code = 'TRANSCRIPT_UNAVAILABLE' as const;
  constructor() {
    super('The session transcript is unavailable.');
    this.name = 'TranscriptUnavailableError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHeader(value: unknown, sessionId: string): Header {
  if (
    !isObject(value) ||
    value.h !== 1 ||
    value.sessionId !== sessionId ||
    typeof value.epoch !== 'string' ||
    !value.epoch ||
    typeof value.createdAt !== 'string'
  )
    throw new TranscriptUnavailableError();
  return value as unknown as Header;
}

function parseRecord(value: unknown, expectedSeq: number): RecordLine {
  if (
    !isObject(value) ||
    value.s !== expectedSeq ||
    typeof value.t !== 'string' ||
    typeof value.ts !== 'number' ||
    !Number.isFinite(value.ts) ||
    !('p' in value)
  )
    throw new TranscriptUnavailableError();
  const checked = checkSessionRecord(value.t, value.p);
  if (!checked.ok) throw new TranscriptUnavailableError();
  return {
    s: expectedSeq,
    t: value.t as SessionEventType,
    ts: value.ts,
    p: checked.payload,
  };
}

function markFrom(record: RecordLine): HistoryMark | null {
  if (record.t !== 'worker:baseline' && record.t !== 'worker:history-mark')
    return null;
  const payload = record.p as { historyMark: HistoryMark };
  return payload.historyMark;
}

export class SessionEventLog {
  private readonly records: RecordLine[] = [];
  private constructor(
    private readonly handle: FileHandle,
    readonly sessionId: string,
    readonly epoch: string,
  ) {}
  get head(): number {
    return this.records.length;
  }
  get latestMark(): HistoryMark | null {
    for (let i = this.records.length - 1; i >= 0; i -= 1) {
      const mark = markFrom(this.records[i]);
      if (mark) return mark;
    }
    return null;
  }

  static async open(
    paths: WorkerPaths,
    sessionId: string,
  ): Promise<SessionEventLog> {
    // A session id is data, never a path component supplied unchecked by a client.
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(sessionId))
      throw new TranscriptUnavailableError();
    await mkdir(paths.events, { recursive: true, mode: 0o700 });
    const handle = await open(
      join(paths.events, `${sessionId}.jsonl`),
      'a+',
      0o600,
    );
    try {
      const contents = await handle.readFile('utf8');
      if (contents.length === 0) {
        const header: Header = {
          h: 1,
          epoch: randomUUID(),
          sessionId,
          createdAt: new Date().toISOString(),
        };
        await handle.write(`${JSON.stringify(header)}\n`);
        return new SessionEventLog(handle, sessionId, header.epoch);
      }
      const lastNewline = contents.lastIndexOf('\n');
      if (lastNewline < 0) throw new TranscriptUnavailableError();
      const complete = contents.slice(0, lastNewline + 1);
      const lines = complete.trimEnd().split('\n');
      const header = parseHeader(JSON.parse(lines[0]) as unknown, sessionId);
      const log = new SessionEventLog(handle, sessionId, header.epoch);
      for (const line of lines.slice(1)) {
        let value: unknown;
        try {
          value = JSON.parse(line) as unknown;
        } catch {
          throw new TranscriptUnavailableError();
        }
        log.records.push(parseRecord(value, log.head + 1));
      }
      if (complete.length !== contents.length)
        await handle.truncate(Buffer.byteLength(complete));
      let unfinished: string | null = null;
      for (const record of log.records) {
        if (record.t === 'worker:turn.begin')
          unfinished = (record.p as { turnId: string }).turnId;
        if (
          record.t === 'worker:turn.end' ||
          record.t === 'worker:turn.interrupted'
        )
          unfinished = null;
      }
      if (unfinished)
        await log.append('worker:turn.interrupted', { turnId: unfinished });
      return log;
    } catch (error) {
      await handle.close();
      if (error instanceof SyntaxError) throw new TranscriptUnavailableError();
      throw error;
    }
  }

  async append(type: SessionEventType, payload: unknown): Promise<EventFrame> {
    if (payload === undefined)
      throw new Error('Session record payload is missing');
    const checked = checkSessionRecord(type, payload);
    if (!checked.ok)
      throw new Error(`Invalid session record: ${checked.reason}`);
    const record: RecordLine = {
      s: this.head + 1,
      t: type,
      ts: Date.now(),
      p: checked.payload,
    };
    await this.handle.write(`${JSON.stringify(record)}\n`);
    this.records.push(record);
    return this.frame(record);
  }

  async sync(): Promise<void> {
    await this.handle.datasync();
  }
  async close(): Promise<void> {
    await this.handle.close();
  }
  replay(afterSeq = 0, throughSeq = this.head): EventFrame[] {
    return this.records
      .filter((r) => r.s > afterSeq && r.s <= throughSeq)
      .map((r) => this.frame(r));
  }
  private frame(record: RecordLine): EventFrame {
    return {
      v: 1,
      kind: 'evt',
      sessionId: this.sessionId,
      epoch: this.epoch,
      seq: record.s,
      type: record.t,
      ts: record.ts,
      payload: record.p,
    };
  }
}
