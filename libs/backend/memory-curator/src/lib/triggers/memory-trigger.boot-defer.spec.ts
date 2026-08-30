/**
 * TASK_2026_352 — the memory boot scan waits for the host to settle.
 *
 * `runBootScan`'s callback calls `curator.curate` INLINE: one LLM round trip
 * per eligible session, bounded only by a 200 ms throttle and the hourly
 * limiter. Firing that from `start()` put every one of those calls in the first
 * seconds after launch (`tmp/logs/log.log:676,678`), competing with window
 * creation, the SDK boot and skill-synthesis drains that ran 122 s and 156 s on
 * the same boot. None of it is urgent — every session it reads ended before the
 * process existed.
 *
 * Driven through the REAL `BootScanRunner` and real timers under Jest's fake
 * clock, because the property under test is WHEN `curate` is reached.
 */
import 'reflect-metadata';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type {
  SqliteConnectionService,
  SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import type { ITranscriptReader } from '@ptah-extension/memory-contracts';
import type { JsonlReaderService } from '@ptah-extension/agent-sdk';
import { CuratorRateLimitService } from '@ptah-extension/agent-sdk';
import { MemoryTriggerService } from './memory-trigger.service';
import { MEMORY_TRIGGER_DEFAULTS } from './memory-trigger-config';
import type { MemoryCuratorService } from '../memory-curator.service';
import type { ObservationQueueStore } from '../observation-queue.store';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

/** A registry whose `register` hands back the callback for the test to fire. */
function makeCapturingRegistry(): {
  registry: unknown;
  emit: (payload: unknown) => void;
} {
  const callbacks: Array<(payload: unknown) => void> = [];
  return {
    registry: {
      register: jest.fn((cb: (payload: unknown) => void) => {
        callbacks.push(cb);
        return () => undefined;
      }),
      notifyAll: jest.fn(),
      size: 0,
    },
    emit: (payload: unknown) => callbacks.forEach((cb) => cb(payload)),
  };
}

function makeRegistry(): unknown {
  return {
    register: jest.fn(() => () => undefined),
    notifyAll: jest.fn(),
    size: 0,
  };
}

function makeSqlite(): SqliteConnectionService {
  const db = {
    prepare: jest.fn((sql: string) =>
      sql.includes('SELECT last_scanned_session_mtime')
        ? { get: jest.fn(() => undefined) }
        : { run: jest.fn(() => ({ changes: 1, lastInsertRowid: 1 })) },
    ),
  } as unknown as SqliteDatabase;
  return { db, isOpen: true } as unknown as SqliteConnectionService;
}

function makeWorkspace(overrides: Record<string, unknown>): IWorkspaceProvider {
  const cfg: Record<string, unknown> = {
    'memory.triggers.bootScan': true,
    'memory.triggers.idleMs': 600000,
    'memory.triggers.maxCuratesPerHour': 100,
    ...overrides,
  };
  return {
    getWorkspaceRoot: jest.fn(() => '/ws'),
    getWorkspaceFolders: jest.fn(() => ['/ws']),
    getConfiguration: jest.fn(
      (_section: string, key: string, def: unknown) => cfg[key] ?? def,
    ),
    setConfiguration: jest.fn().mockResolvedValue(undefined),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as IWorkspaceProvider;
}

function buildHarness(opts: {
  sessionsDir: string;
  settings?: Record<string, unknown>;
}) {
  const curate = jest.fn().mockResolvedValue({
    outcome: 'ran',
    extracted: 0,
    merged: 0,
    created: 0,
    skipped: 0,
  });
  const curator = {
    curate,
    pushEvent: jest.fn(),
    recentEvents: jest.fn(() => []),
    lastRunInfo: jest.fn(() => ({ at: null, stats: null })),
    rekeySession: jest.fn(),
  } as unknown as MemoryCuratorService;

  const activity = makeCapturingRegistry();

  const service = new MemoryTriggerService(
    makeLogger(),
    curator,
    activity.registry as never,
    makeRegistry() as never,
    makeWorkspace(opts.settings ?? {}),
    {} as unknown as IFileSystemProvider,
    makeSqlite(),
    {
      findSessionsDirectory: jest.fn().mockResolvedValue(opts.sessionsDir),
    } as unknown as JsonlReaderService,
    makeRegistry() as never,
    makeRegistry() as never,
    makeRegistry() as never,
    makeRegistry() as never,
    makeRegistry() as never,
    new CuratorRateLimitService(makeLogger()),
    {
      enqueue: jest.fn(),
      flush: jest.fn(),
      drainForSession: jest.fn(() => []),
      markProcessed: jest.fn(),
      purgeOlderThan: jest.fn(() => 0),
      countUnprocessed: jest.fn(() => 0),
      backfillSessionId: jest.fn(() => 0),
    } as unknown as ObservationQueueStore,
    makeRegistry() as never,
    { read: jest.fn().mockResolvedValue('') } as unknown as ITranscriptReader,
    makeRegistry() as never,
  );

  return { service, curate, emitActivity: activity.emit };
}

async function makeSessionsDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'boot-defer-test-'));
  const full = path.join(dir, 'sess.jsonl');
  await fs.writeFile(full, '{}\n');
  const mtime = new Date(Date.now() - DAY_MS);
  await fs.utimes(full, mtime, mtime);
  return dir;
}

