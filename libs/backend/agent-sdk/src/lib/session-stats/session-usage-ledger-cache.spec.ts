/**
 * SessionUsageLedgerCache — exact validity, bounds and coalescing
 * (TASK_2026_411 B4). No clock is involved anywhere: validity is the file
 * token alone.
 */

import type { SessionUsageLedger } from './session-usage-ledger';
import { SessionUsageLedgerCache } from './session-usage-ledger-cache';

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
});
