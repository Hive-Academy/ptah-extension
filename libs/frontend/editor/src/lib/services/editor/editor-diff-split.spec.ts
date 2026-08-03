/**
 * EditorDiffSplitHelper specs — the A1-A4 acceptance matrix (TASK_2026_173,
 * Task 2.14).
 *
 * Coverage map (plan implementation-plan.md SS2, SS3; tasks.md Batch 2):
 *   A1 AC4 - re-click activates AND revalidates (no early return)
 *   A1 AC6 - refresh never clears original/modified while in flight (no flicker)
 *   A1 AC7 - a failed side surfaces a persistent error and retains prior content
 *   A1     - transport failure on refresh -> 'stale', content retained
 *   A1     - transport failure on initial open -> 'error' (nothing to retain)
 *   NFR-7  - bounded queueing: a refresh already in flight is not duplicated
 *   A1     - stale-response protection: a superseded request's answer is dropped
 *   A1 SS2.4 - git:status-update revalidates every diff tab in the pushed
 *            workspace, debounced 250ms; a push for a different (background)
 *            workspace is ignored
 *   A1 SS2.4 - file:content-changed only revalidates matching WORKTREE diff tabs
 *   A2 AC3 - the same path open as 'staged' AND 'worktree' produces two
 *            independent tabs (comparison is part of the key)
 *   A2 AC4/N3 - originalPath is sent on the wire only when it differs from path
 *   A2 AC4 - tab label reflects new/deleted/staged/working-tree chrome
 *   A3     - an empty snapshotToken is never trusted as 'fresh' even when both
 *            sides read as content (defence in depth against a malformed answer)
 *   A4     - a deleted file (modifiedRef absent) resolves cleanly to 'fresh',
 *            never throws
 *   A1 AC3 - a diff that resolves to "no changes" (e.g. after discard) stays
 *            open and fresh; the helper never closes a tab out from under the user
 *
 * `rpcCall` is mocked at the module boundary, matching the pattern already
 * used by editor-workspace.spec.ts and editor.service.spec.ts.
 */

import { signal } from '@angular/core';
import { EditorDiffSplitHelper } from './editor-diff-split';
import { EditorTabsHelper } from './editor-tabs';
import type {
  EditorInternalState,
  EditorWorkspaceState,
} from './editor-internal-state';
import type { EditorTab, OpenDiffRequest } from './editor-tab.types';
import { diffTabKey } from './editor-tab.types';
import type {
  DiffSideRef,
  GitBlobRead,
  GitDiffFileResult,
  GitReadErrorCode,
} from '@ptah-extension/shared';
import { GIT_READ_TRANSPORT_MESSAGE } from './git-read-error-messages';

// ----------------------------------------------------------------------------
// Mock @ptah-extension/core's rpcCall — controlled per test via mockRpcCall.
// ----------------------------------------------------------------------------
const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => ({
  rpcCall: (...args: unknown[]) => mockRpcCall(...args),
}));

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------
function content(text: string): GitBlobRead {
  return { outcome: 'content', content: text };
}
function absentBlob(): GitBlobRead {
  return { outcome: 'absent' };
}
function errorBlob(
  code: GitReadErrorCode = 'unknown',
  message = 'boom',
): GitBlobRead {
  return { outcome: 'error', code, message };
}
const INDEX_REF: DiffSideRef = { kind: 'index' };
const WORKTREE_REF: DiffSideRef = { kind: 'worktree' };
const ABSENT_REF: DiffSideRef = { kind: 'absent' };

function makeResult(
  overrides: Partial<GitDiffFileResult> = {},
): GitDiffFileResult {
  return {
    path: 'a.ts',
    originalPath: 'a.ts',
    comparison: 'worktree',
    original: content('old'),
    modified: content('new'),
    originalRef: INDEX_REF,
    modifiedRef: WORKTREE_REF,
    snapshotToken: 'tok-1',
    ...overrides,
  };
}

function ok(data: GitDiffFileResult): {
  success: true;
  data: GitDiffFileResult;
} {
  return { success: true, data };
}
function fail(error = 'transport down'): { success: false; error: string } {
  return { success: false, error };
}

