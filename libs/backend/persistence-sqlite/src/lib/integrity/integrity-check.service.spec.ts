/**
 * SqliteIntegrityService specs (TASK_2026_380 B1).
 *
 * EVERY ASSERTION HERE IS A CALL COUNT, NEVER A TIMING. The clock is a plain
 * number handed to `isDue`, and the one place a real timer exists (the worker
 * budget) is driven with Jest fake timers. A spec that waited on a duration
 * would be asserting the machine's speed rather than the service's decision,
 * and would be the first thing to flake in CI.
 *
 * The fake factory stands in for the host's `utilityProcess.fork`. It records
 * every spawn and every kill, which is what lets the single-flight and budget
 * properties be stated as counts.
 */
import 'reflect-metadata';
import { createMockLogger } from '../testing/mock-logger';
import {
  SqliteIntegrityService,
  DB_INTEGRITY_CHECK_INTERVAL_MS,
  INTEGRITY_WORKER_BUDGET_MS,
} from './integrity-check.service';
import type {
  IntegrityCheckStateStore,
  IntegrityCheckState,
} from './integrity-check-state.store';
import type {
  IIntegrityWorkerProcess,
  IIntegrityWorkerProcessFactory,
} from './worker-process.port';
import type { IntegrityCheckResponse } from './integrity-worker-protocol';

const DB_PATH = 'C:\\temp\\ptah-test.sqlite';
const NOW = 1_800_000_000_000;

const CLEAN_RESPONSE: IntegrityCheckResponse = {
  id: 1,
  ok: true,
  verdict: 'ok',
  quickCheck: 'ok',
  foreignKeyViolations: 0,
  durationMs: 1868,
  pageCount: 256_183,
  detail: null,
};

/**
 * A clean record `days` old relative to `base`.
 *
 * `base` is explicit because the two halves of this file read two different
 * clocks: `isDue(now)` is handed `NOW`, while `dispatchIfDue()` calls
 * `isDue()` with no argument and therefore reads the real one. A fixture dated
 * against `NOW` and then judged against the real clock lands in the FUTURE and
 * is due for clock skew — which is correct behaviour and a useless test.
 */
function stateAgedDays(days: number, base: number = NOW): IntegrityCheckState {
  return {
    checkedAt: base - days * 24 * 60 * 60 * 1000,
    quickCheckOk: true,
    foreignKeyViolations: 0,
    durationMs: 1868,
    pageCount: 256_183,
    detail: null,
  };
}

interface FakeWorker extends IIntegrityWorkerProcess {
  emitMessage(msg: unknown): void;
  emitExit(): void;
  readonly posted: unknown[];
  readonly killCount: number;
}

/**
 * A worker that never replies on its own. Every reply is pushed by the test,
 * so nothing here depends on scheduling.
 */
function makeFakeWorker(): FakeWorker {
  let onMessage: ((msg: unknown) => void) | null = null;
  let onExit: ((code: number | null) => void) | null = null;
  const posted: unknown[] = [];
  let killCount = 0;
  return {
    posted,
    get killCount() {
      return killCount;
    },
    postMessage: (msg: unknown) => {
      posted.push(msg);
    },
    on: ((event: string, cb: (arg: never) => void) => {
      if (event === 'message') onMessage = cb as (msg: unknown) => void;
      if (event === 'exit') onExit = cb as (code: number | null) => void;
    }) as IIntegrityWorkerProcess['on'],
    kill: () => {
      killCount += 1;
    },
    emitMessage: (msg: unknown) => onMessage?.(msg),
    emitExit: () => onExit?.(null),
  };
}

interface Harness {
  service: SqliteIntegrityService;
  logger: ReturnType<typeof createMockLogger>;
  workers: FakeWorker[];
  spawnCount: () => number;
  writes: IntegrityCheckState[];
}