/** One turn of the event loop's check phase, which follows the poll phase. */
const tick = (): Promise<void> =>
  new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Advance the fake clock and let the scan make progress.
 *
 * Draining microtasks is not sufficient: `BootScanRunner` awaits real
 * `fs.readdir` / `fs.stat`, whose completions arrive as libuv IO callbacks —
 * a MACROtask. `setImmediate` is left unfaked precisely so this helper has a
 * way to yield to that phase.
 *
 * The fixed turn count is for NEGATIVE assertions only, where "still nothing
 * after a generous drain" is the claim. Positive assertions use
 * {@link advanceUntil}: `fs/promises` dispatches to the libuv THREADPOOL (four
 * threads), so on a saturated machine a completion can need far more loop turns
 * than on an idle one — a fixed count there measures the host, and this repo's
 * normal mode is several agents testing in one working tree.
 */
async function advance(ms: number): Promise<void> {
  await jest.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 60; i++) await tick();
}

/** Advance, then yield until `predicate` holds or the turn budget runs out. */
async function advanceUntil(
  ms: number,
  predicate: () => boolean,
): Promise<void> {
  await jest.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 2_000 && !predicate(); i++) await tick();
}

describe('MemoryTriggerService — boot scan deferral', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeSessionsDir();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not curate anything synchronously from start()', async () => {
    const h = buildHarness({ sessionsDir: dir });

    h.service.start();
    await advance(0);

    expect(h.curate).not.toHaveBeenCalled();

    h.service.stop();
  });

  it('runs the scan once the delay has elapsed', async () => {
    const h = buildHarness({ sessionsDir: dir });

    h.service.start();
    await advance(MEMORY_TRIGGER_DEFAULTS.bootScanDelayMs - 1_000);
    expect(h.curate).not.toHaveBeenCalled();

    await advanceUntil(2_000, () => h.curate.mock.calls.length > 0);
    expect(h.curate).toHaveBeenCalledTimes(1);

    h.service.stop();
  });

  it('re-arms instead of running when foreground chat is active', async () => {
    const h = buildHarness({ sessionsDir: dir });

    h.service.start();
    // A chat turn just before the scan comes due.
    await advance(MEMORY_TRIGGER_DEFAULTS.bootScanDelayMs - 1_000);
    h.emitActivity({ sessionId: 'live', workspaceRoot: '/ws' });

    await advance(2_000);
    expect(h.curate).not.toHaveBeenCalled();

    // …and it runs once the user goes quiet for a whole backoff window.
    await advanceUntil(
      MEMORY_TRIGGER_DEFAULTS.bootScanIdleBackoffMs + 1_000,
      () => h.curate.mock.calls.length > 0,
    );
    expect(h.curate).toHaveBeenCalledTimes(1);

    h.service.stop();
  });

  it('cancels a pending scan on stop()', async () => {
    const h = buildHarness({ sessionsDir: dir });

    h.service.start();
    h.service.stop();

    await advance(MEMORY_TRIGGER_DEFAULTS.bootScanDelayMs * 2);
    expect(h.curate).not.toHaveBeenCalled();
  });

  it('runs immediately when the delay is configured to 0', async () => {
    const h = buildHarness({
      sessionsDir: dir,
      settings: { 'memory.triggers.bootScanDelayMs': 0 },
    });

    h.service.start();
    await advanceUntil(0, () => h.curate.mock.calls.length > 0);

    expect(h.curate).toHaveBeenCalledTimes(1);

    h.service.stop();
  });

  it('ignores foreground activity when the backoff is configured to 0', async () => {
    const h = buildHarness({
      sessionsDir: dir,
      settings: {
        'memory.triggers.bootScanDelayMs': 1_000,
        'memory.triggers.bootScanIdleBackoffMs': 0,
      },
    });

    h.service.start();
    h.emitActivity({ sessionId: 'live', workspaceRoot: '/ws' });
    await advanceUntil(2_000, () => h.curate.mock.calls.length > 0);

    expect(h.curate).toHaveBeenCalledTimes(1);

    h.service.stop();
  });
});
