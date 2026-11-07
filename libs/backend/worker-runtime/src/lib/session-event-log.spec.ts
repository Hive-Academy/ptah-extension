import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workerPaths } from './paths';
import {
  SessionEventLog,
  TranscriptUnavailableError,
} from './session-event-log';

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ptah-log-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

it('recovers a torn tail and appends an interrupted turn in sequence', async () => {
  const paths = workerPaths(home);
  const log = await SessionEventLog.open(paths, 'session_1');
  await log.append('worker:turn.begin', { turnId: 'turn_1' });
  await log.close();
  const path = join(paths.events, 'session_1.jsonl');
  await writeFile(
    path,
    `${await readFile(path, 'utf8')}{"s":2,"t":"chat:chunk"`,
  );
  const reopened = await SessionEventLog.open(paths, 'session_1');
  expect(reopened.head).toBe(2);
  expect(reopened.replay().map((frame) => [frame.seq, frame.type])).toEqual([
    [1, 'worker:turn.begin'],
    [2, 'worker:turn.interrupted'],
  ]);
  await reopened.close();
});

it('rebuilds latestMark on open from the newest mark', async () => {
  const paths = workerPaths(home);
  const log = await SessionEventLog.open(paths, 'session_1');
  await log.append('worker:baseline', {
    events: [],
    historyMark: { count: 0, lastEventId: null },
  });
  await log.append('worker:history-mark', {
    turnId: 't',
    historyMark: { count: 2, lastEventId: 'e2' },
  });
  await log.close();
  const reopened = await SessionEventLog.open(paths, 'session_1');
  expect(reopened.latestMark).toEqual({ count: 2, lastEventId: 'e2' });
  await reopened.close();
});

it('rejects a malformed non-tail record with TRANSCRIPT_UNAVAILABLE', async () => {
  const paths = workerPaths(home);
  const log = await SessionEventLog.open(paths, 'session_1');
  await log.close();
  const path = join(paths.events, 'session_1.jsonl');
  await writeFile(path, `${await readFile(path, 'utf8')}{bad}\n`);
  await expect(SessionEventLog.open(paths, 'session_1')).rejects.toMatchObject({
    code: 'TRANSCRIPT_UNAVAILABLE',
  });
  expect(new TranscriptUnavailableError().code).toBe('TRANSCRIPT_UNAVAILABLE');
});
