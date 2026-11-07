import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SqliteConnectionService } from '../sqlite-connection.service';
import { FakeSqliteDatabase } from '../testing/fake-sqlite-database';
import { createMockLogger, type MockLogger } from '../testing/mock-logger';
import {
  WalCheckpointScheduler,
  statWalFile,
  type WalCheckpointSchedulerOptions,
} from './wal-checkpoint-scheduler';
import type {
  IWalCheckpointWorkerProcess,
  IWalCheckpointWorkerProcessFactory,
} from './wal-checkpoint-worker.port';
import type {
  WalCheckpointRequest,
  WalCheckpointResult,
  WalCheckpointWorkerOutbound,
} from './wal-checkpoint-worker-protocol';
import { walCheckpointRequestSchema } from './wal-checkpoint-worker-protocol';
import { WalCheckpointState } from './wal-checkpoint-state';

/** Lets every queued microtask (and the async WAL stat) settle. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

type Responder = (request: WalCheckpointRequest) => WalCheckpointWorkerOutbound | null;

class FakeWorker implements IWalCheckpointWorkerProcess {
  readonly requests: WalCheckpointRequest[] = [];
  kills = 0;
  private messageListener: ((msg: unknown) => void) | null = null;
  private exitListener: ((code: number | null) => void) | null = null;

  constructor(private readonly respond: Responder) {}

  postMessage(msg: unknown): void {
    const request = walCheckpointRequestSchema.parse(msg);
    this.requests.push(request);
    const reply = this.respond(request);
    if (reply) this.messageListener?.(reply);
  }

  on(event: 'message', cb: (msg: unknown) => void): void;
  on(event: 'exit', cb: (code: number | null) => void): void;
  on(
    event: 'message' | 'exit',
    cb: ((msg: unknown) => void) | ((code: number | null) => void),
  ): void {
    if (event === 'message') this.messageListener = cb as (msg: unknown) => void;
    else this.exitListener = cb as (code: number | null) => void;
  }

  kill(): void {
    this.kills++;
  }

  exit(code: number | null): void {
    this.exitListener?.(code);
  }

  /** Deliver a reply later, as a slow worker would. */
  deliver(msg: unknown): void {
    this.messageListener?.(msg);
  }
}

class FakeFactory implements IWalCheckpointWorkerProcessFactory {
  readonly workers: FakeWorker[] = [];
  constructor(public respond: Responder) {}
  spawn(): IWalCheckpointWorkerProcess {
    const worker = new FakeWorker((request) => this.respond(request));
    this.workers.push(worker);
    return worker;
  }
  get requests(): WalCheckpointRequest[] {
    return this.workers.flatMap((w) => w.requests);
  }
}

function caughtUp(request: WalCheckpointRequest): WalCheckpointResult {
  return {
    type: 'checkpoint-result',
    requestId: request.requestId,
    busy: false,
    walFrames: 100,
    checkpointedFrames: 100,
    durationMs: 3,
  };
}

function behind(request: WalCheckpointRequest): WalCheckpointWorkerOutbound {
  return { ...caughtUp(request), walFrames: 900, checkpointedFrames: 200 };
}

function failed(request: WalCheckpointRequest): WalCheckpointWorkerOutbound {
  return {
    type: 'checkpoint-error',
    requestId: request.requestId,
    message: 'SQLITE_IOERR',
  };
}

interface Harness {
  scheduler: WalCheckpointScheduler;
  connection: SqliteConnectionService;
  fake: FakeSqliteDatabase;
  factory: FakeFactory;
  logger: MockLogger;
  clock: { now: number };
  /** `mtimeMs: null` follows the clock, so every advance looks like a write. */
  wal: { bytes: number | Error; mtimeMs: number | null };
  options: Partial<WalCheckpointSchedulerOptions>;
}

