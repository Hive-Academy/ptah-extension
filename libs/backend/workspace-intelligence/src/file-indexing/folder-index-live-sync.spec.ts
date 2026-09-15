import 'reflect-metadata';

import * as path from 'path';
import { FileType } from '@ptah-extension/platform-core';
import { createMockWorkspaceWatcher } from '@ptah-extension/platform-core/testing';
import type { BackgroundWorkAdmission } from '@ptah-extension/vscode-core';
import {
  FolderIndexLiveSync,
  type FolderBuild,
} from './folder-index-live-sync';
import {
  addFileEntry,
  emptySnapshot,
  type FolderIndex,
  type FolderSnapshot,
} from './folder-index-snapshot';

/**
 * TASK_2026_437 C14 (d): a lost-event rebuild of the `@` file index is
 * background work. It waits for the background-work governor, repeated
 * overflows while it waits still produce one rebuild, queries keep serving the
 * previous snapshot, and a release or a governor shutdown cancels it.
 *
 * The rebuild mechanics without a governor (staging swap, one queued rebuild,
 * failure keeps the snapshot) are pinned through the service facade in
 * `workspace-file-index.service.spec.ts`.
 */

const ROOT = path.join('/', 'workspace');
const abs = (rel: string): string => path.join(ROOT, rel);

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

function abortError(): Error {
  const error = new Error('Background-work governor disposed');
  error.name = 'AbortError';
  return error;
}

interface FakeGovernor extends BackgroundWorkAdmission {
  isClear: jest.Mock<boolean, []>;
  whenClear: jest.Mock;
  setClear(value: boolean): void;
  release(outcome?: 'clear' | 'timeout'): void;
  reject(error: Error): void;
  lastSignal(): AbortSignal | undefined;
}

function makeGovernor(initiallyClear = false): FakeGovernor {
  let clear = initiallyClear;
  let settle:
    | {
        resolve: (outcome: 'clear' | 'timeout') => void;
        reject: (error: Error) => void;
      }
    | undefined;
  let signal: AbortSignal | undefined;
  const whenClear = jest.fn(
    (options: { signal?: AbortSignal } = {}) =>
      new Promise<'clear' | 'timeout'>((resolve, reject) => {
        signal = options.signal;
        settle = { resolve, reject };
        // The real governor rejects a waiter whose signal fires.
        options.signal?.addEventListener('abort', () => reject(abortError()), {
          once: true,
        });
      }),
  );
  return {
    isClear: jest.fn(() => clear),
    whenClear,
    setClear: (value) => {
      clear = value;
    },
    release: (outcome = 'clear') => settle?.resolve(outcome),
    reject: (error) => settle?.reject(error),
    lastSignal: () => signal,
  } as FakeGovernor;
}

function makeEntry(): FolderIndex {
  const entry: FolderIndex = {
    key: ROOT,
    root: ROOT,
    ...emptySnapshot(),
    subscription: undefined,
    buildPromise: Promise.resolve(),
    ready: true,
    generation: 1,
    lastActiveAt: 1,
    rebuildStaging: undefined,
    rebuildQueued: false,
    rebuildDeferral: undefined,
    subscribeRetryAt: undefined,
  };
  addFileEntry(ROOT, abs('src/previous.ts'), entry);
  return entry;
}