function makeHarness(opts: {
  state?: IntegrityCheckState | null;
  withFactory?: boolean;
  /** Called with the freshly spawned worker so a test can script its reply. */
  onSpawn?: (worker: FakeWorker) => void;
}): Harness {
  const logger = createMockLogger();
  const writes: IntegrityCheckState[] = [];
  const store = {
    read: () => opts.state ?? null,
    write: (s: IntegrityCheckState) => {
      writes.push(s);
    },
  } as unknown as IntegrityCheckStateStore;

  const workers: FakeWorker[] = [];
  const factory: IIntegrityWorkerProcessFactory = {
    spawn: () => {
      const worker = makeFakeWorker();
      workers.push(worker);
      opts.onSpawn?.(worker);
      return worker;
    },
  };

  const service = new SqliteIntegrityService(
    logger,
    DB_PATH,
    store,
    opts.withFactory === false ? null : factory,
  );
  return { service, logger, workers, spawnCount: () => workers.length, writes };
}

// ── isDue ───────────────────────────────────────────────────────────────────

describe('SqliteIntegrityService.isDue', () => {
  it('is due when there is no record — absence means never checked', () => {
    const { service } = makeHarness({ state: null });
    expect(service.isDue(NOW)).toBe(true);
  });

  it('is NOT due six days after a clean check', () => {
    const { service } = makeHarness({ state: stateAgedDays(6) });
    expect(service.isDue(NOW)).toBe(false);
  });

  it('is due eight days after a clean check', () => {
    const { service } = makeHarness({ state: stateAgedDays(8) });
    expect(service.isDue(NOW)).toBe(true);
  });

  it('is due exactly at the interval boundary', () => {
    const { service } = makeHarness({
      state: {
        ...stateAgedDays(0),
        checkedAt: NOW - DB_INTEGRITY_CHECK_INTERVAL_MS,
      },
    });
    expect(service.isDue(NOW)).toBe(true);
  });

  it('is due when the record is stamped in the FUTURE (clock skew)', () => {
    // "I cannot date this" resolves towards checking, never towards trusting.
    const { service } = makeHarness({
      state: { ...stateAgedDays(0), checkedAt: NOW + 60_000 },
    });
    expect(service.isDue(NOW)).toBe(true);
  });

  it('is due regardless of age when the last quick_check was not ok', () => {
    const { service } = makeHarness({
      state: { ...stateAgedDays(1), quickCheckOk: false, detail: 'bad page' },
    });
    expect(service.isDue(NOW)).toBe(true);
  });

  it('is due regardless of age when the last check found FK violations', () => {
    const { service } = makeHarness({
      state: { ...stateAgedDays(1), foreignKeyViolations: 3 },
    });
    expect(service.isDue(NOW)).toBe(true);
  });
});

// ── dispatchIfDue ───────────────────────────────────────────────────────────

describe('SqliteIntegrityService.dispatchIfDue — dispatch counts', () => {
  it('due with no record dispatches exactly once', async () => {
    const harness = makeHarness({
      state: null,
      onSpawn: (w) => queueMicrotask(() => w.emitMessage(CLEAN_RESPONSE)),
    });
    await harness.service.dispatchIfDue();
    expect(harness.spawnCount()).toBe(1);
  });

  it('a six-day-old clean record dispatches zero times', async () => {
    const harness = makeHarness({ state: stateAgedDays(6, Date.now()) });
    await harness.service.dispatchIfDue();
    expect(harness.spawnCount()).toBe(0);
  });

  it('an eight-day-old record dispatches once', async () => {
    const harness = makeHarness({
      state: stateAgedDays(8, Date.now()),
      onSpawn: (w) => queueMicrotask(() => w.emitMessage(CLEAN_RESPONSE)),
    });
    await harness.service.dispatchIfDue();
    expect(harness.spawnCount()).toBe(1);
  });

  it('a failed prior verdict dispatches regardless of age', async () => {
    const harness = makeHarness({
      state: { ...stateAgedDays(1, Date.now()), quickCheckOk: false },
      onSpawn: (w) => queueMicrotask(() => w.emitMessage(CLEAN_RESPONSE)),
    });
    await harness.service.dispatchIfDue();
    expect(harness.spawnCount()).toBe(1);
  });

  it('two concurrent dispatchIfDue() calls produce ONE spawn', async () => {
    // The single-flight flag is set synchronously, before the first `await`,
    // which is what makes this hold without any ordering assumption.
    const harness = makeHarness({
      state: null,
      onSpawn: (w) => queueMicrotask(() => w.emitMessage(CLEAN_RESPONSE)),
    });
    await Promise.all([
      harness.service.dispatchIfDue(),
      harness.service.dispatchIfDue(),
    ]);
    expect(harness.spawnCount()).toBe(1);
  });

  it('a second dispatch AFTER the first settles is allowed', async () => {
    const harness = makeHarness({
      state: null,
      onSpawn: (w) => queueMicrotask(() => w.emitMessage(CLEAN_RESPONSE)),
    });
    await harness.service.dispatchIfDue();
    await harness.service.dispatchIfDue();
    expect(harness.spawnCount()).toBe(2);
  });

  it('sends the configured db path on the request', async () => {
    const harness = makeHarness({
      state: null,
      onSpawn: (w) => queueMicrotask(() => w.emitMessage(CLEAN_RESPONSE)),
    });
    await harness.service.dispatchIfDue();
    expect(harness.workers[0].posted).toEqual([
      { id: 1, type: 'check', dbPath: DB_PATH },
    ]);
  });
});

