import type {
  WorkspaceChangeBatch,
  WorkspaceWatchOptions,
} from '../interfaces/workspace-watcher.interface';
import {
  WORKSPACE_WATCH_LIMITS,
  WorkspaceChangeCoalescer,
  type WorkspaceChangeCoalescerClock,
  type WorkspaceChangeCoalescerHooks,
} from './workspace-change-coalescer';

/** Deterministic clock: timers fire only when `advance` passes their due time. */
class FakeClock implements WorkspaceChangeCoalescerClock {
  private current = 1_000_000;
  private nextId = 1;
  private readonly timers = new Map<number, { due: number; fn: () => void }>();

  now(): number {
    return this.current;
  }

  setTimer(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.timers.set(id, { due: this.current + delayMs, fn: callback });
    return id;
  }

  clearTimer(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  get pendingTimers(): number {
    return this.timers.size;
  }

  /** Advances time, firing due timers in due order (timers may arm timers). */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      let nextId: number | undefined;
      let nextDue = Infinity;
      for (const [id, timer] of this.timers) {
        if (timer.due <= target && timer.due < nextDue) {
          nextDue = timer.due;
          nextId = id;
        }
      }
      if (nextId === undefined) break;
      const timer = this.timers.get(nextId);
      this.timers.delete(nextId);
      this.current = Math.max(this.current, nextDue);
      timer?.fn();
    }
    this.current = target;
  }
}

const ROOT = '/ws';

/** The default leading-edge hold: a batch after quiet flushes this long after its first change. */
const HOLD = WORKSPACE_WATCH_LIMITS.minBatchIntervalMs;

function baseOptions(
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
  options: Partial<WorkspaceWatchOptions> = {},
  hooks: Partial<WorkspaceChangeCoalescerHooks> = {},
  root = ROOT,
) {
  const clock = new FakeClock();
  const batches: Array<{ at: number; batch: WorkspaceChangeBatch }> = [];
  const listenerErrors: unknown[] = [];
  const coalescer = new WorkspaceChangeCoalescer(
    root,
    baseOptions(options),
    (batch) => batches.push({ at: clock.now(), batch }),
    {
      clock,
      onListenerError: (error) => listenerErrors.push(error),
      // High threshold by default so cadence tests never enter a storm.
      stormBreakerOptions: { enterEventsPerWindow: 1_000_000 },
      ...hooks,
    },
  );
  const paths = () =>
    batches.flatMap(({ batch }) => batch.changes.map((c) => c.path));
  return { clock, batches, listenerErrors, coalescer, paths };
}