function makeState(): {
  state: EditorInternalState;
  openTabs: ReturnType<typeof signal<EditorTab[]>>;
  active: { path: string | null };
  workspaceMap: Map<string, EditorWorkspaceState>;
} {
  const fileTree = signal<EditorWorkspaceState['fileTree']>([]);
  const activeFilePath = signal<string | undefined>(undefined);
  const activeFileContent = signal<string>('');
  const openTabs = signal<EditorTab[]>([]);
  const isLoading = signal<boolean>(false);
  const targetLine = signal<number | undefined>(undefined);
  const splitActive = signal<boolean>(false);
  const splitFilePath = signal<string | undefined>(undefined);
  const splitFileContent = signal<string>('');
  const focusedPane = signal<'left' | 'right'>('left');
  const workspaceMap = new Map<string, EditorWorkspaceState>();
  const active: { path: string | null } = { path: '/ws' };

  const state: EditorInternalState = {
    vscodeService: {} as never,
    fileTree,
    activeFilePath,
    activeFileContent,
    openTabs,
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
    showError: jest.fn(),
    clearError: jest.fn(),
  };

  return { state, openTabs, active, workspaceMap };
}

function makeHelper(): {
  helper: EditorDiffSplitHelper;
  ctx: ReturnType<typeof makeState>;
} {
  const ctx = makeState();
  const tabs = new EditorTabsHelper(ctx.state, {
    clearActiveFile: jest.fn(),
    closeSplit: jest.fn(),
  });
  const helper = new EditorDiffSplitHelper(ctx.state, tabs);
  return { helper, ctx };
}

