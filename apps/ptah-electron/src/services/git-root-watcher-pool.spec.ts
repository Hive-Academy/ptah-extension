/**
 * GitRootWatcherPool specs (TASK_2026_855 component 5, D16) — refcount across
 * leases, replace semantics, the primary root, the watcher and lease caps,
 * timer-driven expiry, pre-attach leases and disposal. The watcher factory is
 * a fake; timers are `jest.useFakeTimers()`, which also drives `Date.now`.
 */

import type { Logger } from '@ptah-extension/vscode-core';

import {
  GitRootWatcherPool,
  LEASE_TTL_MS,
  MAX_LEASES,
  MAX_SECONDARY_ROOT_WATCHERS,
  type GitRootWatcherPoolAttachment,
  type RootWatcher,
} from './git-root-watcher-pool';

interface FakeWatcher extends RootWatcher {
  root: string | null;
  running: boolean;
  start: jest.Mock;
  stop: jest.Mock;
}

function makeLogger(): jest.Mocked<
  Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>
> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

describe('GitRootWatcherPool', () => {
  let created: FakeWatcher[];
  let primary: string | null;
  let failStartFor: Set<string>;
  let pool: GitRootWatcherPool;
  let logger: ReturnType<typeof makeLogger>;
  const broadcast = jest.fn();

  function createWatcher(): FakeWatcher {
    const watcher: FakeWatcher = {
      root: null,
      running: false,
      start: jest.fn((root: string) => {
        if (failStartFor.has(root)) throw new Error('watch host down');
        watcher.root = root;
        watcher.running = true;
      }),
      stop: jest.fn(() => {
        watcher.running = false;
      }),
    };
    created.push(watcher);
    return watcher;
  }

  function attachment(): GitRootWatcherPoolAttachment {
    return { createWatcher, broadcast, primaryRoot: () => primary };
  }

  /** Roots with a running secondary watcher, sorted. */
  function running(): string[] {
    return created
      .filter((w) => w.running)
      .map((w) => w.root ?? '')
      .sort();
  }

  beforeEach(() => {
    jest.useFakeTimers();
    created = [];
    primary = '/repo';
    failStartFor = new Set();
    logger = makeLogger();
    pool = new GitRootWatcherPool(logger as unknown as Logger);
  });

  afterEach(() => {
    pool.dispose();
    jest.useRealTimers();
  });

  it('starts secondary watchers without the agent-worktree audit', () => {
    pool.attach(attachment());

    const outcome = pool.setLease('a', ['/repo/.wt/one']);

    expect(outcome).toEqual({ watched: ['/repo/.wt/one'], evicted: [] });
    expect(created[0].start).toHaveBeenCalledWith('/repo/.wt/one', broadcast, {
      agentWorktreeAudit: false,
    });
  });

  it('refcounts a root across two leases and stops it only after both release', () => {
    pool.attach(attachment());
    pool.setLease('a', ['/repo/.wt/one']);
    pool.setLease('b', ['/repo/.wt/one']);
    expect(created).toHaveLength(1);

    pool.setLease('a', []);
    expect(running()).toEqual(['/repo/.wt/one']);

    pool.setLease('b', []);
    expect(running()).toEqual([]);
  });

  it('replaces a lease set: dropped roots stop, kept roots keep their watcher', () => {
    pool.attach(attachment());
    pool.setLease('a', ['/repo/.wt/one', '/repo/.wt/two']);

    pool.setLease('a', ['/repo/.wt/two', '/repo/.wt/three']);

    expect(running()).toEqual(['/repo/.wt/three', '/repo/.wt/two']);
    expect(created).toHaveLength(3);
  });

  it('an identical renewal does not restart any watcher', () => {
    pool.attach(attachment());
    pool.setLease('a', ['/repo/.wt/one']);

    pool.setLease('a', ['/repo/.wt/one']);
    pool.setLease('a', ['\\repo\\.wt\\one\\']);

    expect(created).toHaveLength(1);
    expect(created[0].stop).not.toHaveBeenCalled();
  });

  it('skips the primary root and reports it watched', () => {
    pool.attach(attachment());

    const outcome = pool.setLease('a', ['/repo', '/repo/.wt/one']);

    expect(running()).toEqual(['/repo/.wt/one']);
    expect(outcome.watched).toEqual(['/repo', '/repo/.wt/one']);
  });

  it('arms a root skipped as primary once the primary watcher moves, and stops the new primary', () => {
    pool.attach(attachment());
    pool.setLease('a', ['/repo', '/other']);
    expect(running()).toEqual(['/other']);

    primary = '/other';
    pool.primaryRootChanged();

    expect(running()).toEqual(['/repo']);
  });

  it(`caps running watchers at ${MAX_SECONDARY_ROOT_WATCHERS} and reports the rest evicted, newest lease first`, () => {
    pool.attach(attachment());

    const first = pool.setLease('a', ['/w/1', '/w/2', '/w/3', '/w/4', '/w/5']);
    expect(first).toEqual({
      watched: ['/w/1', '/w/2', '/w/3', '/w/4'],
      evicted: ['/w/5'],
    });

    jest.advanceTimersByTime(1_000);
    const second = pool.setLease('b', ['/w/6']);

    expect(second).toEqual({ watched: ['/w/6'], evicted: [] });
    expect(running()).toEqual(['/w/1', '/w/2', '/w/3', '/w/6']);
  });

  it('a renewal with unchanged roots keeps its rank; a changed root set moves it first (M2)', () => {
    pool.attach(attachment());
    pool.setLease('a', ['/w/1', '/w/2', '/w/3', '/w/4', '/w/5']);
    jest.advanceTimersByTime(1_000);
    pool.setLease('b', ['/w/6']);
    const stopsBefore = created.filter((w) => w.stop.mock.calls.length > 0);

    // The periodic renewal of the older lease must not reorder the watchers.
    jest.advanceTimersByTime(60_000);
    const renewed = pool.setLease('a', ['/w/1', '/w/2', '/w/3', '/w/4', '/w/5']);

    expect(running()).toEqual(['/w/1', '/w/2', '/w/3', '/w/6']);
    expect(created.filter((w) => w.stop.mock.calls.length > 0)).toEqual(
      stopsBefore,
    );
    expect(renewed.evicted).toEqual(['/w/4', '/w/5']);
    expect(logger.info).not.toHaveBeenCalledWith(
      '[GitRootWatcherPool] Roots over the watcher cap',
      expect.anything(),
    );

    // A real scope change ranks the lease first again.
    pool.setLease('a', ['/w/1', '/w/2', '/w/3', '/w/4']);
    expect(running()).toEqual(['/w/1', '/w/2', '/w/3', '/w/4']);
  });

  it('expires a lease at its TTL with no further RPC, stopping its watchers', () => {
    pool.attach(attachment());
    pool.setLease('a', ['/repo/.wt/one']);

    jest.advanceTimersByTime(LEASE_TTL_MS - 1);
    expect(running()).toEqual(['/repo/.wt/one']);

    jest.advanceTimersByTime(1);
    expect(running()).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a renewal pushes the expiry out', () => {
    pool.attach(attachment());
    pool.setLease('a', ['/repo/.wt/one']);
    jest.advanceTimersByTime(LEASE_TTL_MS - 10);

    pool.setLease('a', ['/repo/.wt/one']);
    jest.advanceTimersByTime(LEASE_TTL_MS - 10);

    expect(running()).toEqual(['/repo/.wt/one']);
    jest.advanceTimersByTime(10);
    expect(running()).toEqual([]);
  });

  it('holds one timer, at the nearest deadline, however many leases', () => {
    pool.attach(attachment());
    pool.setLease('a', ['/w/a']);
    jest.advanceTimersByTime(1_000);
    pool.setLease('b', ['/w/b']);

    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(LEASE_TTL_MS - 1_000);
    expect(running()).toEqual(['/w/b']);
    expect(jest.getTimerCount()).toBe(1);
  });

  it(`holds at most ${MAX_LEASES} leases, dropping the least recently renewed`, () => {
    pool.attach(attachment());
    for (let i = 0; i < MAX_LEASES; i++) {
      // Every lease but the first holds only the primary root (no watcher).
      pool.setLease(`lease-${i}`, i === 0 ? ['/w/first'] : ['/repo']);
      jest.advanceTimersByTime(10);
    }
    expect(running()).toEqual(['/w/first']);

    pool.setLease('one-too-many', ['/repo']);

    expect(running()).toEqual([]);
  });

  it('records leases before attach and arms them on attach', () => {
    const outcome = pool.setLease('a', ['/repo/.wt/one']);
    expect(outcome).toEqual({ watched: [], evicted: [] });
    expect(created).toHaveLength(0);

    pool.attach(attachment());

    expect(running()).toEqual(['/repo/.wt/one']);
  });

  it('a watcher that fails to start is neither watched nor evicted and is retried later', () => {
    pool.attach(attachment());
    failStartFor.add('/repo/.wt/one');

    const outcome = pool.setLease('a', ['/repo/.wt/one']);

    expect(outcome).toEqual({ watched: [], evicted: [] });
    expect(logger.warn).toHaveBeenCalled();
    failStartFor.clear();
    expect(pool.setLease('a', ['/repo/.wt/one']).watched).toEqual([
      '/repo/.wt/one',
    ]);
  });

  it('dispose stops every watcher, clears the timer and ignores later leases', () => {
    pool.attach(attachment());
    pool.setLease('a', ['/w/1', '/w/2']);

    pool.dispose();

    expect(running()).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
    expect(pool.setLease('a', ['/w/3'])).toEqual({ watched: [], evicted: [] });
    expect(created).toHaveLength(2);
  });
});
