/**
 * TASK_2026_380 — the skill boot scan waits for the host to settle.
 *
 * `start()` fired `runBootScan` synchronously. The scan walks every session
 * file newer than the watermark and calls `SkillSynthesisService.enqueueAnalyze`
 * for each, so a backlog of tens of sessions was enqueued in the first seconds
 * after launch, competing with window creation and the SDK boot for the main
 * thread. None of it is urgent: every session it reads ended before the process
 * existed. The drain's own `bootDeferralMs` row filter holds those ROWS but does
 * not hold the SCAN, which is the cost this spec pins.
 *
 * Driven through the REAL `BootScanRunner` and real timers under Jest's fake
 * clock, because the property under test is WHEN `enqueueAnalyze` is reached.
 * Call counts only, never wall-clock timing.
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
import type { JsonlReaderService } from '@ptah-extension/agent-sdk';
import { CuratorRateLimitService } from '@ptah-extension/agent-sdk';
import { SkillTriggerService } from './skill-trigger.service';
import { SKILL_TRIGGER_DEFAULTS } from './skill-trigger-config';
import type { SkillSynthesisService } from '../skill-synthesis.service';
import type { SkillInvocationRecorder } from '../skill-invocation-recorder';
import type { SubagentMetricsExtractor } from '../subagent-metrics-extractor';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The REAL `setTimeout`, captured at module scope — `jest.useFakeTimers()` runs
 * in `beforeEach`, so this binding is taken before the clock is replaced.
 *
 * {@link advanceUntil} needs a way to wait in WALL-CLOCK time for a libuv
 * threadpool completion, and every other route is closed: `setTimeout` is faked
 * (deliberately — the arming delay is the property under test) and `Date.now()`
 * is faked with it (also deliberately — the scheduler's re-arm compares
 * `Date.now()` against the last activity stamp, so unfaking the clock would
 * make the backoff never expire).
 */
const realSetTimeout = setTimeout;

/** A real millisecond, ignoring the fake clock. */
const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => realSetTimeout(resolve, ms));

/**
 * Real-time budget for a positive assertion, in ~1 ms polls.
 *
 * Comfortably under {@link TEST_TIMEOUT_MS} so an exhausted budget fails on the
 * call-count assertion — which names what went wrong — rather than on a bare
 * jest timeout.
 */
const WAIT_BUDGET_POLLS = 5_000;

/** Room for the real filesystem work under `--coverage` on a loaded runner. */
const TEST_TIMEOUT_MS = 30_000;

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
    'skillSynthesis.triggers.bootScan': true,
    'skillSynthesis.triggers.idleMs': 600000,
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
  const enqueueAnalyze = jest.fn().mockResolvedValue(undefined);
  const synthesis = {
    enqueueAnalyze,
    pushEvent: jest.fn(),
    analyzeSession: jest.fn(),
  } as unknown as SkillSynthesisService;

  const activity = makeCapturingRegistry();

  const service = new SkillTriggerService(
    makeLogger(),
    synthesis,
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
    new CuratorRateLimitService(makeLogger()),
    makeRegistry() as never,
    { recordInvocation: jest.fn() } as unknown as SkillInvocationRecorder,
    makeRegistry() as never,
    { harvest: jest.fn().mockResolvedValue(undefined) } as never,
    { extract: jest.fn() } as unknown as SubagentMetricsExtractor,
    makeRegistry() as never,
  );

  return { service, enqueueAnalyze, emitActivity: activity.emit };
}

async function makeSessionsDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-boot-defer-'));
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
 * `fs.readdir` / `fs.stat`, whose completions arrive as libuv IO callbacks — a
 * MACROtask. `setImmediate` is left unfaked precisely so this helper has a way
 * to yield to that phase.
 *
 * The fixed turn count is for NEGATIVE assertions only, where "still nothing
 * after a generous drain" is the claim. Positive assertions use
 * {@link advanceUntil}: `fs/promises` dispatches to the libuv THREADPOOL, so on
 * a saturated machine a completion can need far more loop turns than on an idle
 * one — a fixed count there measures the host, and this repo's normal mode is
 * several agents testing in one working tree.
 */
async function advance(ms: number): Promise<void> {
  await jest.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 60; i++) await tick();
}