describe('WorkspaceChangeCoalescer — cadence', () => {
  it('never calls the listener synchronously inside push', () => {
    const { coalescer, batches, clock } = setup();
    coalescer.push('/ws/a.ts', 'update');
    expect(batches).toHaveLength(0);
    clock.advance(HOLD);
    expect(batches).toHaveLength(1);
  });

  it('holds the first batch after a quiet period for minBatchIntervalMs (leading-edge hold)', () => {
    const { coalescer, batches, clock } = setup();
    coalescer.push('/ws/a.ts', 'update');
    clock.advance(HOLD - 1);
    expect(batches).toHaveLength(0);
    coalescer.push('/ws/b.ts', 'update'); // joins the held batch
    clock.advance(1);
    expect(batches).toHaveLength(1);
    expect(batches[0].batch.changes.map((c) => c.path)).toEqual([
      '/ws/a.ts',
      '/ws/b.ts',
    ]);

    // Quiet for longer than the interval: the next change is held again.
    clock.advance(5_000);
    coalescer.push('/ws/c.ts', 'update');
    clock.advance(HOLD - 1);
    expect(batches).toHaveLength(1);
    clock.advance(1);
    expect(batches).toHaveLength(2);
  });

  it('inside an active cadence waits only for the rest of the interval', () => {
    const { coalescer, batches, clock } = setup();
    coalescer.push('/ws/a.ts', 'update');
    clock.advance(HOLD); // emitted at t = HOLD
    clock.advance(100);
    coalescer.push('/ws/b.ts', 'update');
    clock.advance(HOLD - 100 - 1);
    expect(batches).toHaveLength(1);
    clock.advance(1);
    expect(batches).toHaveLength(2);
    expect(batches[1].at - batches[0].at).toBe(HOLD);
  });

  it('a lone leading event followed by a burst within the hold is folded into the storm overflow (ST-1b)', () => {
    const transitions: string[] = [];
    const { coalescer, clock, batches } = setup(
      { minBatchIntervalMs: 1_000 },
      {
        stormBreakerOptions: { enterEventsPerWindow: 500, quietMs: 2_000 },
        onStorm: (t) => transitions.push(t),
      },
    );
    // `@parcel/watcher` notifies the first change of a burst alone...
    coalescer.push('/ws/pkgs/big/c0/d0/f0.txt', 'delete');
    // ...and the rest up to ~500 ms later, in one callback.
    clock.advance(480);
    expect(batches).toHaveLength(0);
    for (let i = 1; i <= 8_810; i++) {
      coalescer.push(`/ws/pkgs/big/f${i}.txt`, 'delete');
    }
    clock.advance(60_000);

    expect(transitions).toEqual(['entered', 'exited']);
    expect(batches).toHaveLength(1);
    expect(batches[0].batch).toMatchObject({
      overflow: true,
      changes: [],
      droppedCount: 8_811,
    });
  });

  it('emits at most one batch per minBatchIntervalMs and coalesces in between', () => {
    const { coalescer, batches, clock } = setup();
    coalescer.push('/ws/a.ts', 'update');
    clock.advance(HOLD);
    for (let i = 0; i < 40; i++) {
      coalescer.push(`/ws/f${i}.ts`, 'update');
      clock.advance(10);
    }
    clock.advance(1_000);

    const times = batches.map((b) => b.at);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(250);
    }
    // 400 ms of events after the first flush fit in two more batches.
    expect(batches.length).toBeLessThanOrEqual(3);
    expect(batches.flatMap((b) => b.batch.changes)).toHaveLength(41);
  });

  it('clamps minBatchIntervalMs to the INV-1 floor', () => {
    const { coalescer, batches, clock } = setup({ minBatchIntervalMs: 1 });
    coalescer.push('/ws/a.ts', 'update');
    clock.advance(HOLD);
    coalescer.push('/ws/b.ts', 'update');
    clock.advance(249);
    expect(batches).toHaveLength(1);
    clock.advance(1);
    expect(batches).toHaveLength(2);
    expect(WORKSPACE_WATCH_LIMITS.minBatchIntervalMs).toBe(250);
  });

  it('honours a longer interval', () => {
    const { coalescer, batches, clock } = setup({ minBatchIntervalMs: 1_000 });
    coalescer.push('/ws/a.ts', 'update');
    clock.advance(999);
    expect(batches).toHaveLength(0);
    clock.advance(1);
    coalescer.push('/ws/b.ts', 'update');
    clock.advance(999);
    expect(batches).toHaveLength(1);
    clock.advance(1);
    expect(batches).toHaveLength(2);
  });

  it('deduplicates a path and merges kinds (create then update stays create)', () => {
    const { coalescer, batches, clock } = setup();
    coalescer.push('/ws/a.ts', 'create');
    coalescer.push('/ws/a.ts', 'update');
    coalescer.push('/ws/b.ts', 'create');
    coalescer.push('/ws/b.ts', 'delete');
    coalescer.push('/ws/c.ts', 'delete');
    coalescer.push('/ws/c.ts', 'create');
    clock.advance(HOLD);
    expect(batches[0].batch.changes).toEqual([
      { path: '/ws/a.ts', kind: 'create' },
      { path: '/ws/b.ts', kind: 'delete' },
      { path: '/ws/c.ts', kind: 'create' },
    ]);
    expect(batches[0].batch).toMatchObject({
      root: ROOT,
      truncated: false,
      overflow: false,
      droppedCount: 0,
    });
  });
});

