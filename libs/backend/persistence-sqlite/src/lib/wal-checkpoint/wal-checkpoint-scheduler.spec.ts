import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SqliteConnectionService } from '../sqlite-connection.service';
import { FakeSqliteDatabase } from '../testing/fake-sqlite-database';
import { createMockLogger, type MockLogger } from '../testing/mock-logger';
import {
  WalCheckpointScheduler,
  statWalBytes,
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
  wal: { bytes: number | Error };
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
  const wal: { bytes: number | Error } = { bytes: 4096 };
  const options: Partial<WalCheckpointSchedulerOptions> = {
    pollMs: 60 * 60 * 1000,
    intervalMs: 30_000,
    sizeTriggerBytes: 16 * 1024 * 1024,
    stallWarnMs: 60_000,
    requestTimeoutMs: 5_000,
    maxConsecutiveFailures: 3,
    now: () => clock.now,
    statWalBytes: async () => {
      if (wal.bytes instanceof Error) throw wal.bytes;
      return wal.bytes;
    },
  };
  const scheduler = new WalCheckpointScheduler(logger, connection, factory);
  return { scheduler, connection, fake, factory, logger, clock, wal, options };
}

const autoCheckpointPragmas = (fake: FakeSqliteDatabase): string[] =>
  fake.pragmas.filter((p) => p.startsWith('wal_autocheckpoint'));

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

describe('statWalBytes', () => {
  it('returns 0 for a missing WAL file and the size of an existing one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-wal-'));
    try {
      const walPath = path.join(dir, 'ptah.sqlite-wal');
      expect(await statWalBytes(walPath)).toBe(0);
      fs.writeFileSync(walPath, Buffer.alloc(2048));
      expect(await statWalBytes(walPath)).toBe(2048);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
