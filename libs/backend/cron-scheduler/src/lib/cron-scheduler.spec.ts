/**
 * Unit tests for `CronScheduler.start()` / `stop()` — the boot path.
 *
 * The contract under test is that cold-start catchup is **fire-and-forget**.
 * `CatchupCoordinator.replayMissed` walks every overdue job and forwards each
 * missed slot to `JobRunner.run` serially; for an LLM-backed job that duration
 * is set by a remote endpoint and is effectively unbounded. `start()` used to
 * `await` it, which gated Electron window creation on that work
 * (`main.ts` -> `wireRuntime` -> `bootHeavyServices` -> `startThothCron` ->
 * `start`) and could leave the app running with no window at all.
 *
 * These tests therefore pin the *timing*, not just the calls: a `replayMissed`
 * that never settles must not hold `start()` open, and every step after it
 * (arm timers, attach power listener, mark started, log) must still run.
 *
 * `croner-loader` is mocked so no real OS timers are created — the fake `Cron`
 * records its constructions, which is exactly the "were timers armed?" signal.
 */
import 'reflect-metadata';

jest.mock('./croner-loader', () => ({
  loadCron: jest.fn(),
}));

import { CronScheduler } from './cron-scheduler';
import { loadCron } from './croner-loader';
import type { CronCtor, CronInstance } from './croner-loader';
import type { CatchupCoordinator } from './catchup-coordinator';
import type { JobRunner } from './job-runner';
import type { IJobStore } from './job.store';
import type { IRunStore } from './run.store';
import type { Logger } from '@ptah-extension/vscode-core';
import type { JobId } from '@ptah-extension/shared';
import type { CronSchedulerOptions, ScheduledJob } from './types';

// ── Fakes ─────────────────────────────────────────────────────────────────────

/**
 * Records every `new Cron(...)` so a test can assert which jobs were armed,
 * and every `stop()` so `CronScheduler.stop()` can be verified.
 */
class FakeCron implements CronInstance {
  static constructed: FakeCron[] = [];

  stopped = false;

  constructor(
    readonly expr: string,
    readonly options: {
      timezone?: string;
      protect?: boolean;
      paused?: boolean;
    },
    readonly fn?: () => void,
  ) {
    FakeCron.constructed.push(this);
  }

  nextRun(): Date | null {
    return null;
  }

  stop(): void {
    this.stopped = true;
  }

  static reset(): void {
    FakeCron.constructed = [];
  }
}

/** A promise whose settlement the test controls. */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending microtasks (the `.catch` on the replay promise) run. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function makeJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'job-1' as JobId,
    name: 'job one',
    cronExpr: '*/5 * * * *',
    timezone: 'UTC',
    prompt: 'do the thing',
    workspaceRoot: null,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    lastRunAt: null,
    nextRunAt: null,
    ...overrides,
  };
}

const OPTIONS: CronSchedulerOptions = {
  enabled: true,
  maxConcurrentJobs: 3,
  catchupWindowMs: 3_600_000,
};

function build(jobs: ScheduledJob[] = []) {
  const logger = makeLogger();

  const jobStore = {
    list: jest.fn(() => jobs),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    upsert: jest.fn(),
  };

  const runStore = {
    latestForJob: jest.fn(),
    list: jest.fn(),
  };

  const runner = {
    setMaxConcurrent: jest.fn(),
    run: jest.fn(),
  };

  const catchup = {
    replayMissed: jest.fn(),
    attach: jest.fn(),
    detach: jest.fn(),
  };

  const scheduler = new CronScheduler(
    jobStore as unknown as IJobStore,
    runStore as unknown as IRunStore,
    runner as unknown as JobRunner,
    catchup as unknown as CatchupCoordinator,
    logger as unknown as Logger,
  );

  return { scheduler, jobStore, runStore, runner, catchup, logger };
}

/**
 * Resolves to `'resolved'` if `start()` settles, or `'timed-out'` after 50ms of
 * real time. If `start()` ever re-acquires an `await` on catchup, the hanging
 * fake makes this return `'timed-out'` instead of hanging the whole suite.
 */
