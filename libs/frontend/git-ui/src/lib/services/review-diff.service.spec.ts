/**
 * ReviewDiffService specs. The revalidation cases are the Task 19.1 (RC11)
 * contract ported from `diff-tabs.service.spec.ts`, retargeted from dock tabs
 * to mounted canvas entries; the rest cover what is new here — the
 * `(comparison, path, origPath)` cache, lazy reads for mounted files only,
 * read-only historical entries and the workspace lifecycle.
 *
 * `rpcCall` is mocked at the module boundary, matching the other git services.
 */

import { TestBed } from '@angular/core/testing';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  GitApplyHunksResult,
  GitBlobRead,
  GitDiffFileResult,
  GitFileStatus,
  GitHunkRef,
  GitReviewFileResult,
} from '@ptah-extension/shared';
import {
  ReviewDiffService,
  reviewDiffKey,
  type ReviewDiffComparison,
  type ReviewDiffRequest,
} from './review-diff.service';
import { GitStatusService } from './git-status.service';
import { GIT_READ_TRANSPORT_MESSAGE } from './git-read-error-messages';

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

function makeResult(
  overrides: Partial<GitDiffFileResult> = {},
): GitDiffFileResult {
  return {
    path: 'a.ts',
    originalPath: 'a.ts',
    comparison: 'worktree',
    original: content('old'),
    modified: content('new'),
    originalRef: { kind: 'index' },
    modifiedRef: { kind: 'worktree' },
    snapshotToken: 'tok-1',
    patch: null,
    hunks: [],
    ...overrides,
  };
}

function hunk(index: number, start: number): GitHunkRef {
  return {
    index,
    originalStart: start,
    originalLines: 1,
    modifiedStart: start,
    modifiedLines: 1,
    header: `@@ -${start},1 +${start},1 @@`,
  };
}

function ok<T>(data: T): { success: true; data: T } {
  return { success: true, data };
}
function fail(error = 'transport down'): { success: false; error: string } {
  return { success: false, error };
}

function fileStatus(path: string, origPath?: string): GitFileStatus {
  return {
    path,
    status: 'M',
    staged: false,
    ...(origPath ? { origPath } : {}),
  };
}

const WORKTREE: ReviewDiffComparison = { kind: 'worktree' };
const STAGED: ReviewDiffComparison = { kind: 'staged' };
const HISTORICAL: ReviewDiffComparison = {
  kind: 'historical',
  base: { name: 'abc^', sha: 'b'.repeat(40) },
  head: { name: 'abc', sha: 'h'.repeat(40) },
};

interface Ctx {
  service: ReviewDiffService;
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
  return { service: TestBed.inject(ReviewDiffService), active };
}

/** Drain the promise chain a read runs on. */
async function drain(microtasks = 12): Promise<void> {
  for (let i = 0; i < microtasks; i++) await Promise.resolve();
}

