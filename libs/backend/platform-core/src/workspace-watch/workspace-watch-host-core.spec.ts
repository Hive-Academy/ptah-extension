import type { WorkspaceWatchOptions } from '../interfaces/workspace-watcher.interface';
import type { WorkspaceChangeCoalescerClock } from '../utils/workspace-change-coalescer';
import {
  CREATED_DIRECTORY_RECONCILER_DEFAULTS,
  type WorkspaceWatchDirectoryEntry,
} from './created-directory-reconciler';
import {
  WORKSPACE_WATCH_HOST_DEFAULTS,
  WorkspaceWatchHostCore,
  type WorkspaceWatchEngine,
  type WorkspaceWatchEngineCallback,
  type WorkspaceWatchEngineEvent,
  type WorkspaceWatchHostCoreOptions,
} from './workspace-watch-host-core';
import {
  toWorkspaceWatchPathKey,
  type WorkspaceWatchBatchMessage,
  type WorkspaceWatchHostOutbound,
} from './workspace-watch-protocol';

/** Deterministic clock: timers fire only from `advance`. */
class ManualClock implements WorkspaceChangeCoalescerClock {
  private current = 1_000_000;
  private nextHandle = 1;
  private readonly timers = new Map<
    number,
    { at: number; callback: () => void }
  >();

  now(): number {
    return this.current;
  }

  setTimer(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle++;
    this.timers.set(handle, { at: this.current + delayMs, callback });
    return handle;
  }