describe('SqliteIntegrityService.dispatchIfDue — no worker factory', () => {
  it('does not dispatch, does not throw, and logs at info exactly once', async () => {
    const harness = makeHarness({ state: null, withFactory: false });
    await harness.service.dispatchIfDue();
    await harness.service.dispatchIfDue();
    await harness.service.dispatchIfDue();

    expect(harness.spawnCount()).toBe(0);
    expect(harness.writes).toHaveLength(0);
    const infos = harness.logger.entries.filter(
      (e) => e.level === 'info' && e.message.includes('no integrity worker'),
    );
    expect(infos).toHaveLength(1);
  });
});

describe('SqliteIntegrityService.dispatchIfDue — what gets recorded', () => {
  it('a clean verdict writes exactly one record', async () => {
    const harness = makeHarness({
      state: null,
      onSpawn: (w) => queueMicrotask(() => w.emitMessage(CLEAN_RESPONSE)),
    });
    await harness.service.dispatchIfDue();
    expect(harness.writes).toHaveLength(1);
    expect(harness.writes[0]).toMatchObject({
      quickCheckOk: true,
      foreignKeyViolations: 0,
      durationMs: 1868,
      pageCount: 256_183,
      detail: null,
    });
  });

  it('a corrupt verdict writes exactly one record and logs at error', async () => {
    const harness = makeHarness({
      state: null,
      onSpawn: (w) =>
        queueMicrotask(() =>
          w.emitMessage({
            ...CLEAN_RESPONSE,
            verdict: 'corrupt',
            quickCheck: 'row 42 missing from index',
            detail: 'row 42 missing from index',
          }),
        ),
    });
    await harness.service.dispatchIfDue();
    expect(harness.writes).toHaveLength(1);
    expect(harness.writes[0].quickCheckOk).toBe(false);
    expect(
      harness.logger.entries.some(
        (e) => e.level === 'error' && /quick_check FAILED/.test(e.message),
      ),
    ).toBe(true);
  });

  it('an UNAVAILABLE verdict writes ZERO records', async () => {
    // The whole point of the third verdict. A record here would say "checked,
    // fine" about a question that was never asked, and the next window would
    // then skip. No record means the next window retries.
    const harness = makeHarness({
      state: null,
      onSpawn: (w) =>
        queueMicrotask(() =>
          w.emitMessage({
            ...CLEAN_RESPONSE,
            verdict: 'unavailable',
            quickCheck: '',
            detail: 'Cannot find module better-sqlite3',
          }),
        ),
    });
    await harness.service.dispatchIfDue();
    expect(harness.writes).toHaveLength(0);
    expect(harness.logger.entries.some((e) => e.level === 'warn')).toBe(true);
  });

  it('an error response writes zero records', async () => {
    const harness = makeHarness({
      state: null,
      onSpawn: (w) =>
        queueMicrotask(() =>
          w.emitMessage({ id: 1, ok: false, error: 'worker blew up' }),
        ),
    });
    await harness.service.dispatchIfDue();
    expect(harness.writes).toHaveLength(0);
  });

  it('an exit before any reply writes zero records and does not reject', async () => {
    const harness = makeHarness({
      state: null,
      onSpawn: (w) => queueMicrotask(() => w.emitExit()),
    });
    await expect(harness.service.dispatchIfDue()).resolves.toBeUndefined();
    expect(harness.writes).toHaveLength(0);
  });

  it('an unrecognised reply shape writes zero records', async () => {
    const harness = makeHarness({
      state: null,
      onSpawn: (w) =>
        queueMicrotask(() =>
          w.emitMessage({ id: 1, ok: true, verdict: 'fine' }),
        ),
    });
    await harness.service.dispatchIfDue();
    expect(harness.writes).toHaveLength(0);
  });
});

