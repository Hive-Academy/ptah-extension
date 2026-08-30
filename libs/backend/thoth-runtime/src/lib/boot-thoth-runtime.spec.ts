import type { DependencyContainer } from 'tsyringe';

import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { MEMORY_TOKENS } from '@ptah-extension/memory-curator';
import { SKILL_SYNTHESIS_TOKENS } from '@ptah-extension/skill-synthesis';
import { CODE_SYMBOL_INDEXER } from '@ptah-extension/workspace-intelligence';
import { IndexingRpcHandlers } from '@ptah-extension/rpc-handlers';

import { bootThothRuntime } from './boot-thoth-runtime';
import { resetVecLoadDiagnosticForTest } from './diagnostics';

type Entry = readonly [unknown, unknown];

function makeContainer(entries: Entry[]): DependencyContainer {
  const map = new Map<unknown, unknown>(entries);
  return {
    isRegistered: (token: unknown) => map.has(token),
    resolve: (token: unknown) => {
      if (!map.has(token)) {
        throw new Error(`not registered: ${String(token)}`);
      }
      return map.get(token);
    },
  } as unknown as DependencyContainer;
}

function makeVecDiagnostic(ok = true) {
  return {
    ok,
    reason: ok ? 'loaded' : 'load-failed',
    electronVersion: '40.0.0',
    processArch: 'x64',
    processPlatform: 'win32',
    errorChain: [],
  };
}

function makeSqlite(overrides: Record<string, unknown> = {}) {
  return {
    isOpen: true,
    db: { pragma: jest.fn() },
    openAndMigrate: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
    vecLoadDiagnostic: makeVecDiagnostic(),
    ...overrides,
  };
}

function makeWebviewManager() {
  return { broadcastMessage: jest.fn().mockResolvedValue(undefined) };
}

/**
 * Let the deferred starts settle.
 *
 * Since TASK_2026_331 B1.T4 the memory-enabled lookup and the skill-synthesis
 * start are STARTED rather than awaited, so `await bootThothRuntime(...)` no
 * longer implies they have run. A handful of microtask turns is enough for the
 * immediately-resolving stubs these specs use — real work is naturally still
 * in flight, which is the point of the change.
 */