describe('WorkspaceChangeCoalescer — cap and truncation', () => {
  it('caps distinct paths per batch and reports the rest as dropped', () => {
    const { coalescer, batches, clock } = setup({ maxPathsPerBatch: 3 });
    for (let i = 0; i < 5; i++) coalescer.push(`/ws/f${i}.ts`, 'update');
    // An already-listed path still updates in place.
    coalescer.push('/ws/f0.ts', 'delete');
    clock.advance(HOLD);
    expect(batches).toHaveLength(1);
    const batch = batches[0].batch;
    expect(batch.changes).toHaveLength(3);
    expect(batch.changes[0]).toEqual({ path: '/ws/f0.ts', kind: 'delete' });
    expect(batch.truncated).toBe(true);
    expect(batch.droppedCount).toBe(2);
    expect(batch.overflow).toBe(false);
  });

  it('resets truncation for the next batch', () => {
    const { coalescer, batches, clock } = setup({ maxPathsPerBatch: 1 });
    coalescer.push('/ws/a.ts', 'update');
    coalescer.push('/ws/b.ts', 'update');
    clock.advance(HOLD);
    coalescer.push('/ws/c.ts', 'update');
    clock.advance(250);
    expect(batches[1].batch).toMatchObject({
      truncated: false,
      droppedCount: 0,
    });
  });

  it('clamps maxPathsPerBatch to the INV-1 ceiling and ignores values below 1', () => {
    const big = setup({ maxPathsPerBatch: 10_000 });
    for (let i = 0; i < 600; i++) big.coalescer.push(`/ws/f${i}`, 'update');
    big.clock.advance(HOLD);
    expect(big.batches[0].batch.changes).toHaveLength(500);
    expect(big.batches[0].batch.droppedCount).toBe(100);

    const zero = setup({ maxPathsPerBatch: 0 });
    for (let i = 0; i < 600; i++) zero.coalescer.push(`/ws/f${i}`, 'update');
    zero.clock.advance(HOLD);
    expect(zero.batches[0].batch.changes).toHaveLength(500);
  });
});