function makeHarness(governor: BackgroundWorkAdmission | null) {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const workspaceWatcher = createMockWorkspaceWatcher();
  const fsProvider = {
    stat: jest.fn(async () => ({
      type: FileType.File,
      ctime: 0,
      mtime: 0,
      size: 0,
    })),
  };
  /** Files the next rebuild walk finds. */
  const onDisk = [abs('src/rebuilt.ts')];
  let gate: Promise<void> | undefined;
  const build = jest.fn<ReturnType<FolderBuild>, Parameters<FolderBuild>>(
    async (entry: FolderIndex, _generation: number, into: FolderSnapshot) => {
      if (gate) await gate;
      for (const file of onDisk) addFileEntry(entry.root, file, into);
    },
  );
  const liveSync = new FolderIndexLiveSync({
    logger,
    fsProvider: fsProvider as never,
    workspaceWatcher,
    build,
    governor,
  });
  const entry = makeEntry();
  liveSync.subscribe(entry, entry.generation);
  const watcher = workspaceWatcher.__state.subscriptions[0];
  const names = (): string[] =>
    [...entry.files.values()].map((file) => file.fileName).sort();
  return {
    liveSync,
    entry,
    watcher,
    build,
    logger,
    onDisk,
    names,
    holdBuilds: (): (() => void) => {
      let open!: () => void;
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      return () => {
        gate = undefined;
        open();
      };
    },
  };
}