/** Mount a worktree entry and let its first read land, then reset the mock. */
async function mountFresh(
  service: ReviewDiffService,
  request: Partial<ReviewDiffRequest> & { path: string },
  result: Partial<GitDiffFileResult> = {},
): Promise<string> {
  mockRpcCall.mockResolvedValueOnce(
    ok(makeResult({ path: request.path, ...result })),
  );
  const key = service.mount({ comparison: WORKTREE, ...request });
  await drain();
  mockRpcCall.mockReset();
  return key;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockRpcCall.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

// ============================================================================

describe('ReviewDiffService cache and mounting', () => {
  it('keys by (comparison, path, origPath) and reads on first mount', async () => {
    const { service } = makeService();
    const key = await mountFresh(service, { path: 'src/a.ts' });

    expect(key).toBe(reviewDiffKey({ comparison: WORKTREE, path: 'src/a.ts' }));
    const entry = service.entry(key);
    expect(entry?.diff?.status).toBe('fresh');
    expect(entry?.diff?.modified).toBe('new');
    expect(reviewDiffKey({ comparison: STAGED, path: 'src/a.ts' })).not.toBe(
      key,
    );
    expect(
      reviewDiffKey({
        comparison: WORKTREE,
        path: 'src/a.ts',
        origPath: 'b.ts',
      }),
    ).not.toBe(key);
  });

  it('shows the entry as loading (diff null) until the first read lands', () => {
    const { service } = makeService();
    mockRpcCall.mockReturnValue(new Promise(() => undefined));
    const key = service.mount({ comparison: WORKTREE, path: 'a.ts' });
    expect(service.entry(key)?.diff).toBeNull();
    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall.mock.calls[0][1]).toBe('git:diffFile');
  });

  it('a remount of a cached, valid entry issues no read', async () => {
    const { service } = makeService();
    const key = await mountFresh(service, { path: 'a.ts' });
    service.unmount(key);
    service.mount({ comparison: WORKTREE, path: 'a.ts' });
    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('sends originalPath on the wire only when it differs from path', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValue(ok(makeResult()));
    service.mount({ comparison: STAGED, path: 'new.ts', origPath: 'old.ts' });
    service.mount({
      comparison: WORKTREE,
      path: 'same.ts',
      origPath: 'same.ts',
    });
    await drain();

    expect(mockRpcCall.mock.calls[0][2]).toMatchObject({
      path: 'new.ts',
      comparison: 'staged',
      originalPath: 'old.ts',
      workspaceRoot: '/ws',
    });
    expect(mockRpcCall.mock.calls[1][2]).not.toHaveProperty('originalPath');
  });

  it('(A1) a transport failure on the FIRST read is an error, not empty content', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValue(fail());
    const key = service.mount({ comparison: WORKTREE, path: 'a.ts' });
    await drain();
    const diff = service.entry(key)?.diff;
    expect(diff?.status).toBe('error');
    expect(diff?.errorMessage).toBe(GIT_READ_TRANSPORT_MESSAGE);
  });

  it('retry() re-reads an entry whose read failed', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValueOnce(fail());
    const key = service.mount({ comparison: WORKTREE, path: 'a.ts' });
    await drain();
    mockRpcCall.mockResolvedValueOnce(ok(makeResult()));
    await service.retry(key);
    expect(service.entry(key)?.diff?.status).toBe('fresh');
  });

  it.each([
    [
      'too-large',
      { outcome: 'too-large', byteLength: 5_000_000 } as GitBlobRead,
      5_000_000,
    ],
    [
      'lfs-pointer',
      {
        outcome: 'lfs-pointer',
        oid: 'a'.repeat(64),
        size: 9_000,
      } as GitBlobRead,
      9_000,
    ],
  ] as const)(
    '(Req 6.10) carries an unshipped %s side, with no hunks',
    async (reason, read, size) => {
      const { service } = makeService();
      const key = await mountFresh(
        service,
        { path: 'big.bin' },
        { modified: read, hunks: [hunk(0, 1)] },
      );
      const diff = service.entry(key)?.diff;
      expect(diff?.status).toBe('fresh');
      expect(diff?.unrenderable).toEqual({ side: 'modified', reason, size });
      expect(diff?.hunks).toEqual([]);
      expect(diff?.isBinary).toBe(false);
    },
  );

  it('a plain text read carries no unrenderable side', async () => {
    const { service } = makeService();
    const key = await mountFresh(service, { path: 'a.ts' });
    expect(service.entry(key)?.diff).not.toHaveProperty('unrenderable');
  });

  it('an unshipped side survives a refresh that could not reach git', async () => {
    const { service } = makeService();
    const key = await mountFresh(
      service,
      { path: 'big.bin' },
      { original: { outcome: 'too-large', byteLength: 4_000_000 } },
    );
    mockRpcCall.mockResolvedValueOnce(fail());
    await service.retry(key);
    const diff = service.entry(key)?.diff;
    expect(diff?.status).toBe('stale');
    expect(diff?.unrenderable).toEqual({
      side: 'original',
      reason: 'too-large',
      size: 4_000_000,
    });
  });

  it('bounds the unmounted cache, evicting the oldest first', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValue(ok(makeResult()));
    const keys: string[] = [];
    for (let i = 0; i < 66; i++) {
      keys.push(service.mount({ comparison: WORKTREE, path: `f${i}.ts` }));
    }
    await drain();
    for (const key of keys) service.unmount(key);

    expect(service.entries().size).toBe(64);
    expect(service.entry(keys[0])).toBeUndefined();
    expect(service.entry(keys[1])).toBeUndefined();
    expect(service.entry(keys[65])).toBeDefined();
  });

  it('a key mounted twice stays mounted until both sections unmount', async () => {
    const { service } = makeService();
    const key = await mountFresh(service, { path: 'a.ts' });
    service.mount({ comparison: WORKTREE, path: 'a.ts' });
    service.unmount(key);

    mockRpcCall.mockResolvedValue(ok(makeResult()));
    await service.retry(key);
    expect(mockRpcCall).toHaveBeenCalledTimes(1);
  });
});