async function openDiff(
  helper: EditorDiffSplitHelper,
  request: Partial<OpenDiffRequest> & { path: string },
): Promise<void> {
  await helper.openDiff({ comparison: 'worktree', ...request });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockRpcCall.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

// ============================================================================

describe('EditorDiffSplitHelper.openDiff', () => {
  it('creates a diff tab keyed by comparison + path, seeded from the RPC result', async () => {
    const { helper, ctx } = makeHelper();
    mockRpcCall.mockResolvedValue(ok(makeResult({ path: 'src/a.ts' })));

    await openDiff(helper, { path: 'src/a.ts', comparison: 'worktree' });

    const key = diffTabKey('worktree', 'src/a.ts');
    const tab = ctx.openTabs().find((t) => t.filePath === key);
    expect(tab).toBeDefined();
    expect(tab?.diff?.status).toBe('fresh');
    expect(tab?.content).toBe('new');
    expect(ctx.active.path && ctx.state.activeFilePath()).toBe(key);
  });

  it('(A2 AC3) the same path open as staged AND worktree produces two independent tabs', async () => {
    const { helper, ctx } = makeHelper();
    mockRpcCall.mockImplementation(
      (
        _svc: unknown,
        _method: string,
        params: { comparison: 'staged' | 'worktree' },
      ) =>
        Promise.resolve(
          ok(makeResult({ path: 'a.ts', comparison: params.comparison })),
        ),
    );

    await openDiff(helper, { path: 'a.ts', comparison: 'staged' });
    await openDiff(helper, { path: 'a.ts', comparison: 'worktree' });

    expect(ctx.openTabs()).toHaveLength(2);
    expect(ctx.openTabs().map((t) => t.filePath)).toEqual([
      diffTabKey('staged', 'a.ts'),
      diffTabKey('worktree', 'a.ts'),
    ]);
  });

  it('(A2 AC4/N3) sends originalPath on the wire only when it differs from path', async () => {
    const { helper } = makeHelper();
    // Two DISTINCT keys (different paths) — reusing one key would hit the
    // existing-tab/revalidate branch, which reads originalPath off the
    // already-open tab rather than the new request.
    mockRpcCall.mockResolvedValue(ok(makeResult({ path: 'unrenamed.ts' })));
    await openDiff(helper, { path: 'unrenamed.ts', comparison: 'staged' });
    expect(mockRpcCall.mock.calls[0][2]).not.toHaveProperty('originalPath');

    mockRpcCall.mockClear();
    mockRpcCall.mockResolvedValue(ok(makeResult({ path: 'new-name.ts' })));
    await openDiff(helper, {
      path: 'new-name.ts',
      comparison: 'staged',
      origPath: 'old-name.ts',
    });
    expect(mockRpcCall.mock.calls[0][2]).toMatchObject({
      originalPath: 'old-name.ts',
    });
  });

  it('(A2 AC4) labels a staged addition as "(new, staged)" and a deletion as "(deleted, working tree)"', async () => {
    const { helper, ctx } = makeHelper();
    mockRpcCall.mockResolvedValueOnce(
      ok(
        makeResult({
          path: 'added.ts',
          comparison: 'staged',
          originalRef: ABSENT_REF,
          original: absentBlob(),
        }),
      ),
    );
    await openDiff(helper, { path: 'added.ts', comparison: 'staged' });
    expect(
      ctx
        .openTabs()
        .find((t) => t.filePath === diffTabKey('staged', 'added.ts'))?.fileName,
    ).toBe('added.ts (new, staged)');

    mockRpcCall.mockResolvedValueOnce(
      ok(
        makeResult({
          path: 'gone.ts',
          comparison: 'worktree',
          modifiedRef: ABSENT_REF,
          modified: absentBlob(),
        }),
      ),
    );
    await openDiff(helper, { path: 'gone.ts', comparison: 'worktree' });
    expect(
      ctx
        .openTabs()
        .find((t) => t.filePath === diffTabKey('worktree', 'gone.ts'))
        ?.fileName,
    ).toBe('gone.ts (deleted, working tree)');
  });

  it('(A1) a transport failure on the FIRST open produces a persistent error, not a crash', async () => {
    const { helper, ctx } = makeHelper();
    mockRpcCall.mockResolvedValue(fail());

    await openDiff(helper, { path: 'a.ts', comparison: 'worktree' });

    const tab = ctx.openTabs()[0];
    expect(tab.diff?.status).toBe('error');
    expect(tab.diff?.errorMessage).toBe(GIT_READ_TRANSPORT_MESSAGE);
  });

  it('(A1 AC4) re-clicking an already-open tab does NOT early-return: it activates AND revalidates', async () => {
    const { helper, ctx } = makeHelper();
    mockRpcCall.mockResolvedValue(
      ok(makeResult({ path: 'a.ts', modified: content('v1') })),
    );
    await openDiff(helper, { path: 'a.ts', comparison: 'worktree' });
    expect(mockRpcCall).toHaveBeenCalledTimes(1);

    mockRpcCall.mockResolvedValue(
      ok(makeResult({ path: 'a.ts', modified: content('v2') })),
    );
    await openDiff(helper, { path: 'a.ts', comparison: 'worktree' });

    // A literal count, per A1 AC5's own framing: exactly one extra RPC per
    // re-click, never zero (that would be the early-return bug) and never
    // more than one (that would be a duplicate-request leak).
    expect(mockRpcCall).toHaveBeenCalledTimes(2);
    const tab = ctx
      .openTabs()
      .find((t) => t.filePath === diffTabKey('worktree', 'a.ts'));
    expect(tab?.content).toBe('v2');
  });
});

describe('EditorDiffSplitHelper.refreshDiffTab', () => {
  async function openFresh(
    helper: EditorDiffSplitHelper,
    path = 'a.ts',
  ): Promise<void> {
    mockRpcCall.mockResolvedValueOnce(ok(makeResult({ path })));
    await openDiff(helper, { path, comparison: 'worktree' });
    mockRpcCall.mockReset();
  }

  it('is a no-op for a path with no open diff tab', async () => {
    const { helper } = makeHelper();
    await helper.refreshDiffTab(diffTabKey('worktree', 'never-opened.ts'));
    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('(A1 AC6) does not clear original/modified while the request is in flight', async () => {
    const { helper, ctx } = makeHelper();
    await openFresh(helper);
    const key = diffTabKey('worktree', 'a.ts');

    let resolveRpc!: (v: unknown) => void;
    mockRpcCall.mockReturnValue(new Promise((res) => (resolveRpc = res)));

    const pending = helper.refreshDiffTab(key);
    const midFlight = ctx.openTabs().find((t) => t.filePath === key);
    expect(midFlight?.diff?.status).toBe('refreshing');
    expect(midFlight?.diff?.original).toBe('old');
    expect(midFlight?.diff?.modified).toBe('new');

    resolveRpc(ok(makeResult({ path: 'a.ts', modified: content('newer') })));
    await pending;

    const settled = ctx.openTabs().find((t) => t.filePath === key);
    expect(settled?.diff?.status).toBe('fresh');
    expect(settled?.diff?.modified).toBe('newer');
  });

  it('(A1 AC7 / A3) a failed side surfaces a persistent error and RETAINS the previous content', async () => {
    const { helper, ctx } = makeHelper();
    await openFresh(helper);
    const key = diffTabKey('worktree', 'a.ts');

    mockRpcCall.mockResolvedValue(
      ok(
        makeResult({
          path: 'a.ts',
          modified: errorBlob('permission-denied', 'EACCES'),
        }),
      ),
    );
    await helper.refreshDiffTab(key);

    const tab = ctx.openTabs().find((t) => t.filePath === key);
    expect(tab?.diff?.status).toBe('error');
    expect(tab?.diff?.errorMessage).toMatch(/permission/i);
    // Previous content untouched — never rendered as an empty file.
    expect(tab?.diff?.original).toBe('old');
    expect(tab?.diff?.modified).toBe('new');
    expect(tab?.content).toBe('new');
  });

  it('(A1) a transport failure on refresh -> stale, retaining previous content', async () => {
    const { helper, ctx } = makeHelper();
    await openFresh(helper);
    const key = diffTabKey('worktree', 'a.ts');

    mockRpcCall.mockResolvedValue(fail());
    await helper.refreshDiffTab(key);

    const tab = ctx.openTabs().find((t) => t.filePath === key);
    expect(tab?.diff?.status).toBe('stale');
    expect(tab?.diff?.original).toBe('old');
    expect(tab?.diff?.modified).toBe('new');
  });

  it('(NFR-7) a refresh already in flight for the same key is not duplicated', async () => {
    const { helper } = makeHelper();
    await openFresh(helper);
    const key = diffTabKey('worktree', 'a.ts');

    mockRpcCall.mockReturnValue(new Promise(() => undefined)); // never resolves
    void helper.refreshDiffTab(key);
    void helper.refreshDiffTab(key);
    void helper.refreshDiffTab(key);

    expect(mockRpcCall).toHaveBeenCalledTimes(1);
  });

  it('drops the response if the active workspace changed while the request was in flight', async () => {
    const { helper, ctx } = makeHelper();
    await openFresh(helper);
    const key = diffTabKey('worktree', 'a.ts');

    let resolveRpc!: (v: unknown) => void;
    mockRpcCall.mockReturnValueOnce(new Promise((res) => (resolveRpc = res)));
    const pending = helper.refreshDiffTab(key);

    // The user switches workspace before the read comes back.
    ctx.active.path = '/some/other/workspace';
    resolveRpc(
      ok(
        makeResult({
          path: 'a.ts',
          modified: content('leaked-across-workspaces'),
        }),
      ),
    );
    await pending;

    // The response belongs to the ORIGIN workspace and must never be applied
    // once the user has navigated elsewhere — applying it would leak one
    // workspace's git content into another's tab.
    const tab = ctx.openTabs().find((t) => t.filePath === key);
    expect(tab?.diff?.modified).toBe('new');
    expect(tab?.diff?.status).toBe('refreshing');
  });

  it('drops the response if the tab was closed while the request was in flight', async () => {
    const { helper, ctx } = makeHelper();
    await openFresh(helper);
    const key = diffTabKey('worktree', 'a.ts');

    let resolveRpc!: (v: unknown) => void;
    mockRpcCall.mockReturnValueOnce(new Promise((res) => (resolveRpc = res)));
    const pending = helper.refreshDiffTab(key);

    // The tab is closed mid-flight.
    ctx.openTabs.set(ctx.openTabs().filter((t) => t.filePath !== key));

    await expect(
      (async () => {
        resolveRpc(
          ok(
            makeResult({
              path: 'a.ts',
              modified: content('should-not-resurrect'),
            }),
          ),
        );
        await pending;
      })(),
    ).resolves.not.toThrow();

    // The tab must not be resurrected by a response that outlived it.
    expect(ctx.openTabs().find((t) => t.filePath === key)).toBeUndefined();
  });

  it('(A4) a deleted file (modifiedRef absent) resolves to fresh without throwing', async () => {
    const { helper, ctx } = makeHelper();
    await openFresh(helper);
    const key = diffTabKey('worktree', 'a.ts');

    mockRpcCall.mockResolvedValue(
      ok(
        makeResult({
          path: 'a.ts',
          modified: absentBlob(),
          modifiedRef: ABSENT_REF,
        }),
      ),
    );
    await expect(helper.refreshDiffTab(key)).resolves.not.toThrow();

    const tab = ctx.openTabs().find((t) => t.filePath === key);
    expect(tab?.diff?.status).toBe('fresh');
    expect(tab?.diff?.modifiedRef).toEqual(ABSENT_REF);
    expect(tab?.diff?.modified).toBe('');
  });

  it('(A3) an empty snapshotToken is never trusted as fresh even when both sides read as content', async () => {
    const { helper, ctx } = makeHelper();
    await openFresh(helper);
    const key = diffTabKey('worktree', 'a.ts');

    mockRpcCall.mockResolvedValue(
      ok(makeResult({ path: 'a.ts', snapshotToken: '' })),
    );
    await helper.refreshDiffTab(key);

    const tab = ctx.openTabs().find((t) => t.filePath === key);
    expect(tab?.diff?.status).toBe('error');
  });

  it('(A1 AC3) a diff that resolves to "no changes" (discard) stays open, fresh, and is never auto-closed', async () => {
    const { helper, ctx } = makeHelper();
    await openFresh(helper);
    const key = diffTabKey('worktree', 'a.ts');

    mockRpcCall.mockResolvedValue(
      ok(
        makeResult({
          path: 'a.ts',
          original: content('same'),
          modified: content('same'),
        }),
      ),
    );
    await helper.refreshDiffTab(key);

    const tab = ctx.openTabs().find((t) => t.filePath === key);
    expect(tab).toBeDefined();
    expect(tab?.diff?.status).toBe('fresh');
    expect(tab?.diff?.original).toBe(tab?.diff?.modified);
  });
});

describe('EditorDiffSplitHelper.onGitStatusUpdate', () => {
  async function openFresh(
    helper: EditorDiffSplitHelper,
    path = 'a.ts',
  ): Promise<void> {
    mockRpcCall.mockResolvedValueOnce(ok(makeResult({ path })));
    await openDiff(helper, { path, comparison: 'worktree' });
    mockRpcCall.mockReset();
  }

  it('debounces at 250ms and revalidates every open diff tab in the active workspace', async () => {
    const { helper, ctx } = makeHelper();
    await openFresh(helper, 'a.ts');
    await openFresh(helper, 'b.ts');

    mockRpcCall.mockResolvedValue(
      ok(makeResult({ path: 'a.ts', modified: content('refreshed') })),
    );

    helper.onGitStatusUpdate('/ws');
    helper.onGitStatusUpdate('/ws');
    helper.onGitStatusUpdate('/ws');

    jest.advanceTimersByTime(249);
    expect(mockRpcCall).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRpcCall).toHaveBeenCalledTimes(2);
    void ctx;
  });

  it('ignores a push for a different (background) workspace', async () => {
    const { helper } = makeHelper();
    await openFresh(helper, 'a.ts');

    helper.onGitStatusUpdate('/some/other/workspace');
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(mockRpcCall).not.toHaveBeenCalled();
  });
});

describe('EditorDiffSplitHelper.onFileContentChanged', () => {
  async function openFresh(
    helper: EditorDiffSplitHelper,
    request: Partial<OpenDiffRequest> & { path: string },
  ): Promise<void> {
    mockRpcCall.mockResolvedValueOnce(
      ok(
        makeResult({
          path: request.path,
          comparison: request.comparison ?? 'worktree',
        }),
      ),
    );
    await openDiff(helper, request);
    mockRpcCall.mockReset();
  }

  it('revalidates only a matching WORKTREE diff tab, never a staged one', async () => {
    const { helper } = makeHelper();
    await openFresh(helper, { path: 'a.ts', comparison: 'worktree' });
    await openFresh(helper, { path: 'a.ts', comparison: 'staged' });
    await openFresh(helper, { path: 'b.ts', comparison: 'worktree' });

    mockRpcCall.mockResolvedValue(ok(makeResult({ path: 'a.ts' })));
    helper.onFileContentChanged('/ws/a.ts');
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall.mock.calls[0][2]).toMatchObject({
      path: 'a.ts',
      comparison: 'worktree',
    });
  });

  it('is a no-op for a path outside the active workspace', async () => {
    const { helper } = makeHelper();
    await openFresh(helper, { path: 'a.ts', comparison: 'worktree' });

    helper.onFileContentChanged('/outside/a.ts');
    await Promise.resolve();

    expect(mockRpcCall).not.toHaveBeenCalled();
  });
});
