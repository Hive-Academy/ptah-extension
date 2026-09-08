/**
 * DiffTabsService specs — the A1-A4 acceptance matrix and the D2 apply guard,
 * ported from `editor-diff-split.spec.ts` (TASK_2026_173 Task 2.14, Batch 8
 * task 8.6) when the diff engine moved into `@ptah-extension/git-ui`
 * (TASK_2026_385 Batch 2.3).
 *
 * Every split-pane block of the original is deliberately absent: the split pane
 * stayed in `@ptah-extension/editor` and this service has no pane state at all.
 * What had to survive the port is the diff half, unchanged in behaviour:
 *
 *   A1 AC4 - re-click activates AND revalidates (no early return)
 *   A1 AC6 - refresh never clears original/modified while in flight (no flicker)
 *   A1 AC7 - a failed side surfaces a persistent error and retains prior content
 *   A1     - transport failure on refresh -> 'stale', content retained
 *   A1     - transport failure on initial open -> 'error' (nothing to retain)
 *   NFR-7  - bounded queueing: a refresh already in flight is not duplicated
 *   A1     - stale-response protection: a superseded request's answer is dropped
 *   A1     - git:status-update revalidates every diff tab in the pushed
 *            workspace, debounced 250ms; a push for a different (background)
 *            workspace is ignored
 *   A1     - file:content-changed only revalidates matching WORKTREE diff tabs
 *   A2 AC3 - the same path open as 'staged' AND 'worktree' produces two
 *            independent tabs (comparison is part of the key)
 *   A2 AC4/N3 - originalPath is sent on the wire only when it differs from path
 *   A2 AC4 - tab label reflects new/deleted/staged/working-tree chrome
 *   A3     - an empty snapshotToken is never trusted as 'fresh' even when both
 *            sides read as content; error copy comes from the frontend table
 *   A4     - a deleted file (modifiedRef absent) resolves cleanly to 'fresh'
 *   A1 AC3 - a diff that resolves to "no changes" stays open and fresh
 *   D2 AC6 - an apply whose snapshotToken has moved is refused WITHOUT an RPC
 *
 * Plus what is new here: the two push types arrive through `handleMessage`
 * rather than through the editor coordinator, and `applyHunksFn` is the bound
 * surface `DiffViewComponent` binds to.
 *
 * `rpcCall` is mocked at the module boundary, matching the pattern the moved
 * git services already use.
 */

import { TestBed } from '@angular/core/testing';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  DiffSideRef,
  GitApplyHunksResult,
  GitBlobRead,
  GitDiffFileResult,
  GitHunkRef,
  GitReadErrorCode,
} from '@ptah-extension/shared';
import { DiffTabsService } from './diff-tabs.service';
import { GitStatusService } from './git-status.service';
import { GIT_READ_TRANSPORT_MESSAGE } from './git-read-error-messages';
import { diffTabKey } from '../types/diff-tab.types';
import type { OpenDiffRequest } from '../types/diff-tab.types';

// ----------------------------------------------------------------------------
// Mock @ptah-extension/core. `VSCodeService` is re-declared as a bare class
// because the service injects it as a DI token — a module mock exporting only
// `rpcCall` would make that token `undefined` at construction.
// ----------------------------------------------------------------------------
const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => ({
  rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  VSCodeService: class VSCodeService {},
}));
const { VSCodeService } = jest.requireMock('@ptah-extension/core');

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
    patch: null,
    hunks: [],
    ...overrides,
  };
}

