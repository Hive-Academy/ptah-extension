/**
 * TASK_2026_345 — the coalescer contract.
 *
 * Everything this primitive promises is a TIMING claim, so every test here runs
 * on fake timers and drives them explicitly. The four claims, one describe
 * block each:
 *
 * 1. N triggers inside the window produce ONE run, told every reason.
 * 2. A trigger after the run has drained produces a SECOND run.
 * 3. Runs for one key never overlap, and a trigger that arrives mid-run joins
 *    the single batch queued behind it rather than starting a third.
 * 4. Different keys are independent, and a rejected run poisons nothing.
 */

import { createCoalescedJob } from './coalesced-job';

const KEY = 'ws-a';
const OTHER = 'ws-b';
const WINDOW = 300;

/** A deferred whose settle side the test drives. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Let every already-queued microtask run without advancing the clock. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('createCoalescedJob — N reasons in the window, one run', () => {
  it('runs once and names every reason, in arrival order', async () => {
    const batches: string[][] = [];
    const job = createCoalescedJob<undefined>({
      windowMs: WINDOW,
      run: async ({ reasons }) => {
        batches.push([...reasons]);
      },
    });

    const all = Promise.all([
      job.request(KEY, 'activation', undefined),
      job.request(KEY, 'workspace-folders-changed', undefined),
      job.request(KEY, 'content-download-complete', undefined),
    ]);

    // Nothing runs while the window is open.
    await flushMicrotasks();
    expect(batches).toHaveLength(0);
    expect(job.pendingReasons(KEY)).toEqual([
      'activation',
      'workspace-folders-changed',
      'content-download-complete',
    ]);

    jest.advanceTimersByTime(WINDOW);
    await all;

    expect(batches).toEqual([
      ['activation', 'workspace-folders-changed', 'content-download-complete'],
    ]);
  });

  it('deduplicates a reason that fires twice in one window', async () => {
    const batches: string[][] = [];
    const job = createCoalescedJob<undefined>({
      windowMs: WINDOW,
      run: async ({ reasons }) => {
        batches.push([...reasons]);
      },
    });

    const all = Promise.all([
      job.request(KEY, 'workspace-folders-changed', undefined),
      job.request(KEY, 'workspace-folders-changed', undefined),
      job.request(KEY, 'activation', undefined),
    ]);
    jest.advanceTimersByTime(WINDOW);
    await all;

    expect(batches).toEqual([['workspace-folders-changed', 'activation']]);
  });

  it('gives every joiner the SAME promise, so none returns before the run', async () => {
    const gate = deferred();
    const settled: string[] = [];
    const job = createCoalescedJob<undefined>({
      windowMs: WINDOW,
      run: () => gate.promise,
    });

    void job.request(KEY, 'first', undefined).then(() => settled.push('first'));
    void job
      .request(KEY, 'second', undefined)
      .then(() => settled.push('second'));

    jest.advanceTimersByTime(WINDOW);
    await flushMicrotasks();
    expect(settled).toEqual([]);

    gate.resolve();
    await flushMicrotasks();
    expect(settled).toEqual(['first', 'second']);
  });

  it('carries the most recent payload of the batch', async () => {
    const seen: Array<string | undefined> = [];
    const job = createCoalescedJob<string | undefined>({
      windowMs: WINDOW,
      run: async ({ payload }) => {
        seen.push(payload);
      },
    });

    // Two spellings of one directory reach the same key; the newest is the one
    // the newest trigger actually observed.
    const all = Promise.all([
      job.request(KEY, 'activation', 'D:\\projects\\ws'),
      job.request(KEY, 'switch', 'D:/projects/ws'),
    ]);
    jest.advanceTimersByTime(WINDOW);
    await all;

    expect(seen).toEqual(['D:/projects/ws']);
  });
});

describe('createCoalescedJob — a trigger after the run gets its own run', () => {
  it('runs a second time for a reason that arrives once the batch has drained', async () => {
    const batches: string[][] = [];
    const job = createCoalescedJob<undefined>({
      windowMs: WINDOW,
      run: async ({ reasons }) => {
        batches.push([...reasons]);
      },
    });

    const first = job.request(KEY, 'activation', undefined);
    jest.advanceTimersByTime(WINDOW);
    await first;
    expect(batches).toEqual([['activation']]);

    const second = job.request(KEY, 'content-download-complete', undefined);
    jest.advanceTimersByTime(WINDOW);
    await second;

    expect(batches).toEqual([['activation'], ['content-download-complete']]);
  });

  it('does not run again on its own — the window is not a poll', async () => {
    const run = jest.fn(async () => undefined);
    const job = createCoalescedJob<undefined>({ windowMs: WINDOW, run });

    const first = job.request(KEY, 'activation', undefined);
    jest.advanceTimersByTime(WINDOW);
    await first;

    jest.advanceTimersByTime(WINDOW * 10);
    await flushMicrotasks();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('createCoalescedJob — runs for one key never overlap', () => {
  it('serializes a second batch behind an in-flight run', async () => {
    const order: string[] = [];
    const gate = deferred();
    let call = 0;
    const job = createCoalescedJob<undefined>({
      windowMs: WINDOW,
      run: async ({ reasons }) => {
        call += 1;
        const label = `${call}:${reasons.join('+')}`;
        order.push(`start ${label}`);
        if (call === 1) await gate.promise;
        order.push(`end ${label}`);
      },
    });

    const first = job.request(KEY, 'activation', undefined);
    jest.advanceTimersByTime(WINDOW);
    await flushMicrotasks();
    expect(order).toEqual(['start 1:activation']);

    // Arrives WHILE run 1 is in flight.
    const second = job.request(KEY, 'plugin-toggle', undefined);
    jest.advanceTimersByTime(WINDOW);
    await flushMicrotasks();
    // Still nothing else started — this is the interleaving the log showed,
    // where one pass reported fastForwarded:15 and its twin reported 0.
    expect(order).toEqual(['start 1:activation']);

    gate.resolve();
    await first;
    await second;

    expect(order).toEqual([
      'start 1:activation',
      'end 1:activation',
      'start 2:plugin-toggle',
      'end 2:plugin-toggle',
    ]);
  });

  it('folds several mid-run triggers into the ONE batch queued behind it', async () => {
    const batches: string[][] = [];
    const gate = deferred();
    let call = 0;
    const job = createCoalescedJob<undefined>({
      windowMs: WINDOW,
      run: async ({ reasons }) => {
        batches.push([...reasons]);
        call += 1;
        if (call === 1) await gate.promise;
      },
    });

    const first = job.request(KEY, 'activation', undefined);
    jest.advanceTimersByTime(WINDOW);
    await flushMicrotasks();

    const queued = Promise.all([
      job.request(KEY, 'switch', undefined),
      job.request(KEY, 'plugin-toggle', undefined),
      job.request(KEY, 'wizard-submit', undefined),
    ]);
    jest.advanceTimersByTime(WINDOW * 3);
    await flushMicrotasks();

    gate.resolve();
    await first;
    await queued;

    expect(batches).toEqual([
      ['activation'],
      ['switch', 'plugin-toggle', 'wizard-submit'],
    ]);
  });
});

describe('createCoalescedJob — isolation', () => {
  it('keeps different keys independent and concurrent', async () => {
    const started: string[] = [];
    const gate = deferred();
    const job = createCoalescedJob<undefined>({
      windowMs: WINDOW,
      run: async ({ key }) => {
        started.push(key);
        await gate.promise;
      },
    });

    const a = job.request(KEY, 'activation', undefined);
    const b = job.request(OTHER, 'activation', undefined);
    jest.advanceTimersByTime(WINDOW);
    await flushMicrotasks();

    expect(started.sort()).toEqual([KEY, OTHER]);

    gate.resolve();
    await Promise.all([a, b]);
  });

  it('reports a rejected run and still resolves its requesters', async () => {
    const onError = jest.fn();
    const job = createCoalescedJob<undefined>({
      windowMs: WINDOW,
      run: async () => {
        throw new Error('EPERM');
      },
      onError,
    });

    const request = job.request(KEY, 'activation', undefined);
    jest.advanceTimersByTime(WINDOW);

    await expect(request).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toBe('EPERM');
    expect(onError.mock.calls[0][1]).toEqual({
      key: KEY,
      reasons: ['activation'],
      payload: undefined,
    });
  });

  it('warns rather than throwing when no onError is supplied', async () => {
    const job = createCoalescedJob<undefined>({
      windowMs: WINDOW,
      run: async () => {
        throw new Error('EBUSY');
      },
    });

    const request = job.request(KEY, 'activation', undefined);
    jest.advanceTimersByTime(WINDOW);
    await expect(request).resolves.toBeUndefined();

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Coalesced job failed'),
      'EBUSY',
    );
  });

  it('lets a later batch run after an earlier one failed', async () => {
    const runs: string[][] = [];
    let call = 0;
    const job = createCoalescedJob<undefined>({
      windowMs: WINDOW,
      run: async ({ reasons }) => {
        call += 1;
        if (call === 1) throw new Error('EPERM');
        runs.push([...reasons]);
      },
    });

    const first = job.request(KEY, 'activation', undefined);
    jest.advanceTimersByTime(WINDOW);
    await first;

    const second = job.request(KEY, 'retry', undefined);
    jest.advanceTimersByTime(WINDOW);
    await second;

    expect(runs).toEqual([['retry']]);
  });
});
