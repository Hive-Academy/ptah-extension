/**
 * DbWorkerRunner specs (TASK_2026_383 Batch 7).
 *
 * EVERY ASSERTION IS A CALL COUNT OR A SETTLED VALUE, NEVER A TIMING — the one
 * place a real timer exists (the budget) is driven with Jest fake timers. The
 * fake worker never replies on its own; every reply is pushed by the test, so
 * nothing here depends on scheduling.
 *
 * What is under test is the property the whole feature rests on: the run
 * settles EXACTLY ONCE, on whichever of reply / exit / budget / abort comes
 * first, and the worker is killed on every one of those paths. A second
 * implementation of this loop inside the backup service is precisely what this
 * class exists to prevent, so these cases are the shared contract.
 */
import 'reflect-metadata';
import { createMockLogger } from '../testing/mock-logger';
import { DbWorkerRunner } from './db-worker-runner';
import type { IIntegrityWorkerProcess } from './worker-process.port';
import type { IntegrityCheckRequest } from './integrity-worker-protocol';

const REQUEST: IntegrityCheckRequest = {
  id: 1,
  type: 'check',
  dbPath: 'C:\\temp\\ptah-test.sqlite',
};

interface FakeWorker extends IIntegrityWorkerProcess {
  emitMessage(msg: unknown): void;
  emitExit(): void;
  readonly posted: unknown[];
  readonly killCount: number;
}