describe('WorkspaceChangeCoalescer — exclusion', () => {
  it('matches directory names case-sensitively and segment rules case-insensitively, at any depth', () => {
    const { coalescer, clock, paths } = setup({
      excludeDirNames: ['node_modules'],
      excludeSegmentRules: [['.claude', 'worktrees'], [], ['a', '']],
    });
    coalescer.push('/ws/node_modules/x/index.js', 'update');
    coalescer.push('/ws/pkg/node_modules/y.js', 'update');
    coalescer.push('/ws/pkg/Node_Modules/y.js', 'update'); // kept: exact name only
    coalescer.push('/ws/.claude/worktrees/a/b.ts', 'delete');
    coalescer.push('/ws/.Claude/WorkTrees', 'delete');
    coalescer.push('/ws/.claude/commands/x.md', 'update');
    coalescer.push('/ws/worktrees/.claude/z', 'update');
    coalescer.push('/ws/foo.claude-worktrees/z', 'update');
    coalescer.push('/ws/src/a.ts', 'update');
    clock.advance(HOLD);
    expect(paths()).toEqual([
      '/ws/pkg/Node_Modules/y.js',
      '/ws/.claude/commands/x.md',
      '/ws/worktrees/.claude/z',
      '/ws/foo.claude-worktrees/z',
      '/ws/src/a.ts',
    ]);
  });

  it('applies globs against the root-relative path with dot files, including the directory entry', () => {
    const { coalescer, clock, paths } = setup({
      excludeGlobs: ['**/dist/**', '**/*.log'],
    });
    coalescer.push('/ws/dist', 'create');
    coalescer.push('/ws/libs/a/dist/b.js', 'update');
    coalescer.push('/ws/.hidden/debug.log', 'update');
    coalescer.push('/ws/src/a.ts', 'update');
    clock.advance(HOLD);
    expect(paths()).toEqual(['/ws/src/a.ts']);
  });

  it('drops the root itself and paths outside the root (sibling prefix too)', () => {
    const { coalescer, clock, batches } = setup();
    coalescer.push('/ws', 'update');
    coalescer.push('/ws/', 'update');
    coalescer.push('/wsx/a.ts', 'update');
    coalescer.push('/other/a.ts', 'update');
    coalescer.push('/ws/../etc/passwd', 'update');
    clock.advance(1_000);
    expect(batches).toHaveLength(0);
  });

  it('handles Windows roots: backslashes, mixed separators and case folding', () => {
    const { coalescer, clock, paths } = setup(
      { excludeDirNames: ['dist'] },
      {},
      'D:\\Projects\\App\\',
    );
    coalescer.push('d:\\projects\\app\\src\\a.ts', 'update');
    coalescer.push('D:/Projects/App/src\\A.ts', 'update');
    coalescer.push('D:\\Projects\\App\\dist\\x.js', 'update');
    coalescer.push('D:\\Projects\\Apple\\x.ts', 'update');
    clock.advance(HOLD);
    // Same file in two spellings is one change; the last spelling wins.
    expect(paths()).toEqual(['D:/Projects/App/src\\A.ts']);
  });

  it('handles UNC roots: containment, doubled separators, case folding, sibling shares', () => {
    const detected: string[] = [];
    const { coalescer, clock, paths } = setup(
      { nestedRepoDetection: true },
      { onNestedRepoRoot: (root) => detected.push(root) },
      '\\\\server\\share\\repo',
    );
    coalescer.push('\\\\server\\share\\repo\\src\\a.ts', 'update');
    coalescer.push('//SERVER/Share/repo/src/b.ts', 'update');
    coalescer.push('\\\\server\\share\\repo\\\\src\\\\c.ts', 'update');
    coalescer.push('\\\\server\\share\\repository\\x.ts', 'update');
    coalescer.push('\\\\server\\share2\\repo\\x.ts', 'update');
    coalescer.push('\\\\other\\share\\repo\\x.ts', 'update');
    coalescer.push('\\\\server\\share\\repo', 'update');
    coalescer.push('\\\\server\\share\\repo\\vendor\\.git', 'create');
    coalescer.push('\\\\server\\share\\repo\\vendor\\lib.ts', 'update');
    clock.advance(HOLD);
    expect(paths()).toEqual([
      '\\\\server\\share\\repo\\src\\a.ts',
      '//SERVER/Share/repo/src/b.ts',
      '\\\\server\\share\\repo\\\\src\\\\c.ts',
    ]);
    expect(detected).toEqual(['\\\\server\\share\\repo\\vendor']);
    expect(coalescer.addNestedRepoRoot('//server/share/repo/other')).toBe(true);
    expect(coalescer.addNestedRepoRoot('//server/share/elsewhere')).toBe(false);
  });

  it('excludes seeded nested repository roots and ignores roots outside the workspace', () => {
    const { coalescer, clock, paths } = setup({
      nestedRepoRoots: ['/ws/vendor/lib', '/elsewhere/repo', '/ws'],
    });
    coalescer.push('/ws/vendor/lib/a.ts', 'update');
    coalescer.push('/ws/vendor/lib', 'delete');
    coalescer.push('/ws/vendor/library/a.ts', 'update');
    coalescer.push('/ws/src/a.ts', 'update');
    clock.advance(HOLD);
    expect(paths()).toEqual(['/ws/vendor/library/a.ts', '/ws/src/a.ts']);
    expect(coalescer.addNestedRepoRoot('/ws/vendor/lib/deeper')).toBe(false);
    expect(coalescer.addNestedRepoRoot('/ws/other')).toBe(true);
  });

  it('detects nested repositories from a .git entry below the root when enabled', () => {
    const detected: string[] = [];
    const { coalescer, clock, paths } = setup(
      { nestedRepoDetection: true, excludeDirNames: ['.git'] },
      { onNestedRepoRoot: (root) => detected.push(root) },
    );
    coalescer.push('/ws/.git/index', 'update'); // the root's own repository
    coalescer.push('/ws/pkg/sub/.git', 'create'); // a worktree .git file
    coalescer.push('/ws/pkg/sub/src/a.ts', 'update');
    coalescer.push('/ws/pkg/sub/.git/HEAD', 'update'); // already covered
    coalescer.push('/ws/pkg/a.ts', 'update');
    clock.advance(HOLD);
    expect(detected).toEqual(['/ws/pkg/sub']);
    expect(paths()).toEqual(['/ws/pkg/a.ts']);
  });

  it.each([
    ['/ws/pkg/.gitignore'],
    ['/ws/pkg/.gitattributes'],
    ['/ws/pkg/.gitmodules'],
    ['/ws/pkg/.github/workflows/ci.yml'],
    ['/ws/pkg/.git-blame-ignore-revs'],
    ['/ws/pkg/my.git/x'],
    ['/ws/pkg/.GIT/HEAD'],
  ])(
    'nested detection matches only an exact .git segment: %s is not a marker',
    (path) => {
      const detected: string[] = [];
      const { coalescer, clock, paths } = setup(
        { nestedRepoDetection: true },
        { onNestedRepoRoot: (root) => detected.push(root) },
      );
      coalescer.push(path, 'update');
      coalescer.push('/ws/pkg/src/a.ts', 'update');
      clock.advance(HOLD);
      expect(detected).toEqual([]);
      expect(paths()).toEqual([path, '/ws/pkg/src/a.ts']);
    },
  );

  it('composes detected roots in the root separator style', () => {
    const detected: string[] = [];
    const { coalescer } = setup(
      { nestedRepoDetection: true },
      { onNestedRepoRoot: (root) => detected.push(root) },
      'C:\\ws',
    );
    coalescer.push('C:\\ws\\a\\b\\.git', 'create');
    expect(detected).toEqual(['C:\\ws\\a\\b']);
  });

  it('does not detect nested roots when disabled, nor inside an excluded directory', () => {
    const detected: string[] = [];
    const off = setup(
      { nestedRepoDetection: false },
      { onNestedRepoRoot: (root) => detected.push(root) },
    );
    off.coalescer.push('/ws/pkg/.git', 'create');
    off.coalescer.push('/ws/pkg/a.ts', 'update');
    off.clock.advance(HOLD);
    expect(off.paths()).toEqual(['/ws/pkg/.git', '/ws/pkg/a.ts']);

    const excluded = setup(
      {
        nestedRepoDetection: true,
        excludeSegmentRules: [['.claude-worktrees']],
      },
      { onNestedRepoRoot: (root) => detected.push(root) },
    );
    excluded.coalescer.push('/ws/.claude-worktrees/t1/.git', 'create');
    expect(detected).toEqual([]);
  });

  it('excluded events can never start a storm', () => {
    const storms: string[] = [];
    const { coalescer, clock, batches } = setup(
      { excludeDirNames: ['node_modules'] },
      {
        stormBreakerOptions: { enterEventsPerWindow: 10 },
        onStorm: (t) => storms.push(t),
      },
    );
    for (let i = 0; i < 1_000; i++) {
      coalescer.push(`/ws/node_modules/p/${i}.js`, 'delete');
    }
    coalescer.push('/ws/a.ts', 'update');
    clock.advance(HOLD);
    expect(storms).toEqual([]);
    expect(batches).toHaveLength(1);
    expect(batches[0].batch.overflow).toBe(false);
  });
});