describe('SqliteIntegrityService.dispatchIfDue — never throws', () => {
  it('resolves when the factory itself throws on spawn', async () => {
    const logger = createMockLogger();
    const store = {
      read: () => null,
      write: () => undefined,
    } as unknown as IntegrityCheckStateStore;
    const factory: IIntegrityWorkerProcessFactory = {
      spawn: () => {
        throw new Error('utilityProcess.fork failed');
      },
    };
    const service = new SqliteIntegrityService(logger, DB_PATH, store, factory);
    await expect(service.dispatchIfDue()).resolves.toBeUndefined();
    expect(logger.entries.some((e) => e.level === 'warn')).toBe(true);
  });

  it('resolves when the store read throws', async () => {
    const logger = createMockLogger();
    const store = {
      read: () => {
        throw new Error('PERSISTENCE_UNAVAILABLE');
      },
      write: () => undefined,
    } as unknown as IntegrityCheckStateStore;
    const service = new SqliteIntegrityService(logger, DB_PATH, store, {
      spawn: () => makeFakeWorker(),
    });
    await expect(service.dispatchIfDue()).resolves.toBeUndefined();
  });

  it('releases the single-flight flag after a failed attempt', async () => {
    const harness = makeHarness({
      state: null,
      onSpawn: (w) => queueMicrotask(() => w.emitExit()),
    });
    await harness.service.dispatchIfDue();
    await harness.service.dispatchIfDue();
    expect(harness.spawnCount()).toBe(2);
  });
});

// ── cancellation: the AbortSignal and dispose() ─────────────────────────────
//
// Both are the same mechanism seen from two sides — the boot signal the host
// threads in, and the synchronous teardown call. Every assertion here is still
// a call count: spawns, kills and records.

describe('SqliteIntegrityService.dispatchIfDue — an ALREADY-aborted signal', () => {
  it('spawns nothing and writes nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = makeHarness({ state: null });

    await expect(
      harness.service.dispatchIfDue({ signal: controller.signal }),
    ).resolves.toBeUndefined();

    expect(harness.spawnCount()).toBe(0);
    expect(harness.writes).toHaveLength(0);
  });

  it('leaves the single-flight flag clear, so a later dispatch still spawns', async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = makeHarness({
      state: null,
      onSpawn: (w) => queueMicrotask(() => w.emitMessage(CLEAN_RESPONSE)),
    });

    await harness.service.dispatchIfDue({ signal: controller.signal });
    await harness.service.dispatchIfDue();

    expect(harness.spawnCount()).toBe(1);
  });
});