async function makeHarness(respond: Responder = caughtUp): Promise<Harness> {
  const logger = createMockLogger();
  const fake = new FakeSqliteDatabase();
  const connection = new SqliteConnectionService(':memory:', logger);
  connection.configure({ factory: () => fake, vecPathResolver: null });
  await connection.openAndMigrate();
  const factory = new FakeFactory(respond);
  const clock = { now: 1_000_000 };
  const wal: Harness['wal'] = { bytes: 4096, mtimeMs: null };
  const options: Partial<WalCheckpointSchedulerOptions> = {
    pollMs: 60 * 60 * 1000,
    intervalMs: 30_000,
    sizeTriggerBytes: 16 * 1024 * 1024,
    stallWarnMs: 60_000,
    requestTimeoutMs: 5_000,
    maxConsecutiveFailures: 3,
    maxIdleSkipMs: 5 * 60_000,
    pauseWaitMs: 50,
    now: () => clock.now,
    statWal: async () => {
      if (wal.bytes instanceof Error) throw wal.bytes;
      return { bytes: wal.bytes, mtimeMs: wal.mtimeMs ?? clock.now };
    },
  };
  const scheduler = new WalCheckpointScheduler(logger, connection, factory);
  return { scheduler, connection, fake, factory, logger, clock, wal, options };
}

const autoCheckpointPragmas = (fake: FakeSqliteDatabase): string[] =>
  fake.pragmas.filter((p) => p.startsWith('wal_autocheckpoint ='));

const warnings = (logger: MockLogger, fragment: string) =>
  logger.entries.filter((e) => e.level === 'warn' && e.message.includes(fragment));