async function raceStart(promise: Promise<void>): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(() => 'resolved'),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve('timed-out'), 50);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

beforeEach(() => {
  FakeCron.reset();
  (loadCron as jest.Mock).mockReturnValue(FakeCron as unknown as CronCtor);
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('CronScheduler.start — cold-start catchup is fire-and-forget', () => {
  it('resolves without waiting for a slow replayMissed', async () => {
    const { scheduler, catchup } = build([makeJob()]);
    const replay = deferred<void>();
    catchup.replayMissed.mockReturnValue(replay.promise);

    const outcome = await raceStart(scheduler.start(OPTIONS));

    expect(outcome).toBe('resolved');
    // The hang is real — the replay we blocked on is still in flight.
    expect(catchup.replayMissed).toHaveBeenCalledTimes(1);

    replay.resolve();
    await flushMicrotasks();
  });

  it('arms timers for enabled jobs while catchup is still in flight', async () => {
    const jobs = [
      makeJob({ id: 'job-1' as JobId, cronExpr: '*/5 * * * *' }),
      makeJob({
        id: 'job-2' as JobId,
        cronExpr: '0 3 * * *',
        timezone: 'Europe/Berlin',
      }),
    ];
    const { scheduler, catchup, jobStore, runner, logger } = build(jobs);
    const replay = deferred<void>();
    catchup.replayMissed.mockReturnValue(replay.promise);

    await scheduler.start(OPTIONS);

    // Everything downstream of the old `await` ran, with the replay unsettled.
    expect(runner.setMaxConcurrent).toHaveBeenCalledWith(3);
    expect(jobStore.list).toHaveBeenCalledWith({ enabledOnly: true });
    expect(FakeCron.constructed).toHaveLength(2);
    expect(FakeCron.constructed[0].expr).toBe('*/5 * * * *');
    expect(FakeCron.constructed[0].options.timezone).toBe('UTC');
    expect(FakeCron.constructed[1].expr).toBe('0 3 * * *');
    expect(FakeCron.constructed[1].options.timezone).toBe('Europe/Berlin');
    expect(catchup.attach).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      '[cron-scheduler] started',
      expect.objectContaining({ armed: 2, maxConcurrent: 3 }),
    );

    replay.resolve();
    await flushMicrotasks();
  });

  it('clamps the logged catchup window to the 24h ceiling', async () => {
    const { scheduler, catchup, logger } = build([]);
    catchup.replayMissed.mockReturnValue(deferred<void>().promise);

    await scheduler.start({ ...OPTIONS, catchupWindowMs: 999_999_999 });

    expect(logger.info).toHaveBeenCalledWith(
      '[cron-scheduler] started',
      expect.objectContaining({ catchupWindowMs: 86_400_000 }),
    );
  });
});

describe('CronScheduler.start — replay rejection handling', () => {
  it('logs a rejecting replayMissed and does not raise an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      const { scheduler, catchup, logger } = build([makeJob()]);
      const replay = deferred<void>();
      catchup.replayMissed.mockReturnValue(replay.promise);

      await scheduler.start(OPTIONS);
      replay.reject(new Error('replay exploded'));
      await flushMicrotasks();
      await flushMicrotasks();

      expect(logger.error).toHaveBeenCalledWith(
        '[cron-scheduler] cold-start catchup failed',
        { err: 'replay exploded' },
      );
      expect(unhandled).toHaveLength(0);
      // The failure is contained: the scheduler still came up.
      expect(FakeCron.constructed).toHaveLength(1);
      expect(logger.info).toHaveBeenCalledWith(
        '[cron-scheduler] started',
        expect.anything(),
      );
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('stringifies a non-Error rejection instead of reading .message off it', async () => {
    const { scheduler, catchup, logger } = build([]);
    const replay = deferred<void>();
    catchup.replayMissed.mockReturnValue(replay.promise);

    await scheduler.start(OPTIONS);
    replay.reject('plain string failure');
    await flushMicrotasks();

    expect(logger.error).toHaveBeenCalledWith(
      '[cron-scheduler] cold-start catchup failed',
      { err: 'plain string failure' },
    );
  });

  it('logs the rejection even after stop() has already run', async () => {
    const { scheduler, catchup, logger } = build([makeJob()]);
    const replay = deferred<void>();
    catchup.replayMissed.mockReturnValue(replay.promise);

    await scheduler.start(OPTIONS);
    scheduler.stop();
    replay.reject(new Error('late failure'));

    await expect(flushMicrotasks()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      '[cron-scheduler] cold-start catchup failed',
      { err: 'late failure' },
    );
  });
});

describe('CronScheduler.start — idempotency and the disabled path', () => {
  it('is idempotent: a second start does not replay or re-arm', async () => {
    const { scheduler, catchup, runner } = build([makeJob()]);
    catchup.replayMissed.mockReturnValue(deferred<void>().promise);

    await scheduler.start(OPTIONS);
    await scheduler.start(OPTIONS);

    expect(catchup.replayMissed).toHaveBeenCalledTimes(1);
    expect(catchup.attach).toHaveBeenCalledTimes(1);
    expect(runner.setMaxConcurrent).toHaveBeenCalledTimes(1);
    expect(FakeCron.constructed).toHaveLength(1);
  });

  it('starts no catchup and no timers when disabled by settings', async () => {
    const { scheduler, catchup, runner, logger } = build([makeJob()]);

    await scheduler.start({ ...OPTIONS, enabled: false });

    expect(catchup.replayMissed).not.toHaveBeenCalled();
    expect(catchup.attach).not.toHaveBeenCalled();
    expect(runner.setMaxConcurrent).not.toHaveBeenCalled();
    expect(FakeCron.constructed).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(
      '[cron-scheduler] disabled by settings; not starting',
    );
  });

  it('marks itself started when disabled, so a later start stays a no-op', async () => {
    const { scheduler, catchup } = build([makeJob()]);

    await scheduler.start({ ...OPTIONS, enabled: false });
    await scheduler.start(OPTIONS);

    expect(catchup.replayMissed).not.toHaveBeenCalled();
    expect(FakeCron.constructed).toHaveLength(0);
  });
});

describe('CronScheduler.stop — safe against an in-flight replay', () => {
  it('stops every armed timer and detaches while catchup is still running', async () => {
    const { scheduler, catchup, logger } = build([
      makeJob({ id: 'job-1' as JobId }),
      makeJob({ id: 'job-2' as JobId, cronExpr: '0 * * * *' }),
    ]);
    const replay = deferred<void>();
    catchup.replayMissed.mockReturnValue(replay.promise);

    await scheduler.start(OPTIONS);
    expect(() => scheduler.stop()).not.toThrow();

    expect(FakeCron.constructed.every((c) => c.stopped)).toBe(true);
    expect(catchup.detach).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('[cron-scheduler] stopped');

    // A replay that completes after shutdown is harmless.
    replay.resolve();
    await flushMicrotasks();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('is idempotent and is a no-op before start', async () => {
    const { scheduler, catchup } = build([makeJob()]);
    catchup.replayMissed.mockReturnValue(deferred<void>().promise);

    scheduler.stop();
    expect(catchup.detach).not.toHaveBeenCalled();

    await scheduler.start(OPTIONS);
    scheduler.stop();
    scheduler.stop();

    expect(catchup.detach).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh start after stop, replaying catchup again', async () => {
    const { scheduler, catchup } = build([makeJob()]);
    catchup.replayMissed.mockReturnValue(deferred<void>().promise);

    await scheduler.start(OPTIONS);
    scheduler.stop();
    await scheduler.start(OPTIONS);

    expect(catchup.replayMissed).toHaveBeenCalledTimes(2);
    expect(FakeCron.constructed).toHaveLength(2);
  });
});
