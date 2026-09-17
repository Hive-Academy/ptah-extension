import type { WorkspaceChangeCoalescerClock } from '../utils/workspace-change-coalescer';
import {
  CREATED_DIRECTORY_RECONCILER_DEFAULTS,
  CreatedDirectoryReconciler,
  type CreatedDirectoryReconcilerOptions,
  type WorkspaceWatchDirectoryEntry,
} from './created-directory-reconciler';

/** Deterministic clock: timers fire only from `advance`. */
class ManualClock implements WorkspaceChangeCoalescerClock {
  private current = 0;
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
      let due: [number, { at: number; callback: () => void }] | undefined;
      for (const entry of this.timers) {
        if (entry[1].at <= until && (!due || entry[1].at < due[1].at)) {
          due = entry;
        }
      }
      if (!due) break;
      this.timers.delete(due[0]);
      this.current = Math.max(this.current, due[1].at);
      due[1].callback();
    }
    this.current = until;
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const { settleMs, confirmMs } = CREATED_DIRECTORY_RECONCILER_DEFAULTS;

function setup(
  overrides: Partial<CreatedDirectoryReconcilerOptions> = {},
  ignore: readonly string[] = [],
) {
  const clock = new ManualClock();
  const tree = new Map<string, WorkspaceWatchDirectoryEntry[]>();
  const discovered: string[] = [];
  const incomplete: Array<[string, string]> = [];
  const listDirectory = jest.fn(async (dir: string) => {
    const entries = tree.get(dir);
    if (!entries) throw Object.assign(new Error(dir), { code: 'ENOTDIR' });
    return entries;
  });
  const reconciler = new CreatedDirectoryReconciler({
    root: '/ws',
    listDirectory,
    clock,
    nativeIgnore: () => ignore,
    onDiscovered: (path) => discovered.push(path),
    onIncomplete: (reason, detail) => incomplete.push([reason, detail]),
    ...overrides,
  });
  const dir = (name: string) => ({ name, isDirectory: true });
  const file = (name: string) => ({ name, isDirectory: false });
  const settle = async () => {
    clock.advance(settleMs);
    await flush();
  };
  return {
    clock,
    tree,
    discovered,
    incomplete,
    listDirectory,
    reconciler,
    dir,
    file,
    settle,
  };
}

