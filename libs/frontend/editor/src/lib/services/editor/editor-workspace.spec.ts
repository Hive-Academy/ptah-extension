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