describe('WorkspaceChangeCoalescer — storm and overflow', () => {
  const storm = {
    enterEventsPerWindow: 10,
    quietMs: 2_000,
    maxStormMs: 30_000,
  };

  it('a storm emits nothing while it runs and exactly one overflow batch when it quiets', () => {
    const transitions: string[] = [];
    const { coalescer, clock, batches } = setup(
      {},
      {
        stormBreakerOptions: storm,
        onStorm: (t) => transitions.push(t),
      },
    );
    for (let i = 0; i < 5_000; i++) {
      coalescer.push(`/ws/tree/${i}.ts`, 'delete');
      // Never advance before the storm is entered, or the first path flushes.
      if (i > 0 && i % 100 === 0) clock.advance(1);
    }
    expect(coalescer.isStorming).toBe(true);
    clock.advance(1_999);
    expect(batches).toHaveLength(0);
    clock.advance(10_000);

    expect(transitions).toEqual(['entered', 'exited']);
    expect(batches).toHaveLength(1);
    expect(batches[0].batch).toEqual({
      root: ROOT,
      changes: [],
      truncated: false,
      overflow: true,
      droppedCount: 5_000,
    });
  });

  it('pending changes collected before a storm are folded into its overflow', () => {
    const { coalescer, clock, batches } = setup(
      {},
      { stormBreakerOptions: storm },
    );
    coalescer.push('/ws/first.ts', 'update');
    clock.advance(HOLD); // first batch
    coalescer.push('/ws/second.ts', 'update'); // pending behind the cadence
    for (let i = 0; i < 20; i++) coalescer.push(`/ws/s${i}.ts`, 'delete');
    clock.advance(60_000);
    expect(batches.map((b) => b.batch.overflow)).toEqual([false, true]);
    expect(batches[1].batch.droppedCount).toBe(21);
  });

  it('a storm that never quiets still yields one overflow per maxStormMs', () => {
    const { coalescer, clock, batches } = setup(
      {},
      { stormBreakerOptions: { ...storm, maxStormMs: 5_000 } },
    );
    for (let ms = 0; ms < 16_000; ms += 10) {
      // 20 per step: the storm is entered before the first timer can flush.
      for (let i = 0; i < 20; i++) coalescer.push(`/ws/x${ms}-${i}`, 'update');
      clock.advance(10);
    }
    const overflows = batches.filter((b) => b.batch.overflow);
    expect(overflows.length).toBeGreaterThanOrEqual(3);
    expect(batches.every((b) => b.batch.changes.length === 0)).toBe(true);
  });

  it('signalOverflow folds pending changes into one overflow batch on the cadence', () => {
    const { coalescer, clock, batches } = setup();
    coalescer.push('/ws/a.ts', 'update');
    clock.advance(HOLD);
    coalescer.push('/ws/b.ts', 'update');
    coalescer.signalOverflow();
    coalescer.push('/ws/c.ts', 'update'); // subsumed by the owed rescan
    clock.advance(100);
    expect(batches).toHaveLength(1);
    clock.advance(150);
    expect(batches).toHaveLength(2);
    expect(batches[1].batch).toEqual({
      root: ROOT,
      changes: [],
      truncated: false,
      overflow: true,
      droppedCount: 2,
    });
    coalescer.push('/ws/d.ts', 'update');
    clock.advance(250);
    expect(batches[2].batch.overflow).toBe(false);
    expect(batches[2].batch.changes).toEqual([
      { path: '/ws/d.ts', kind: 'update' },
    ]);
  });

  it('while storming an event is O(1): no path parsing and no split (INV-1)', () => {
    const helper = jest.spyOn(
      WorkspaceChangeCoalescer.prototype as unknown as {
        toRelativeSegments: (path: string) => string[] | undefined;
      },
      'toRelativeSegments',
    );
    const { coalescer, clock } = setup(
      { excludeDirNames: ['node_modules'], excludeGlobs: ['**/*.log'] },
      { stormBreakerOptions: storm },
    );
    for (let i = 0; i < 20; i++) coalescer.push(`/ws/s${i}.ts`, 'delete');
    expect(coalescer.isStorming).toBe(true);
    expect(helper).toHaveBeenCalled();

    helper.mockClear();
    const split = jest.spyOn(String.prototype, 'split');
    try {
      for (let i = 0; i < 10_000; i++) {
        coalescer.push(`/ws/tree/${i}/node_modules/x.ts`, 'delete');
      }
    } finally {
      split.mockRestore();
    }
    const splitCalls = split.mock.calls.length;
    const helperCalls = helper.mock.calls.length;
    helper.mockRestore();

    expect(helperCalls).toBe(0);
    expect(splitCalls).toBe(0);
    clock.advance(60_000);
  });

  it('signalOverflow during a storm yields exactly one overflow for the incident', () => {
    const { coalescer, clock, batches } = setup(
      {},
      { stormBreakerOptions: storm },
    );
    for (let i = 0; i < 20; i++) coalescer.push(`/ws/s${i}.ts`, 'delete');
    expect(coalescer.isStorming).toBe(true);
    coalescer.signalOverflow();
    clock.advance(500);
    coalescer.signalOverflow();
    clock.advance(60_000);

    expect(batches).toHaveLength(1);
    expect(batches[0].batch).toMatchObject({
      overflow: true,
      changes: [],
      droppedCount: 20,
    });
  });

  it('a storm starting while a signalled overflow is pending yields exactly one overflow', () => {
    const { coalescer, clock, batches } = setup(
      {},
      { stormBreakerOptions: storm },
    );
    coalescer.push('/ws/first.ts', 'update');
    clock.advance(HOLD); // first batch; the next flush waits for the cadence
    coalescer.signalOverflow(); // owed, flush timer armed 250 ms out
    for (let i = 0; i < 20; i++) coalescer.push(`/ws/s${i}.ts`, 'delete');
    expect(coalescer.isStorming).toBe(true);
    clock.advance(60_000);

    expect(batches.map((b) => b.batch.overflow)).toEqual([false, true]);
    expect(batches[1].batch.droppedCount).toBe(20);
  });

  it('signalOverflow never emits synchronously', () => {
    const { coalescer, batches, clock } = setup();
    coalescer.signalOverflow();
    expect(batches).toHaveLength(0);
    clock.advance(HOLD);
    expect(batches[0].batch.overflow).toBe(true);
  });
});