describe('SqliteIntegrityService — abort MID-FLIGHT', () => {
  it('kills the worker once, records nothing, and releases the flag', async () => {
    // The worker is scripted never to reply, so the abort is the only way this
    // dispatch can settle — no timing assumption, and no budget timer needed.
    const controller = new AbortController();
    const harness = makeHarness({ state: null });

    const pending = harness.service.dispatchIfDue({
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    await pending;

    expect(harness.workers[0].killCount).toBe(1);
    expect(harness.writes).toHaveLength(0);

    // The flag is released, not stuck: a later dispatch spawns a SECOND worker.
    // The spawn is synchronous inside the dispatch, so the count can be read
    // before this second run is itself aborted and awaited.
    const second = harness.service.dispatchIfDue();
    expect(harness.spawnCount()).toBe(2);
    harness.service.dispose();
    await second;
  });

  it('a late reply after the abort still writes no record', async () => {
    const controller = new AbortController();
    const harness = makeHarness({ state: null });

    const pending = harness.service.dispatchIfDue({
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    await pending;

    harness.workers[0].emitMessage(CLEAN_RESPONSE);
    await Promise.resolve();

    expect(harness.writes).toHaveLength(0);
  });

  it('dispose() aborts the in-flight run the same way', async () => {
    const harness = makeHarness({ state: null });

    const pending = harness.service.dispatchIfDue();
    await Promise.resolve();
    harness.service.dispose();
    await pending;

    expect(harness.workers[0].killCount).toBe(1);
    expect(harness.writes).toHaveLength(0);
  });
});

describe('SqliteIntegrityService.dispose', () => {
  it('is a no-op with nothing in flight, and does not throw', () => {
    const harness = makeHarness({ state: null });
    expect(() => harness.service.dispose()).not.toThrow();
    expect(harness.spawnCount()).toBe(0);
  });

  it('does not throw when called twice after an in-flight abort', async () => {
    const harness = makeHarness({ state: null });

    const pending = harness.service.dispatchIfDue();
    await Promise.resolve();
    harness.service.dispose();
    expect(() => harness.service.dispose()).not.toThrow();
    await pending;

    expect(harness.workers[0].killCount).toBe(1);
  });

  it('does not throw after a completed check', async () => {
    const harness = makeHarness({
      state: null,
      onSpawn: (w) => queueMicrotask(() => w.emitMessage(CLEAN_RESPONSE)),
    });
    await harness.service.dispatchIfDue();

    expect(() => harness.service.dispose()).not.toThrow();
    // The completed run's worker was killed exactly once — dispose did not
    // reach a settled run and kill it again.
    expect(harness.workers[0].killCount).toBe(1);
  });
});

describe('SqliteIntegrityService — the worker is killed', () => {
  it('kills the worker once after a completed check', async () => {
    const harness = makeHarness({
      state: null,
      onSpawn: (w) => queueMicrotask(() => w.emitMessage(CLEAN_RESPONSE)),
    });
    await harness.service.dispatchIfDue();
    expect(harness.workers[0].killCount).toBe(1);
  });

  it('kills a worker that never replies, once the budget is spent', async () => {
    jest.useFakeTimers();
    try {
      const harness = makeHarness({ state: null });
      const pending = harness.service.dispatchIfDue();
      // Nothing is scripted to reply: the budget timer is the only way out.
      jest.advanceTimersByTime(INTEGRITY_WORKER_BUDGET_MS);
      await pending;

      expect(harness.workers[0].killCount).toBe(1);
      expect(harness.writes).toHaveLength(0);
      expect(
        harness.logger.entries.some(
          (e) => e.level === 'warn' && /budget/.test(e.message),
        ),
      ).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("unref's the budget timer so a pending check cannot hold the process open", async () => {
    jest.useFakeTimers();
    const unref = jest.fn();
    const realSetTimeout = global.setTimeout;
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation(((
      fn: () => void,
      ms?: number,
    ) => {
      const handle = realSetTimeout(fn, ms);
      (handle as unknown as { unref: () => void }).unref = unref;
      return handle;
    }) as unknown as typeof setTimeout);
    try {
      const harness = makeHarness({
        state: null,
        onSpawn: (w) => queueMicrotask(() => w.emitMessage(CLEAN_RESPONSE)),
      });
      const pending = harness.service.dispatchIfDue();
      await jest.advanceTimersByTimeAsync(0);
      await pending;
      expect(unref).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      jest.useRealTimers();
    }
  });
});