describe('FolderIndexLiveSync — rebuild governed by background work (C14 d)', () => {
  it('without a governor, an overflow rebuilds at once', async () => {
    const h = makeHarness(null);

    h.watcher.deliver({ overflow: true });
    expect(h.build).toHaveBeenCalledTimes(1);
    await flush();

    expect(h.names()).toEqual(['rebuilt.ts']);
  });

  it('with the governor already clear, rebuilds at once without waiting', async () => {
    const governor = makeGovernor(true);
    const h = makeHarness(governor);

    h.watcher.deliver({ overflow: true });

    expect(h.build).toHaveBeenCalledTimes(1);
    expect(governor.whenClear).not.toHaveBeenCalled();
  });

  it('holds the rebuild while busy, serves the previous snapshot, and coalesces repeated overflows into one rebuild', async () => {
    const governor = makeGovernor(false);
    const h = makeHarness(governor);

    h.watcher.deliver({ overflow: true, droppedCount: 900 });
    h.watcher.deliver({ overflow: true });
    h.watcher.deliver({ truncated: true });
    await flush();

    expect(h.build).not.toHaveBeenCalled();
    expect(governor.whenClear).toHaveBeenCalledTimes(1);
    expect(governor.whenClear).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      lane: 'workspace-file-index-rebuild',
    });
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
    expect(h.logger.info).toHaveBeenCalledWith(
      '[WorkspaceFileIndex] rebuild deferred until background work clears (serving the previous snapshot)',
      { root: ROOT },
    );
    expect(h.names()).toEqual(['previous.ts']);

    // A live batch still patches the served snapshot while the rebuild waits.
    h.watcher.fire('create', abs('src/during-wait.ts'));
    await flush();
    expect(h.names()).toEqual(['during-wait.ts', 'previous.ts']);

    governor.release('clear');
    await flush();

    expect(h.build).toHaveBeenCalledTimes(1);
    expect(h.entry.rebuildDeferral).toBeUndefined();
    expect(h.names()).toEqual(['rebuilt.ts']);
  });

  it('runs the held rebuild when the governor reaches its starvation ceiling', async () => {
    const governor = makeGovernor(false);
    const h = makeHarness(governor);

    h.watcher.deliver({ overflow: true });
    await flush();
    governor.release('timeout');
    await flush();

    expect(h.build).toHaveBeenCalledTimes(1);
    expect(h.names()).toEqual(['rebuilt.ts']);
  });

  it('release() cancels a held rebuild: the signal aborts and no walk ever runs', async () => {
    const governor = makeGovernor(false);
    const h = makeHarness(governor);

    h.watcher.deliver({ overflow: true });
    await flush();
    const signal = governor.lastSignal();
    expect(signal?.aborted).toBe(false);

    h.entry.generation++;
    h.liveSync.release(h.entry);
    await flush();

    expect(signal?.aborted).toBe(true);
    expect(h.entry.rebuildDeferral).toBeUndefined();
    expect(h.build).not.toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it('a governor disposed at shutdown cancels the held rebuild quietly and keeps the previous snapshot; the next overflow asks again', async () => {
    const governor = makeGovernor(false);
    const h = makeHarness(governor);

    h.watcher.deliver({ overflow: true });
    await flush();
    governor.reject(abortError());
    await flush();

    expect(h.build).not.toHaveBeenCalled();
    expect(h.entry.rebuildDeferral).toBeUndefined();
    expect(h.names()).toEqual(['previous.ts']);
    expect(h.logger.error).not.toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
    expect(h.logger.debug).toHaveBeenCalledWith(
      '[WorkspaceFileIndex] deferred rebuild cancelled (keeping the previous snapshot)',
      { root: ROOT, reason: 'Background-work governor disposed' },
    );

    h.watcher.deliver({ overflow: true });
    await flush();
    expect(governor.whenClear).toHaveBeenCalledTimes(2);
  });

  it('the one rebuild queued behind a running rebuild also waits for the governor', async () => {
    const governor = makeGovernor(true);
    const h = makeHarness(governor);
    const openBuild = h.holdBuilds();

    h.watcher.deliver({ overflow: true });
    expect(h.build).toHaveBeenCalledTimes(1);
    h.watcher.deliver({ overflow: true });
    h.watcher.deliver({ overflow: true });
    expect(h.entry.rebuildQueued).toBe(true);

    // The foreground turns busy before the first rebuild finishes.
    governor.setClear(false);
    openBuild();
    await flush();

    expect(h.build).toHaveBeenCalledTimes(1);
    expect(governor.whenClear).toHaveBeenCalledTimes(1);
    expect(h.entry.rebuildDeferral).toBeDefined();

    governor.release('clear');
    await flush();
    expect(h.build).toHaveBeenCalledTimes(2);
    expect(h.entry.rebuildDeferral).toBeUndefined();
  });

  it('a governor rejection that is NOT an abort warns once and rebuilds anyway (fail open)', async () => {
    const governor = makeGovernor(false);
    const h = makeHarness(governor);

    h.watcher.deliver({ overflow: true });
    await flush();
    governor.reject(new Error('governor bug'));
    await flush();

    expect(h.build).toHaveBeenCalledTimes(1);
    expect(h.entry.rebuildDeferral).toBeUndefined();
    expect(h.names()).toEqual(['rebuilt.ts']);
    expect(h.logger.warn).toHaveBeenCalledWith(
      '[WorkspaceFileIndex] background-work wait failed — rebuilding anyway',
      { root: ROOT, reason: 'governor bug' },
    );

    // A second defect is not warned about again, and still rebuilds.
    h.watcher.deliver({ overflow: true });
    await flush();
    governor.reject(new Error('governor bug again'));
    await flush();
    expect(h.build).toHaveBeenCalledTimes(2);
    const failureWarnings = h.logger.warn.mock.calls.filter(([message]) =>
      String(message).includes('background-work wait failed'),
    );
    expect(failureWarnings).toHaveLength(1);
  });

  it('expediteDeferredRebuild starts a held rebuild at once and releases the governor wait', async () => {
    const governor = makeGovernor(false);
    const h = makeHarness(governor);

    h.watcher.deliver({ overflow: true });
    await flush();
    expect(h.build).not.toHaveBeenCalled();
    const signal = governor.lastSignal();

    h.liveSync.expediteDeferredRebuild(h.entry);

    expect(h.build).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true);
    expect(h.entry.rebuildDeferral).toBeUndefined();
    await flush();
    // The aborted wait's rejection starts nothing more.
    expect(h.build).toHaveBeenCalledTimes(1);
    expect(h.names()).toEqual(['rebuilt.ts']);
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('expediteDeferredRebuild is a no-op for a folder with no held rebuild', () => {
    const governor = makeGovernor(false);
    const h = makeHarness(governor);

    h.liveSync.expediteDeferredRebuild(h.entry);

    expect(h.build).not.toHaveBeenCalled();
    expect(governor.whenClear).not.toHaveBeenCalled();
  });
});
