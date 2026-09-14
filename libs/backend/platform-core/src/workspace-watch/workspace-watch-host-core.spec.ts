import type { WorkspaceWatchOptions } from '../interfaces/workspace-watcher.interface';
import type { WorkspaceChangeCoalescerClock } from '../utils/workspace-change-coalescer';
import {
  WorkspaceWatchHostCore,
  toWorkspaceWatchPathKey,
  type WorkspaceWatchEngine,
  type WorkspaceWatchEngineCallback,
  type WorkspaceWatchEngineEvent,
} from './workspace-watch-host-core';
import type {
  WorkspaceWatchBatchMessage,
  WorkspaceWatchHostOutbound,
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

/** An engine whose subscribe promises the test settles by hand. */
function createFakeEngine(options: { autoSettle?: boolean } = {}) {
  const calls: FakeSubscribeCall[] = [];
  const engine: WorkspaceWatchEngine = {
    subscribe: (dir, callback, { ignore }) =>
      new Promise((resolve, reject) => {
        const unsubscribe = jest.fn(async () => undefined);
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
  return { engine, calls };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

const ROOT = '/repo';

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

function setup(engineOptions: { autoSettle?: boolean } = {}) {
  const clock = new ManualClock();
  const { engine, calls } = createFakeEngine(engineOptions);
  const posted: WorkspaceWatchHostOutbound[] = [];
  const core = new WorkspaceWatchHostCore({
    engine,
    post: (message) => posted.push(message),
    clock,
    stormBreakerOptions: { enterEventsPerWindow: 10_000 },
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
  return { clock, calls, posted, core, subscribe, batches, ofType };
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

  describe('native ignore set', () => {
    it('is the intersection of subscriber exclusions, in subtree-only form', async () => {
      const { subscribe, calls, core } = setup();
      subscribe(1, {
        excludeDirNames: ['node_modules', 'dist', '.git', 'we*rd'],
        excludeSegmentRules: [
          ['.claude', 'worktrees'],
          ['.GIT', 'x'],
        ],
        excludeGlobs: ['**/build/**', '**/*.log', '**/.git/**'],
        nestedRepoRoots: ['/repo/wt-a', '/repo/wt-b', '/elsewhere/wt'],
      });
      await flush();

      expect(calls[0].ignore).toEqual(
        [
          '**/node_modules/**',
          '**/dist/**',
          '**/.[cC][lL][aA][uU][dD][eE]/[wW][oO][rR][kK][tT][rR][eE][eE][sS]/**',
          '**/build/**',
          '/repo/wt-a',
          '/repo/wt-b',
        ].sort(),
      );
      await core.dispose();
    });

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
    it('a native error emits one overflow per subscriber and re-subscribes', async () => {
      const { clock, subscribe, calls, batches, ofType, core } = setup();
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
      expect(calls[0].unsubscribe).toHaveBeenCalledTimes(1);
      expect(ofType('notice')).toEqual([
        expect.objectContaining({ code: 'native-resubscribed' }),
      ]);

      // Delivery resumes from the new subscription; stale callbacks are dropped.
      calls[0].emit([{ path: '/repo/stale.ts', type: 'update' }]);
      calls[1].emit([{ path: '/repo/fresh.ts', type: 'update' }]);
      clock.advance(250);
      expect(batches(1)[1].changes.map((c) => c.path)).toEqual([
        '/repo/fresh.ts',
      ]);
      await core.dispose();
    });

    it('retries a refused subscribe with doubling back-off and signals overflow once per streak', async () => {
      const { clock, subscribe, calls, batches, ofType, core } = setup({
        autoSettle: false,
      });
      subscribe(1);
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
      calls[2].emit([{ path: '/repo/ok.ts', type: 'create' }]);
      clock.advance(250);
      expect(batches(1)[1].changes).toEqual([
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
      core.handleMessage({ type: 'unsubscribe', id: 1 });
      calls[0].settle();
      await flush();
      expect(calls[0].unsubscribe).toHaveBeenCalledTimes(1);
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