function makeFakeWorker(opts?: { postThrows?: boolean }): FakeWorker {
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
      if (opts?.postThrows) throw new Error('channel closed (fake)');
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

/** Identity narrowing: the reply is whatever the test pushed. */
const passThrough = (msg: unknown): unknown => msg;

function makeHarness(opts?: {
  worker?: FakeWorker;
  spawnThrows?: boolean;
  budgetMs?: number;
  narrow?: (msg: unknown) => unknown;
  signal?: AbortSignal;
  label?: string;
}) {
  const logger = createMockLogger();
  const worker = opts?.worker ?? makeFakeWorker();
  let spawnCount = 0;
  const factory = {
    spawn: () => {
      spawnCount += 1;
      if (opts?.spawnThrows) throw new Error('utilityProcess.fork failed');
      return worker;
    },
  };
  const runner = new DbWorkerRunner(logger);
  const run = runner.run<unknown>(factory, {
    label: opts?.label ?? 'integrity',
    request: REQUEST,
    budgetMs: opts?.budgetMs ?? 5_000,
    narrow: opts?.narrow ?? passThrough,
    signal: opts?.signal,
  });
  return { logger, worker, run, spawnCount: () => spawnCount };
}

describe('DbWorkerRunner.run — the reply path', () => {
  it('posts the request exactly once and settles with the narrowed reply', async () => {
    const harness = makeHarness();
    harness.worker.emitMessage({ id: 1, ok: true });

    const outcome = await harness.run.settled;

    expect(harness.worker.posted).toEqual([REQUEST]);
    expect(outcome).toEqual({ aborted: false, response: { id: 1, ok: true } });
  });

  it('kills the worker once after a completed run', async () => {
    const harness = makeHarness();
    harness.worker.emitMessage({ id: 1, ok: true });
    await harness.run.settled;
    expect(harness.worker.killCount).toBe(1);
  });

  it('settles with a null response when narrow rejects the reply shape', async () => {
    const harness = makeHarness({ narrow: () => null });
    harness.worker.emitMessage({ id: 1, ok: true, verdict: 'fine' });

    const outcome = await harness.run.settled;

    // Inconclusive, not aborted: we asked and got something we cannot read.
    expect(outcome).toEqual({ aborted: false, response: null });
  });

  it('a SECOND reply cannot settle the run again or kill a second time', async () => {
    const harness = makeHarness();
    harness.worker.emitMessage({ id: 1, ok: true });
    await harness.run.settled;

    harness.worker.emitMessage({ id: 1, ok: false, error: 'late' });
    await expect(harness.run.settled).resolves.toEqual({
      aborted: false,
      response: { id: 1, ok: true },
    });
    expect(harness.worker.killCount).toBe(1);
  });
});

describe('DbWorkerRunner.run — the exit path', () => {
  it('an exit before any reply settles null and kills once', async () => {
    const harness = makeHarness();
    harness.worker.emitExit();

    await expect(harness.run.settled).resolves.toEqual({
      aborted: false,
      response: null,
    });
    expect(harness.worker.killCount).toBe(1);
  });

  it('an exit AFTER a reply does not overwrite the reply', async () => {
    const harness = makeHarness();
    harness.worker.emitMessage({ id: 1, ok: true });
    harness.worker.emitExit();

    await expect(harness.run.settled).resolves.toEqual({
      aborted: false,
      response: { id: 1, ok: true },
    });
  });
});

describe('DbWorkerRunner.run — the budget path', () => {
  it('kills a worker that never replies once the budget is spent, and warns', async () => {
    jest.useFakeTimers();
    try {
      const harness = makeHarness({ budgetMs: 1_000 });
      jest.advanceTimersByTime(1_000);

      await expect(harness.run.settled).resolves.toEqual({
        aborted: false,
        response: null,
      });
      expect(harness.worker.killCount).toBe(1);
      expect(
        harness.logger.entries.some(
          (e) => e.level === 'warn' && /budget/.test(e.message),
        ),
      ).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("unref's the budget timer so a pending run cannot hold the process open", async () => {
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
      const harness = makeHarness();
      harness.worker.emitMessage({ id: 1, ok: true });
      await harness.run.settled;
      expect(unref).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('uses the budget the CALLER passed, not a shared constant', async () => {
    jest.useFakeTimers();
    try {
      // The whole reason the budget is a parameter: a gigabyte copy and a
      // quick_check are not the same amount of work.
      const harness = makeHarness({ budgetMs: 60_000 });
      jest.advanceTimersByTime(59_999);
      let settledEarly = false;
      void harness.run.settled.then(() => {
        settledEarly = true;
      });
      await Promise.resolve();
      expect(settledEarly).toBe(false);

      jest.advanceTimersByTime(1);
      await harness.run.settled;
      expect(harness.worker.killCount).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('DbWorkerRunner.run — abort', () => {
  it('abort() settles as aborted, kills once, and a late reply changes nothing', async () => {
    const harness = makeHarness();
    harness.run.abort();

    await expect(harness.run.settled).resolves.toEqual({
      aborted: true,
      response: null,
    });
    expect(harness.worker.killCount).toBe(1);

    harness.worker.emitMessage({ id: 1, ok: true });
    await expect(harness.run.settled).resolves.toEqual({
      aborted: true,
      response: null,
    });
  });

  it('abort() is idempotent and never throws', async () => {
    const harness = makeHarness();
    expect(() => harness.run.abort()).not.toThrow();
    expect(() => harness.run.abort()).not.toThrow();
    await harness.run.settled;
    expect(harness.worker.killCount).toBe(1);
  });

  it('abort() after the run settled is a no-op, not a second kill', async () => {
    const harness = makeHarness();
    harness.worker.emitMessage({ id: 1, ok: true });
    await harness.run.settled;

    harness.run.abort();
    expect(harness.worker.killCount).toBe(1);
  });

  it('an AbortSignal firing mid-flight settles the run the same way', async () => {
    const controller = new AbortController();
    const harness = makeHarness({ signal: controller.signal });
    controller.abort();

    await expect(harness.run.settled).resolves.toEqual({
      aborted: true,
      response: null,
    });
    expect(harness.worker.killCount).toBe(1);
  });
});

describe('DbWorkerRunner.run — never rejects', () => {
  it('a factory that throws on spawn settles null and warns', async () => {
    const harness = makeHarness({ spawnThrows: true });

    await expect(harness.run.settled).resolves.toEqual({
      aborted: false,
      response: null,
    });
    expect(
      harness.logger.entries.some(
        (e) => e.level === 'warn' && /spawn failed/.test(e.message),
      ),
    ).toBe(true);
  });

  it('a postMessage that throws settles null, warns, and kills the worker', async () => {
    const worker = makeFakeWorker({ postThrows: true });
    const harness = makeHarness({ worker });

    await expect(harness.run.settled).resolves.toEqual({
      aborted: false,
      response: null,
    });
    expect(
      harness.logger.entries.some(
        (e) => e.level === 'warn' && /request post failed/.test(e.message),
      ),
    ).toBe(true);
    expect(worker.killCount).toBe(1);
  });

  it('a kill that throws is swallowed and the run still settles', async () => {
    const worker = makeFakeWorker();
    const throwingWorker: FakeWorker = {
      ...worker,
      kill: () => {
        throw new Error('already dead (fake)');
      },
    };
    const harness = makeHarness({ worker: throwingWorker });
    throwingWorker.emitMessage({ id: 1, ok: true });

    await expect(harness.run.settled).resolves.toEqual({
      aborted: false,
      response: { id: 1, ok: true },
    });
  });
});

describe('DbWorkerRunner.run — the label', () => {
  it("names the caller's command in the log line, so two drivers are told apart", async () => {
    jest.useFakeTimers();
    try {
      const harness = makeHarness({ label: 'backup', budgetMs: 10 });
      jest.advanceTimersByTime(10);
      await harness.run.settled;

      expect(
        harness.logger.entries.some(
          (e) => e.level === 'warn' && e.message.includes('backup worker'),
        ),
      ).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
