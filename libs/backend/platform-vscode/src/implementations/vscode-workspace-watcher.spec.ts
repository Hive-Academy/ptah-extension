/**
 * `VscodeWorkspaceWatcher` (TASK_2026_437 C9).
 *
 * `vscode.workspace.createFileSystemWatcher` is replaced by a small bus of
 * watcher doubles that honour their `RelativePattern` base and their
 * `dispose`, so the shared `runWorkspaceWatcherContract` drives the real
 * adapter and the real `WorkspaceChangeCoalescer` on real timers. The contract's
 * loss-of-events case is an event storm: VS Code's watcher reports no errors
 * once created, so a storm is the loss this adapter meets in the field. A
 * failed `createFileSystemWatcher` is covered on a manual clock below.
 */
import * as vscode from 'vscode';
import type {
  WorkspaceChangeBatch,
  WorkspaceChangeCoalescerClock,
  WorkspaceWatchOptions,
  WorkspaceWatcherDiagnostic,
} from '@ptah-extension/platform-core';
import { runWorkspaceWatcherContract } from '@ptah-extension/platform-core/testing';

import { VscodeWorkspaceWatcher } from './vscode-workspace-watcher';

type UriListener = (uri: { fsPath: string }) => void;

interface WatcherDouble {
  readonly base: string;
  readonly pattern: string;
  readonly listeners: Record<'create' | 'change' | 'delete', Set<UriListener>>;
  disposed: boolean;
}

const watchers: WatcherDouble[] = [];
const createFileSystemWatcher = vscode.workspace
  .createFileSystemWatcher as unknown as jest.Mock;
/** The stateful double's seed helpers (`__mocks__/vscode.ts`). */
const vscodeState = (
  vscode as unknown as {
    __vscodeState: { setWorkspaceFolders(paths: string[]): void };
  }
).__vscodeState;

function installWatcherBus(): void {
  createFileSystemWatcher.mockImplementation(
    (pattern: { base: string; pattern: string }) => {
      const double: WatcherDouble = {
        base: pattern.base,
        pattern: pattern.pattern,
        listeners: { create: new Set(), change: new Set(), delete: new Set() },
        disposed: false,
      };
      watchers.push(double);
      const subscribe = (kind: keyof WatcherDouble['listeners']) =>
        jest.fn((listener: UriListener) => {
          double.listeners[kind].add(listener);
          return { dispose: () => double.listeners[kind].delete(listener) };
        });
      return {
        onDidCreate: subscribe('create'),
        onDidChange: subscribe('change'),
        onDidDelete: subscribe('delete'),
        dispose: jest.fn(() => {
          double.disposed = true;
        }),
      };
    },
  );
}

/** What VS Code's watcher would report for `file` to every live watcher over it. */
function fire(kind: 'create' | 'change' | 'delete', file: string): void {
  for (const double of watchers) {
    if (double.disposed || !file.startsWith(`${double.base}/`)) continue;
    for (const listener of [...double.listeners[kind]]) {
      listener({ fsPath: file });
    }
  }
}

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

beforeEach(() => {
  watchers.length = 0;
  createFileSystemWatcher.mockClear();
  installWatcherBus();
  // Every root below sits inside this folder unless a test says otherwise.
  vscodeState.setWorkspaceFolders(['/']);
});

afterAll(() => {
  createFileSystemWatcher.mockReset();
});