describe('ReviewDiffService refresh (A1)', () => {
  it('(A1 AC6) does not clear content while the read is in flight', async () => {
    const { service } = makeService();
    const key = await mountFresh(service, { path: 'a.ts' });

    let resolveRpc!: (v: unknown) => void;
    mockRpcCall.mockReturnValue(new Promise((res) => (resolveRpc = res)));
    const pending = service.retry(key);
    expect(service.entry(key)?.diff?.status).toBe('refreshing');
    expect(service.entry(key)?.diff?.modified).toBe('new');

    resolveRpc(ok(makeResult({ modified: content('newer') })));
    await pending;
    expect(service.entry(key)?.diff?.status).toBe('fresh');
    expect(service.entry(key)?.diff?.modified).toBe('newer');
  });

  it('(A1 AC7 / A3) a failed side shows sanitized copy and keeps the previous content', async () => {
    const { service } = makeService();
    const key = await mountFresh(service, { path: 'a.ts' });
    mockRpcCall.mockResolvedValue(
      ok(
        makeResult({
          modified: {
            outcome: 'error',
            code: 'permission-denied',
            message: 'EACCES',
          },
        }),
      ),
    );
    await service.retry(key);
    const diff = service.entry(key)?.diff;
    expect(diff?.status).toBe('error');
    expect(diff?.errorMessage).toBe(
      'Permission denied while reading this file from git.',
    );
    expect(diff?.modified).toBe('new');
  });

  it('(A1) a transport failure on refresh -> stale, content retained', async () => {
    const { service } = makeService();
    const key = await mountFresh(service, { path: 'a.ts' });
    mockRpcCall.mockResolvedValue(fail());
    await service.retry(key);
    expect(service.entry(key)?.diff?.status).toBe('stale');
    expect(service.entry(key)?.diff?.modified).toBe('new');
  });

  it('(A3) an empty snapshotToken is never fresh and carries no hunks', async () => {
    const { service } = makeService();
    const key = await mountFresh(service, { path: 'a.ts' });
    mockRpcCall.mockResolvedValue(
      ok(makeResult({ snapshotToken: '', hunks: [hunk(0, 1)] })),
    );
    await service.retry(key);
    expect(service.entry(key)?.diff?.status).toBe('error');
    expect(service.entry(key)?.diff?.modified).toBe('new');
  });

  it('carries hunk ordinals onto the record untouched', async () => {
    const { service } = makeService();
    const key = await mountFresh(
      service,
      { path: 'a.ts' },
      { hunks: [hunk(0, 1), hunk(1, 9)] },
    );
    expect(service.entry(key)?.diff?.hunks).toEqual([hunk(0, 1), hunk(1, 9)]);
  });

  it('drops the response when the workspace changed in flight, marking stale', async () => {
    const { service, active } = makeService();
    const key = await mountFresh(service, { path: 'a.ts' });
    let resolveRpc!: (v: unknown) => void;
    mockRpcCall.mockReturnValueOnce(new Promise((res) => (resolveRpc = res)));
    const pending = service.retry(key);

    active.path = '/other';
    resolveRpc(ok(makeResult({ modified: content('leaked') })));
    await pending;

    expect(service.entry(key)?.diff?.modified).toBe('new');
    expect(service.entry(key)?.diff?.status).toBe('stale');
  });
});

