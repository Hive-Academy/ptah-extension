/**
 * EditorWorkspaceHelper specs — tree-merge logic + file-tree push event
 * watcher (TASK file-explorer-auto-refresh).
 *
 * Coverage:
 *   - mergeLoadedSubtrees: preserves loaded children for needsLoad nodes
 *   - mergeLoadedSubtrees: drops deleted directories
 *   - mergeLoadedSubtrees: recurses into preserved subtree (multi-level)
 *   - mergeLoadedSubtrees: handles file ↔ directory type change
 *   - mergeLoadedSubtrees: returns new tree unchanged for empty previous
 *   - mergeLoadedSubtrees: path normalization (\\ vs /)
 *   - push handling: registers no raw window listener (C1 AC1)
 *   - onFileTreeChanged: debounces tree refresh (500ms, unchanged)
 *   - onFileContentChanged: forwards the routed path
 *   - onRereadOpenTabs: debounces at 250ms (unchanged) and skips dirty tabs
 *   - start/stopFileTreeWatcher: gate semantics + no timer pending (C1 AC3)
 *   - loadFileTree: stale-response protection (concurrent calls)
 *
 * Post-C1 the helper no longer owns a `window.addEventListener`. Dispatch is
 * owned by `MessageRouterService` and delegated here by `EditorService`; the
 * message-shape guard (`data.payload.filePath`, not `data.data.filePath`)
 * moved with it and is asserted in `editor.service.spec.ts`.
 *
 * `rpcCall` is mocked at the module boundary so we can drive arbitrary
 * tree shapes from RPC responses without an actual webview bridge.
 */

import { signal } from '@angular/core';
import { EditorWorkspaceHelper } from './editor-workspace';
import type {
  EditorInternalState,
  EditorWorkspaceState,
} from './editor-internal-state';
import type { FileTreeNode } from '../../models/file-tree.model';

// ----------------------------------------------------------------------------
// Mock @ptah-extension/core's rpcCall — controlled per test via mockRpcCall.
// ----------------------------------------------------------------------------
const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => ({
  rpcCall: (...args: unknown[]) => mockRpcCall(...args),
}));

// ----------------------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------------------
function makeNode(
  partial: Partial<FileTreeNode> & {
    name: string;
    path: string;
    type: 'file' | 'directory';
  },
): FileTreeNode {
  return {
    name: partial.name,
    path: partial.path,
    type: partial.type,
    children: partial.children,
    needsLoad: partial.needsLoad,
    expanded: partial.expanded,
  };
}

function makeState(): {
  state: EditorInternalState;
  fileTree: ReturnType<typeof signal<FileTreeNode[]>>;
  isLoading: ReturnType<typeof signal<boolean>>;
  showError: jest.Mock;
  clearError: jest.Mock;
  workspaceMap: Map<string, EditorWorkspaceState>;
  active: { path: string | null };
} {
  const fileTree = signal<FileTreeNode[]>([]);
  const isLoading = signal<boolean>(false);
  const activeFilePath = signal<string | undefined>(undefined);
  const activeFileContent = signal<string>('');
  const openTabs = signal<unknown[]>([]);
  const targetLine = signal<number | undefined>(undefined);
  const splitActive = signal<boolean>(false);
  const splitFilePath = signal<string | undefined>(undefined);
  const splitFileContent = signal<string>('');
  const focusedPane = signal<'left' | 'right'>('left');
  const workspaceMap = new Map<string, EditorWorkspaceState>();
  const active: { path: string | null } = { path: '/ws' };
  const showError = jest.fn();
  const clearError = jest.fn();

  const state: EditorInternalState = {
    vscodeService: {} as never,
    fileTree,
    activeFilePath,
    activeFileContent,
    openTabs: openTabs as never,
    isLoading,
    targetLine,
    splitActive,
    splitFilePath,
    splitFileContent,
    focusedPane,
    workspaceEditorState: workspaceMap,
    getActiveWorkspacePath: () => active.path,
    setActiveWorkspacePath: (p) => {
      active.path = p;
    },
    showError,
    clearError,
  };

  return {
    state,
    fileTree,
    isLoading,
    showError,
    clearError,
    workspaceMap,
    active,
  };
}

