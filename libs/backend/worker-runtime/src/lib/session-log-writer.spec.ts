import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  EventFrame,
  SessionEventType,
} from '@ptah-extension/worker-protocol';
import { workerPaths } from './paths';
import { SessionEventLog } from './session-event-log';
import { SessionFanOut } from './fan-out';
import { SessionLogWriter } from './session-log-writer';

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ptah-writer-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

it('assigns strictly ordered sequence numbers per session', async () => {
  const log = await SessionEventLog.open(workerPaths(home), 's');
  const fanOut = new SessionFanOut();
  const writer = new SessionLogWriter(log, fanOut, {
    onAppendFailed: jest.fn(),
  });
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => writer.enqueue('chat:chunk', { i })),
  );
  expect(results.map((frame) => frame.seq)).toEqual(
    Array.from({ length: 20 }, (_, i) => i + 1),
  );
  expect(writer.head).toBe(20);
  await log.close();
});

it('No evt frame with seq > head under an injected slow write', async () => {
  const log = await SessionEventLog.open(workerPaths(home), 's');
  const fanOut = new SessionFanOut();
  const seen: EventFrame[] = [];
  const subscription = fanOut.subscribe((frame) => {
    if (frame.kind === 'evt') seen.push(frame);
  }, log.head);
  subscription.finishReplay();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writer = new SessionLogWriter(log, fanOut, {
    onAppendFailed: jest.fn(),
    append: async (type: SessionEventType, payload: unknown) => {
      await gate;
      return log.append(type, payload);
    },
  });
  const pending = writer.enqueue('chat:chunk', { text: 'slow' });
  await Promise.resolve();
  expect(writer.head).toBe(0);
  expect(seen).toEqual([]);
  release();
  await pending;
  expect(seen.map((frame) => frame.seq)).toEqual([1]);
  expect(seen.every((frame) => frame.seq <= writer.head)).toBe(true);
  subscription.unsubscribe();
  await log.close();
});

it('Append failure mid-turn aborts, sends ctl degraded, and returns SESSION_LOG_FAILED', async () => {
  const log = await SessionEventLog.open(workerPaths(home), 's');
  const fanOut = new SessionFanOut();
  const seen: Array<{ kind: string; type: string }> = [];
  const subscription = fanOut.subscribe((frame) => {
    seen.push({ kind: frame.kind, type: frame.type });
  }, log.head);
  subscription.finishReplay();
  const abort = jest.fn();
  let writes = 0;
  const writer = new SessionLogWriter(log, fanOut, {
    onAppendFailed: (_sessionId, _error) => abort(),
    append: async (type, payload) => {
      writes += 1;
      if (writes === 2) throw new Error('disk full');
      return log.append(type, payload);
    },
  });
  await writer.enqueue('worker:turn.begin', { turnId: 't' });
  const failed = writer.enqueue('chat:chunk', { text: 'lost' });
  const later = writer.enqueue('chat:complete', {});
  await expect(failed).rejects.toMatchObject({ code: 'SESSION_LOG_FAILED' });
  await expect(later).rejects.toMatchObject({ code: 'SESSION_LOG_FAILED' });
  await expect(writer.enqueue('chat:chunk', {})).rejects.toMatchObject({
    code: 'SESSION_LOG_FAILED',
  });
  expect(abort).toHaveBeenCalledTimes(1);
  expect(seen).toEqual([
    { kind: 'evt', type: 'worker:turn.begin' },
    { kind: 'ctl', type: 'session-state' },
  ]);
  subscription.unsubscribe();
  await log.close();
});