/**
 * Advance the fake clock, then WAIT until `predicate` holds or the budget runs
 * out.
 *
 * The budget is spent in real milliseconds, not in loop turns. A turn count was
 * the original shape and it is what made this helper flaky: `await tick()` on an
 * otherwise-idle loop costs microseconds, so 2 000 of them is a few milliseconds
 * of wall clock — a SPIN, not a wait. The scan it is waiting on needs at least a
 * `readdir` and a `stat` off the libuv threadpool, and under `--coverage` with
 * three Nx projects in parallel those cost more than the spin lasted. The helper
 * then reported "the scan never reached `enqueueAnalyze`" when the truth was
 * "the test stopped looking first" (CI on PR #463: `runs immediately when the
 * delay is configured to 0`, the case with no fake-time advance to pad it).
 *
 * A real `setTimeout` is the only clock available here — see {@link sleep}. The
 * `tick()` beside it keeps the poll-phase yield the fake-timer advance does not
 * give, and a saturated host stretches each poll past 1 ms, which moves the
 * budget in the forgiving direction.
 */
async function advanceUntil(
  ms: number,
  predicate: () => boolean,
): Promise<void> {
  await jest.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < WAIT_BUDGET_POLLS && !predicate(); i++) {
    await tick();
    if (predicate()) return;
    await sleep(1);
  }
}

describe('SkillTriggerService — boot scan deferral', () => {
  // The positive assertions wait on REAL filesystem work (`readdir` + `stat`
  // off the libuv threadpool) through `advanceUntil`, whose budget is real
  // milliseconds. Under `--coverage` with three Nx projects in parallel that
  // can outlast Jest's 5 s default, and a bare timeout would report the wait
  // rather than the call count. Raising the ceiling keeps the scan real, which
  // is the point of driving the actual `BootScanRunner` here.
  jest.setTimeout(TEST_TIMEOUT_MS);

  let dir: string;

  beforeEach(async () => {
    dir = await makeSessionsDir();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not enqueue anything synchronously from start()', async () => {
    const h = buildHarness({ sessionsDir: dir });

    h.service.start();
    await advance(0);

    expect(h.enqueueAnalyze).not.toHaveBeenCalled();

    h.service.stop();
  });

  it('runs the scan once the delay has elapsed', async () => {
    const h = buildHarness({ sessionsDir: dir });

    h.service.start();
    await advance(SKILL_TRIGGER_DEFAULTS.bootScanDelayMs - 1_000);
    expect(h.enqueueAnalyze).not.toHaveBeenCalled();

    await advanceUntil(2_000, () => h.enqueueAnalyze.mock.calls.length > 0);
    expect(h.enqueueAnalyze).toHaveBeenCalledTimes(1);

    h.service.stop();
  });

  it('re-arms instead of running when foreground chat is active', async () => {
    const h = buildHarness({ sessionsDir: dir });

    h.service.start();
    // A chat turn just before the scan comes due.
    await advance(SKILL_TRIGGER_DEFAULTS.bootScanDelayMs - 1_000);
    h.emitActivity({ sessionId: 'live', workspaceRoot: '/ws' });

    await advance(2_000);
    expect(h.enqueueAnalyze).not.toHaveBeenCalled();

    // …and it runs once the user goes quiet for a whole backoff window.
    await advanceUntil(
      SKILL_TRIGGER_DEFAULTS.bootScanIdleBackoffMs + 1_000,
      () => h.enqueueAnalyze.mock.calls.length > 0,
    );
    expect(h.enqueueAnalyze).toHaveBeenCalledTimes(1);

    h.service.stop();
  });

  it('cancels a pending scan on stop()', async () => {
    const h = buildHarness({ sessionsDir: dir });

    h.service.start();
    h.service.stop();

    await advance(SKILL_TRIGGER_DEFAULTS.bootScanDelayMs * 2);
    expect(h.enqueueAnalyze).not.toHaveBeenCalled();
  });

  it('runs immediately when the delay is configured to 0', async () => {
    const h = buildHarness({
      sessionsDir: dir,
      settings: { 'skillSynthesis.triggers.bootScanDelayMs': 0 },
    });

    h.service.start();
    await advanceUntil(0, () => h.enqueueAnalyze.mock.calls.length > 0);

    expect(h.enqueueAnalyze).toHaveBeenCalledTimes(1);

    h.service.stop();
  });

  it('ignores foreground activity when the backoff is configured to 0', async () => {
    const h = buildHarness({
      sessionsDir: dir,
      settings: {
        'skillSynthesis.triggers.bootScanDelayMs': 1_000,
        'skillSynthesis.triggers.bootScanIdleBackoffMs': 0,
      },
    });

    h.service.start();
    h.emitActivity({ sessionId: 'live', workspaceRoot: '/ws' });
    await advanceUntil(2_000, () => h.enqueueAnalyze.mock.calls.length > 0);

    expect(h.enqueueAnalyze).toHaveBeenCalledTimes(1);

    h.service.stop();
  });
});