  clearTimer(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  get pendingTimers(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    const until = this.current + ms;
    for (;;) {
      let dueHandle: number | undefined;
      let dueAt = Infinity;
      for (const [handle, timer] of this.timers) {
        if (timer.at <= until && timer.at < dueAt) {
          dueAt = timer.at;
          dueHandle = handle;
        }
      }
      if (dueHandle === undefined) break;
      const timer = this.timers.get(dueHandle);
      this.timers.delete(dueHandle);
      this.current = Math.max(this.current, dueAt);
      timer?.callback();
    }
    this.current = until;
  }
}

interface FakeSubscribeCall {
  readonly dir: string;
  readonly ignore: string[];
  readonly callback: WorkspaceWatchEngineCallback;
  readonly unsubscribe: jest.Mock;
  settle(): void;
  fail(error: Error): void;
  emit(events: WorkspaceWatchEngineEvent[]): void;
  emitError(error: Error): void;
}

/**
 * An engine whose subscribe promises the test settles by hand. `log` records
 * `subscribe:<n>` / `unsubscribe:<n>` in call order.
 */
function createFakeEngine(options: { autoSettle?: boolean } = {}) {
  const calls: FakeSubscribeCall[] = [];
  const log: string[] = [];
  const engine: WorkspaceWatchEngine = {
    subscribe: (dir, callback, { ignore }) =>
      new Promise((resolve, reject) => {
        const index = calls.length;
        log.push(`subscribe:${index}`);
        const unsubscribe = jest.fn(async () => {
          log.push(`unsubscribe:${index}`);
        });
        const call: FakeSubscribeCall = {
          dir,
          ignore,
          callback,
          unsubscribe,
          settle: () => resolve({ unsubscribe }),
          fail: reject,
          emit: (events) => callback(null, events),
          emitError: (error) => callback(error, []),
        };
        calls.push(call);
        if (options.autoSettle !== false) call.settle();
      }),
  };
  return { engine, calls, log };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

const ROOT = '/repo';
const WORKSPACE_WATCH_REBUILD_DEBOUNCE_MS =
  WORKSPACE_WATCH_HOST_DEFAULTS.rebuildDebounceMs;
const WORKSPACE_WATCH_REBUILD_MIN_GAP_MS =
  WORKSPACE_WATCH_HOST_DEFAULTS.rebuildMinGapMs;

const last = <T>(items: readonly T[]): T | undefined => items[items.length - 1];

function options(
  overrides: Partial<WorkspaceWatchOptions> = {},
): WorkspaceWatchOptions {
  return {
    excludeGlobs: [],
    excludeDirNames: [],
    excludeSegmentRules: [],
    nestedRepoDetection: false,
    ...overrides,
  };
}

function setup(
  engineOptions: { autoSettle?: boolean } = {},
  coreOptions: Partial<WorkspaceWatchHostCoreOptions> = {},
) {
  const clock = new ManualClock();
  const { engine, calls, log } = createFakeEngine(engineOptions);
  const posted: WorkspaceWatchHostOutbound[] = [];
  const core = new WorkspaceWatchHostCore({
    engine,
    post: (message) => posted.push(message),
    clock,
    stormBreakerOptions: { enterEventsPerWindow: 10_000 },
    ...coreOptions,
  });
  const subscribe = (
    id: number,
    overrides: Partial<WorkspaceWatchOptions> = {},
    root = ROOT,
  ) =>
    core.handleMessage({
      type: 'subscribe',
      id,
      root,
      options: options(overrides),
    });
  const batches = (id?: number) =>
    posted.filter(
      (m): m is WorkspaceWatchBatchMessage =>
        m.type === 'batch' && (id === undefined || m.id === id),
    );
  const ofType = <T extends WorkspaceWatchHostOutbound['type']>(type: T) =>
    posted.filter(
      (m): m is Extract<WorkspaceWatchHostOutbound, { type: T }> =>
        m.type === type,
    );
  return { clock, calls, log, posted, core, subscribe, batches, ofType };
}

describe('WorkspaceWatchHostCore', () => {
  it('posts a heartbeat on start and every interval, with subscription and event counts', async () => {
    const { clock, core, subscribe, calls, ofType } = setup();
    core.start();
    core.start();
    expect(ofType('heartbeat')).toHaveLength(1);

    subscribe(1);
    await flush();
    calls[0].emit([
      { path: '/repo/a', type: 'create' },
      { path: '/repo/b', type: 'create' },
    ]);
    clock.advance(2_000);

    const beats = ofType('heartbeat');
    expect(beats).toHaveLength(2);
    expect(beats[1]).toEqual({
      type: 'heartbeat',
      seq: 1,
      subscriptions: 1,
      eventsPerSec: 1,
    });
    await core.dispose();
  });

  it('reports and drops an invalid inbound message', () => {
    const { core, ofType, calls } = setup();
    core.handleMessage({ type: 'subscribe', id: 1 });
    expect(ofType('error')).toEqual([
      expect.objectContaining({ code: 'invalid-message' }),
    ]);
    expect(calls).toHaveLength(0);
  });

  it('caps invalid-message errors at 10 and still processes valid messages after the cap', async () => {
    const { core, ofType, calls, subscribe } = setup();
    for (let i = 0; i < 25; i++) core.handleMessage({ type: 'bogus' });
    expect(
      ofType('error').filter((e) => e.code === 'invalid-message'),
    ).toHaveLength(10);
    subscribe(1);
    await flush();
    expect(calls).toHaveLength(1);
    await core.dispose();
  });

  it('coalesces engine events into posted batches — never one message per event', async () => {
    const { clock, subscribe, calls, batches, core } = setup();
    subscribe(1);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].dir).toBe(ROOT);

    calls[0].emit(
      Array.from({ length: 50 }, (_, i) => ({
        path: `/repo/f${i}`,
        type: 'create' as const,
      })),
    );
    expect(batches()).toHaveLength(0);
    clock.advance(250);
    expect(batches(1)).toHaveLength(1);
    expect(batches(1)[0].changes).toHaveLength(50);

    calls[0].emit([{ path: '/repo/f1', type: 'update' }]);
    clock.advance(100);
    expect(batches(1)).toHaveLength(1);
    clock.advance(150);
    expect(batches(1)).toHaveLength(2);
    await core.dispose();
  });

  it('shares one native subscription per root and fans events out to every subscriber', async () => {
    const { clock, subscribe, calls, batches, core } = setup();
    subscribe(1, { excludeDirNames: ['node_modules'] });
    subscribe(2, { excludeDirNames: ['node_modules'] });
    await flush();
    expect(calls).toHaveLength(1);

    calls[0].emit([{ path: '/repo/src/a.ts', type: 'update' }]);
    clock.advance(250);
    expect(batches(1)[0].changes).toEqual([
      { path: '/repo/src/a.ts', kind: 'update' },
    ]);
    expect(batches(2)[0].changes).toEqual([
      { path: '/repo/src/a.ts', kind: 'update' },
    ]);
    await core.dispose();
  });

  it('matches roots case-insensitively on Windows paths', async () => {
    const { subscribe, calls, core } = setup();
    subscribe(1, {}, 'C:\\Repo');
    subscribe(2, {}, 'c:/repo/');
    await flush();
    expect(calls).toHaveLength(1);
    expect(toWorkspaceWatchPathKey('C:\\Repo\\')).toBe('c:/repo');
    await core.dispose();
  });

  // What goes INTO the set is `native-ignore-set-planner.spec.ts`; these pin
  // how the host applies it.
  describe('native ignore set', () => {
    it('re-subscribes natively when a new subscriber narrows the intersection', async () => {
      const { subscribe, calls, core } = setup();
      subscribe(1, {
        excludeDirNames: ['node_modules', 'dist'],
        excludeSegmentRules: [['.claude', 'worktrees']],
      });
      await flush();
      expect(calls).toHaveLength(1);

      // Same rules spelled in a different case: the intersection is unchanged.
      subscribe(2, {
        excludeDirNames: ['dist', 'node_modules'],
        excludeSegmentRules: [['.CLAUDE', 'Worktrees']],
      });
      await flush();
      expect(calls).toHaveLength(1);

      subscribe(3, { excludeDirNames: ['node_modules'] });
      await flush();
      expect(calls).toHaveLength(2);
      expect(calls[1].ignore).toEqual(['**/node_modules/**']);
      // The replacement was live before the old one was released.
      expect(calls[0].unsubscribe).toHaveBeenCalledTimes(1);
      await core.dispose();
    });
  });

  it('never delivers excluded paths even when the native layer passes them', async () => {
    const { clock, subscribe, calls, batches, core } = setup();
    subscribe(1, { excludeDirNames: ['node_modules'] });
    await flush();
    calls[0].emit([
      { path: '/repo/node_modules/x/index.js', type: 'create' },
      { path: '/repo/src/kept.ts', type: 'create' },
    ]);
    clock.advance(250);
    expect(batches(1)[0].changes.map((c) => c.path)).toEqual([
      '/repo/src/kept.ts',
    ]);
    await core.dispose();
  });

  describe('nested repository detection', () => {
    it('adds a detected root to the native ignore set, debounced 1 s and at most once per 10 s', async () => {
      const { clock, subscribe, calls, ofType, core } = setup();
      subscribe(1, { nestedRepoDetection: true });
      subscribe(2, { nestedRepoDetection: true });
      await flush();

      calls[0].emit([{ path: '/repo/pkg-a/.git', type: 'create' }]);
      expect(ofType('notice')).toEqual([
        expect.objectContaining({
          code: 'nested-root-detected',
          detail: '/repo/pkg-a',
        }),
      ]);
      clock.advance(999);
      await flush();
      expect(calls).toHaveLength(1);
      clock.advance(1);
      await flush();
      expect(calls).toHaveLength(2);
      expect(calls[1].ignore).toEqual(['/repo/pkg-a']);

      calls[1].emit([{ path: '/repo/pkg-b/.git/HEAD', type: 'create' }]);
      // 10 s after the previous re-subscribe, not 1 s after this detection.
      clock.advance(1_000);
      await flush();
      expect(calls).toHaveLength(2);
      clock.advance(8_999);
      await flush();
      expect(calls).toHaveLength(2);
      clock.advance(1);
      await flush();
      expect(calls).toHaveLength(3);
      expect(calls[2].ignore).toEqual(['/repo/pkg-a', '/repo/pkg-b']);
      await core.dispose();
    });

    it('does not ignore a detected root natively while some subscriber has detection off', async () => {
      const { clock, subscribe, calls, core } = setup();
      subscribe(1, { nestedRepoDetection: true });
      subscribe(2, { nestedRepoDetection: false });
      await flush();
      calls[0].emit([{ path: '/repo/pkg-a/.git', type: 'create' }]);
      clock.advance(20_000);
      await flush();
      expect(calls).toHaveLength(1);
      await core.dispose();
    });

    it('seeds a later subscriber with detection on with the roots already detected', async () => {
      const { clock, subscribe, calls, batches, core } = setup();
      subscribe(1, { nestedRepoDetection: true });
      await flush();
      calls[0].emit([{ path: '/repo/pkg-a/.git', type: 'create' }]);
      clock.advance(1_000);
      await flush();

      subscribe(2, { nestedRepoDetection: true });
      await flush();
      const live = calls[calls.length - 1];
      live.emit([
        { path: '/repo/pkg-a/src/hidden.ts', type: 'create' },
        { path: '/repo/kept.ts', type: 'create' },
      ]);
      clock.advance(250);
      expect(batches(2).flatMap((b) => b.changes.map((c) => c.path))).toEqual([
        '/repo/kept.ts',
      ]);
      await core.dispose();
    });
  });

  describe('native failures (A1)', () => {
    it('a native error emits one overflow per subscriber, rebuilds (release awaited first), and overflows again once live', async () => {
      const { clock, subscribe, calls, log, batches, ofType, core } = setup();
      subscribe(1);
      subscribe(2);
      await flush();

      calls[0].emitError(
        new Error('Events were dropped by the FSEvents client'),
      );
      calls[0].emitError(new Error('again'));
      clock.advance(250);
      expect(batches(1)).toEqual([
        expect.objectContaining({ overflow: true, changes: [] }),
      ]);
      expect(batches(2)).toEqual([
        expect.objectContaining({ overflow: true, changes: [] }),
      ]);
      expect(
        ofType('error').filter((e) => e.code === 'native-error'),
      ).toHaveLength(2);

      clock.advance(1_000);
      await flush();
      expect(calls).toHaveLength(2);
      // A full rebuild, not an overlap: the engine drops its cached tree only
      // when no subscription holds it.
      expect(log).toEqual(['subscribe:0', 'unsubscribe:0', 'subscribe:1']);
      expect(ofType('notice')).toEqual([
        expect.objectContaining({
          code: 'native-rebuilt',
          detail: expect.stringContaining('native error'),
        }),
      ]);

      // The second overflow covers the gap with no live subscription.
      clock.advance(250);
      expect(batches(1)[1]).toEqual(
        expect.objectContaining({ overflow: true, changes: [] }),
      );
      expect(batches(2)[1]).toEqual(
        expect.objectContaining({ overflow: true, changes: [] }),
      );

      // Delivery resumes from the new subscription; stale callbacks are dropped.
      calls[0].emit([{ path: '/repo/stale.ts', type: 'update' }]);
      calls[1].emit([{ path: '/repo/fresh.ts', type: 'update' }]);
      clock.advance(250);
      expect(batches(1)[2].changes.map((c) => c.path)).toEqual([
        '/repo/fresh.ts',
      ]);
      await core.dispose();
    });

    it('ignores an error from a subscription a rebuild is already releasing', async () => {
      const { clock, subscribe, calls, ofType, core } = setup();
      subscribe(1);
      await flush();
      let release: () => void = () => undefined;
      calls[0].unsubscribe.mockImplementationOnce(
        () => new Promise<void>((resolve) => (release = resolve)),
      );

      calls[0].emitError(new Error('overflow'));
      clock.advance(1_000);
      await flush();
      // Released but not yet settled: a late error from it changes nothing.
      calls[0].emitError(new Error('late'));
      expect(
        ofType('error').filter((e) => e.code === 'native-error'),
      ).toHaveLength(1);
      release();
      await flush();
      expect(calls).toHaveLength(2);
      clock.advance(60_000);
      await flush();
      expect(calls).toHaveLength(2);
      await core.dispose();
    });

    it('retries a refused subscribe with doubling back-off and signals overflow once per streak', async () => {
      const { clock, subscribe, calls, batches, ofType, core } = setup({
        autoSettle: false,
      });
      subscribe(1);
      await flush();
      calls[0].fail(new Error('ENOENT'));
      await flush();
      clock.advance(250);
      expect(batches(1)).toEqual([expect.objectContaining({ overflow: true })]);
      expect(ofType('error')).toEqual([
        expect.objectContaining({ code: 'native-subscribe-failed' }),
      ]);

      clock.advance(1_000);
      await flush();
      expect(calls).toHaveLength(2);
      calls[1].fail(new Error('ENOENT'));
      await flush();
      clock.advance(1_999);
      await flush();
      expect(calls).toHaveLength(2);
      clock.advance(1);
      await flush();
      expect(calls).toHaveLength(3);
      expect(batches(1)).toHaveLength(1);

      calls[2].settle();
      await flush();
      // Nothing was watched during the streak: one more overflow once live.
      clock.advance(250);
      expect(batches(1)[1]).toEqual(
        expect.objectContaining({ overflow: true }),
      );
      calls[2].emit([{ path: '/repo/ok.ts', type: 'create' }]);
      clock.advance(250);
      expect(batches(1)[2].changes).toEqual([
        { path: '/repo/ok.ts', kind: 'create' },
      ]);
      await core.dispose();
    });

    it('acks a subscription only once a native subscribe covering it has succeeded, once each', async () => {
      const { clock, subscribe, calls, ofType, core } = setup({
        autoSettle: false,
      });
      core.start();
      subscribe(1);
      await flush();
      expect(ofType('heartbeat')).toHaveLength(1);
      expect(ofType('subscribed')).toEqual([]);

      calls[0].fail(new Error('ENOENT'));
      await flush();
      expect(ofType('subscribed')).toEqual([]);

      clock.advance(1_000);
      await flush();
      calls[1].settle();
      await flush();
      expect(ofType('subscribed')).toEqual([{ type: 'subscribed', id: 1 }]);

      // Same excludes on a settled root: covered now, acked at once.
      subscribe(2);
      expect(ofType('subscribed').map((m) => m.id)).toEqual([1, 2]);

      // A subscriber on another root waits for that root's native subscribe.
      subscribe(3, {}, '/other');
      await flush();
      expect(ofType('subscribed').map((m) => m.id)).toEqual([1, 2]);
      calls[2].settle();
      await flush();
      expect(ofType('subscribed').map((m) => m.id)).toEqual([1, 2, 3]);
      await core.dispose();
    });

    it('treats a synchronous engine throw as a refused subscribe', async () => {
      const posted: WorkspaceWatchHostOutbound[] = [];
      const core = new WorkspaceWatchHostCore({
        engine: {
          subscribe: () => {
            throw new Error('binding missing');
          },
        },
        post: (m) => posted.push(m),
        clock: new ManualClock(),
      });
      core.handleMessage({
        type: 'subscribe',
        id: 1,
        root: ROOT,
        options: options(),
      });
      await flush();
      expect(posted).toContainEqual(
        expect.objectContaining({
          type: 'error',
          code: 'native-subscribe-failed',
          message: 'binding missing',
        }),
      );
      await core.dispose();
    });
  });

  describe('created-directory reconciliation (a listDirectory is given)', () => {
    /** A fake file system: directory path → entries. Anything else rejects like ENOENT/ENOTDIR. */
    function reconcilingSetup(
      coreOptions: Partial<WorkspaceWatchHostCoreOptions> = {},
    ) {
      const tree = new Map<string, WorkspaceWatchDirectoryEntry[]>();
      const listDirectory = jest.fn(async (dir: string) => {
        const entries = tree.get(dir);
        if (!entries) throw Object.assign(new Error(dir), { code: 'ENOENT' });
        return entries;
      });
      const harness = setup({}, { listDirectory, ...coreOptions });
      const dir = (name: string) => ({ name, isDirectory: true });
      const file = (name: string) => ({ name, isDirectory: false });
      const rebuilt = () =>
        harness.ofType('notice').filter((n) => n.code === 'native-rebuilt');
      const overflows = (id: number) =>
        harness.batches(id).filter((b) => b.overflow);
      return { ...harness, tree, listDirectory, dir, file, rebuilt, overflows };
    }

    const SETTLE = CREATED_DIRECTORY_RECONCILER_DEFAULTS.settleMs;
    const CONFIRM = CREATED_DIRECTORY_RECONCILER_DEFAULTS.confirmMs;

    it('delivers a child file the engine never reported, without a rebuild', async () => {
      const h = reconcilingSetup();
      h.subscribe(1);
      await flush();
      h.tree.set('/repo/src', [h.file('created.txt')]);

      // What inotify reports for `mkdir src && echo > src/created.txt`.
      h.calls[0].emit([{ path: '/repo/src', type: 'create' }]);
      h.clock.advance(SETTLE);
      await flush();
      h.clock.advance(250);

      expect(h.batches(1).flatMap((b) => b.changes)).toEqual([
        { path: '/repo/src', kind: 'create' },
        { path: '/repo/src/created.txt', kind: 'create' },
      ]);
      h.clock.advance(30_000);
      await flush();
      expect(h.calls).toHaveLength(1);
      expect(h.rebuilt()).toEqual([]);
      await h.core.dispose();
    });

    it('does not re-deliver a child the engine did report', async () => {
      const h = reconcilingSetup();
      h.subscribe(1);
      await flush();
      h.tree.set('/repo/src', [h.file('a.ts')]);
      h.calls[0].emit([
        // Out of order within one batch, as the engine may deliver them.
        { path: '/repo/src/a.ts', type: 'create' },
        { path: '/repo/src', type: 'create' },
      ]);
      h.clock.advance(SETTLE);
      await flush();
      h.clock.advance(250);
      expect(h.batches(1)).toHaveLength(1);
      expect(
        h
          .batches(1)[0]
          .changes.map((c) => c.path)
          .sort(),
      ).toEqual(['/repo/src', '/repo/src/a.ts']);
      await h.core.dispose();
    });

    it('a subdirectory still unreported after the confirm window is a lost watch: overflow at once, full rebuild, overflow again', async () => {
      const h = reconcilingSetup();
      h.subscribe(1);
      await flush();
      h.tree.set('/repo/a', [h.dir('b')]);

      h.calls[0].emit([{ path: '/repo/a', type: 'create' }]);
      h.clock.advance(SETTLE);
      await flush();
      h.clock.advance(CONFIRM - 1);
      expect(h.overflows(1)).toHaveLength(0);
      h.clock.advance(1);

      // Detected: told now, on the next batch tick, long before the rebuild.
      h.clock.advance(250);
      expect(h.overflows(1)).toHaveLength(1);
      expect(h.calls).toHaveLength(1);

      // Debounced: one re-walk for the whole burst.
      h.clock.advance(WORKSPACE_WATCH_REBUILD_DEBOUNCE_MS - 251);
      await flush();
      expect(h.calls).toHaveLength(1);
      h.clock.advance(1);
      await flush();

      expect(h.calls).toHaveLength(2);
      expect(h.log).toEqual(['subscribe:0', 'unsubscribe:0', 'subscribe:1']);
      expect(h.rebuilt()).toEqual([
        expect.objectContaining({
          detail: expect.stringContaining('lost-watch: /repo/a/b'),
        }),
      ]);
      h.clock.advance(250);
      expect(h.overflows(1)).toHaveLength(2);
      expect(last(h.batches(1))).toEqual(
        expect.objectContaining({ overflow: true, changes: [] }),
      );
      await h.core.dispose();
    });

    it('a subdirectory whose report arrives inside the confirm window is not a lost watch', async () => {
      const h = reconcilingSetup();
      h.subscribe(1);
      await flush();
      h.tree.set('/repo/a', [h.dir('b')]);
      h.tree.set('/repo/a/b', []);

      h.calls[0].emit([{ path: '/repo/a', type: 'create' }]);
      h.clock.advance(SETTLE);
      await flush();
      h.calls[0].emit([{ path: '/repo/a/b', type: 'create' }]);
      h.clock.advance(CONFIRM + SETTLE);
      await flush();
      h.clock.advance(30_000);
      await flush();

      expect(h.calls).toHaveLength(1);
      expect(h.rebuilt()).toEqual([]);
      await h.core.dispose();
    });

    it('a nested .git found only by listing is detected like a reported one: notice, then native ignore', async () => {
      const h = reconcilingSetup();
      h.subscribe(1, { nestedRepoDetection: true });
      await flush();
      h.tree.set('/repo/clone', [h.file('.git'), h.file('README.md')]);

      // inotify reported the directory but not the `.git` written into it.
      h.calls[0].emit([{ path: '/repo/clone', type: 'create' }]);
      expect(
        h.ofType('notice').filter((n) => n.code === 'nested-root-detected'),
      ).toEqual([]);
      h.clock.advance(SETTLE);
      await flush();

      expect(
        h.ofType('notice').filter((n) => n.code === 'nested-root-detected'),
      ).toEqual([expect.objectContaining({ detail: '/repo/clone' })]);
      h.clock.advance(
        WORKSPACE_WATCH_HOST_DEFAULTS.nestedResubscribeDebounceMs,
      );
      await flush();
      expect(last(h.calls)?.ignore).toEqual(['/repo/clone']);
      h.clock.advance(250);
      // Everything under the new nested root stays out of the batches.
      const delivered = h
        .batches(1)
        .flatMap((b) => b.changes.map((c) => c.path));
      expect(delivered.filter((p) => p.startsWith('/repo/clone/'))).toEqual([]);
      await h.core.dispose();
    });

    it('never counts a natively ignored child as lost', async () => {
      const h = reconcilingSetup();
      h.subscribe(1, { excludeDirNames: ['node_modules'] });
      await flush();
      expect(h.calls[0].ignore).toEqual(['**/node_modules/**']);
      h.tree.set('/repo/pkg', [h.dir('node_modules'), h.file('index.js')]);

      h.calls[0].emit([{ path: '/repo/pkg', type: 'create' }]);
      h.clock.advance(SETTLE);
      await flush();
      h.clock.advance(30_000);
      await flush();

      expect(h.calls).toHaveLength(1);
      expect(h.batches(1).flatMap((b) => b.changes.map((c) => c.path))).toEqual(
        ['/repo/pkg', '/repo/pkg/index.js'],
      );
      await h.core.dispose();
    });

    it('too many created paths at once is an overflow at once and a rebuild, with no listing', async () => {
      const h = reconcilingSetup();
      h.subscribe(1);
      await flush();

      const limit = CREATED_DIRECTORY_RECONCILER_DEFAULTS.maxTrackedPaths;
      h.calls[0].emit(
        Array.from({ length: limit + 1 }, (_, i) => ({
          path: `/repo/d${i}`,
          type: 'create' as const,
        })),
      );
      // The immediate overflow replaces the truncated batch those creates made.
      h.clock.advance(250);
      expect(h.batches(1)).toEqual([
        expect.objectContaining({ overflow: true, changes: [] }),
      ]);
      expect(h.calls).toHaveLength(1);

      h.clock.advance(WORKSPACE_WATCH_REBUILD_DEBOUNCE_MS - 250);
      await flush();
      expect(h.listDirectory).not.toHaveBeenCalled();
      expect(h.calls).toHaveLength(2);
      expect(h.rebuilt()).toEqual([
        expect.objectContaining({
          detail: expect.stringContaining('limit-exceeded'),
        }),
      ]);
      h.clock.advance(250);
      expect(h.overflows(1)).toHaveLength(2);
      await h.core.dispose();
    });

    it('a created path that is a file or already gone reconciles to nothing', async () => {
      const h = reconcilingSetup();
      h.subscribe(1);
      await flush();

      h.calls[0].emit([
        { path: '/repo/file.txt', type: 'create' },
        { path: '/repo/gone', type: 'create' },
      ]);
      h.calls[0].emit([{ path: '/repo/gone', type: 'delete' }]);
      h.clock.advance(SETTLE);
      await flush();
      h.clock.advance(30_000);
      await flush();

      // `gone` was forgotten on its delete; `file.txt` listed and rejected.
      expect(h.listDirectory.mock.calls.map(([d]) => d)).toEqual([
        '/repo/file.txt',
      ]);
      expect(h.calls).toHaveLength(1);
      expect(h.rebuilt()).toEqual([]);
      await h.core.dispose();
    });

    it('an unreadable created directory posts one directory-unreadable notice and reconciles to nothing', async () => {
      const h = reconcilingSetup();
      h.listDirectory.mockImplementation(async (dir: string) => {
        throw Object.assign(new Error(dir), { code: 'EACCES' });
      });
      h.subscribe(1);
      await flush();

      h.calls[0].emit([
        { path: '/repo/locked-a', type: 'create' },
        { path: '/repo/locked-b', type: 'create' },
      ]);
      h.clock.advance(SETTLE);
      await flush();
      h.clock.advance(30_000);
      await flush();

      expect(
        h.ofType('notice').filter((n) => n.code === 'directory-unreadable'),
      ).toEqual([
        expect.objectContaining({
          root: ROOT,
          detail: 'EACCES: /repo/locked-a',
        }),
      ]);
      expect(h.overflows(1)).toHaveLength(0);
      expect(h.calls).toHaveLength(1);
      await h.core.dispose();
    });

    it('does not list during a storm, and rebuilds after it when creates went unreconciled', async () => {
      const h = reconcilingSetup({
        stormBreakerOptions: { enterEventsPerWindow: 5, quietMs: 2_000 },
      });
      h.subscribe(1);
      await flush();

      h.calls[0].emit(
        Array.from({ length: 20 }, (_, i) => ({
          path: `/repo/burst${i}`,
          type: 'create' as const,
        })),
      );
      h.clock.advance(SETTLE);
      await flush();
      expect(h.listDirectory).not.toHaveBeenCalled();

      // Quiet → storm exits. The storm's own exit overflow and the lost-watch
      // overflow fold into ONE batch, on the next tick.
      h.clock.advance(2_000);
      await flush();
      expect(h.calls).toHaveLength(1);
      h.clock.advance(250);
      expect(h.overflows(1)).toHaveLength(1);
      h.clock.advance(1_000);
      expect(h.overflows(1)).toHaveLength(1);

      // Rebuild after the debounce, then the second overflow once it is live.
      await flush();
      expect(h.calls).toHaveLength(2);
      expect(h.rebuilt()).toEqual([
        expect.objectContaining({
          detail: expect.stringContaining('event storm'),
        }),
      ]);
      h.clock.advance(250);
      expect(h.overflows(1)).toHaveLength(2);
      await h.core.dispose();
    });

    it('a storm with no creates ends without a rebuild', async () => {
      const h = reconcilingSetup({
        stormBreakerOptions: { enterEventsPerWindow: 5, quietMs: 2_000 },
      });
      h.subscribe(1);
      await flush();
      h.calls[0].emit(
        Array.from({ length: 20 }, (_, i) => ({
          path: `/repo/f${i}`,
          type: 'update' as const,
        })),
      );
      h.clock.advance(30_000);
      await flush();
      expect(h.calls).toHaveLength(1);
      expect(h.listDirectory).not.toHaveBeenCalled();
      await h.core.dispose();
    });

    it('bounds rebuilds of one root by the minimum gap', async () => {
      const h = reconcilingSetup();
      h.subscribe(1);
      await flush();
      const burst = (label: string) =>
        Array.from(
          {
            length: CREATED_DIRECTORY_RECONCILER_DEFAULTS.maxTrackedPaths + 1,
          },
          (_, i) => ({ path: `/repo/${label}${i}`, type: 'create' as const }),
        );

      h.calls[0].emit(burst('a'));
      h.clock.advance(WORKSPACE_WATCH_REBUILD_DEBOUNCE_MS);
      await flush();
      expect(h.calls).toHaveLength(2);

      h.calls[1].emit(burst('b'));
      h.clock.advance(WORKSPACE_WATCH_REBUILD_MIN_GAP_MS - 1);
      await flush();
      expect(h.calls).toHaveLength(2);
      h.clock.advance(1);
      await flush();
      expect(h.calls).toHaveLength(3);
      await h.core.dispose();
    });

    it('dispose during the settle delay leaves no timer and lists nothing', async () => {
      const h = reconcilingSetup();
      h.core.start();
      h.subscribe(1);
      await flush();
      h.calls[0].emit([{ path: '/repo/src', type: 'create' }]);
      await h.core.dispose();

      expect(h.clock.pendingTimers).toBe(0);
      const count = h.posted.length;
      h.clock.advance(60_000);
      await flush();
      expect(h.listDirectory).not.toHaveBeenCalled();
      expect(h.posted).toHaveLength(count);
    });

    it('dispose during an in-flight listing drops its result', async () => {
      const h = reconcilingSetup();
      let resolveListing: (
        entries: WorkspaceWatchDirectoryEntry[],
      ) => void = () => undefined;
      h.listDirectory.mockImplementationOnce(
        () => new Promise((resolve) => (resolveListing = resolve)),
      );
      h.subscribe(1);
      await flush();
      h.calls[0].emit([{ path: '/repo/src', type: 'create' }]);
      h.clock.advance(SETTLE);
      expect(h.listDirectory).toHaveBeenCalledTimes(1);

      await h.core.dispose();
      const count = h.posted.length;
      resolveListing([h.dir('lost')]);
      await flush();
      h.clock.advance(60_000);
      await flush();
      expect(h.clock.pendingTimers).toBe(0);
      expect(h.posted).toHaveLength(count);
      expect(h.calls).toHaveLength(1);
    });

    it('dispose while a rebuild awaits the release never subscribes again', async () => {
      const h = reconcilingSetup();
      h.subscribe(1);
      await flush();
      let release: () => void = () => undefined;
      h.calls[0].unsubscribe.mockImplementationOnce(() => {
        h.log.push('unsubscribe:0');
        return new Promise<void>((resolve) => (release = resolve));
      });
      h.calls[0].emit(
        Array.from(
          {
            length: CREATED_DIRECTORY_RECONCILER_DEFAULTS.maxTrackedPaths + 1,
          },
          (_, i) => ({ path: `/repo/d${i}`, type: 'create' as const }),
        ),
      );
      h.clock.advance(WORKSPACE_WATCH_REBUILD_DEBOUNCE_MS);
      await flush();
      expect(h.log).toEqual(['subscribe:0', 'unsubscribe:0']);

      const disposing = h.core.dispose();
      release();
      await disposing;
      await flush();
      expect(h.calls).toHaveLength(1);
      expect(h.clock.pendingTimers).toBe(0);
    });
  });

  describe('lifecycle', () => {
    it('rejects a duplicate subscription id', async () => {
      const { subscribe, ofType, calls, core } = setup();
      subscribe(1);
      subscribe(1, {}, '/other');
      await flush();

      expect(ofType('error').map((e) => [e.code, e.id])).toEqual([
        ['subscribe-rejected', 1],
      ]);
      expect(calls.map((c) => c.dir)).toEqual([ROOT]);
      expect(core.subscriptionCount).toBe(1);
      await core.dispose();
    });

    it('releases the native subscription with the last subscriber and stops that subscriber', async () => {
      const { clock, subscribe, calls, batches, core } = setup();
      subscribe(1);
      subscribe(2);
      await flush();

      core.handleMessage({ type: 'unsubscribe', id: 1 });
      calls[0].emit([{ path: '/repo/a.ts', type: 'create' }]);
      clock.advance(250);
      expect(batches(1)).toHaveLength(0);
      expect(batches(2)).toHaveLength(1);
      expect(calls[0].unsubscribe).not.toHaveBeenCalled();

      core.handleMessage({ type: 'unsubscribe', id: 2 });
      core.handleMessage({ type: 'unsubscribe', id: 2 });
      await flush();
      expect(calls[0].unsubscribe).toHaveBeenCalledTimes(1);
      expect(core.subscriptionCount).toBe(0);
    });

    it('releases a subscription that resolves after its root was abandoned', async () => {
      const { subscribe, calls, core } = setup({ autoSettle: false });
      subscribe(1);
      await flush();
      core.handleMessage({ type: 'unsubscribe', id: 1 });
      calls[0].settle();
      await flush();
      expect(calls[0].unsubscribe).toHaveBeenCalledTimes(1);
      await core.dispose();
    });

    it('never runs a native subscribe while another root’s unsubscribe is in flight', async () => {
      const { subscribe, calls, log, core } = setup();
      subscribe(1, {}, '/a');
      await flush();
      let release: () => void = () => undefined;
      calls[0].unsubscribe.mockImplementationOnce(() => {
        log.push('unsubscribe:0');
        return new Promise<void>((resolve) => (release = resolve));
      });

      // A folder switch: the last subscription of one root goes, another comes.
      core.handleMessage({ type: 'unsubscribe', id: 1 });
      subscribe(2, {}, '/b');
      await flush();
      expect(log).toEqual(['subscribe:0', 'unsubscribe:0']);

      release();
      await flush();
      expect(log).toEqual(['subscribe:0', 'unsubscribe:0', 'subscribe:1']);
      expect(calls[1].dir).toBe('/b');
      await core.dispose();
    });

    it('a hung native unsubscribe times out: fatal, the queued subscribe runs, the late resolve is inert', async () => {
      const TIMEOUT = WORKSPACE_WATCH_HOST_DEFAULTS.nativeUnsubscribeTimeoutMs;
      const { clock, subscribe, calls, posted, ofType, core } = setup();
      subscribe(1, {}, '/a');
      await flush();
      let release: () => void = () => undefined;
      calls[0].unsubscribe.mockImplementationOnce(
        () => new Promise<void>((resolve) => (release = resolve)),
      );

      core.handleMessage({ type: 'unsubscribe', id: 1 });
      subscribe(2, {}, '/b');
      await flush();
      clock.advance(TIMEOUT - 1);
      await flush();
      expect(calls).toHaveLength(1);
      expect(ofType('fatal')).toEqual([]);

      clock.advance(1);
      await flush();
      expect(ofType('fatal')).toEqual([
        {
          type: 'fatal',
          message: `native unsubscribe did not settle within ${TIMEOUT} ms`,
        },
      ]);
      expect(ofType('error')).toEqual([
        expect.objectContaining({ code: 'native-unsubscribe-failed' }),
      ]);
      expect(calls.map((c) => c.dir)).toEqual(['/a', '/b']);

      const count = posted.length;
      release();
      await flush();
      expect(posted).toHaveLength(count);
      await core.dispose();
    });

    it('a hung subscribe is fatal only after the subscribe timeout; its late result is released and the root retries', async () => {
      const TIMEOUT = WORKSPACE_WATCH_HOST_DEFAULTS.nativeSubscribeTimeoutMs;
      const { clock, subscribe, calls, ofType, core } = setup({
        autoSettle: false,
      });
      subscribe(1);
      await flush();
      // A long walk is not a hang: the unsubscribe bound does not apply.
      clock.advance(TIMEOUT - 1);
      await flush();
      expect(ofType('fatal')).toEqual([]);
      clock.advance(1);
      await flush();
      expect(ofType('fatal')).toEqual([
        expect.objectContaining({
          message: `native subscribe did not settle within ${TIMEOUT} ms`,
        }),
      ]);
      expect(ofType('error')).toEqual([
        expect.objectContaining({ code: 'native-subscribe-failed' }),
      ]);

      // The late subscription belongs to nobody: released, never acked.
      calls[0].settle();
      await flush();
      expect(calls[0].unsubscribe).toHaveBeenCalledTimes(1);
      expect(ofType('subscribed')).toEqual([]);

      clock.advance(WORKSPACE_WATCH_HOST_DEFAULTS.nativeRetryInitialMs);
      await flush();
      expect(calls).toHaveLength(2);
      calls[1].settle();
      await flush();
      expect(ofType('subscribed')).toEqual([{ type: 'subscribed', id: 1 }]);
      await core.dispose();
    });

    it('dispose waits for a cleanup release queued before it, bounded by the timeout', async () => {
      const { clock, subscribe, calls, core } = setup({ autoSettle: false });
      subscribe(1);
      await flush();
      // Abandoned while subscribing: its late subscription gets released.
      core.handleMessage({ type: 'unsubscribe', id: 1 });
      let release: () => void = () => undefined;
      calls[0].unsubscribe.mockImplementationOnce(
        () => new Promise<void>((resolve) => (release = resolve)),
      );
      calls[0].settle();
      await flush();
      expect(calls[0].unsubscribe).toHaveBeenCalledTimes(1);

      let disposed = false;
      void core.dispose().then(() => (disposed = true));
      await flush();
      expect(disposed).toBe(false);
      release();
      await flush();
      expect(disposed).toBe(true);
      expect(clock.pendingTimers).toBe(0);
    });

    it('dispose with a subscribe mid-walk resolves after at most the unsubscribe timeout; the late subscription is released', async () => {
      const CAP = WORKSPACE_WATCH_HOST_DEFAULTS.nativeUnsubscribeTimeoutMs;
      const { clock, subscribe, calls, ofType, core } = setup({
        autoSettle: false,
      });
      subscribe(1);
      await flush();

      let disposed = false;
      void core.dispose().then(() => (disposed = true));
      await flush();
      clock.advance(CAP - 1);
      await flush();
      expect(disposed).toBe(false);
      clock.advance(1);
      await flush();
      expect(disposed).toBe(true);
      expect(ofType('fatal')).toEqual([]);
      expect(clock.pendingTimers).toBe(0);

      // The walk finishes after the app has moved on: released, never acked.
      calls[0].settle();
      await flush();
      expect(calls[0].unsubscribe).toHaveBeenCalledTimes(1);
      expect(ofType('subscribed')).toEqual([]);
      expect(ofType('fatal')).toEqual([]);
      expect(clock.pendingTimers).toBe(0);
    });

    it('releases queued behind a call dispose abandoned still run after dispose, without fresh timers', async () => {
      const CAP = WORKSPACE_WATCH_HOST_DEFAULTS.nativeUnsubscribeTimeoutMs;
      const { clock, subscribe, calls, ofType, core } = setup({
        autoSettle: false,
      });
      subscribe(1, {}, '/a');
      await flush();
      calls[0].settle();
      await flush();
      // A release that will never settle, queued behind a subscribe mid-walk.
      calls[0].unsubscribe.mockImplementationOnce(
        () => new Promise<void>(() => undefined),
      );
      subscribe(2, {}, '/b');
      await flush();
      expect(calls).toHaveLength(2);

      let disposed = false;
      void core.dispose().then(() => (disposed = true));
      await flush();
      expect(calls[0].unsubscribe).not.toHaveBeenCalled();

      clock.advance(CAP);
      await flush();
      expect(disposed).toBe(true);
      // The abandoned walk let the queue move: `/a` is released, untimed.
      expect(calls[0].unsubscribe).toHaveBeenCalledTimes(1);
      expect(clock.pendingTimers).toBe(0);

      clock.advance(WORKSPACE_WATCH_HOST_DEFAULTS.nativeSubscribeTimeoutMs);
      await flush();
      expect(ofType('fatal')).toEqual([]);
      expect(clock.pendingTimers).toBe(0);
    });

    it('dispose does not wait past the unsubscribe timeout for a release that never settles', async () => {
      const TIMEOUT = WORKSPACE_WATCH_HOST_DEFAULTS.nativeUnsubscribeTimeoutMs;
      const { clock, subscribe, calls, ofType, core } = setup();
      subscribe(1);
      await flush();
      calls[0].unsubscribe.mockImplementationOnce(
        () => new Promise<void>(() => undefined),
      );

      let disposed = false;
      void core.dispose().then(() => (disposed = true));
      await flush();
      expect(disposed).toBe(false);
      clock.advance(TIMEOUT);
      await flush();
      expect(disposed).toBe(true);
      // Disposed: nothing is posted any more, fatal included.
      expect(ofType('fatal')).toEqual([]);
      expect(clock.pendingTimers).toBe(0);
    });

    it('drops a queued subscribe whose root was abandoned before its turn', async () => {
      const { subscribe, calls, core } = setup();
      subscribe(1, {}, '/a');
      await flush();
      let release: () => void = () => undefined;
      calls[0].unsubscribe.mockImplementationOnce(
        () => new Promise<void>((resolve) => (release = resolve)),
      );
      core.handleMessage({ type: 'unsubscribe', id: 1 });
      subscribe(2, {}, '/b');
      core.handleMessage({ type: 'unsubscribe', id: 2 });
      await flush();
      release();
      await flush();
      expect(calls).toHaveLength(1);
      await core.dispose();
    });

    it('dispose releases every native subscription, stops heartbeats and ignores later messages', async () => {
      const { clock, subscribe, calls, posted, core } = setup();
      core.start();
      subscribe(1, {}, '/a');
      subscribe(2, {}, '/b');
      await flush();

      await core.dispose();
      await core.dispose();
      expect(calls.map((c) => c.unsubscribe.mock.calls.length)).toEqual([1, 1]);

      const count = posted.length;
      clock.advance(10_000);
      subscribe(3);
      await flush();
      expect(posted).toHaveLength(count);
    });

    it('reports a failed native unsubscribe while running', async () => {
      const { subscribe, calls, ofType, core } = setup();
      subscribe(1);
      await flush();
      calls[0].unsubscribe.mockRejectedValueOnce(new Error('busy'));
      core.handleMessage({ type: 'unsubscribe', id: 1 });
      await flush();
      expect(ofType('error')).toEqual([
        expect.objectContaining({
          code: 'native-unsubscribe-failed',
          message: 'busy',
        }),
      ]);
      await core.dispose();
    });
  });
});
