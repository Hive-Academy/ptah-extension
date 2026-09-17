/**
 * SessionUsageLedgerCache — exact validity, bounds and coalescing
 * (TASK_2026_411 B4). No clock is involved anywhere: validity is the file
 * token alone.
 */

import type { SessionUsageLedger } from './session-usage-ledger';
import {
  MAX_COALESCE_ATTEMPTS,
  SessionUsageLedgerCache,
} from './session-usage-ledger-cache';

function fakeLedger(estimatedBytes = 1000, tag = 'x'): SessionUsageLedger {
  return {
    records: [],
    currentContextStart: 0,
    initModel: tag,
    firstSessionId: null,
    estimatedBytes,
  };
}

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

describe('SessionUsageLedgerCache', () => {
  it('serves a hit only while size AND mtime both match', async () => {
    const cache = new SessionUsageLedgerCache();
    const project = jest.fn(async () => fakeLedger());

    await cache.getOrProject('/a.jsonl', { size: 10, mtimeMs: 1 }, project);
    await cache.getOrProject('/a.jsonl', { size: 10, mtimeMs: 1 }, project);
    expect(project).toHaveBeenCalledTimes(1);

    await cache.getOrProject('/a.jsonl', { size: 11, mtimeMs: 1 }, project);
    expect(project).toHaveBeenCalledTimes(2);

    await cache.getOrProject('/a.jsonl', { size: 11, mtimeMs: 2 }, project);
    expect(project).toHaveBeenCalledTimes(3);
    expect(cache.size).toBe(1);
  });

  it('evicts least-recently-used entries to hold the entry cap', async () => {
    const cache = new SessionUsageLedgerCache({ maxEntries: 2, maxBytes: 1e9 });
    const token = { size: 1, mtimeMs: 1 };
    const project = jest.fn(async () => fakeLedger());

    await cache.getOrProject('/a', token, project);
    await cache.getOrProject('/b', token, project);
    await cache.getOrProject('/a', token, project); // touch a
    await cache.getOrProject('/c', token, project); // evicts b
    expect(project).toHaveBeenCalledTimes(3);

    await cache.getOrProject('/a', token, project);
    expect(project).toHaveBeenCalledTimes(3);
    await cache.getOrProject('/b', token, project);
    expect(project).toHaveBeenCalledTimes(4);
  });

  it('holds the byte cap and never stores a ledger larger than the cap', async () => {
    const cache = new SessionUsageLedgerCache({ maxEntries: 100, maxBytes: 2500 });
    const token = { size: 1, mtimeMs: 1 };

    await cache.getOrProject('/a', token, async () => fakeLedger(1000));
    await cache.getOrProject('/b', token, async () => fakeLedger(1000));
    await cache.getOrProject('/c', token, async () => fakeLedger(1000));
    expect(cache.estimatedBytes).toBeLessThanOrEqual(2500);
    expect(cache.size).toBe(2);

    const huge = await cache.getOrProject('/huge', token, async () =>
      fakeLedger(5000, 'huge'),
    );
    expect(huge.initModel).toBe('huge');
    expect(cache.size).toBe(2);
  });

  it('coalesces concurrent requests for the same file and token', async () => {
    const cache = new SessionUsageLedgerCache();
    let release: (ledger: SessionUsageLedger) => void = () => undefined;
    const project = jest.fn(
      () => new Promise<SessionUsageLedger>((resolve) => (release = resolve)),
    );
    const token = { size: 5, mtimeMs: 5 };

    const first = cache.getOrProject('/a', token, project);
    const second = cache.getOrProject('/a', token, project);
    release(fakeLedger(10, 'shared'));

    await expect(first).resolves.toMatchObject({ initModel: 'shared' });
    await expect(second).resolves.toMatchObject({ initModel: 'shared' });
    expect(project).toHaveBeenCalledTimes(1);
  });

  it('never stores a failed projection', async () => {
    const cache = new SessionUsageLedgerCache();
    const token = { size: 5, mtimeMs: 5 };

    await expect(
      cache.getOrProject('/a', token, async () => {
        throw abortError();
      }),
    ).rejects.toThrow('aborted');
    expect(cache.size).toBe(0);

    const project = jest.fn(async () => fakeLedger());
    await cache.getOrProject('/a', token, project);
    expect(project).toHaveBeenCalledTimes(1);
  });

  it("retries for a live waiter instead of inheriting another caller's abort", async () => {
    const cache = new SessionUsageLedgerCache();
    const token = { size: 5, mtimeMs: 5 };
    let rejectFirst: (error: Error) => void = () => undefined;
    const aborted = cache.getOrProject(
      '/a',
      token,
      () => new Promise<SessionUsageLedger>((_, reject) => (rejectFirst = reject)),
    );
    const retry = jest.fn(async () => fakeLedger(10, 'retried'));
    const waiter = cache.getOrProject('/a', token, retry, new AbortController().signal);

    rejectFirst(abortError());
    await expect(aborted).rejects.toThrow('aborted');
    await expect(waiter).resolves.toMatchObject({ initModel: 'retried' });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('rejects immediately for a waiter whose own signal is already aborted', async () => {
    const cache = new SessionUsageLedgerCache();
    const controller = new AbortController();
    controller.abort();
    const project = jest.fn(async () => fakeLedger());

    await expect(
      cache.getOrProject('/a', { size: 1, mtimeMs: 1 }, project, controller.signal),
    ).rejects.toThrow();
    expect(project).not.toHaveBeenCalled();
  });

  /**
   * b4 code-logic review, failure mode 2: with three or more callers on one
   * key, a waiter must never be rejected with another caller's abort. Each
   * `caller` below owns a controllable projection that, like the real one,
   * rejects with an `AbortError` when its own caller aborts.
   */
  describe('coalescing under interleaved aborts', () => {
    const TOKEN = { size: 5, mtimeMs: 5 };
    const flush = (): Promise<void> =>
      new Promise((resolve) => setImmediate(resolve));

    interface Caller {
      readonly result: Promise<SessionUsageLedger>;
      readonly project: jest.Mock;
      readonly controller: AbortController;
      /** Abort this caller; a projection it started rejects with AbortError. */
      abort(): void;
      /** Fail this caller's projection with a non-abort error. */
      fail(error: Error): void;
      /** Complete this caller's projection with a ledger tagged by caller. */
      resolve(): void;
    }

    function caller(cache: SessionUsageLedgerCache, tag: string): Caller {
      const controller = new AbortController();
      const settle: {
        resolve?: (ledger: SessionUsageLedger) => void;
        reject?: (error: Error) => void;
      } = {};
      const project = jest.fn(
        () =>
          new Promise<SessionUsageLedger>((resolve, reject) => {
            settle.resolve = resolve;
            settle.reject = reject;
          }),
      );
      const result = cache.getOrProject('/shared', TOKEN, project, controller.signal);
      // Asserted explicitly below; keep Node from flagging it meanwhile.
      result.catch(() => undefined);
      return {
        result,
        project,
        controller,
        abort: () => {
          controller.abort();
          settle.reject?.(abortError());
        },
        fail: (error) => settle.reject?.(error),
        resolve: () => settle.resolve?.(fakeLedger(10, tag)),
      };
    }

    it('re-projects for the live waiters when the owner of a three-caller projection aborts', async () => {
      const cache = new SessionUsageLedgerCache();
      const a = caller(cache, 'a');
      const b = caller(cache, 'b');
      const c = caller(cache, 'c');
      expect(a.project).toHaveBeenCalledTimes(1);
      expect(b.project).not.toHaveBeenCalled();

      a.abort();
      await flush();
      expect(cache.size).toBe(0);
      expect(b.project).toHaveBeenCalledTimes(1);
      expect(c.project).not.toHaveBeenCalled();

      b.resolve();
      await expect(a.result).rejects.toMatchObject({ name: 'AbortError' });
      await expect(b.result).resolves.toMatchObject({ initModel: 'b' });
      await expect(c.result).resolves.toMatchObject({ initModel: 'b' });
      expect(cache.size).toBe(1);
    });

    it('never hands a live waiter a foreign abort, however many projections abort in turn', async () => {
      expect(MAX_COALESCE_ATTEMPTS).toBe(3);
      const cache = new SessionUsageLedgerCache();
      const a = caller(cache, 'a');
      const b = caller(cache, 'b');
      const c = caller(cache, 'c');
      const w = caller(cache, 'w');

      a.abort();
      await flush(); // b projects; c and w join it
      expect(b.project).toHaveBeenCalledTimes(1);
      b.abort();
      await flush(); // c projects; w joins it
      expect(c.project).toHaveBeenCalledTimes(1);
      c.abort();
      await flush(); // w has now seen three foreign aborts and projects itself
      expect(w.project).toHaveBeenCalledTimes(1);
      expect(cache.size).toBe(0);

      w.resolve();
      await expect(w.result).resolves.toMatchObject({ initModel: 'w' });
      for (const aborted of [a, b, c]) {
        await expect(aborted.result).rejects.toMatchObject({ name: 'AbortError' });
      }
      expect(w.controller.signal.aborted).toBe(false);
      expect(cache.size).toBe(1);
    });

    it('projects privately once joins are exhausted while another projection is still in flight', async () => {
      const cache = new SessionUsageLedgerCache();
      const [a, b, c, d, w] = ['a', 'b', 'c', 'd', 'w'].map((tag) => caller(cache, tag));

      a.abort();
      await flush(); // b projects
      b.abort();
      await flush(); // c projects
      c.abort();
      await flush(); // d and w are both exhausted: d registers a projection, w runs its own
      expect(d.project).toHaveBeenCalledTimes(1);
      expect(w.project).toHaveBeenCalledTimes(1);

      // w never joined d, so d's abort cannot reach it.
      d.abort();
      w.resolve();
      await expect(d.result).rejects.toMatchObject({ name: 'AbortError' });
      await expect(w.result).resolves.toMatchObject({ initModel: 'w' });
      expect(cache.size).toBe(1);
    });

    it("rejects an aborted waiter with its own reason, not the shared projection's error", async () => {
      const cache = new SessionUsageLedgerCache();
      const owner = caller(cache, 'owner');
      const waiter = caller(cache, 'waiter');
      const reason = new Error('waiter cancelled');

      waiter.controller.abort(reason);
      owner.fail(new Error('EACCES'));

      await expect(owner.result).rejects.toThrow('EACCES');
      await expect(waiter.result).rejects.toBe(reason);
      expect(waiter.project).not.toHaveBeenCalled();
    });

    it('shares a real (non-abort) projection failure with live waiters without re-projecting', async () => {
      const cache = new SessionUsageLedgerCache();
      const owner = caller(cache, 'owner');
      const waiter = caller(cache, 'waiter');

      owner.fail(new Error('EACCES'));

      await expect(waiter.result).rejects.toThrow('EACCES');
      expect(waiter.project).not.toHaveBeenCalled();
      expect(cache.size).toBe(0);
    });
  });
});