describe('CreatedDirectoryReconciler', () => {
  it('lists every create of a burst in one pass, never the root itself', async () => {
    const h = setup();
    h.tree.set('/ws/a', [h.file('1.txt')]);
    h.tree.set('/ws/b', [h.file('2.txt')]);
    h.reconciler.observe([
      { path: '/ws', type: 'create' },
      { path: '/ws/a', type: 'create' },
    ]);
    h.reconciler.observe([{ path: '/ws/b', type: 'create' }]);
    await h.settle();

    expect(h.listDirectory.mock.calls.map(([d]) => d)).toEqual([
      '/ws/a',
      '/ws/b',
    ]);
    expect(h.discovered).toEqual(['/ws/a/1.txt', '/ws/b/2.txt']);
    expect(h.reconciler.trackedCount).toBe(0);
    expect(h.clock.pendingTimers).toBe(0);
  });

  it('skips children under an absolute native ignore entry and a native glob', async () => {
    const h = setup({}, ['/ws/pkg/nested-repo', '**/dist/**']);
    h.tree.set('/ws/pkg', [
      h.dir('nested-repo'),
      h.dir('dist'),
      h.dir('src'),
      h.file('dist.txt'),
    ]);
    h.reconciler.observe([{ path: '/ws/pkg', type: 'create' }]);
    await h.settle();

    expect(h.discovered).toEqual(['/ws/pkg/src', '/ws/pkg/dist.txt']);
    h.clock.advance(confirmMs);
    expect(h.incomplete).toEqual([
      ['lost-watch', '/ws/pkg/src was created but never reported'],
    ]);
  });

  it('lists an unreported child directory too, so what is under a lost watch is delivered before the rebuild', async () => {
    const h = setup();
    h.tree.set('/ws/other', [h.dir('Node_Modules')]);
    h.tree.set('/ws/other/Node_Modules', [h.file('kept.js'), h.dir('deeper')]);
    h.tree.set('/ws/other/Node_Modules/deeper', [h.file('x')]);
    h.reconciler.observe([{ path: '/ws/other', type: 'create' }]);
    await h.settle();
    await h.settle();
    await h.settle();

    expect(h.discovered).toEqual([
      '/ws/other/Node_Modules',
      '/ws/other/Node_Modules/kept.js',
      '/ws/other/Node_Modules/deeper',
      '/ws/other/Node_Modules/deeper/x',
    ]);
    expect(h.incomplete).toEqual([]);
    h.clock.advance(confirmMs);
    expect(h.incomplete).toEqual([
      ['lost-watch', '/ws/other/Node_Modules was created but never reported'],
    ]);
    expect(h.reconciler.trackedCount).toBe(0);
  });

  it('reports limit-exceeded when discovered child directories, not raw events, fill the tracked set', async () => {
    const h = setup({ maxTrackedPaths: 2 });
    h.tree.set('/ws/a', [h.dir('b'), h.dir('c'), h.dir('d')]);
    h.reconciler.observe([{ path: '/ws/a', type: 'create' }]);
    await h.settle();

    expect(h.discovered).toEqual(['/ws/a/b']);
    expect(h.incomplete).toEqual([
      ['limit-exceeded', 'more than 2 created paths awaiting reconciliation'],
    ]);
    expect(h.reconciler.trackedCount).toBe(0);
    expect(h.clock.pendingTimers).toBe(0);
  });

  it('reports EACCES and EPERM through onUnreadable at most once per interval, and nothing else', async () => {
    const unreadable: Array<[string, string]> = [];
    const h = setup({
      onUnreadable: (path, code) => unreadable.push([path, code]),
    });
    const codes = new Map([
      ['/ws/acc', 'EACCES'],
      ['/ws/perm', 'EPERM'],
      ['/ws/gone', 'ENOENT'],
    ]);
    h.listDirectory.mockImplementation(async (dir: string) => {
      throw Object.assign(new Error(dir), { code: codes.get(dir) });
    });

    h.reconciler.observe([
      { path: '/ws/gone', type: 'create' },
      { path: '/ws/acc', type: 'create' },
      { path: '/ws/perm', type: 'create' },
    ]);
    await h.settle();
    expect(unreadable).toEqual([['/ws/acc', 'EACCES']]);

    h.clock.advance(
      CREATED_DIRECTORY_RECONCILER_DEFAULTS.unreadableReportIntervalMs,
    );
    h.reconciler.observe([{ path: '/ws/perm', type: 'create' }]);
    await h.settle();
    expect(unreadable).toEqual([
      ['/ws/acc', 'EACCES'],
      ['/ws/perm', 'EPERM'],
    ]);
    expect(h.discovered).toEqual([]);
    expect(h.incomplete).toEqual([]);
    expect(h.reconciler.trackedCount).toBe(0);
  });

  it('a delete forgets a tracked directory and everything tracked under it', async () => {
    const h = setup();
    h.reconciler.observe([
      { path: '/ws/a', type: 'create' },
      { path: '/ws/a/b', type: 'create' },
      { path: '/ws/other', type: 'create' },
    ]);
    h.reconciler.observe([{ path: '/ws/a', type: 'delete' }]);
    expect(h.reconciler.trackedCount).toBe(1);
    await h.settle();
    expect(h.listDirectory.mock.calls.map(([d]) => d)).toEqual(['/ws/other']);
  });

  it('a child directory deleted inside the confirm window is not a lost watch', async () => {
    const h = setup();
    h.tree.set('/ws/a', [h.dir('b')]);
    h.reconciler.observe([{ path: '/ws/a', type: 'create' }]);
    await h.settle();
    h.reconciler.observe([{ path: '/ws/a/b', type: 'delete' }]);
    h.clock.advance(confirmMs);
    expect(h.incomplete).toEqual([]);
    expect(h.reconciler.trackedCount).toBe(0);
  });

  it('reports limit-exceeded when one pass reads too many entries, and clears', async () => {
    const h = setup({ maxEntriesPerPass: 3 });
    h.tree.set('/ws/a', [h.file('1'), h.file('2')]);
    h.tree.set('/ws/b', [h.file('3'), h.file('4')]);
    h.reconciler.observe([
      { path: '/ws/a', type: 'create' },
      { path: '/ws/b', type: 'create' },
    ]);
    await h.settle();
    expect(h.incomplete).toEqual([
      ['limit-exceeded', 'more than 3 entries in created directories'],
    ]);
    expect(h.reconciler.trackedCount).toBe(0);
  });

  it('suspend drops tracked work; resume reports whether a create went unreconciled', async () => {
    const h = setup();
    h.reconciler.observe([{ path: '/ws/a', type: 'create' }]);
    h.reconciler.suspend();
    expect(h.reconciler.isSuspended).toBe(true);
    await h.settle();
    expect(h.listDirectory).not.toHaveBeenCalled();
    expect(h.reconciler.resume()).toBe(true);

    h.reconciler.suspend();
    h.reconciler.observe([{ path: '/ws/x', type: 'update' }]);
    expect(h.reconciler.resume()).toBe(false);
    h.reconciler.suspend();
    h.reconciler.observe([{ path: '/ws/y', type: 'create' }]);
    expect(h.reconciler.resume()).toBe(true);
    expect(h.reconciler.resume()).toBe(false);
  });

  it('a suspend during discovery stops the pass mid-directory', async () => {
    const h = setup({
      onDiscovered: (path) => {
        h.discovered.push(path);
        h.reconciler.suspend();
      },
    });
    h.tree.set('/ws/a', [h.file('1'), h.file('2')]);
    h.reconciler.observe([{ path: '/ws/a', type: 'create' }]);
    await h.settle();
    expect(h.discovered).toEqual(['/ws/a/1']);
    expect(h.clock.pendingTimers).toBe(0);
  });

  it('joins children with the directory’s own separator', async () => {
    const h = setup({ root: 'C:\\ws' });
    h.tree.set('C:\\ws\\a', [h.file('f.txt')]);
    h.reconciler.observe([{ path: 'C:\\ws\\a', type: 'create' }]);
    await h.settle();
    expect(h.discovered).toEqual(['C:\\ws\\a\\f.txt']);
  });

  it('dispose stops timers and drops an in-flight listing', async () => {
    const h = setup();
    let resolveListing: (
      entries: WorkspaceWatchDirectoryEntry[],
    ) => void = () => undefined;
    h.listDirectory.mockImplementationOnce(
      () => new Promise((resolve) => (resolveListing = resolve)),
    );
    h.reconciler.observe([
      { path: '/ws/a', type: 'create' },
      { path: '/ws/b', type: 'create' },
    ]);
    h.clock.advance(settleMs);
    h.reconciler.dispose();
    h.reconciler.dispose();
    resolveListing([h.dir('lost')]);
    await flush();
    h.clock.advance(60_000);
    h.reconciler.observe([{ path: '/ws/c', type: 'create' }]);
    expect(h.discovered).toEqual([]);
    expect(h.incomplete).toEqual([]);
    expect(h.clock.pendingTimers).toBe(0);
  });
});