/** A `@@` header ref, positions only — exactly what the backend returns. */
function hunk(
  index: number,
  modifiedStart: number,
  modifiedLines = 1,
): GitHunkRef {
  return {
    index,
    originalStart: modifiedStart,
    originalLines: modifiedLines,
    modifiedStart,
    modifiedLines,
    header: `@@ -${modifiedStart},${modifiedLines} +${modifiedStart},${modifiedLines} @@`,
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

/**
 * The one thing this service reads from {@link GitStatusService}. Held in a
 * mutable box so a test can switch workspace mid-flight, which is what the
 * stale-response guards are about.
 */
interface Ctx {
  service: DiffTabsService;
  active: { path: string | null };
}

function makeService(): Ctx {
  const active: { path: string | null } = { path: '/ws' };
  TestBed.configureTestingModule({
    providers: [
      { provide: VSCodeService, useValue: {} },
      {
        provide: GitStatusService,
        useValue: { activeWorkspacePath: () => active.path },
      },
    ],
  });
  return { service: TestBed.inject(DiffTabsService), active };
}

async function openDiff(
  service: DiffTabsService,
  request: Partial<OpenDiffRequest> & { path: string },
): Promise<void> {
  await service.openDiff({ comparison: 'worktree', ...request });
}

function tabAt(service: DiffTabsService, key: string) {
  return service.diffTabs().find((t) => t.filePath === key);
}

beforeEach(() => {
  jest.useFakeTimers();
  mockRpcCall.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

// ============================================================================

describe('DiffTabsService.openDiff', () => {
  it('creates a diff tab keyed by comparison + path, seeded from the RPC result', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValue(ok(makeResult({ path: 'src/a.ts' })));

    await openDiff(service, { path: 'src/a.ts', comparison: 'worktree' });

    const key = diffTabKey('worktree', 'src/a.ts');
    const tab = tabAt(service, key);
    expect(tab).toBeDefined();
    expect(tab?.diff?.status).toBe('fresh');
    expect(tab?.content).toBe('new');
    expect(service.activeDiffKey()).toBe(key);
    // The two bindings `GitDockComponent` hands to `DiffViewComponent`.
    expect(service.activeDiffTab()?.filePath).toBe(key);
    expect(service.openDiffKeys()).toEqual([key]);
  });

  it('(A2 AC3) the same path open as staged AND worktree produces two independent tabs', async () => {
    const { service } = makeService();
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

    await openDiff(service, { path: 'a.ts', comparison: 'staged' });
    await openDiff(service, { path: 'a.ts', comparison: 'worktree' });

    expect(service.diffTabs()).toHaveLength(2);
    expect(service.openDiffKeys()).toEqual([
      diffTabKey('staged', 'a.ts'),
      diffTabKey('worktree', 'a.ts'),
    ]);
  });

  it('(A2 AC4/N3) sends originalPath on the wire only when it differs from path', async () => {
    const { service } = makeService();
    // Two DISTINCT keys (different paths) — reusing one key would hit the
    // existing-tab/revalidate branch, which reads originalPath off the
    // already-open tab rather than the new request.
    mockRpcCall.mockResolvedValue(ok(makeResult({ path: 'unrenamed.ts' })));
    await openDiff(service, { path: 'unrenamed.ts', comparison: 'staged' });
    expect(mockRpcCall.mock.calls[0][2]).not.toHaveProperty('originalPath');

    mockRpcCall.mockClear();
    mockRpcCall.mockResolvedValue(ok(makeResult({ path: 'new-name.ts' })));
    await openDiff(service, {
      path: 'new-name.ts',
      comparison: 'staged',
      origPath: 'old-name.ts',
    });
    expect(mockRpcCall.mock.calls[0][2]).toMatchObject({
      originalPath: 'old-name.ts',
    });
  });

  it('(A2 AC4) labels a staged addition as "(new, staged)" and a deletion as "(deleted, working tree)"', async () => {
    const { service } = makeService();
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
    await openDiff(service, { path: 'added.ts', comparison: 'staged' });
    expect(tabAt(service, diffTabKey('staged', 'added.ts'))?.fileName).toBe(
      'added.ts (new, staged)',
    );

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
    await openDiff(service, { path: 'gone.ts', comparison: 'worktree' });
    expect(tabAt(service, diffTabKey('worktree', 'gone.ts'))?.fileName).toBe(
      'gone.ts (deleted, working tree)',
    );
  });

  it('(A1) a transport failure on the FIRST open produces a persistent error, not a crash', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValue(fail());

    await openDiff(service, { path: 'a.ts', comparison: 'worktree' });

    const tab = service.diffTabs()[0];
    expect(tab.diff?.status).toBe('error');
    expect(tab.diff?.errorMessage).toBe(GIT_READ_TRANSPORT_MESSAGE);
  });

  it('(A1 AC4) re-clicking an already-open tab does NOT early-return: it activates AND revalidates', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValue(
      ok(makeResult({ path: 'a.ts', modified: content('v1') })),
    );
    await openDiff(service, { path: 'a.ts', comparison: 'worktree' });
    expect(mockRpcCall).toHaveBeenCalledTimes(1);

    mockRpcCall.mockResolvedValue(
      ok(makeResult({ path: 'a.ts', modified: content('v2') })),
    );
    await openDiff(service, { path: 'a.ts', comparison: 'worktree' });

    // A literal count, per A1 AC5's own framing: exactly one extra RPC per
    // re-click, never zero (that would be the early-return bug) and never
    // more than one (that would be a duplicate-request leak).
    expect(mockRpcCall).toHaveBeenCalledTimes(2);
    expect(tabAt(service, diffTabKey('worktree', 'a.ts'))?.content).toBe('v2');
  });

  it('does not create a tab when the workspace changed while the first read was in flight', async () => {
    const { service, active } = makeService();
    let resolveRpc!: (v: unknown) => void;
    mockRpcCall.mockReturnValue(new Promise((res) => (resolveRpc = res)));

    const pending = openDiff(service, { path: 'a.ts', comparison: 'worktree' });
    active.path = '/other';
    resolveRpc(ok(makeResult({ path: 'a.ts' })));
    await pending;

    // A tab belongs to the workspace it was requested from; materialising it
    // now would put another workspace's diff in this one's dock.
    expect(service.diffTabs()).toHaveLength(0);
  });
});

describe('DiffTabsService.refreshDiffTab', () => {
  async function openFresh(
    service: DiffTabsService,
    path = 'a.ts',
  ): Promise<void> {
    mockRpcCall.mockResolvedValueOnce(ok(makeResult({ path })));
    await openDiff(service, { path, comparison: 'worktree' });
    mockRpcCall.mockReset();
  }

  it('is a no-op for a path with no open diff tab', async () => {
    const { service } = makeService();
    await service.refreshDiffTab(diffTabKey('worktree', 'never-opened.ts'));
    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('(A1 AC6) does not clear original/modified while the request is in flight', async () => {
    const { service } = makeService();
    await openFresh(service);
    const key = diffTabKey('worktree', 'a.ts');

    let resolveRpc!: (v: unknown) => void;
    mockRpcCall.mockReturnValue(new Promise((res) => (resolveRpc = res)));

    const pending = service.refreshDiffTab(key);
    const midFlight = tabAt(service, key);
    expect(midFlight?.diff?.status).toBe('refreshing');
    expect(midFlight?.diff?.original).toBe('old');
    expect(midFlight?.diff?.modified).toBe('new');

    resolveRpc(ok(makeResult({ path: 'a.ts', modified: content('newer') })));
    await pending;

    const settled = tabAt(service, key);
    expect(settled?.diff?.status).toBe('fresh');
    expect(settled?.diff?.modified).toBe('newer');
  });

  it('(A1 AC7 / A3) a failed side surfaces a persistent error and RETAINS the previous content', async () => {
    const { service } = makeService();
    await openFresh(service);
    const key = diffTabKey('worktree', 'a.ts');

    mockRpcCall.mockResolvedValue(
      ok(
        makeResult({
          path: 'a.ts',
          modified: errorBlob('permission-denied', 'EACCES'),
        }),
      ),
    );
    await service.refreshDiffTab(key);

    const tab = tabAt(service, key);
    expect(tab?.diff?.status).toBe('error');
    // A3 AC4: the copy is the frontend's own sanitized string, never the
    // backend's raw detail.
    expect(tab?.diff?.errorMessage).toBe(
      'Permission denied while reading this file from git.',
    );
    expect(tab?.diff?.errorMessage).not.toContain('EACCES');
    // Previous content untouched — never rendered as an empty file.
    expect(tab?.diff?.original).toBe('old');
    expect(tab?.diff?.modified).toBe('new');
    expect(tab?.content).toBe('new');
  });

  it('(A1) a transport failure on refresh -> stale, retaining previous content', async () => {
    const { service } = makeService();
    await openFresh(service);
    const key = diffTabKey('worktree', 'a.ts');

    mockRpcCall.mockResolvedValue(fail());
    await service.refreshDiffTab(key);

    const tab = tabAt(service, key);
    expect(tab?.diff?.status).toBe('stale');
    expect(tab?.diff?.original).toBe('old');
    expect(tab?.diff?.modified).toBe('new');
  });

  it('(NFR-7) a refresh already in flight for the same key is not duplicated', async () => {
    const { service } = makeService();
    await openFresh(service);
    const key = diffTabKey('worktree', 'a.ts');

    mockRpcCall.mockReturnValue(new Promise(() => undefined)); // never resolves
    void service.refreshDiffTab(key);
    void service.refreshDiffTab(key);
    void service.refreshDiffTab(key);

    expect(mockRpcCall).toHaveBeenCalledTimes(1);
  });

  it('drops the response if the active workspace changed while the request was in flight', async () => {
    const { service, active } = makeService();
    await openFresh(service);
    const key = diffTabKey('worktree', 'a.ts');

    let resolveRpc!: (v: unknown) => void;
    mockRpcCall.mockReturnValueOnce(new Promise((res) => (resolveRpc = res)));
    const pending = service.refreshDiffTab(key);

    // The user switches workspace before the read comes back.
    active.path = '/some/other/workspace';
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
    const tab = tabAt(service, key);
    expect(tab?.diff?.modified).toBe('new');
    expect(tab?.diff?.status).toBe('refreshing');
  });

  it('drops the response if the tab was closed while the request was in flight', async () => {
    const { service } = makeService();
    await openFresh(service);
    const key = diffTabKey('worktree', 'a.ts');

    let resolveRpc!: (v: unknown) => void;
    mockRpcCall.mockReturnValueOnce(new Promise((res) => (resolveRpc = res)));
    const pending = service.refreshDiffTab(key);

    service.closeDiff(key);

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
    expect(tabAt(service, key)).toBeUndefined();
  });

  it('(A4) a deleted file (modifiedRef absent) resolves to fresh without throwing', async () => {
    const { service } = makeService();
    await openFresh(service);
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
    await expect(service.refreshDiffTab(key)).resolves.not.toThrow();

    const tab = tabAt(service, key);
    expect(tab?.diff?.status).toBe('fresh');
    expect(tab?.diff?.modifiedRef).toEqual(ABSENT_REF);
    expect(tab?.diff?.modified).toBe('');
  });

  it('(A3) an empty snapshotToken is never trusted as fresh even when both sides read as content', async () => {
    const { service } = makeService();
    await openFresh(service);
    const key = diffTabKey('worktree', 'a.ts');

    mockRpcCall.mockResolvedValue(
      ok(makeResult({ path: 'a.ts', snapshotToken: '' })),
    );
    await service.refreshDiffTab(key);

    const tab = tabAt(service, key);
    expect(tab?.diff?.status).toBe('error');
    // ...and the content the user was looking at is still there.
    expect(tab?.diff?.modified).toBe('new');
  });

  it('(A1 AC3) a diff that resolves to "no changes" (discard) stays open, fresh, and is never auto-closed', async () => {
    const { service } = makeService();
    await openFresh(service);
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
    await service.refreshDiffTab(key);

    const tab = tabAt(service, key);
    expect(tab).toBeDefined();
    expect(tab?.diff?.status).toBe('fresh');
    expect(tab?.diff?.original).toBe(tab?.diff?.modified);
  });
});

describe('DiffTabsService.onGitStatusUpdate', () => {
  async function openFresh(
    service: DiffTabsService,
    path = 'a.ts',
  ): Promise<void> {
    mockRpcCall.mockResolvedValueOnce(ok(makeResult({ path })));
    await openDiff(service, { path, comparison: 'worktree' });
    mockRpcCall.mockReset();
  }

  it('debounces at 250ms and revalidates every open diff tab in the active workspace', async () => {
    const { service } = makeService();
    await openFresh(service, 'a.ts');
    await openFresh(service, 'b.ts');

    mockRpcCall.mockResolvedValue(
      ok(makeResult({ path: 'a.ts', modified: content('refreshed') })),
    );

    service.onGitStatusUpdate('/ws');
    service.onGitStatusUpdate('/ws');
    service.onGitStatusUpdate('/ws');

    jest.advanceTimersByTime(249);
    expect(mockRpcCall).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();

    // One `git:diffFile` per open tab per burst — three pushes, two calls.
    expect(mockRpcCall).toHaveBeenCalledTimes(2);
  });

  it('ignores a push for a different (background) workspace', async () => {
    const { service } = makeService();
    await openFresh(service, 'a.ts');

    service.onGitStatusUpdate('/some/other/workspace');
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('dispose() cancels a pending revalidation rather than letting it fire', async () => {
    const { service } = makeService();
    await openFresh(service, 'a.ts');

    service.onGitStatusUpdate('/ws');
    service.dispose();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(mockRpcCall).not.toHaveBeenCalled();
  });
});

describe('DiffTabsService.onFileContentChanged', () => {
  async function openFresh(
    service: DiffTabsService,
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
    await openDiff(service, request);
    mockRpcCall.mockReset();
  }

  it('revalidates only a matching WORKTREE diff tab, never a staged one', async () => {
    const { service } = makeService();
    await openFresh(service, { path: 'a.ts', comparison: 'worktree' });
    await openFresh(service, { path: 'a.ts', comparison: 'staged' });
    await openFresh(service, { path: 'b.ts', comparison: 'worktree' });

    mockRpcCall.mockResolvedValue(ok(makeResult({ path: 'a.ts' })));
    service.onFileContentChanged('/ws/a.ts');
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall.mock.calls[0][2]).toMatchObject({
      path: 'a.ts',
      comparison: 'worktree',
    });
  });

  it('is a no-op for a path outside the active workspace', async () => {
    const { service } = makeService();
    await openFresh(service, { path: 'a.ts', comparison: 'worktree' });

    service.onFileContentChanged('/outside/a.ts');
    await Promise.resolve();

    expect(mockRpcCall).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Push routing. In the editor lib these two arrived through the coordinator's
// `handleMessage`; here the service registers for them itself, so the routing
// is part of this file's contract rather than someone else's.
// ============================================================================

describe('DiffTabsService — MessageHandler registration', () => {
  it('declares exactly the two push types it acts on', () => {
    const { service } = makeService();
    expect(service.handledMessageTypes).toEqual([
      MESSAGE_TYPES.GIT_STATUS_UPDATE,
      MESSAGE_TYPES.FILE_CONTENT_CHANGED,
    ]);
  });

  it('routes a git:status-update push into the debounced revalidation', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValueOnce(ok(makeResult({ path: 'a.ts' })));
    await openDiff(service, { path: 'a.ts', comparison: 'worktree' });
    mockRpcCall.mockReset();
    mockRpcCall.mockResolvedValue(ok(makeResult({ path: 'a.ts' })));

    service.handleMessage({
      type: MESSAGE_TYPES.GIT_STATUS_UPDATE,
      payload: { workspaceRoot: '/ws' },
    });

    jest.advanceTimersByTime(250);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRpcCall).toHaveBeenCalledTimes(1);
  });

  it('routes a file:content-changed push by absolute path', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValueOnce(ok(makeResult({ path: 'a.ts' })));
    await openDiff(service, { path: 'a.ts', comparison: 'worktree' });
    mockRpcCall.mockReset();
    mockRpcCall.mockResolvedValue(ok(makeResult({ path: 'a.ts' })));

    service.handleMessage({
      type: MESSAGE_TYPES.FILE_CONTENT_CHANGED,
      payload: { filePath: '/ws/a.ts' },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRpcCall).toHaveBeenCalledTimes(1);
  });

  it('ignores a payload-less push and an unrelated type', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValueOnce(ok(makeResult({ path: 'a.ts' })));
    await openDiff(service, { path: 'a.ts', comparison: 'worktree' });
    mockRpcCall.mockReset();

    service.handleMessage({ type: MESSAGE_TYPES.FILE_CONTENT_CHANGED });
    service.handleMessage({ type: 'something:else', payload: {} });
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(mockRpcCall).not.toHaveBeenCalled();
  });
});

// ============================================================================
// D2 — hunk stage / unstage / revert.
//
// The property under test throughout is the CLIENT-SIDE half of AC6. The
// backend refuses a write whose token no longer describes the repository, but
// it cannot see this failure mode: a revalidation landing between the user's
// click and the RPC re-points the tab record at a NEW diff with a NEW,
// perfectly fresh token and a renumbered `hunks` array. Forwarding the old
// ordinal with that fresh token would sail through the server's check and
// apply a hunk the user never looked at.
//
// Every refusal below asserts that NO apply RPC was made. "The write path was
// not entered" is the claim; a test that only checked the returned code would
// pass just as happily while git ran.
// ============================================================================

/** The one call site that matters — every git:applyHunks invocation. */
function applyCalls(): unknown[][] {
  return mockRpcCall.mock.calls.filter((c) => c[1] === 'git:applyHunks');
}

function diffCalls(): unknown[][] {
  return mockRpcCall.mock.calls.filter((c) => c[1] === 'git:diffFile');
}

function applyOk(snapshotToken = 'tok-after'): {
  success: true;
  data: GitApplyHunksResult;
} {
  return { success: true, data: { success: true, snapshotToken } };
}

function applyRefused(
  code: GitApplyHunksResult['code'] = 'APPLY_FAILED',
  message = 'git refused the patch. Nothing was written.',
): { success: true; data: GitApplyHunksResult } {
  return { success: true, data: { success: false, code, message } };
}

/**
 * Open a worktree diff carrying three hunks and return its tab key.
 *
 * The call log is cleared afterwards, so a later "no apply happened" assertion
 * is about the test and not about the fixture.
 */
async function openHunkedDiff(
  service: DiffTabsService,
  overrides: Partial<GitDiffFileResult> = {},
): Promise<string> {
  mockRpcCall.mockResolvedValue(
    ok(
      makeResult({
        path: 'a.ts',
        patch: 'diff --git a/a.ts b/a.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n',
        hunks: [hunk(0, 5), hunk(1, 25), hunk(2, 45)],
        ...overrides,
      }),
    ),
  );
  await openDiff(service, { path: 'a.ts', comparison: 'worktree' });
  mockRpcCall.mockClear();
  return diffTabKey('worktree', 'a.ts');
}

describe('DiffTabsService — hunk ordinals reach the tab record', () => {
  it('carries git hunk positions onto the diff tab, untouched', async () => {
    const { service } = makeService();
    const key = await openHunkedDiff(service);

    const diff = tabAt(service, key)?.diff;
    expect(diff?.hunks.map((h) => h.index)).toEqual([0, 1, 2]);
    expect(diff?.hunks.map((h) => h.modifiedStart)).toEqual([5, 25, 45]);
  });

  it('does NOT mirror the patch text onto the tab record', async () => {
    const { service } = makeService();
    const key = await openHunkedDiff(service);

    // Holding patch bytes across a state change is the staleness hazard the
    // always-regenerate backend design removes (batch-8a-report.md §7.2).
    const diff = tabAt(service, key)?.diff;
    expect(diff).not.toHaveProperty('patch');
    expect(JSON.stringify(diff)).not.toContain('diff --git');
  });

  it('drops hunks from a response that never reached a real read', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValue(
      ok(makeResult({ snapshotToken: '', hunks: [hunk(0, 5)] })),
    );
    await openDiff(service, { path: 'a.ts', comparison: 'worktree' });

    const diff = tabAt(service, diffTabKey('worktree', 'a.ts'))?.diff;
    expect(diff?.status).toBe('error');
    expect(diff?.hunks).toEqual([]);
  });

  it('drops hunks when a side could not be read', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValue(
      ok(makeResult({ original: errorBlob('timeout'), hunks: [hunk(0, 5)] })),
    );
    await openDiff(service, { path: 'a.ts', comparison: 'worktree' });

    const diff = tabAt(service, diffTabKey('worktree', 'a.ts'))?.diff;
    expect(diff?.status).toBe('error');
    expect(diff?.hunks).toEqual([]);
  });
});

describe('DiffTabsService.applyHunks — AC6, the client-side half', () => {
  it('refuses a selection made against a SUPERSEDED snapshot, without calling git', async () => {
    const { service } = makeService();
    const key = await openHunkedDiff(service);

    const result = await service.applyHunks({
      key,
      operation: 'stage',
      hunkIndices: [1],
      // What the user selected against, before a revalidation moved the tab on.
      snapshotToken: 'tok-the-user-saw',
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('STALE_SNAPSHOT');
    expect(result.snapshotToken).toBeUndefined();
    // THE assertion: the write path was never entered.
    expect(applyCalls()).toHaveLength(0);
  });

  it('re-reads the diff after refusing, so the next selection is made on the truth', async () => {
    const { service } = makeService();
    const key = await openHunkedDiff(service);

    await service.applyHunks({
      key,
      operation: 'stage',
      hunkIndices: [1],
      snapshotToken: 'stale',
    });

    expect(diffCalls()).toHaveLength(1);
  });

  it('refuses when the tab carries no token at all, without calling git', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValue(
      ok(makeResult({ snapshotToken: '', hunks: [hunk(0, 5)] })),
    );
    await openDiff(service, { path: 'a.ts', comparison: 'worktree' });
    mockRpcCall.mockClear();

    const result = await service.applyHunks({
      key: diffTabKey('worktree', 'a.ts'),
      operation: 'stage',
      hunkIndices: [0],
      // A caller echoing the empty token back must not be read as a match.
      snapshotToken: '',
    });

    expect(result.code).toBe('STALE_SNAPSHOT');
    expect(applyCalls()).toHaveLength(0);
  });

  it('refuses for a tab that is not open, without calling git', async () => {
    const { service } = makeService();
    await openHunkedDiff(service);

    const result = await service.applyHunks({
      key: diffTabKey('worktree', 'gone.ts'),
      operation: 'stage',
      hunkIndices: [0],
      snapshotToken: 'tok-1',
    });

    expect(result.code).toBe('STALE_SNAPSHOT');
    expect(applyCalls()).toHaveLength(0);
  });
});

describe('DiffTabsService.applyHunks — the wire', () => {
  it('sends the ordinal, the operation and the token the user acted on', async () => {
    const { service } = makeService();
    const key = await openHunkedDiff(service);
    mockRpcCall.mockResolvedValue(applyOk());

    await service.applyHunks({
      key,
      operation: 'stage',
      hunkIndices: [1],
      snapshotToken: 'tok-1',
    });

    expect(applyCalls()).toHaveLength(1);
    expect(applyCalls()[0][2]).toEqual({
      path: 'a.ts',
      comparison: 'worktree',
      operation: 'stage',
      hunkIndices: [1],
      snapshotToken: 'tok-1',
      workspaceRoot: '/ws',
    });
  });

  it('sends originalPath only for a staged rename', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValue(
      ok(
        makeResult({
          path: 'new.ts',
          originalPath: 'old.ts',
          comparison: 'staged',
          hunks: [hunk(0, 3)],
        }),
      ),
    );
    await service.openDiff({
      path: 'new.ts',
      comparison: 'staged',
      origPath: 'old.ts',
    });
    mockRpcCall.mockClear();
    mockRpcCall.mockResolvedValue(applyOk());

    await service.applyHunks({
      key: diffTabKey('staged', 'new.ts'),
      operation: 'unstage',
      hunkIndices: [0],
      snapshotToken: 'tok-1',
    });

    expect(applyCalls()[0][2]).toMatchObject({
      path: 'new.ts',
      originalPath: 'old.ts',
      operation: 'unstage',
      comparison: 'staged',
    });
  });

  it('(AC8) re-reads the diff after a SUCCESSFUL apply, in every host', async () => {
    const { service } = makeService();
    const key = await openHunkedDiff(service);
    mockRpcCall.mockResolvedValue(applyOk());

    await service.applyHunks({
      key,
      operation: 'stage',
      hunkIndices: [0],
      snapshotToken: 'tok-1',
    });

    // Only Electron watches `.git/index`; VS Code and the CLI have no watcher,
    // so the refresh must hang off the RPC response rather than off a push.
    expect(diffCalls()).toHaveLength(1);
  });

  it('(AC8) re-reads the diff after a FAILED apply too', async () => {
    const { service } = makeService();
    const key = await openHunkedDiff(service);
    mockRpcCall.mockResolvedValue(applyRefused());

    const result = await service.applyHunks({
      key,
      operation: 'stage',
      hunkIndices: [0],
      snapshotToken: 'tok-1',
    });

    expect(result.success).toBe(false);
    expect(diffCalls()).toHaveLength(1);
  });

  it('passes the backend refusal through verbatim — the frontend never paraphrases it', async () => {
    const { service } = makeService();
    const key = await openHunkedDiff(service);
    mockRpcCall.mockResolvedValue(
      applyRefused(
        'STALE_SNAPSHOT',
        'The file changed since this diff was read.',
      ),
    );

    const result = await service.applyHunks({
      key,
      operation: 'stage',
      hunkIndices: [0],
      snapshotToken: 'tok-1',
    });

    expect(result.code).toBe('STALE_SNAPSHOT');
    expect(result.message).toBe('The file changed since this diff was read.');
  });

  it('maps a transport failure to UNKNOWN, with no snapshot token to retry with', async () => {
    const { service } = makeService();
    const key = await openHunkedDiff(service);
    mockRpcCall.mockResolvedValue(fail());

    const result = await service.applyHunks({
      key,
      operation: 'revert',
      hunkIndices: [2],
      snapshotToken: 'tok-1',
    });

    expect(result).toMatchObject({ success: false, code: 'UNKNOWN' });
    expect(result.snapshotToken).toBeUndefined();
    expect(result.message).toContain('Nothing was applied');
  });

  it('applyHunksFn is the same guard, reachable without injecting the service', async () => {
    const { service } = makeService();
    const key = await openHunkedDiff(service);

    // `DiffViewComponent` receives this as an input, so it must carry `this`.
    const boundApply = service.applyHunksFn;
    const result = await boundApply({
      key,
      operation: 'stage',
      hunkIndices: [0],
      snapshotToken: 'not-the-tab-token',
    });

    expect(result.code).toBe('STALE_SNAPSHOT');
    expect(applyCalls()).toHaveLength(0);
  });
});