async function flushDeferredStarts(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

describe('bootThothRuntime', () => {
  beforeEach(() => {
    resetVecLoadDiagnosticForTest();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens + migrates SQLite and captures the connection ref', async () => {
    const sqlite = makeSqlite();
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, sqlite],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);

    const refs = await bootThothRuntime(container, {
      workspaceRoot: '/ws',
    });

    expect(sqlite.openAndMigrate).toHaveBeenCalledTimes(1);
    expect(refs.sqliteConnection).toBe(sqlite);
  });

  it('degrades to a null SQLite ref when openAndMigrate throws, without rejecting', async () => {
    const sqlite = makeSqlite({
      openAndMigrate: jest
        .fn()
        .mockRejectedValue(new Error('NODE_MODULE_VERSION mismatch')),
    });
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, sqlite],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);

    const refs = await bootThothRuntime(container, { workspaceRoot: '/ws' });

    expect(refs.sqliteConnection).toBeNull();
    expect(refs.memoryCurator).toBeNull();
    expect(refs.memoryTrigger).toBeNull();
  });

  it('starts the memory curator then the memory trigger when indexing control allows it', async () => {
    const memoryCurator = { start: jest.fn(), onEvent: jest.fn() };
    const memoryTrigger = { start: jest.fn() };
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, makeSqlite()],
      [MEMORY_TOKENS.MEMORY_CURATOR, memoryCurator],
      [
        MEMORY_TOKENS.INDEXING_CONTROL,
        { getStatus: jest.fn().mockResolvedValue({ memoryEnabled: true }) },
      ],
      [MEMORY_TOKENS.MEMORY_TRIGGER_SERVICE, memoryTrigger],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);

    const refs = await bootThothRuntime(container, { workspaceRoot: '/ws' });
    await flushDeferredStarts();

    expect(memoryCurator.start).toHaveBeenCalledTimes(1);
    expect(memoryTrigger.start).toHaveBeenCalledTimes(1);
    expect(refs.memoryCurator).toBe(memoryCurator);
    expect(refs.memoryTrigger).toBe(memoryTrigger);
  });

  it('starts the memory curator without consulting indexing control when no workspace is open', async () => {
    const memoryCurator = { start: jest.fn(), onEvent: jest.fn() };
    const getStatus = jest.fn();
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, makeSqlite()],
      [MEMORY_TOKENS.MEMORY_CURATOR, memoryCurator],
      [MEMORY_TOKENS.INDEXING_CONTROL, { getStatus }],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);

    await bootThothRuntime(container, { workspaceRoot: undefined });
    await flushDeferredStarts();

    expect(memoryCurator.start).toHaveBeenCalledTimes(1);
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('does not start the memory curator when memoryEnabled is false', async () => {
    const memoryCurator = { start: jest.fn(), onEvent: jest.fn() };
    const memoryTrigger = { start: jest.fn() };
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, makeSqlite()],
      [MEMORY_TOKENS.MEMORY_CURATOR, memoryCurator],
      [
        MEMORY_TOKENS.INDEXING_CONTROL,
        { getStatus: jest.fn().mockResolvedValue({ memoryEnabled: false }) },
      ],
      [MEMORY_TOKENS.MEMORY_TRIGGER_SERVICE, memoryTrigger],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);

    await bootThothRuntime(container, { workspaceRoot: '/ws' });
    await flushDeferredStarts();

    expect(memoryCurator.start).not.toHaveBeenCalled();
    // The trigger is gated on the curator ref, which is still captured.
    expect(memoryTrigger.start).toHaveBeenCalledTimes(1);
  });

  it('broadcasts MEMORY_EXTRACTED only for curator runs that created memories', async () => {
    const webviewManager = makeWebviewManager();
    let onEventCb: ((ev: Record<string, unknown>) => void) | null = null;
    const memoryCurator = {
      start: jest.fn(),
      onEvent: jest.fn((cb: (ev: Record<string, unknown>) => void) => {
        onEventCb = cb;
      }),
    };
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, makeSqlite()],
      [MEMORY_TOKENS.MEMORY_CURATOR, memoryCurator],
      [TOKENS.WEBVIEW_MANAGER, webviewManager],
    ]);

    await bootThothRuntime(container, { workspaceRoot: '/ws' });

    expect(onEventCb).not.toBeNull();
    const emit = onEventCb as unknown as (ev: Record<string, unknown>) => void;

    emit({ kind: 'curator-run', stats: { created: 0 }, timestamp: 1 });
    expect(webviewManager.broadcastMessage).not.toHaveBeenCalled();

    emit({
      kind: 'curator-run',
      sessionId: 's1',
      stats: { created: 2, extracted: 5, merged: 1 },
      timestamp: 42,
    });
    expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
      MESSAGE_TYPES.MEMORY_EXTRACTED,
      {
        sessionId: 's1',
        workspaceRoot: null,
        extracted: 5,
        created: 2,
        merged: 1,
        timestamp: 42,
      },
    );
  });

  // TASK_2026_296 item 1 — `CuratorEvent.sessionId` is optional at the source
  // (`diagnostics.types.ts`), so the bridge used to invent `''` to satisfy a
  // required wire field. The field is now optional; an absent id must stay
  // absent rather than becoming a string nobody can resolve.
  it('broadcasts an absent sessionId as undefined, never as an empty string', async () => {
    const webviewManager = makeWebviewManager();
    let onEventCb: ((ev: Record<string, unknown>) => void) | null = null;
    const memoryCurator = {
      start: jest.fn(),
      onEvent: jest.fn((cb: (ev: Record<string, unknown>) => void) => {
        onEventCb = cb;
      }),
    };
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, makeSqlite()],
      [MEMORY_TOKENS.MEMORY_CURATOR, memoryCurator],
      [TOKENS.WEBVIEW_MANAGER, webviewManager],
    ]);

    await bootThothRuntime(container, { workspaceRoot: '/ws' });

    const emit = onEventCb as unknown as (ev: Record<string, unknown>) => void;
    emit({
      kind: 'curator-run',
      stats: { created: 1, extracted: 3, merged: 0 },
      timestamp: 7,
    });

    expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
      MESSAGE_TYPES.MEMORY_EXTRACTED,
      {
        sessionId: undefined,
        workspaceRoot: null,
        extracted: 3,
        created: 1,
        merged: 0,
        timestamp: 7,
      },
    );
    const payload = webviewManager.broadcastMessage.mock.calls[0][1] as {
      sessionId?: string;
    };
    expect(payload.sessionId).not.toBe('');
  });

  it('collects vec + embedder status bridge disposables', async () => {
    const vecDispose = jest.fn();
    const embedderDispose = jest.fn();
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, makeSqlite()],
      [
        PERSISTENCE_TOKENS.VEC_STATUS,
        { on: jest.fn(() => ({ dispose: vecDispose })) },
      ],
      [
        MEMORY_TOKENS.EMBEDDER_STATUS,
        { on: jest.fn(() => ({ dispose: embedderDispose })) },
      ],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);

    const refs = await bootThothRuntime(container, { workspaceRoot: '/ws' });

    expect(refs.statusBridgeDisposables).toHaveLength(2);
    refs.statusBridgeDisposables?.forEach((d) => d.dispose());
    expect(vecDispose).toHaveBeenCalledTimes(1);
    expect(embedderDispose).toHaveBeenCalledTimes(1);
  });

  it('starts skill synthesis then the skill trigger', async () => {
    const skillSynthesis = { start: jest.fn().mockResolvedValue(undefined) };
    const skillTrigger = { start: jest.fn() };
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, makeSqlite()],
      [SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE, skillSynthesis],
      [SKILL_SYNTHESIS_TOKENS.SKILL_TRIGGER_SERVICE, skillTrigger],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);

    const refs = await bootThothRuntime(container, { workspaceRoot: '/ws' });
    await flushDeferredStarts();

    expect(skillSynthesis.start).toHaveBeenCalledTimes(1);
    expect(skillTrigger.start).toHaveBeenCalledTimes(1);
    expect(refs.skillSynthesis).toBe(skillSynthesis);
    expect(refs.skillTrigger).toBe(skillTrigger);
  });

  it('leaves the skill trigger unstarted when skill synthesis fails to start', async () => {
    const skillTrigger = { start: jest.fn() };
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, makeSqlite()],
      [
        SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE,
        { start: jest.fn().mockRejectedValue(new Error('boom')) },
      ],
      [SKILL_SYNTHESIS_TOKENS.SKILL_TRIGGER_SERVICE, skillTrigger],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);

    const refs = await bootThothRuntime(container, { workspaceRoot: '/ws' });
    await flushDeferredStarts();

    expect(refs.skillSynthesis).toBeNull();
    expect(refs.skillTrigger).toBeNull();
    expect(skillTrigger.start).not.toHaveBeenCalled();
  });

  it('injects symbol run-deps into IndexingRpcHandlers and broadcasts indexing progress', async () => {
    const webviewManager = makeWebviewManager();
    const symbolIndexer = {
      indexWorkspace: jest.fn(
        async (
          _root: string,
          opts: { onProgress: (p: unknown) => void },
        ): Promise<void> => {
          opts.onProgress({ filesScanned: 5, totalFiles: 10 });
        },
      ),
    };
    const setRunDeps = jest.fn();
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, makeSqlite()],
      [CODE_SYMBOL_INDEXER, symbolIndexer],
      [IndexingRpcHandlers, { setRunDeps }],
      [TOKENS.WEBVIEW_MANAGER, webviewManager],
    ]);

    await bootThothRuntime(container, { workspaceRoot: '/ws' });

    expect(setRunDeps).toHaveBeenCalledTimes(1);
    const runDeps = setRunDeps.mock.calls[0][0] as {
      runSymbols: (root: string) => Promise<void>;
    };
    await runDeps.runSymbols('/ws');

    expect(symbolIndexer.indexWorkspace).toHaveBeenCalledTimes(1);
    expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
      MESSAGE_TYPES.INDEXING_PROGRESS,
      expect.objectContaining({
        pipeline: 'symbols',
        percent: 50,
        currentLabel: '5/10 files',
        totalKnown: true,
      }),
    );
  });

  it('swallows AbortError from the symbol indexer but rethrows other failures', async () => {
    const setRunDeps = jest.fn();
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    const symbolIndexer = {
      indexWorkspace: jest
        .fn()
        .mockRejectedValueOnce(abortError)
        .mockRejectedValueOnce(new Error('real failure')),
    };
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, makeSqlite()],
      [CODE_SYMBOL_INDEXER, symbolIndexer],
      [IndexingRpcHandlers, { setRunDeps }],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);

    await bootThothRuntime(container, { workspaceRoot: '/ws' });
    const runDeps = setRunDeps.mock.calls[0][0] as {
      runSymbols: (root: string) => Promise<void>;
    };

    await expect(runDeps.runSymbols('/ws')).resolves.toBeUndefined();
    await expect(runDeps.runSymbols('/ws')).rejects.toThrow('real failure');
  });

  it('does not wire the symbol indexer when the connection is closed', async () => {
    const setRunDeps = jest.fn();
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, makeSqlite({ isOpen: false })],
      [CODE_SYMBOL_INDEXER, { indexWorkspace: jest.fn() }],
      [IndexingRpcHandlers, { setRunDeps }],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);

    await bootThothRuntime(container, { workspaceRoot: '/ws' });

    expect(setRunDeps).not.toHaveBeenCalled();
  });

  it('starts the workspace file index for the active workspace root', async () => {
    const fileIndex = { start: jest.fn().mockResolvedValue(undefined) };
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, makeSqlite()],
      [TOKENS.WORKSPACE_FILE_INDEX_SERVICE, fileIndex],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);

    await bootThothRuntime(container, { workspaceRoot: '/ws' });

    expect(fileIndex.start).toHaveBeenCalledWith('/ws');
  });

  it('skips the workspace file index when no workspace is open', async () => {
    const fileIndex = { start: jest.fn().mockResolvedValue(undefined) };
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, makeSqlite()],
      [TOKENS.WORKSPACE_FILE_INDEX_SERVICE, fileIndex],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);

    await bootThothRuntime(container, { workspaceRoot: undefined });

    expect(fileIndex.start).not.toHaveBeenCalled();
  });

  it('returns an all-null refs object when nothing is registered', async () => {
    // With no WEBVIEW_MANAGER the status-bridge block throws before it can
    // assign an (empty) disposables array, so the ref stays null — the host's
    // teardown chain must tolerate that.
    const refs = await bootThothRuntime(makeContainer([]), {
      workspaceRoot: '/ws',
    });

    expect(refs).toEqual({
      sqliteConnection: null,
      memoryCurator: null,
      memoryTrigger: null,
      skillSynthesis: null,
      skillTrigger: null,
      cronScheduler: null,
      symbolWatcher: null,
      statusBridgeDisposables: null,
    });
  });

  // -------------------------------------------------------------------------
  // TASK_2026_331 B1.T4 — what the boot awaits, and what it merely starts.
  // -------------------------------------------------------------------------

  it('resolves while a slow skill-synthesis start is still pending', async () => {
    let releaseStart!: () => void;
    const skillSynthesis = {
      start: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseStart = resolve;
          }),
      ),
    };
    const skillTrigger = { start: jest.fn() };
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, makeSqlite()],
      [SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE, skillSynthesis],
      [SKILL_SYNTHESIS_TOKENS.SKILL_TRIGGER_SERVICE, skillTrigger],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);

    const refs = await bootThothRuntime(container, { workspaceRoot: '/ws' });

    // The boot is DONE while the scan behind it has not even resolved.
    expect(skillSynthesis.start).toHaveBeenCalledTimes(1);
    expect(skillTrigger.start).not.toHaveBeenCalled();
    expect(refs.skillSynthesis).toBe(skillSynthesis);

    releaseStart();
    await flushDeferredStarts();
    expect(skillTrigger.start).toHaveBeenCalledTimes(1);
  });

  it('resolves while the memoryEnabled probe is still pending', async () => {
    let releaseStatus!: (v: { memoryEnabled: boolean }) => void;
    const memoryCurator = { start: jest.fn(), onEvent: jest.fn() };
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, makeSqlite()],
      [MEMORY_TOKENS.MEMORY_CURATOR, memoryCurator],
      [
        MEMORY_TOKENS.INDEXING_CONTROL,
        {
          getStatus: jest.fn(
            () =>
              new Promise((resolve) => {
                releaseStatus = resolve as (v: {
                  memoryEnabled: boolean;
                }) => void;
              }),
          ),
        },
      ],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);

    await bootThothRuntime(container, { workspaceRoot: '/ws' });
    expect(memoryCurator.start).not.toHaveBeenCalled();

    releaseStatus({ memoryEnabled: true });
    await flushDeferredStarts();
    expect(memoryCurator.start).toHaveBeenCalledTimes(1);
  });

  it('opens + migrates SQLite BEFORE any of the deferred starts is called', async () => {
    const order: string[] = [];
    const sqlite = makeSqlite({
      openAndMigrate: jest.fn(async () => {
        await Promise.resolve();
        order.push('openAndMigrate');
      }),
    });
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, sqlite],
      [
        MEMORY_TOKENS.MEMORY_CURATOR,
        {
          start: jest.fn(() => {
            order.push('memoryCurator.start');
          }),
          onEvent: jest.fn(),
        },
      ],
      [
        MEMORY_TOKENS.MEMORY_TRIGGER_SERVICE,
        {
          start: jest.fn(() => {
            order.push('memoryTrigger.start');
          }),
        },
      ],
      [
        SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE,
        {
          start: jest.fn(async () => {
            order.push('skillSynthesis.start');
          }),
        },
      ],
      [
        TOKENS.WORKSPACE_FILE_INDEX_SERVICE,
        {
          start: jest.fn(async () => {
            order.push('fileIndex.start');
          }),
        },
      ],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);

    await bootThothRuntime(container, { workspaceRoot: '/ws' });
    await flushDeferredStarts();

    expect(order[0]).toBe('openAndMigrate');
    expect(order).toContain('memoryTrigger.start');
    expect(order).toContain('skillSynthesis.start');
    expect(order).toContain('fileIndex.start');
  });

  it('skips every scan when the signal is already aborted', async () => {
    const sqlite = makeSqlite();
    const memoryCurator = { start: jest.fn(), onEvent: jest.fn() };
    const memoryTrigger = { start: jest.fn() };
    const skillSynthesis = { start: jest.fn().mockResolvedValue(undefined) };
    const fileIndex = { start: jest.fn().mockResolvedValue(undefined) };
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, sqlite],
      [MEMORY_TOKENS.MEMORY_CURATOR, memoryCurator],
      [MEMORY_TOKENS.MEMORY_TRIGGER_SERVICE, memoryTrigger],
      [SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE, skillSynthesis],
      [TOKENS.WORKSPACE_FILE_INDEX_SERVICE, fileIndex],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);
    const controller = new AbortController();
    controller.abort();

    const refs = await bootThothRuntime(container, {
      workspaceRoot: '/ws',
      signal: controller.signal,
    });
    await flushDeferredStarts();

    expect(sqlite.openAndMigrate).not.toHaveBeenCalled();
    expect(memoryCurator.start).not.toHaveBeenCalled();
    expect(memoryTrigger.start).not.toHaveBeenCalled();
    expect(skillSynthesis.start).not.toHaveBeenCalled();
    expect(fileIndex.start).not.toHaveBeenCalled();
    expect(refs.sqliteConnection).toBeNull();
  });

  it('stops after SQLite when the signal fires during openAndMigrate', async () => {
    // The quit-during-boot case: the connection ref is still returned so the
    // host's LIFO chain can close it, but nothing else is started.
    const controller = new AbortController();
    const sqlite = makeSqlite({
      openAndMigrate: jest.fn(async () => {
        controller.abort();
      }),
    });
    const memoryTrigger = { start: jest.fn() };
    const skillSynthesis = { start: jest.fn().mockResolvedValue(undefined) };
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, sqlite],
      [MEMORY_TOKENS.MEMORY_CURATOR, { start: jest.fn(), onEvent: jest.fn() }],
      [MEMORY_TOKENS.MEMORY_TRIGGER_SERVICE, memoryTrigger],
      [SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE, skillSynthesis],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);

    const refs = await bootThothRuntime(container, {
      workspaceRoot: '/ws',
      signal: controller.signal,
    });
    await flushDeferredStarts();

    expect(sqlite.openAndMigrate).toHaveBeenCalledTimes(1);
    expect(refs.sqliteConnection).toBe(sqlite);
    expect(memoryTrigger.start).not.toHaveBeenCalled();
    expect(skillSynthesis.start).not.toHaveBeenCalled();
  });

  it('uses the host-supplied log prefix verbatim', async () => {
    const logSpy = jest.spyOn(console, 'log');
    const container = makeContainer([
      [PERSISTENCE_TOKENS.SQLITE_CONNECTION, makeSqlite()],
      [TOKENS.WEBVIEW_MANAGER, makeWebviewManager()],
    ]);

    await bootThothRuntime(container, {
      workspaceRoot: '/ws',
      logPrefix: '[Ptah Electron]',
    });

    expect(logSpy).toHaveBeenCalledWith(
      '[Ptah Electron] Resolving SQLite connection service...',
    );
    expect(logSpy).toHaveBeenCalledWith(
      '[Ptah Electron] SQLite connection opened + migrated successfully',
    );
  });
});