describe('VscodeWorkspaceWatcher', () => {
  const ROOT = '/repo';

  it('watches the whole root through a RelativePattern and maps each event kind', () => {
    const clock = new ManualClock();
    const watcher = new VscodeWorkspaceWatcher({ clock });
    const batches: WorkspaceChangeBatch[] = [];
    watcher.watch(ROOT, options(), (batch) => batches.push(batch));

    expect(createFileSystemWatcher).toHaveBeenCalledTimes(1);
    const [pattern] = createFileSystemWatcher.mock.calls[0];
    expect(pattern).toBeInstanceOf(vscode.RelativePattern);
    expect(watchers[0]).toMatchObject({ base: ROOT, pattern: '**/*' });

    fire('create', '/repo/a.ts');
    fire('change', '/repo/b.ts');
    fire('delete', '/repo/c.ts');
    expect(batches).toHaveLength(0);
    clock.advance(250);

    expect(batches).toEqual([
      {
        root: ROOT,
        changes: [
          { path: '/repo/a.ts', kind: 'create' },
          { path: '/repo/b.ts', kind: 'update' },
          { path: '/repo/c.ts', kind: 'delete' },
        ],
        truncated: false,
        overflow: false,
        droppedCount: 0,
      },
    ]);
    watcher.dispose();
  });

  it('disposing a subscription releases its watcher, listeners and timers', () => {
    const clock = new ManualClock();
    const watcher = new VscodeWorkspaceWatcher({ clock });
    const batches: WorkspaceChangeBatch[] = [];
    const subscription = watcher.watch(ROOT, options(), (b) => batches.push(b));

    fire('create', '/repo/pending.ts');
    subscription.dispose();
    subscription.dispose();
    clock.advance(1_000);

    expect(watchers[0].disposed).toBe(true);
    expect(
      Object.values(watchers[0].listeners).every((set) => set.size === 0),
    ).toBe(true);
    expect(clock.pendingTimers).toBe(0);
    expect(batches).toEqual([]);
  });

  it('dispose() ends every subscription, and a later watch is inert', () => {
    const clock = new ManualClock();
    const watcher = new VscodeWorkspaceWatcher({ clock });
    watcher.watch(ROOT, options(), () => undefined);
    watcher.watch('/other', options(), () => undefined);

    watcher.dispose();
    watcher.dispose();
    expect(watchers.map((w) => w.disposed)).toEqual([true, true]);

    const late = watcher.watch(ROOT, options(), () => undefined);
    expect(createFileSystemWatcher).toHaveBeenCalledTimes(2);
    expect(() => late.dispose()).not.toThrow();
  });

  it('a failed create emits overflow now and on every 60 s retry, then one overflow on recovery', () => {
    const clock = new ManualClock();
    const diagnostics: WorkspaceWatcherDiagnostic[] = [];
    const watcher = new VscodeWorkspaceWatcher({
      clock,
      onDiagnostic: (d) => diagnostics.push(d),
    });
    createFileSystemWatcher.mockImplementationOnce(() => {
      throw new Error('watcher limit');
    });
    createFileSystemWatcher.mockImplementationOnce(() => {
      throw new Error('watcher limit');
    });
    const batches: WorkspaceChangeBatch[] = [];
    watcher.watch(ROOT, options(), (b) => batches.push(b));

    expect(batches).toHaveLength(0);
    clock.advance(250);
    expect(batches.map((b) => b.overflow)).toEqual([true]);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        level: 'error',
        message: '[WorkspaceWatcher] file system watcher could not be created',
      }),
    ]);

    clock.advance(60_000);
    expect(batches.map((b) => b.overflow)).toEqual([true, true]);
    expect(diagnostics).toHaveLength(1);

    clock.advance(60_000);
    expect(batches.map((b) => b.overflow)).toEqual([true, true, true]);
    expect(createFileSystemWatcher).toHaveBeenCalledTimes(3);
    expect(diagnostics[1]).toMatchObject({
      level: 'info',
      message: '[WorkspaceWatcher] file system watcher recovered',
    });

    fire('create', '/repo/after.ts');
    clock.advance(250);
    expect(batches[3]).toMatchObject({
      overflow: false,
      changes: [{ path: '/repo/after.ts', kind: 'create' }],
    });
    watcher.dispose();
    expect(clock.pendingTimers).toBe(0);
  });

  it('disposing during a retry cancels it', () => {
    const clock = new ManualClock();
    const watcher = new VscodeWorkspaceWatcher({ clock });
    createFileSystemWatcher.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const subscription = watcher.watch(ROOT, options(), () => undefined);
    subscription.dispose();
    clock.advance(120_000);
    expect(createFileSystemWatcher).toHaveBeenCalledTimes(1);
    expect(clock.pendingTimers).toBe(0);
  });

  it('warns once per root outside every workspace folder, and still watches it', () => {
    vscodeState.setWorkspaceFolders(['/workspace']);
    const clock = new ManualClock();
    const diagnostics: WorkspaceWatcherDiagnostic[] = [];
    const watcher = new VscodeWorkspaceWatcher({
      clock,
      onDiagnostic: (d) => diagnostics.push(d),
    });
    const batches: WorkspaceChangeBatch[] = [];

    watcher.watch('/workspace/pkg', options(), () => undefined);
    watcher.watch('/external', options(), (b) => batches.push(b));
    watcher.watch('/external', options(), () => undefined);
    watcher.watch('/elsewhere', options(), () => undefined);

    const warnings = diagnostics.filter((d) => d.level === 'warn');
    expect(warnings.map((d) => d.detail?.['root'])).toEqual([
      '/external',
      '/elsewhere',
    ]);
    expect(warnings[0].message).toContain(
      'outside every workspace folder; recursive watching may be partial',
    );
    expect(createFileSystemWatcher).toHaveBeenCalledTimes(4);

    fire('create', '/external/a.ts');
    clock.advance(250);
    expect(batches).toEqual([
      expect.objectContaining({
        overflow: false,
        changes: [{ path: '/external/a.ts', kind: 'create' }],
      }),
    ]);
    watcher.dispose();
  });

  it('with no workspace folder open, every root gets the warning', () => {
    vscodeState.setWorkspaceFolders([]);
    const diagnostics: WorkspaceWatcherDiagnostic[] = [];
    const watcher = new VscodeWorkspaceWatcher({
      clock: new ManualClock(),
      onDiagnostic: (d) => diagnostics.push(d),
    });
    watcher.watch(ROOT, options(), () => undefined);
    expect(diagnostics).toEqual([
      expect.objectContaining({ level: 'warn', detail: { root: ROOT } }),
    ]);
    watcher.dispose();
  });

  it('a throwing listener is reported, and a throwing log sink is contained', () => {
    const clock = new ManualClock();
    const watcher = new VscodeWorkspaceWatcher({
      clock,
      onDiagnostic: () => {
        throw new Error('sink down');
      },
    });
    watcher.watch(ROOT, options(), () => {
      throw new Error('listener down');
    });
    fire('create', '/repo/a.ts');
    expect(() => clock.advance(250)).not.toThrow();
    watcher.dispose();
  });
});

let rootCounter = 0;
const existing = new Set<string>();

runWorkspaceWatcherContract(
  'VscodeWorkspaceWatcher (FileSystemWatcher double)',
  {
    createWatcher: () => new VscodeWorkspaceWatcher(),
    createRoot: () => `/contract-root-${++rootCounter}`,
    writeFile: (file) => {
      fire(existing.has(file) ? 'change' : 'create', file);
      existing.add(file);
    },
    deleteFile: (file) => {
      existing.delete(file);
      fire('delete', file);
    },
    // One burst past the storm breaker's entry rate: the adapter suppresses
    // per-event work and owes the subscriber one rescan when the storm ends.
    triggerOverflow: (_watcher, root) => {
      for (let i = 0; i < 1_000; i++) fire('create', `${root}/storm/file-${i}`);
    },
  },
  () => {
    existing.clear();
  },
);