function makeHelper(opts?: {
  handleFileContentChanged?: jest.Mock;
  refreshDiffTabsForFile?: jest.Mock;
  closeSplit?: jest.Mock;
}): {
  helper: EditorWorkspaceHelper;
  ctx: ReturnType<typeof makeState>;
  handleFileContentChanged: jest.Mock;
  refreshDiffTabsForFile: jest.Mock;
  closeSplit: jest.Mock;
} {
  const ctx = makeState();
  const handleFileContentChanged =
    opts?.handleFileContentChanged ?? jest.fn().mockResolvedValue(undefined);
  const refreshDiffTabsForFile = opts?.refreshDiffTabsForFile ?? jest.fn();
  const closeSplit = opts?.closeSplit ?? jest.fn();
  const helper = new EditorWorkspaceHelper(ctx.state, {
    handleFileContentChanged,
    refreshDiffTabsForFile,
    closeSplit,
  });
  return {
    helper,
    ctx,
    handleFileContentChanged,
    refreshDiffTabsForFile,
    closeSplit,
  };
}

// ============================================================================

describe('EditorWorkspaceHelper.mergeLoadedSubtrees', () => {
  let helper: EditorWorkspaceHelper;

  beforeEach(() => {
    helper = makeHelper().helper;
  });

  it('preserves loaded children for a needsLoad directory at the boundary', () => {
    const previous: FileTreeNode[] = [
      makeNode({
        name: 'a',
        path: '/a',
        type: 'directory',
        children: [
          makeNode({
            name: 'b',
            path: '/a/b',
            type: 'directory',
            children: [
              makeNode({
                name: 'c',
                path: '/a/b/c',
                type: 'directory',
                needsLoad: false,
                children: [
                  makeNode({
                    name: 'file1.ts',
                    path: '/a/b/c/file1.ts',
                    type: 'file',
                  }),
                  makeNode({
                    name: 'file2.ts',
                    path: '/a/b/c/file2.ts',
                    type: 'file',
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];

    const fresh: FileTreeNode[] = [
      makeNode({
        name: 'a',
        path: '/a',
        type: 'directory',
        children: [
          makeNode({
            name: 'b',
            path: '/a/b',
            type: 'directory',
            children: [
              makeNode({
                name: 'c',
                path: '/a/b/c',
                type: 'directory',
                needsLoad: true,
                children: [],
              }),
            ],
          }),
        ],
      }),
    ];

    const merged = helper.mergeLoadedSubtrees(fresh, previous);
    const c = merged[0].children![0].children![0];
    expect(c.path).toBe('/a/b/c');
    expect(c.needsLoad).toBe(false);
    expect(c.children).toHaveLength(2);
    expect(c.children!.map((n) => n.name).sort()).toEqual([
      'file1.ts',
      'file2.ts',
    ]);
  });

  it('does NOT carry over deleted directories that no longer exist in the new tree', () => {
    const previous: FileTreeNode[] = [
      makeNode({
        name: 'a',
        path: '/a',
        type: 'directory',
        children: [
          makeNode({
            name: 'b',
            path: '/a/b',
            type: 'directory',
            children: [
              makeNode({
                name: 'c',
                path: '/a/b/c',
                type: 'directory',
                needsLoad: false,
                children: [
                  makeNode({ name: 'x.ts', path: '/a/b/c/x.ts', type: 'file' }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
    const fresh: FileTreeNode[] = [
      makeNode({
        name: 'a',
        path: '/a',
        type: 'directory',
        children: [
          makeNode({
            name: 'b',
            path: '/a/b',
            type: 'directory',
            children: [],
          }),
        ],
      }),
    ];

    const merged = helper.mergeLoadedSubtrees(fresh, previous);
    const b = merged[0].children![0];
    expect(b.children).toEqual([]);
    // Walk and ensure no node references /a/b/c
    const allPaths: string[] = [];
    const walk = (nodes: FileTreeNode[]): void => {
      for (const n of nodes) {
        allPaths.push(n.path);
        if (n.children) walk(n.children);
      }
    };
    walk(merged);
    expect(allPaths).not.toContain('/a/b/c');
  });

  it('recurses into preserved subtree (two-level lazy load preserved)', () => {
    // previous: c was loaded; inside c, e was ALSO a needsLoad boundary
    // previously loaded with leaf.
    const previous: FileTreeNode[] = [
      makeNode({
        name: 'a',
        path: '/a',
        type: 'directory',
        children: [
          makeNode({
            name: 'b',
            path: '/a/b',
            type: 'directory',
            children: [
              makeNode({
                name: 'c',
                path: '/a/b/c',
                type: 'directory',
                needsLoad: false,
                children: [
                  makeNode({
                    name: 'd',
                    path: '/a/b/c/d',
                    type: 'directory',
                    children: [
                      makeNode({
                        name: 'e',
                        path: '/a/b/c/d/e',
                        type: 'directory',
                        needsLoad: false,
                        children: [
                          makeNode({
                            name: 'leaf.ts',
                            path: '/a/b/c/d/e/leaf.ts',
                            type: 'file',
                          }),
                        ],
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];

    // fresh: c is a needsLoad boundary (no children); the merge should
    // restore c's children, AND because c's restored children include e
    // (which prev had loaded), e should also surface its children.
    const fresh: FileTreeNode[] = [
      makeNode({
        name: 'a',
        path: '/a',
        type: 'directory',
        children: [
          makeNode({
            name: 'b',
            path: '/a/b',
            type: 'directory',
            children: [
              makeNode({
                name: 'c',
                path: '/a/b/c',
                type: 'directory',
                needsLoad: true,
                children: [],
              }),
            ],
          }),
        ],
      }),
    ];

    const merged = helper.mergeLoadedSubtrees(fresh, previous);
    const c = merged[0].children![0].children![0];
    expect(c.needsLoad).toBe(false);
    const d = c.children![0];
    expect(d.path).toBe('/a/b/c/d');
    const e = d.children![0];
    expect(e.path).toBe('/a/b/c/d/e');
    expect(e.children).toHaveLength(1);
    expect(e.children![0].name).toBe('leaf.ts');
  });

  it('handles file ↔ directory type change at the same path (drops previous, takes new)', () => {
    const previous: FileTreeNode[] = [
      makeNode({ name: 'thing', path: '/thing', type: 'file' }),
    ];
    const fresh: FileTreeNode[] = [
      makeNode({
        name: 'thing',
        path: '/thing',
        type: 'directory',
        needsLoad: true,
        children: [],
      }),
    ];

    const merged = helper.mergeLoadedSubtrees(fresh, previous);
    expect(merged[0].type).toBe('directory');
    // Previous was a file; we should NOT have carried any children — needsLoad
    // remains as the new node specified.
    expect(merged[0].needsLoad).toBe(true);
    expect(merged[0].children ?? []).toHaveLength(0);
  });

  it('returns the new tree unchanged when previous tree is empty', () => {
    const fresh: FileTreeNode[] = [
      makeNode({ name: 'a', path: '/a', type: 'directory', children: [] }),
    ];
    expect(helper.mergeLoadedSubtrees(fresh, [])).toBe(fresh);
  });

  it('normalizes paths so backslash-vs-forward-slash still matches', () => {
    const previous: FileTreeNode[] = [
      makeNode({
        name: 'a',
        path: 'D:\\ws\\a',
        type: 'directory',
        needsLoad: false,
        children: [
          makeNode({ name: 'x.ts', path: 'D:\\ws\\a\\x.ts', type: 'file' }),
        ],
      }),
    ];
    const fresh: FileTreeNode[] = [
      makeNode({
        name: 'a',
        path: 'D:/ws/a',
        type: 'directory',
        needsLoad: true,
        children: [],
      }),
    ];
    const merged = helper.mergeLoadedSubtrees(fresh, previous);
    expect(merged[0].needsLoad).toBe(false);
    expect(merged[0].children).toHaveLength(1);
    expect(merged[0].children![0].name).toBe('x.ts');
  });
});

// ============================================================================

describe('EditorWorkspaceHelper push handling (post-C1: no raw listener)', () => {
  beforeEach(() => {
    mockRpcCall.mockReset();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('registers NO global message listener (C1 AC1)', () => {
    const addSpy = jest.spyOn(window, 'addEventListener');
    const { helper } = makeHelper();

    helper.startFileTreeWatcher();

    const messageRegistrations = addSpy.mock.calls.filter(
      ([type]) => type === 'message',
    );
    expect(messageRegistrations).toHaveLength(0);

    helper.stopFileTreeWatcher();
    addSpy.mockRestore();
  });

  it('debounces 5 rapid file:tree-changed events into a single loadFileTree() call', () => {
    const { helper } = makeHelper();
    mockRpcCall.mockResolvedValue({ success: true, data: { tree: [] } });

    helper.startFileTreeWatcher();

    for (let i = 0; i < 5; i++) {
      helper.onFileTreeChanged();
    }

    // Before debounce window completes — no RPC call yet
    jest.advanceTimersByTime(499);
    expect(mockRpcCall).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    // loadFileTree calls rpcCall('editor:getFileTree', ...)
    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'editor:getFileTree',
      { rootPath: '/ws' },
    );

    helper.stopFileTreeWatcher();
  });

  it('invokes handleFileContentChanged for a routed file path', () => {
    const { helper, handleFileContentChanged } = makeHelper();
    helper.startFileTreeWatcher();

    helper.onFileContentChanged('D:/ws/a.ts');

    expect(handleFileContentChanged).toHaveBeenCalledTimes(1);
    expect(handleFileContentChanged).toHaveBeenCalledWith('D:/ws/a.ts');

    helper.stopFileTreeWatcher();
  });

  it('debounces editor:reread-open-tabs at 250ms and skips dirty tabs', () => {
    const { helper, ctx, handleFileContentChanged } = makeHelper();
    (ctx.state.openTabs as unknown as { set(v: unknown): void }).set([
      { filePath: 'D:/ws/clean.ts', isDirty: false },
      { filePath: 'D:/ws/dirty.ts', isDirty: true },
    ]);

    helper.startFileTreeWatcher();

    helper.onRereadOpenTabs();
    helper.onRereadOpenTabs();
    helper.onRereadOpenTabs();

    jest.advanceTimersByTime(249);
    expect(handleFileContentChanged).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(handleFileContentChanged).toHaveBeenCalledTimes(1);
    expect(handleFileContentChanged).toHaveBeenCalledWith('D:/ws/clean.ts');

    helper.stopFileTreeWatcher();
  });

  it('(A1 AC5, literal) editor:reread-open-tabs SKIPS diff tabs entirely — 0 failed RPCs against a diff key', () => {
    const { helper, ctx, handleFileContentChanged } = makeHelper();
    (ctx.state.openTabs as unknown as { set(v: unknown): void }).set([
      { filePath: 'D:/ws/clean.ts', isDirty: false },
      {
        filePath: 'diff:worktree:clean.ts',
        isDirty: false,
        diff: { comparison: 'worktree', path: 'clean.ts' },
      },
      {
        filePath: 'diff:staged:renamed.ts',
        isDirty: false,
        diff: { comparison: 'staged', path: 'renamed.ts' },
      },
    ]);

    helper.startFileTreeWatcher();
    helper.onRereadOpenTabs();
    jest.advanceTimersByTime(250);

    // The two diff-keyed tabs must never reach handleFileContentChanged — that
    // is what used to fire a guaranteed-failing `editor:openFile` RPC against
    // a `diff:...` key on every single git operation with a diff tab open.
    expect(handleFileContentChanged).toHaveBeenCalledTimes(1);
    expect(handleFileContentChanged).toHaveBeenCalledWith('D:/ws/clean.ts');
    expect(handleFileContentChanged).not.toHaveBeenCalledWith(
      'diff:worktree:clean.ts',
    );
    expect(handleFileContentChanged).not.toHaveBeenCalledWith(
      'diff:staged:renamed.ts',
    );

    helper.stopFileTreeWatcher();
  });

  it('ignores pushes that arrive before startFileTreeWatcher', () => {
    const { helper, handleFileContentChanged } = makeHelper();
    mockRpcCall.mockResolvedValue({ success: true, data: { tree: [] } });

    helper.onFileTreeChanged();
    helper.onFileContentChanged('D:/ws/a.ts');
    helper.onRereadOpenTabs();
    jest.advanceTimersByTime(2000);

    expect(mockRpcCall).not.toHaveBeenCalled();
    expect(handleFileContentChanged).not.toHaveBeenCalled();
  });

  it('stopFileTreeWatcher closes the gate so subsequent pushes are ignored', () => {
    const { helper } = makeHelper();
    mockRpcCall.mockResolvedValue({ success: true, data: { tree: [] } });

    helper.startFileTreeWatcher();
    helper.stopFileTreeWatcher();

    helper.onFileTreeChanged();
    jest.advanceTimersByTime(2000);

    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('stopFileTreeWatcher leaves NO timer pending, even mid-debounce (C1 AC3)', () => {
    const { helper, handleFileContentChanged } = makeHelper();
    mockRpcCall.mockResolvedValue({ success: true, data: { tree: [] } });

    helper.startFileTreeWatcher();
    helper.onFileTreeChanged();
    helper.onRereadOpenTabs();
    expect(jest.getTimerCount()).toBe(2);

    helper.stopFileTreeWatcher();

    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(10_000);
    expect(mockRpcCall).not.toHaveBeenCalled();
    expect(handleFileContentChanged).not.toHaveBeenCalled();
  });
});

// ============================================================================

describe('EditorWorkspaceHelper.loadFileTree', () => {
  beforeEach(() => {
    mockRpcCall.mockReset();
  });

  it('discards the older response when a second concurrent load supersedes it (stale-response protection)', async () => {
    const { helper, ctx } = makeHelper();

    let resolveSlow!: (v: unknown) => void;
    const slowPromise = new Promise((res) => {
      resolveSlow = res;
    });
    const fastPromise = Promise.resolve({
      success: true,
      data: {
        tree: [
          makeNode({ name: 'fast.ts', path: '/ws/fast.ts', type: 'file' }),
        ],
      },
    });

    mockRpcCall
      .mockReturnValueOnce(slowPromise)
      .mockReturnValueOnce(fastPromise);

    // Kick off both calls; do not await the slow one yet
    const slowAwait = helper.loadFileTree('/ws');
    const fastAwait = helper.loadFileTree('/ws');

    await fastAwait;
    // After fast resolves: tree should reflect fast.ts
    expect(ctx.fileTree().map((n) => n.name)).toEqual(['fast.ts']);

    // Now slow resolves with a stale tree — it should be discarded
    resolveSlow({
      success: true,
      data: {
        tree: [
          makeNode({ name: 'slow.ts', path: '/ws/slow.ts', type: 'file' }),
        ],
      },
    });
    await slowAwait;

    expect(ctx.fileTree().map((n) => n.name)).toEqual(['fast.ts']);
  });
});

// ============================================================================
// C2 dispatch §1.3 leg 4 — the workspace cache is a SECOND store of the same
// text. The tab record is updated on every edit; the cached `activeFileContent`
// and `splitFileContent` are snapshots taken when the file was opened or
// switched to. Restoring the pane snapshots verbatim reinstates pre-edit text,
// which both reverts unsaved work and re-opens the divergence C2 closes on
// every other path.
// ============================================================================

interface CachedTab {
  filePath: string;
  fileName: string;
  content: string;
  isDirty: boolean;
}

function cachedTab(
  filePath: string,
  content: string,
  isDirty = true,
): CachedTab {
  return {
    filePath,
    fileName: filePath.split('/').pop() ?? filePath,
    content,
    isDirty,
  };
}

describe('EditorWorkspaceHelper.switchWorkspace — panes restore from the tab record (C2 AC1)', () => {
  it('prefers the tab record over the stale cached activeFileContent', () => {
    const { helper, ctx } = makeHelper();
    ctx.active.path = '/other';
    ctx.workspaceMap.set('/ws', {
      fileTree: [],
      activeFilePath: '/ws/a.ts',
      // Snapshot from when a.ts was opened — every edit since went to the tab.
      activeFileContent: 'v0 as opened',
      openTabs: [cachedTab('/ws/a.ts', 'v3 after editing')] as never,
    });

    helper.switchWorkspace('/ws');

    expect(ctx.state.activeFileContent()).toBe('v3 after editing');
  });

  it('prefers the tab record over the stale cached splitFileContent', () => {
    const { helper, ctx } = makeHelper();
    ctx.active.path = '/other';
    ctx.workspaceMap.set('/ws', {
      fileTree: [],
      activeFilePath: '/ws/a.ts',
      activeFileContent: 'v0',
      openTabs: [cachedTab('/ws/a.ts', 'v3 after editing')] as never,
      splitActive: true,
      splitFilePath: '/ws/a.ts',
      splitFileContent: 'v0',
    });

    helper.switchWorkspace('/ws');

    // Both panes land on the owner, so the round-trip cannot reintroduce a
    // divergence the other C2 fixes just removed.
    expect(ctx.state.activeFileContent()).toBe('v3 after editing');
    expect(ctx.state.splitFileContent()).toBe('v3 after editing');
    expect(ctx.state.splitActive()).toBe(true);
  });

  it('(§1.4) falls back to the cached content for a split file with NO tab record', () => {
    const { helper, ctx } = makeHelper();
    ctx.active.path = '/other';
    ctx.workspaceMap.set('/ws', {
      fileTree: [],
      activeFilePath: '/ws/a.ts',
      activeFileContent: 'A',
      openTabs: [cachedTab('/ws/a.ts', 'A', false)] as never,
      splitActive: true,
      splitFilePath: '/ws/untabbed.ts',
      splitFileContent: 'only copy of this text',
    });

    helper.switchWorkspace('/ws');

    // Nothing owns it but the cache, so the cache is authoritative here.
    expect(ctx.state.splitFileContent()).toBe('only copy of this text');
    expect(ctx.state.splitFilePath()).toBe('/ws/untabbed.ts');
  });

  it('round-trips away and back without losing an edit made in the split pane', () => {
    const { helper, ctx } = makeHelper();
    // /ws is active, same file in both panes, edited via the split pane so the
    // tab record is ahead of both cached pane snapshots.
    ctx.workspaceMap.set('/ws', {
      fileTree: [],
      activeFilePath: '/ws/a.ts',
      activeFileContent: 'v0',
      openTabs: [] as never,
      splitActive: true,
      splitFilePath: '/ws/a.ts',
      splitFileContent: 'v0',
    });
    ctx.state.activeFilePath.set('/ws/a.ts');
    ctx.state.activeFileContent.set('v0');
    ctx.state.openTabs.set([cachedTab('/ws/a.ts', 'v1 split edit')] as never);
    ctx.state.splitActive.set(true);
    ctx.state.splitFilePath.set('/ws/a.ts');
    ctx.state.splitFileContent.set('v1 split edit');
    ctx.workspaceMap.set('/away', {
      fileTree: [],
      activeFilePath: undefined,
      activeFileContent: '',
      openTabs: [] as never,
    });

    helper.switchWorkspace('/away');
    helper.switchWorkspace('/ws');

    expect(ctx.state.activeFileContent()).toBe('v1 split edit');
    expect(ctx.state.splitFileContent()).toBe('v1 split edit');
  });
});

// ============================================================================
// SEQ-2 gate closure — A2 AC5 (TASK_2026_173 seq-2-verification.md).
//
// "GIVEN a diff tab of either kind, WHEN the tab is persisted and the
// workspace is reopened, THEN the tab SHALL restore the same comparison it
// had... it SHALL NOT silently restore as the other comparison."
//
// `switchWorkspace` restores `openTabs` as a direct object reference from
// `workspaceEditorState` (an in-memory Map keyed by workspace path) — there is
// no serialize/re-parse step for a diff tab's `comparison` field, which is
// exactly the class of bug (a persisted key re-derived incorrectly) AC5 is
// worried about. This round-trips a 'staged' and a 'worktree' tab for the
// SAME path through an away-and-back workspace switch and asserts neither
// comparison is swapped.
// ============================================================================

interface DiffTab extends CachedTab {
  diff: {
    comparison: 'staged' | 'worktree';
    path: string;
    originalPath: string;
  };
}

function diffTab(
  key: string,
  comparison: 'staged' | 'worktree',
  path: string,
): DiffTab {
  return {
    filePath: key,
    fileName: `${path.split('/').pop()} (${comparison})`,
    content: `${comparison} content for ${path}`,
    isDirty: false,
    diff: { comparison, path, originalPath: path },
  };
}

describe('EditorWorkspaceHelper.switchWorkspace — diff tab comparison round trip (A2 AC5)', () => {
  it('restores a staged diff tab as staged, never as worktree, across an away-and-back switch', () => {
    // makeState() starts active.path at '/ws' already — switchWorkspace('/ws')
    // would be a same-workspace no-op (early return), so the LIVE state is set
    // directly, exactly as it would be after openDiff() ran while '/ws' was
    // active. saveCurrentWorkspaceState() (called at the top of the first real
    // switchWorkspace below) is what snapshots this into the cache.
    const { helper, ctx } = makeHelper();
    const stagedTab = diffTab('diff:staged:a.ts', 'staged', 'a.ts');
    ctx.state.activeFilePath.set('diff:staged:a.ts');
    ctx.state.activeFileContent.set(stagedTab.content);
    ctx.state.openTabs.set([stagedTab] as never);
    ctx.workspaceMap.set('/away', {
      fileTree: [],
      activeFilePath: undefined,
      activeFileContent: '',
      openTabs: [] as never,
    });

    helper.switchWorkspace('/away'); // saves '/ws' (the staged tab), loads '/away' (empty)
    helper.switchWorkspace('/ws'); // saves '/away', restores '/ws' from cache

    const restored = ctx.state
      .openTabs()
      .find((t) => (t as DiffTab).filePath === 'diff:staged:a.ts') as
      | DiffTab
      | undefined;
    expect(restored).toBeDefined();
    expect(restored?.diff.comparison).toBe('staged');
    expect(restored?.diff.comparison).not.toBe('worktree');
  });

  it('keeps two simultaneous tabs for the same path (staged + worktree) distinct across the round trip', () => {
    const { helper, ctx } = makeHelper();
    const stagedTab = diffTab('diff:staged:a.ts', 'staged', 'a.ts');
    const worktreeTab = diffTab('diff:worktree:a.ts', 'worktree', 'a.ts');
    ctx.state.activeFilePath.set('diff:staged:a.ts');
    ctx.state.activeFileContent.set(stagedTab.content);
    ctx.state.openTabs.set([stagedTab, worktreeTab] as never);
    ctx.workspaceMap.set('/away', {
      fileTree: [],
      activeFilePath: undefined,
      activeFileContent: '',
      openTabs: [] as never,
    });

    helper.switchWorkspace('/away');
    helper.switchWorkspace('/ws');

    const tabs = ctx.state.openTabs() as unknown as DiffTab[];
    const staged = tabs.find((t) => t.filePath === 'diff:staged:a.ts');
    const worktree = tabs.find((t) => t.filePath === 'diff:worktree:a.ts');
    expect(staged?.diff.comparison).toBe('staged');
    expect(worktree?.diff.comparison).toBe('worktree');
  });
});

// ============================================================================
// SEQ-2 gate closure — A2 AC5, the "discard" branch.
//
// R-2's mitigation (task-description.md): "Treat old-format diff tab entries
// as unrecognized and drop them cleanly on load... test the upgrade path
// explicitly with pre-existing persisted state." `switchWorkspace`'s
// cache-miss branch is what runs on a genuinely new/never-seen workspace path
// — the same code path that runs after a real reload, since
// `workspaceEditorState` is only ever populated by the live JS instance and
// is never hydrated from `VSCodeService.getState()` (see EditorService's
// constructor — no such call exists). This proves the cache-miss branch
// starts every workspace with zero tabs, so there is no code path through
// which an old-format (or any persisted) diff tab entry could survive into
// `openTabs` in the first place — the discard is structural, not a promise.
// ============================================================================

describe('EditorWorkspaceHelper.switchWorkspace — no persisted tabs survive a first-seen workspace (A2 AC5, discard branch)', () => {
  it('starts a never-before-cached workspace with zero tabs — a live diff tab does not leak across', () => {
    const { helper, ctx } = makeHelper();
    // Stand in for "a diff tab was open in whatever workspace was active
    // before" — the closest constructible analogue of "a persisted entry
    // exists" for a helper that has no persisted-storage dependency at all.
    // No entry in ctx.workspaceMap for '/never-seen' — this is the exact
    // shape of a genuine post-reload EditorService: workspaceEditorState is a
    // fresh empty Map (see editor.service.ts's constructor), so EVERY
    // workspace looks "never-before-cached" to the first switchWorkspace call
    // after a reload, including ones that held diff tabs (any format) before.
    ctx.state.openTabs.set([
      diffTab('diff:staged:leftover.ts', 'staged', 'leftover.ts'),
    ] as never);

    helper.switchWorkspace('/never-seen');

    expect(ctx.state.openTabs()).toEqual([]);
  });
});