describe('ReviewDiffService.onGitStatusUpdate', () => {
  it('debounces at 250ms and revalidates every mounted mutable entry', async () => {
    const { service } = makeService();
    await mountFresh(service, { path: 'a.ts' });
    await mountFresh(service, { path: 'b.ts' });
    mockRpcCall.mockResolvedValue(ok(makeResult()));

    service.onGitStatusUpdate('/ws');
    service.onGitStatusUpdate('/ws');
    service.onGitStatusUpdate('/ws');
    jest.advanceTimersByTime(249);
    expect(mockRpcCall).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(2);
  });

  it('ignores a push for a background workspace', async () => {
    const { service } = makeService();
    await mountFresh(service, { path: 'a.ts' });
    service.onGitStatusUpdate('/other');
    jest.advanceTimersByTime(1000);
    await drain();
    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('accepts a push for the active workspace spelled with backslashes and another drive-letter case', async () => {
    const { service, active } = makeService();
    active.path = 'D:/repo';
    await mountFresh(service, { path: 'src/a.ts' });
    await mountFresh(service, { path: 'src/b.ts' });
    mockRpcCall.mockResolvedValue(ok(makeResult({ path: 'src/a.ts' })));

    // Scoped push: Windows-separated root AND file path.
    service.onGitStatusUpdate(
      'd:\\repo\\',
      ['workspace'],
      [fileStatus('src\\a.ts')],
    );
    jest.advanceTimersByTime(250);
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall.mock.calls[0][2]).toMatchObject({ path: 'src/a.ts' });
  });

  it('dispose() cancels a pending revalidation', async () => {
    const { service } = makeService();
    await mountFresh(service, { path: 'a.ts' });
    service.onGitStatusUpdate('/ws');
    service.dispose();
    jest.advanceTimersByTime(1000);
    await drain();
    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('marks an UNMOUNTED entry invalidated instead of reading it, then reads on remount', async () => {
    const { service } = makeService();
    const key = await mountFresh(service, { path: 'a.ts' });
    service.unmount(key);

    service.onGitStatusUpdate('/ws', ['index'], []);
    jest.advanceTimersByTime(250);
    await drain();
    expect(mockRpcCall).not.toHaveBeenCalled();
    expect(service.entry(key)?.invalidated).toBe(true);

    mockRpcCall.mockResolvedValue(ok(makeResult({ modified: content('v2') })));
    service.mount({ comparison: WORKTREE, path: 'a.ts' });
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(service.entry(key)?.invalidated).toBe(false);
    expect(service.entry(key)?.diff?.modified).toBe('v2');
  });

  it('never revalidates a historical entry', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValueOnce(
      ok<GitReviewFileResult>({
        success: true,
        path: 'a.ts',
        originalPath: 'a.ts',
        baseSha: 'b'.repeat(40),
        headSha: 'h'.repeat(40),
        original: content('x'),
        modified: content('y'),
      }),
    );
    service.mount({ comparison: HISTORICAL, path: 'a.ts' });
    await drain();
    mockRpcCall.mockReset();

    service.onGitStatusUpdate('/ws');
    jest.advanceTimersByTime(250);
    await drain();
    expect(mockRpcCall).not.toHaveBeenCalled();
  });
});

// ============================================================================
// RC11 — the Task 19.1 contract, moved with the logic.
// ============================================================================

describe('ReviewDiffService — scoped, queued refresh (RC11)', () => {
  it('a workspace-only cause refreshes only the entry whose file changed (1 of 3)', async () => {
    const { service } = makeService();
    await mountFresh(service, { path: 'a.ts' });
    await mountFresh(service, { path: 'b.ts' });
    await mountFresh(service, { path: 'c.ts' });

    mockRpcCall.mockResolvedValue(ok(makeResult({ path: 'b.ts' })));
    service.onGitStatusUpdate('/ws', ['workspace'], [fileStatus('b.ts')]);
    jest.advanceTimersByTime(250);
    await drain();

    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall.mock.calls[0][2]).toMatchObject({ path: 'b.ts' });
  });

  it('a workspace-only cause matches a renamed entry by its pre-rename path', async () => {
    const { service } = makeService();
    await mountFresh(
      service,
      { path: 'new.ts', origPath: 'old.ts', comparison: STAGED },
      { originalPath: 'old.ts', comparison: 'staged' },
    );
    mockRpcCall.mockResolvedValue(
      ok(makeResult({ path: 'new.ts', originalPath: 'old.ts' })),
    );

    service.onGitStatusUpdate('/ws', ['workspace'], [fileStatus('old.ts')]);
    jest.advanceTimersByTime(250);
    await drain();

    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall.mock.calls[0][2]).toMatchObject({ path: 'new.ts' });
  });

  it('a workspace-only cause still refreshes an entry whose file left the status set', async () => {
    const { service } = makeService();
    await mountFresh(service, { path: 'a.ts' });
    await mountFresh(service, { path: 'b.ts' });

    mockRpcCall.mockResolvedValue(ok(makeResult()));
    service.onGitStatusUpdate(
      '/ws',
      ['index'],
      [fileStatus('a.ts'), fileStatus('b.ts')],
    );
    jest.advanceTimersByTime(250);
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(2);

    mockRpcCall.mockClear();
    service.onGitStatusUpdate('/ws', ['workspace'], []);
    jest.advanceTimersByTime(250);
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(2);
  });

  it('an index cause refreshes every mounted entry', async () => {
    const { service } = makeService();
    await mountFresh(service, { path: 'a.ts' });
    await mountFresh(service, { path: 'b.ts' });
    await mountFresh(service, { path: 'c.ts' });

    mockRpcCall.mockResolvedValue(ok(makeResult()));
    service.onGitStatusUpdate('/ws', ['index'], [fileStatus('a.ts')]);
    jest.advanceTimersByTime(250);
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(3);
  });

  it('requests landing while a read runs queue exactly ONE trailing run', async () => {
    const { service } = makeService();
    const key = await mountFresh(service, { path: 'a.ts' });

    let resolveFirst!: (value: unknown) => void;
    mockRpcCall.mockReturnValueOnce(
      new Promise((resolve) => (resolveFirst = resolve)),
    );
    const first = service.retry(key);
    void service.retry(key);
    void service.retry(key);
    void service.retry(key);
    expect(mockRpcCall).toHaveBeenCalledTimes(1);

    let resolveTrailing!: (value: unknown) => void;
    mockRpcCall.mockReturnValueOnce(
      new Promise((resolve) => (resolveTrailing = resolve)),
    );
    resolveFirst(ok(makeResult({ modified: content('run-1') })));
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(2);

    resolveTrailing(ok(makeResult({ modified: content('run-2') })));
    await first;
    expect(mockRpcCall).toHaveBeenCalledTimes(2);
    expect(service.entry(key)?.diff?.modified).toBe('run-2');
  });

  it('drops a queued trailing run when the workspace changed during the read', async () => {
    const { service, active } = makeService();
    const key = await mountFresh(service, { path: 'a.ts' });

    let resolveFirst!: (value: unknown) => void;
    mockRpcCall.mockReturnValueOnce(
      new Promise((resolve) => (resolveFirst = resolve)),
    );
    const first = service.retry(key);
    void service.retry(key);

    active.path = '/other';
    mockRpcCall.mockResolvedValue(
      ok(makeResult({ modified: content('from-workspace-b') })),
    );
    resolveFirst(ok(makeResult({ modified: content('run-1') })));
    await first;
    await drain();

    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(service.entry(key)?.diff?.modified).toBe('new');
    expect(service.entry(key)?.diff?.status).toBe('stale');
  });

  it('a queued trailing run for an entry unmounted meanwhile becomes an invalidation', async () => {
    const { service } = makeService();
    const key = await mountFresh(service, { path: 'a.ts' });

    let resolveFirst!: (value: unknown) => void;
    mockRpcCall.mockReturnValueOnce(
      new Promise((resolve) => (resolveFirst = resolve)),
    );
    const first = service.retry(key);
    void service.retry(key);
    service.unmount(key);

    resolveFirst(ok(makeResult({ modified: content('run-1') })));
    await first;

    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(service.entry(key)?.diff?.modified).toBe('run-1');
    expect(service.entry(key)?.invalidated).toBe(true);
  });

  it('a failed scoped refresh keeps the previous content', async () => {
    const { service } = makeService();
    const key = await mountFresh(service, { path: 'a.ts' });
    mockRpcCall.mockResolvedValue(fail());
    service.onGitStatusUpdate('/ws', ['workspace'], [fileStatus('a.ts')]);
    jest.advanceTimersByTime(250);
    await drain();

    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(service.entry(key)?.diff?.status).toBe('stale');
    expect(service.entry(key)?.diff?.modified).toBe('new');
  });

  it('a statusUnavailable push refreshes ALL entries and keeps the previous file set', async () => {
    const { service } = makeService();
    await mountFresh(service, { path: 'a.ts' });
    await mountFresh(service, { path: 'b.ts' });
    mockRpcCall.mockResolvedValue(ok(makeResult()));

    service.onGitStatusUpdate(
      '/ws',
      ['workspace'],
      [fileStatus('a.ts'), fileStatus('b.ts')],
    );
    jest.advanceTimersByTime(250);
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(2);
    mockRpcCall.mockClear();

    service.handleMessage({
      type: MESSAGE_TYPES.GIT_STATUS_UPDATE,
      payload: {
        workspaceRoot: '/ws',
        causes: ['workspace'],
        files: [],
        statusUnavailable: 'output-too-large',
      },
    });
    jest.advanceTimersByTime(250);
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(2);
    mockRpcCall.mockClear();

    service.onGitStatusUpdate('/ws', ['workspace'], []);
    jest.advanceTimersByTime(250);
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(2);
  });

  it('a present cause with an absent or malformed files list refreshes every entry', async () => {
    const { service } = makeService();
    await mountFresh(service, { path: 'a.ts' });
    await mountFresh(service, { path: 'b.ts' });
    await mountFresh(service, { path: 'c.ts' });
    mockRpcCall.mockResolvedValue(ok(makeResult()));

    service.onGitStatusUpdate('/ws', ['workspace']);
    jest.advanceTimersByTime(250);
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(3);
    mockRpcCall.mockClear();

    service.handleMessage({
      type: MESSAGE_TYPES.GIT_STATUS_UPDATE,
      payload: { workspaceRoot: '/ws', causes: ['workspace'], files: 'bogus' },
    });
    jest.advanceTimersByTime(250);
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(3);
  });

  it('a rejected rpcCall clears the rerun marker (no phantom trailing pass)', async () => {
    const { service } = makeService();
    const key = await mountFresh(service, { path: 'a.ts' });
    mockRpcCall
      .mockRejectedValueOnce(new Error('transport threw'))
      .mockResolvedValueOnce(
        ok(makeResult({ modified: content('after-reject') })),
      );
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const first = service.retry(key);
    void service.retry(key);
    await first;

    expect(mockRpcCall).toHaveBeenCalledTimes(2);
    expect(service.entry(key)?.diff?.status).toBe('fresh');
    expect(service.entry(key)?.diff?.modified).toBe('after-reject');

    mockRpcCall.mockResolvedValueOnce(
      ok(makeResult({ modified: content('v3') })),
    );
    await service.retry(key);
    expect(mockRpcCall).toHaveBeenCalledTimes(3);
    expect(service.entry(key)?.diff?.modified).toBe('v3');
    errorSpy.mockRestore();
  });
});