describe('WalCheckpointScheduler', () => {
  let harness: Harness;

  afterEach(() => {
    harness?.scheduler.dispose();
  });

  it('does nothing on a host without a worker factory', async () => {
    harness = await makeHarness();
    const logger = createMockLogger();
    const scheduler = new WalCheckpointScheduler(logger, harness.connection, null);

    expect(scheduler.start(harness.options)).toBe(false);
    await scheduler.tick();

    expect(scheduler.running).toBe(false);
    expect(autoCheckpointPragmas(harness.fake)).toEqual([]);
    expect(harness.connection.walCheckpointsOffMainThread).toBe(false);
    expect(logger.entries.some((e) => e.message.includes('no WAL checkpoint worker'))).toBe(true);
  });

  it('checkpoints in the worker, then turns main-thread auto-checkpoint off', async () => {
    harness = await makeHarness();
    expect(harness.scheduler.start(harness.options)).toBe(true);
    // Nothing changes before the worker has proved itself.
    expect(autoCheckpointPragmas(harness.fake)).toEqual([]);

    await harness.scheduler.tick();

    expect(harness.factory.requests).toEqual([
      { type: 'checkpoint', requestId: 1, dbPath: ':memory:' },
    ]);
    expect(autoCheckpointPragmas(harness.fake)).toEqual(['wal_autocheckpoint = 0']);
    expect(harness.connection.walCheckpointsOffMainThread).toBe(true);
  });

  it('waits for the interval while the WAL does not grow by the size trigger', async () => {
    harness = await makeHarness();
    harness.scheduler.start(harness.options);
    await harness.scheduler.tick();

    harness.clock.now += 29_999;
    harness.wal.bytes = 4096 + 1024 * 1024;
    await harness.scheduler.tick();
    expect(harness.factory.requests).toHaveLength(1);

    harness.clock.now += 1;
    await harness.scheduler.tick();
    expect(harness.factory.requests).toHaveLength(2);
  });

  it('checkpoints early once the WAL grows by the size trigger', async () => {
    harness = await makeHarness();
    harness.scheduler.start(harness.options);
    await harness.scheduler.tick();

    harness.clock.now += 5_000;
    harness.wal.bytes = 4096 + 16 * 1024 * 1024;
    await harness.scheduler.tick();

    expect(harness.factory.requests).toHaveLength(2);
  });

  it('skips an empty WAL', async () => {
    harness = await makeHarness();
    harness.wal.bytes = 0;
    harness.scheduler.start(harness.options);
    await harness.scheduler.tick();
    expect(harness.factory.requests).toHaveLength(0);
  });

  it('records the measured WAL size for slow-statement lines', async () => {
    harness = await makeHarness();
    harness.wal.bytes = 12_345;
    harness.scheduler.start(harness.options);
    await harness.scheduler.tick();
    const state: unknown = Reflect.get(harness.connection, 'walState');
    if (!(state instanceof WalCheckpointState)) throw new Error('no WAL state');
    expect(state.slowStatementContext()).toEqual(
      expect.objectContaining({ walCheckpoints: 'worker', walBytes: 12_345 }),
    );
  });

  it('still uses the interval when the WAL size cannot be read', async () => {
    harness = await makeHarness();
    harness.wal.bytes = new Error('EACCES');
    harness.scheduler.start(harness.options);
    await harness.scheduler.tick();
    expect(harness.factory.requests).toHaveLength(1);
  });

  it('never runs two checkpoints at once', async () => {
    harness = await makeHarness(() => null);
    harness.scheduler.start(harness.options);

    const first = harness.scheduler.tick();
    const second = harness.scheduler.tick();

    expect(second).toBe(first);
    await flush();
    expect(harness.factory.requests).toHaveLength(1);
    harness.scheduler.dispose();
    await first;
  });

  it('logs a failed checkpoint and resolves instead of throwing', async () => {
    harness = await makeHarness(failed);
    harness.scheduler.start(harness.options);

    await expect(harness.scheduler.tick()).resolves.toBeUndefined();

    expect(warnings(harness.logger, 'off-main WAL checkpoint failed')).toEqual([
      expect.objectContaining({
        context: { error: 'SQLITE_IOERR', consecutiveFailures: 1 },
      }),
    ]);
    // A failure before any success never touched auto-checkpoint.
    expect(autoCheckpointPragmas(harness.fake)).toEqual([]);
    expect(harness.scheduler.running).toBe(true);
  });

  it('falls back to SQLite auto-checkpoint after repeated failures', async () => {
    harness = await makeHarness();
    harness.scheduler.start({ ...harness.options, maxConsecutiveFailures: 2 });
    await harness.scheduler.tick();
    expect(harness.connection.walCheckpointsOffMainThread).toBe(true);

    harness.factory.respond = failed;
    for (let i = 0; i < 2; i++) {
      harness.clock.now += 30_000;
      await harness.scheduler.tick();
    }

    expect(harness.scheduler.running).toBe(false);
    expect(autoCheckpointPragmas(harness.fake)).toEqual([
      'wal_autocheckpoint = 0',
      'wal_autocheckpoint = 1000',
    ]);
    expect(harness.connection.walCheckpointsOffMainThread).toBe(false);
    expect(harness.factory.workers[0].kills).toBe(1);
    expect(warnings(harness.logger, 'keeps failing')).toHaveLength(1);
  });

  it('kills a worker that does not answer within the request timeout', async () => {
    harness = await makeHarness(() => null);
    harness.scheduler.start({ ...harness.options, requestTimeoutMs: 10 });

    await harness.scheduler.tick();

    expect(harness.factory.workers[0].kills).toBe(1);
    expect(warnings(harness.logger, 'off-main WAL checkpoint failed')[0]?.context).toEqual(
      expect.objectContaining({ error: 'WAL checkpoint timed out after 10 ms' }),
    );
  });

  it('respawns the worker after it exits mid-request', async () => {
    harness = await makeHarness(() => null);
    harness.scheduler.start(harness.options);
    const pending = harness.scheduler.tick();
    await flush();
    expect(harness.factory.requests).toHaveLength(1);
    harness.factory.workers[0].exit(1);
    await pending;
    expect(warnings(harness.logger, 'off-main WAL checkpoint failed')[0]?.context).toEqual(
      expect.objectContaining({ error: 'WAL checkpoint worker exited (code 1)' }),
    );

    harness.factory.respond = caughtUp;
    harness.clock.now += 30_000;
    await harness.scheduler.tick();
    expect(harness.factory.workers).toHaveLength(2);
    expect(harness.connection.walCheckpointsOffMainThread).toBe(true);
  });

  it('warns once per episode when the checkpoint cannot catch up', async () => {
    harness = await makeHarness(behind);
    harness.scheduler.start(harness.options);
    const stalled = () => warnings(harness.logger, 'cannot catch up');

    await harness.scheduler.tick();
    harness.clock.now += 30_000;
    await harness.scheduler.tick();
    expect(stalled()).toHaveLength(0);
    harness.clock.now += 30_000;
    await harness.scheduler.tick();
    harness.clock.now += 30_000;
    await harness.scheduler.tick();
    expect(stalled()).toHaveLength(1);

    harness.factory.respond = caughtUp;
    harness.clock.now += 30_000;
    await harness.scheduler.tick();
    expect(harness.logger.entries.some((e) => e.message.includes('caught up'))).toBe(true);

    harness.factory.respond = behind;
    for (let i = 0; i < 3; i++) {
      harness.clock.now += 30_000;
      await harness.scheduler.tick();
    }
    expect(stalled()).toHaveLength(2);
  });

  it('dispose stops the timer, kills the worker and restores auto-checkpoint', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      harness = await makeHarness();
      harness.scheduler.start({ ...harness.options, pollMs: 1_000 });
      await harness.scheduler.tick();
      const timersWhileRunning = jest.getTimerCount();

      harness.scheduler.dispose();
      harness.scheduler.dispose();

      expect(jest.getTimerCount()).toBe(timersWhileRunning - 1);
      expect(harness.factory.workers[0].kills).toBe(1);
      expect(autoCheckpointPragmas(harness.fake)).toEqual([
        'wal_autocheckpoint = 0',
        'wal_autocheckpoint = 1000',
      ]);
      await harness.scheduler.tick();
      expect(harness.factory.requests).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('dispose during a checkpoint is not reported as a failure', async () => {
    harness = await makeHarness(() => null);
    harness.scheduler.start(harness.options);
    const pending = harness.scheduler.tick();
    await flush();
    expect(harness.factory.requests).toHaveLength(1);

    harness.scheduler.dispose();
    await pending;

    expect(warnings(harness.logger, 'failed')).toHaveLength(0);
  });

  it('polls on its interval once started', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      harness = await makeHarness();
      harness.scheduler.start({ ...harness.options, pollMs: 1_000 });
      await jest.advanceTimersByTimeAsync(1_000);
      // Joins the poll the timer started; a fresh one would not be due yet.
      await harness.scheduler.tick();
      expect(harness.factory.requests).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('WalCheckpointScheduler — idle WAL (review-11 finding 3)', () => {
  let harness: Harness;
  afterEach(() => harness?.scheduler.dispose());

  async function caughtUpOnce(): Promise<void> {
    harness = await makeHarness();
    harness.wal.mtimeMs = 1234;
    harness.scheduler.start(harness.options);
    await harness.scheduler.tick();
    expect(harness.factory.requests).toHaveLength(1);
  }

  it('skips the interval checkpoint while a caught-up WAL is unchanged', async () => {
    await caughtUpOnce();
    harness.clock.now += 30_000;
    await harness.scheduler.tick();
    harness.clock.now += 30_000;
    await harness.scheduler.tick();
    expect(harness.factory.requests).toHaveLength(1);
  });

  it('treats a new mtime as new work', async () => {
    await caughtUpOnce();
    harness.clock.now += 30_000;
    harness.wal.mtimeMs = 5678;
    await harness.scheduler.tick();
    expect(harness.factory.requests).toHaveLength(2);
  });

  it('treats a new size (growth or a smaller file) as new work', async () => {
    await caughtUpOnce();
    harness.clock.now += 30_000;
    harness.wal.bytes = 2048;
    await harness.scheduler.tick();
    expect(harness.factory.requests).toHaveLength(2);
  });

  it('treats another database path as new work at once', async () => {
    await caughtUpOnce();
    Object.defineProperty(harness.connection, 'dbPath', {
      configurable: true,
      get: () => '/elsewhere/ptah.sqlite',
    });
    await harness.scheduler.tick();
    expect(harness.factory.requests.map((r) => r.dbPath)).toEqual([
      ':memory:',
      '/elsewhere/ptah.sqlite',
    ]);
  });

  it('keeps checkpointing a WAL whose last checkpoint did not catch up', async () => {
    harness = await makeHarness(behind);
    harness.wal.mtimeMs = 1234;
    harness.scheduler.start(harness.options);
    await harness.scheduler.tick();
    harness.clock.now += 30_000;
    await harness.scheduler.tick();
    expect(harness.factory.requests).toHaveLength(2);
  });

  it('rechecks an idle WAL after maxIdleSkipMs', async () => {
    await caughtUpOnce();
    harness.clock.now += 5 * 60_000;
    await harness.scheduler.tick();
    expect(harness.factory.requests).toHaveLength(2);
  });
});

describe('WalCheckpointScheduler — verified auto-checkpoint (review-11 finding 2)', () => {
  let harness: Harness;
  afterEach(() => harness?.scheduler.dispose());

  it('does not count auto-checkpoint as off when SQLite rejects 0, and retries', async () => {
    harness = await makeHarness();
    harness.fake.setWalAutoCheckpointFailure('throw');
    harness.scheduler.start(harness.options);

    await harness.scheduler.tick();

    expect(harness.connection.walCheckpointsOffMainThread).toBe(false);
    expect(harness.fake.getWalAutoCheckpointPages()).toBe(1000);
    expect(
      warnings(harness.logger, 'could not turn SQLite auto-checkpoint off')[0]?.context,
    ).toEqual({ error: expect.any(Error) });

    harness.fake.setWalAutoCheckpointFailure(null);
    harness.clock.now += 30_000;
    await harness.scheduler.tick();
    expect(harness.connection.walCheckpointsOffMainThread).toBe(true);
    expect(harness.fake.getWalAutoCheckpointPages()).toBe(0);
  });

  it('keeps running while a fallback restore fails, and stops once it succeeds', async () => {
    harness = await makeHarness();
    harness.scheduler.start({ ...harness.options, maxConsecutiveFailures: 1 });
    await harness.scheduler.tick();
    expect(harness.fake.getWalAutoCheckpointPages()).toBe(0);

    harness.factory.respond = failed;
    harness.fake.setWalAutoCheckpointFailure('ignore');
    harness.clock.now += 30_000;
    await harness.scheduler.tick();

    // SQLite is still at 0, so the scheduler must not stop.
    expect(harness.fake.getWalAutoCheckpointPages()).toBe(0);
    expect(harness.scheduler.running).toBe(true);
    expect(
      warnings(harness.logger, 'restoring SQLite auto-checkpoint failed')[0]?.context,
    ).toEqual({ error: expect.any(Error) });

    // The next poll retries the restore first.
    harness.fake.setWalAutoCheckpointFailure(null);
    await harness.scheduler.tick();
    expect(harness.fake.getWalAutoCheckpointPages()).toBe(1000);
    expect(harness.connection.walCheckpointsOffMainThread).toBe(false);
    expect(harness.scheduler.running).toBe(false);
    expect(warnings(harness.logger, 'keeps failing')).toHaveLength(1);
  });

  it('keeps retrying the worker while the restore fails', async () => {
    harness = await makeHarness();
    harness.scheduler.start({ ...harness.options, maxConsecutiveFailures: 1 });
    await harness.scheduler.tick();
    harness.factory.respond = failed;
    harness.fake.setWalAutoCheckpointFailure('ignore');
    harness.clock.now += 30_000;
    await harness.scheduler.tick();

    harness.factory.respond = caughtUp;
    harness.clock.now += 30_000;
    await harness.scheduler.tick();

    expect(harness.factory.requests).toHaveLength(3);
    expect(harness.scheduler.running).toBe(true);
  });
});

describe('WalCheckpointScheduler — exclusive access (review-11 finding 1)', () => {
  let harness: Harness;
  afterEach(() => harness?.scheduler.dispose());

  it('resolves at once on a host whose scheduler never started', async () => {
    harness = await makeHarness();
    const scheduler = new WalCheckpointScheduler(createMockLogger(), harness.connection, null);
    scheduler.start();
    const lease = await scheduler.pauseForExclusiveAccess();
    expect(() => {
      lease.release();
      lease.release();
    }).not.toThrow();
  });

  it('runs no checkpoint while paused and resumes after release', async () => {
    harness = await makeHarness();
    harness.scheduler.start(harness.options);
    const lease = await harness.scheduler.pauseForExclusiveAccess();

    await harness.scheduler.tick();
    harness.clock.now += 60_000;
    await harness.scheduler.tick();
    expect(harness.factory.requests).toHaveLength(0);

    lease.release();
    await harness.scheduler.tick();
    expect(harness.factory.requests).toHaveLength(1);
  });

  it('waits for a checkpoint that finishes within the bound, without a kill', async () => {
    harness = await makeHarness(() => null);
    harness.scheduler.start({ ...harness.options, pauseWaitMs: 5_000 });
    const tick = harness.scheduler.tick();
    await flush();
    const [request] = harness.factory.requests;
    expect(request).toBeDefined();

    let paused = false;
    const pause = harness.scheduler.pauseForExclusiveAccess().then((lease) => {
      paused = true;
      return lease;
    });
    await flush();
    expect(paused).toBe(false);

    harness.factory.workers[0].deliver(caughtUp(request));
    (await pause).release();
    await tick;

    expect(paused).toBe(true);
    expect(harness.factory.workers[0].kills).toBe(0);
  });

  it('kills a checkpoint that outlasts the bound, without counting a failure', async () => {
    harness = await makeHarness(() => null);
    harness.scheduler.start(harness.options);
    const tick = harness.scheduler.tick();
    await flush();
    expect(harness.factory.requests).toHaveLength(1);

    const lease = await harness.scheduler.pauseForExclusiveAccess();
    await tick;

    expect(harness.factory.workers[0].kills).toBe(1);
    expect(warnings(harness.logger, 'killing the worker')).toHaveLength(1);
    expect(warnings(harness.logger, 'off-main WAL checkpoint failed')).toHaveLength(0);
    lease.release();

    // The next checkpoint after release runs in a fresh worker.
    harness.factory.respond = caughtUp;
    harness.clock.now += 30_000;
    await harness.scheduler.tick();
    expect(harness.factory.workers).toHaveLength(2);
  });

  it('starts no checkpoint for a poll that was at its WAL stat when the pause began', async () => {
    const stat: { resolve: ((value: { bytes: number; mtimeMs: number }) => void) | null } = {
      resolve: null,
    };
    harness = await makeHarness();
    harness.scheduler.start({
      ...harness.options,
      statWal: () =>
        new Promise((resolve) => {
          stat.resolve = resolve;
        }),
    });
    const tick = harness.scheduler.tick();
    await flush();
    const pause = harness.scheduler.pauseForExclusiveAccess();
    stat.resolve?.({ bytes: 4096, mtimeMs: 1 });
    const lease = await pause;
    await tick;

    expect(harness.factory.requests).toHaveLength(0);
    lease.release();
  });
});

describe('statWalFile', () => {
  it('returns zeros for a missing WAL file and size + mtime of an existing one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-wal-'));
    try {
      const walPath = path.join(dir, 'ptah.sqlite-wal');
      expect(await statWalFile(walPath)).toEqual({ bytes: 0, mtimeMs: 0 });
      fs.writeFileSync(walPath, Buffer.alloc(2048));
      expect(await statWalFile(walPath)).toEqual({
        bytes: 2048,
        mtimeMs: fs.statSync(walPath).mtimeMs,
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
