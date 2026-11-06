import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ISessionDriverLock } from '@ptah-extension/platform-core';
import { workerPaths } from './paths';
import { SessionEventLog } from './session-event-log';
import { SessionFanOut } from './fan-out';
import { SessionLogWriter } from './session-log-writer';
import { Transcript, DriverLockUnavailableError } from './transcript';

const owner = {
  kind: 'worker' as const,
  hostname: 'host',
  pid: 1,
  label: 'worker',
  acquiredAt: '',
  responding: true,
};
let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ptah-transcript-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

it('A3 / R-K fixture JSONL refreshes after an intervening desktop turn and replays its new baseline', async () => {
  const log = await SessionEventLog.open(workerPaths(home), 'session_1');
  const writer = new SessionLogWriter(log, new SessionFanOut(), {
    onAppendFailed: jest.fn(),
  });
  const history = {
    readForResume: jest.fn().mockResolvedValue({ events: [] }),
  };
  const lock = {
    acquire: jest.fn().mockResolvedValue({ ok: true, nonce: 'n' }),
    release: jest.fn().mockResolvedValue('released'),
  } as unknown as ISessionDriverLock;
  const transcript = new Transcript(history, lock, owner);
  await transcript.baseline('session_1', writer);
  await writer.enqueue('worker:turn.begin', { turnId: 't1' });
  await writer.enqueue('worker:turn.end', { turnId: 't1' });
  await transcript.mark('session_1', 't1', writer);
  const oldHead = log.head;
  expect(log.replay(oldHead - 1)[0].type).toBe('worker:history-mark');
  history.readForResume.mockResolvedValue({
    events: [
      {
        id: 'desktop-event',
        eventType: 'text_delta',
        timestamp: 1_700_000_000_000,
        sessionId: 'session_1',
        messageId: 'm1',
        delta: 'desktop',
        blockIndex: 0,
      },
    ],
  });
  const attached = await transcript.attach('session_1', log, writer, oldHead);
  expect(attached).toMatchObject({ mode: 'log', fromSeq: oldHead });
  expect(log.replay(oldHead).map((frame) => frame.type)).toEqual([
    'worker:baseline',
  ]);
  expect(log.latestMark).toEqual({ count: 1, lastEventId: 'desktop-event' });
  await transcript.attach('session_1', log, writer);
  expect(log.head).toBe(oldHead + 1);
  await log.close();
});

it('returns a labelled snapshot while another process holds the lock and fails closed when unavailable', async () => {
  const log = await SessionEventLog.open(workerPaths(home), 'session_1');
  const writer = new SessionLogWriter(log, new SessionFanOut(), {
    onAppendFailed: jest.fn(),
  });
  const history = {
    readForResume: jest.fn().mockResolvedValue({ events: [] }),
  };
  const acquire = jest
    .fn()
    .mockResolvedValue({ ok: false, holder: { label: 'Desktop' } });
  const lock = { acquire } as unknown as ISessionDriverLock;
  const transcript = new Transcript(history, lock, owner);
  await transcript.baseline('session_1', writer);
  expect(await transcript.attach('session_1', log, writer)).toMatchObject({
    mode: 'snapshot',
    drivenBy: 'Desktop',
  });
  acquire.mockResolvedValue({ ok: false, unavailable: 'failed' });
  await expect(
    transcript.attach('session_1', log, writer),
  ).rejects.toBeInstanceOf(DriverLockUnavailableError);
  await log.close();
});