describe('ReviewDiffService.onFileContentChanged', () => {
  it('revalidates only a matching WORKTREE entry, never a staged one', async () => {
    const { service } = makeService();
    await mountFresh(service, { path: 'a.ts' });
    await mountFresh(service, { path: 'a.ts', comparison: STAGED });
    mockRpcCall.mockResolvedValue(ok(makeResult()));

    service.handleMessage({
      type: MESSAGE_TYPES.FILE_CONTENT_CHANGED,
      payload: { filePaths: ['/ws/a.ts'], truncated: false },
    });
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall.mock.calls[0][2]).toMatchObject({
      comparison: 'worktree',
    });
  });

  it('is a no-op for a path outside the workspace and for an empty batch', async () => {
    const { service } = makeService();
    await mountFresh(service, { path: 'a.ts' });
    service.onFileContentChanged({
      filePaths: ['/elsewhere/a.ts'],
      truncated: false,
    });
    service.onFileContentChanged({ filePaths: [], truncated: false });
    await drain();
    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('a truncated batch triggers ONE debounced revalidation of every entry', async () => {
    const { service } = makeService();
    await mountFresh(service, { path: 'a.ts' });
    await mountFresh(service, { path: 'b.ts' });
    mockRpcCall.mockResolvedValue(ok(makeResult()));

    service.onFileContentChanged({ filePaths: [], truncated: true });
    service.onFileContentChanged({ filePaths: [], truncated: true });
    jest.advanceTimersByTime(250);
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(2);
  });

  it('ignores a malformed payload and an unrelated type', async () => {
    const { service } = makeService();
    await mountFresh(service, { path: 'a.ts' });
    service.handleMessage({ type: MESSAGE_TYPES.FILE_CONTENT_CHANGED });
    service.handleMessage({
      type: MESSAGE_TYPES.FILE_CONTENT_CHANGED,
      payload: { filePaths: 'nope' },
    });
    service.handleMessage({ type: 'something:else', payload: {} });
    jest.advanceTimersByTime(1000);
    await drain();
    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('matches a Windows push whose drive letter and separators differ from the workspace', async () => {
    const { service, active } = makeService();
    active.path = 'D:/repo';
    await mountFresh(service, { path: 'src/a.ts' });
    mockRpcCall.mockResolvedValue(ok(makeResult({ path: 'src/a.ts' })));

    service.onFileContentChanged({
      filePaths: ['d:\\repo\\src\\a.ts'],
      truncated: false,
    });
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall.mock.calls[0][2]).toMatchObject({ path: 'src/a.ts' });
  });

  it('does not treat a sibling folder sharing the root as a prefix as inside the workspace', async () => {
    const { service, active } = makeService();
    active.path = 'D:/repo';
    await mountFresh(service, { path: 'a.ts' });
    service.onFileContentChanged({
      filePaths: ['D:/repository/a.ts', 'D:/repo'],
      truncated: false,
    });
    await drain();
    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('declares exactly the two push types it acts on', () => {
    const { service } = makeService();
    expect([...service.handledMessageTypes]).toEqual([
      MESSAGE_TYPES.GIT_STATUS_UPDATE,
      MESSAGE_TYPES.FILE_CONTENT_CHANGED,
    ]);
  });
});

describe('ReviewDiffService historical entries', () => {
  function reviewFile(
    overrides: Partial<GitReviewFileResult> = {},
  ): GitReviewFileResult {
    return {
      success: true,
      path: 'a.ts',
      originalPath: 'a.ts',
      baseSha: 'b'.repeat(40),
      headSha: 'h'.repeat(40),
      original: content('before'),
      modified: content('after'),
      ...overrides,
    };
  }

  it('reads through git:reviewFile with the resolved SHAs, read-only', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValue(ok(reviewFile()));
    const key = service.mount({
      comparison: HISTORICAL,
      path: 'a.ts',
      origPath: 'z.ts',
    });
    await drain();

    expect(mockRpcCall.mock.calls[0][1]).toBe('git:reviewFile');
    expect(mockRpcCall.mock.calls[0][2]).toMatchObject({
      baseSha: 'b'.repeat(40),
      headSha: 'h'.repeat(40),
      path: 'a.ts',
      originalPath: 'z.ts',
      workspaceRoot: '/ws',
    });
    const diff = service.entry(key)?.diff;
    expect(diff?.provenance.kind).toBe('historical');
    expect(diff?.status).toBe('fresh');
    expect(diff?.snapshotToken).toBe('');
    expect(diff?.hunks).toEqual([]);
    expect(diff?.original).toBe('before');
    expect(diff?.modified).toBe('after');
  });

  it('a refused read is an error row, never empty content', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValue(
      ok(reviewFile({ success: false, error: 'bad object' })),
    );
    const key = service.mount({ comparison: HISTORICAL, path: 'a.ts' });
    await drain();
    expect(service.entry(key)?.diff?.status).toBe('error');
    expect(service.entry(key)?.diff?.errorDetail).toBe('bad object');
  });

  it.each([
    [
      'too-large',
      { outcome: 'too-large', byteLength: 3_000_000 } as GitBlobRead,
      3_000_000,
    ],
    [
      'lfs-pointer',
      { outcome: 'lfs-pointer', oid: 'f'.repeat(64), size: 42 } as GitBlobRead,
      42,
    ],
  ] as const)(
    'carries an unshipped %s side instead of empty text',
    async (reason, read, size) => {
      const { service } = makeService();
      mockRpcCall.mockResolvedValue(ok(reviewFile({ original: read })));
      const key = service.mount({ comparison: HISTORICAL, path: 'a.ts' });
      await drain();
      const diff = service.entry(key)?.diff;
      expect(diff?.status).toBe('fresh');
      expect(diff?.unrenderable).toEqual({ side: 'original', reason, size });
      expect(diff?.originalRef).toEqual({
        kind: 'commit',
        sha: 'b'.repeat(40),
      });
    },
  );

  it('applyHunks refuses a historical entry without calling git', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValue(ok(reviewFile()));
    const key = service.mount({ comparison: HISTORICAL, path: 'a.ts' });
    await drain();
    mockRpcCall.mockReset();

    const result = await service.applyHunks({
      key,
      operation: 'stage',
      hunkIndices: [0],
      snapshotToken: '',
    });
    expect(result).toMatchObject({ success: false, code: 'INVALID_OPERATION' });
    expect(mockRpcCall).not.toHaveBeenCalled();
  });
});

describe('ReviewDiffService.applyHunks (STALE_SNAPSHOT rules)', () => {
  it('refuses a selection made against a superseded token without calling git, then re-reads', async () => {
    const { service } = makeService();
    const key = await mountFresh(
      service,
      { path: 'a.ts' },
      { snapshotToken: 'tok-2' },
    );
    mockRpcCall.mockResolvedValue(ok(makeResult({ snapshotToken: 'tok-3' })));

    const result = await service.applyHunks({
      key,
      operation: 'stage',
      hunkIndices: [0],
      snapshotToken: 'tok-1',
    });
    expect(result).toMatchObject({ success: false, code: 'STALE_SNAPSHOT' });
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall.mock.calls[0][1]).toBe('git:diffFile');
  });

  it('refuses for an unknown key without calling git', async () => {
    const { service } = makeService();
    const result = await service.applyHunks({
      key: 'review:nope',
      operation: 'stage',
      hunkIndices: [0],
      snapshotToken: 'tok-1',
    });
    expect(result).toMatchObject({ success: false, code: 'STALE_SNAPSHOT' });
    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('sends ordinal, operation, token and the staged-rename originalPath, then re-reads', async () => {
    const { service } = makeService();
    const key = await mountFresh(
      service,
      { path: 'new.ts', origPath: 'old.ts', comparison: STAGED },
      { originalPath: 'old.ts', comparison: 'staged' },
    );
    const applied: GitApplyHunksResult = { success: true };
    mockRpcCall.mockImplementation((_vs: unknown, method: string) =>
      Promise.resolve(
        method === 'git:applyHunks'
          ? ok(applied)
          : ok(makeResult({ path: 'new.ts', originalPath: 'old.ts' })),
      ),
    );

    const result = await service.applyHunks({
      key,
      operation: 'unstage',
      hunkIndices: [1],
      snapshotToken: 'tok-1',
    });
    await drain();

    expect(result).toEqual(applied);
    expect(mockRpcCall.mock.calls[0][1]).toBe('git:applyHunks');
    expect(mockRpcCall.mock.calls[0][2]).toEqual({
      path: 'new.ts',
      originalPath: 'old.ts',
      comparison: 'staged',
      operation: 'unstage',
      hunkIndices: [1],
      snapshotToken: 'tok-1',
      workspaceRoot: '/ws',
    });
    expect(mockRpcCall.mock.calls[1][1]).toBe('git:diffFile');
  });

  it('passes a backend refusal through verbatim and still re-reads', async () => {
    const { service } = makeService();
    const key = await mountFresh(service, { path: 'a.ts' });
    const refused: GitApplyHunksResult = {
      success: false,
      code: 'APPLY_FAILED',
      message: 'git refused the patch.',
    };
    mockRpcCall.mockImplementation((_vs: unknown, method: string) =>
      Promise.resolve(
        method === 'git:applyHunks' ? ok(refused) : ok(makeResult()),
      ),
    );
    const result = await service.applyHunks({
      key,
      operation: 'stage',
      hunkIndices: [0],
      snapshotToken: 'tok-1',
    });
    await drain();
    expect(result).toEqual(refused);
    expect(mockRpcCall).toHaveBeenCalledTimes(2);
  });

  it('maps a transport failure (or a throw) to UNKNOWN', async () => {
    const { service } = makeService();
    const key = await mountFresh(service, { path: 'a.ts' });
    mockRpcCall.mockImplementation((_vs: unknown, method: string) =>
      method === 'git:applyHunks'
        ? Promise.reject(new Error('down'))
        : Promise.resolve(ok(makeResult())),
    );
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const result = await service.applyHunksFn({
      key,
      operation: 'revert',
      hunkIndices: [0],
      snapshotToken: 'tok-1',
    });
    expect(result).toMatchObject({ success: false, code: 'UNKNOWN' });
    errorSpy.mockRestore();
  });
});

describe('ReviewDiffService workspace lifecycle', () => {
  it('switchWorkspace drops the cache', async () => {
    const { service } = makeService();
    await mountFresh(service, { path: 'a.ts' });
    service.switchWorkspace('/ws2');
    expect(service.entries().size).toBe(0);
  });

  it('removeWorkspaceState drops the cache only for its own workspace', async () => {
    const { service } = makeService();
    await mountFresh(service, { path: 'a.ts' });
    service.removeWorkspaceState('/elsewhere');
    expect(service.entries().size).toBe(1);
    service.removeWorkspaceState('/ws');
    expect(service.entries().size).toBe(0);
  });

  it('a read that outlived a cache reset never overwrites the newer read for the same key', async () => {
    const { service } = makeService();
    let resolveOld!: (v: unknown) => void;
    let resolveNew!: (v: unknown) => void;
    mockRpcCall
      .mockReturnValueOnce(new Promise((res) => (resolveOld = res)))
      .mockReturnValueOnce(new Promise((res) => (resolveNew = res)));

    service.mount({ comparison: WORKTREE, path: 'a.ts' });
    await drain();
    // Away and back while the first read is still in flight.
    service.switchWorkspace('/ws2');
    const key = service.mount({ comparison: WORKTREE, path: 'a.ts' });
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(2);

    resolveNew(ok(makeResult({ modified: content('newer') })));
    await drain();
    resolveOld(ok(makeResult({ modified: content('older') })));
    await drain();

    expect(service.entry(key)?.diff?.modified).toBe('newer');
  });

  it('a mount after the active workspace moved starts from an empty cache', async () => {
    const { service, active } = makeService();
    const key = await mountFresh(service, { path: 'a.ts' });
    active.path = '/ws2';
    mockRpcCall.mockResolvedValue(ok(makeResult({ modified: content('ws2') })));
    service.mount({ comparison: WORKTREE, path: 'a.ts' });
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall.mock.calls[0][2]).toMatchObject({
      workspaceRoot: '/ws2',
    });
    expect(service.entry(key)?.diff?.modified).toBe('ws2');
  });
});

describe('ReviewDiffService read-only worktree root', () => {
  const ROOT = '/ws/.claude-worktrees/feature';
  const ROOTED: ReviewDiffComparison = { kind: 'worktree', root: ROOT };

  it('reads a rooted comparison from its root, under its own key', async () => {
    const { service } = makeService();
    const key = await mountFresh(service, {
      path: 'src/a.ts',
      comparison: ROOTED,
    });

    expect(key).not.toBe(
      reviewDiffKey({ comparison: WORKTREE, path: 'src/a.ts' }),
    );
    expect(service.entry(key)?.diff?.status).toBe('fresh');

    mockRpcCall.mockResolvedValueOnce(ok(makeResult({ path: 'src/a.ts' })));
    await service.retry(key);
    expect(mockRpcCall.mock.calls[0][1]).toBe('git:diffFile');
    expect(mockRpcCall.mock.calls[0][2]).toMatchObject({
      path: 'src/a.ts',
      comparison: 'worktree',
      workspaceRoot: ROOT,
    });
  });

  it('never applies a hunk to a rooted comparison', async () => {
    const { service } = makeService();
    const key = await mountFresh(
      service,
      { path: 'a.ts', comparison: ROOTED },
      { hunks: [hunk(0, 1)] },
    );

    const result = await service.applyHunks({
      key,
      operation: 'stage',
      hunkIndices: [0],
      snapshotToken: 'tok-1',
    });

    expect(result).toMatchObject({ success: false, code: 'INVALID_OPERATION' });
    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it("is not revalidated by the active workspace's pushes", async () => {
    const { service } = makeService();
    await mountFresh(service, { path: 'a.ts', comparison: ROOTED });

    service.onGitStatusUpdate('/ws', ['index'], [fileStatus('a.ts')]);
    jest.advanceTimersByTime(300);
    service.onFileContentChanged({ filePaths: ['/ws/a.ts'], truncated: false });
    await drain();

    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('invalidateRoot re-reads a reopened scope: mounted now, unmounted on remount', async () => {
    const { service } = makeService();
    const mounted = await mountFresh(service, {
      path: 'a.ts',
      comparison: ROOTED,
    });
    const parked = await mountFresh(service, {
      path: 'b.ts',
      comparison: ROOTED,
    });
    const active = await mountFresh(service, { path: 'c.ts' });
    service.unmount(parked);

    mockRpcCall.mockResolvedValue(ok(makeResult({ path: 'a.ts' })));
    service.invalidateRoot(`${ROOT}/`);
    await drain();

    // Only the mounted rooted entry reads now; the active one is untouched.
    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall.mock.calls[0][2]).toMatchObject({
      path: 'a.ts',
      workspaceRoot: ROOT,
    });
    expect(service.entry(parked)?.invalidated).toBe(true);
    expect(service.entry(active)?.invalidated).toBe(false);
    expect(service.entry(mounted)?.diff?.status).toBe('fresh');

    mockRpcCall.mockReset();
    mockRpcCall.mockResolvedValue(ok(makeResult({ path: 'b.ts' })));
    service.mount({ path: 'b.ts', comparison: ROOTED });
    await drain();
    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall.mock.calls[0][2]).toMatchObject({ path: 'b.ts' });
  });
});