describe('WorkspaceChangeCoalescer — dispose and listener failures', () => {
  it('never calls the listener after dispose, including a pending flush and storm exit', () => {
    const { coalescer, clock, batches } = setup(
      {},
      { stormBreakerOptions: { enterEventsPerWindow: 10 } },
    );
    coalescer.push('/ws/a.ts', 'update');
    coalescer.dispose();
    clock.advance(1_000);
    expect(batches).toHaveLength(0);
    expect(clock.pendingTimers).toBe(0);

    const storming = setup(
      {},
      { stormBreakerOptions: { enterEventsPerWindow: 10 } },
    );
    for (let i = 0; i < 50; i++) storming.coalescer.push(`/ws/${i}`, 'delete');
    storming.coalescer.dispose();
    storming.coalescer.dispose(); // idempotent
    storming.coalescer.push('/ws/late.ts', 'update');
    storming.coalescer.signalOverflow();
    storming.clock.advance(120_000);
    expect(storming.batches).toHaveLength(0);
    expect(storming.coalescer.isDisposed).toBe(true);
  });

  it('dispose from inside the listener stops further batches', () => {
    const clock = new FakeClock();
    let calls = 0;
    const coalescer: WorkspaceChangeCoalescer = new WorkspaceChangeCoalescer(
      ROOT,
      baseOptions(),
      () => {
        calls++;
        coalescer.dispose();
      },
      { clock, onListenerError: () => undefined },
    );
    coalescer.push('/ws/a.ts', 'update');
    clock.advance(HOLD);
    coalescer.push('/ws/b.ts', 'update');
    clock.advance(1_000);
    expect(calls).toBe(1);
  });

  it('a throwing listener is reported and the coalescer keeps delivering', () => {
    const clock = new FakeClock();
    const errors: unknown[] = [];
    const seen: string[] = [];
    let first = true;
    const coalescer = new WorkspaceChangeCoalescer(
      ROOT,
      baseOptions(),
      (batch) => {
        seen.push(...batch.changes.map((c) => c.path));
        if (first) {
          first = false;
          throw new Error('consumer bug');
        }
      },
      { clock, onListenerError: (error) => errors.push(error) },
    );
    coalescer.push('/ws/a.ts', 'update');
    clock.advance(HOLD);
    coalescer.push('/ws/b.ts', 'update');
    clock.advance(250);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('consumer bug');
    expect(seen).toEqual(['/ws/a.ts', '/ws/b.ts']);
  });

  it('uses the real timers by default', async () => {
    const batches: WorkspaceChangeBatch[] = [];
    const coalescer = new WorkspaceChangeCoalescer(
      ROOT,
      baseOptions(),
      (batch) => batches.push(batch),
      { onListenerError: () => undefined },
    );
    coalescer.push('/ws/a.ts', 'update');
    expect(batches).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, HOLD + 50));
    expect(batches).toHaveLength(1);
    coalescer.dispose();
  });
});
