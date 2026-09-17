import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import type { EditorTab } from '../types/diff-tab.types';
import { DiffTabsService } from './diff-tabs.service';
import { GitBranchesService } from './git-branches.service';
import { GitStashService } from './git-stash.service';
import { GitStatusService } from './git-status.service';

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return {
    ...actual,
    rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  };
});

type RpcHandler = (params: Record<string, unknown>) => unknown;

function routeRpc(handlers: Record<string, RpcHandler>): void {
  mockRpcCall.mockImplementation(
    async (
      _vscode: unknown,
      method: string,
      params: Record<string, unknown>,
    ) => {
      const handler = handlers[method];
      if (!handler) return { success: false, error: `unexpected ${method}` };
      return { success: true, data: handler(params) };
    },
  );
}

const ENTRIES = [
  {
    index: 0,
    hash: '0123456789abcdef',
    message: 'WIP on main: tidy',
    branch: 'main',
    time: 1,
  },
  {
    index: 1,
    hash: 'fedcba9876543210',
    message: 'WIP on feat: spike',
    branch: 'feat',
    time: 2,
  },
];

describe('GitStashService', () => {
  let service: GitStashService;
  const workspace = signal<string | null>('/ws/a');
  const gitStatus = {
    activeWorkspacePath: workspace.asReadonly(),
    refresh: jest.fn(async () => undefined),
  };
  const gitBranches = { refreshForCauses: jest.fn(async () => undefined) };
  const diffTabs = { openHistoricalDiff: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    workspace.set('/ws/a');
    TestBed.configureTestingModule({
      providers: [
        GitStashService,
        { provide: VSCodeService, useValue: {} },
        { provide: GitStatusService, useValue: gitStatus },
        { provide: GitBranchesService, useValue: gitBranches },
        { provide: DiffTabsService, useValue: diffTabs },
      ],
    });
    service = TestBed.inject(GitStashService);
  });

  it('loads the stash list for the active workspace', async () => {
    routeRpc({ 'git:stashList': () => ({ count: 2, entries: ENTRIES }) });
    await service.loadList();
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:stashList',
      { workspaceRoot: '/ws/a' },
    );
    expect(service.entries()).toEqual(ENTRIES);
  });

  it('partitions state per workspace', async () => {
    routeRpc({ 'git:stashList': () => ({ count: 2, entries: ENTRIES }) });
    await service.loadList();
    workspace.set('/ws/b');
    expect(service.entries()).toEqual([]);
    workspace.set('/ws/a');
    expect(service.entries()).toEqual(ENTRIES);
  });

  it('drops a late list answer into the workspace that asked for it', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mockRpcCall.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const pending = service.loadList();
    workspace.set('/ws/b');
    resolve({ success: true, data: { count: 2, entries: ENTRIES } });
    await pending;
    expect(service.entries()).toEqual([]);
    workspace.set('/ws/a');
    expect(service.entries()).toEqual(ENTRIES);
  });

  it('keeps the latest same-workspace stash list response', async () => {
    const finishes: Array<(value: unknown) => void> = [];
    mockRpcCall.mockImplementation(
      () => new Promise((resolve) => finishes.push(resolve)),
    );
    const first = service.loadList();
    const second = service.loadList();
    const newest = [ENTRIES[1]];
    finishes[1]({ success: true, data: { count: 1, entries: newest } });
    await second;
    finishes[0]({ success: true, data: { count: 2, entries: ENTRIES } });
    await first;

    expect(service.entries()).toEqual(newest);
  });

  it('selects an entry, lists its files, and collapses on reselect', async () => {
    const files = [{ path: 'src/a.ts', status: 'M' }];
    routeRpc({ 'git:stashShow': () => ({ success: true, files }) });
    await service.select(ENTRIES[1]);
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:stashShow',
      {
        workspaceRoot: '/ws/a',
        index: 1,
        expectedHash: ENTRIES[1].hash,
      },
    );
    expect(service.selectedIndex()).toBe(1);
    expect(service.files()).toEqual(files);

    await service.select(ENTRIES[1]);
    expect(service.selectedIndex()).toBeNull();
    expect(service.files()).toEqual([]);
  });

  it('surfaces a stashShow failure', async () => {
    routeRpc({
      'git:stashShow': () => ({ success: false, files: [], error: 'bad ref' }),
    });
    await service.select(ENTRIES[0]);
    expect(service.error()).toBe('bad ref');
  });

  it.each([
    ['apply', 'git:stashApply'],
    ['pop', 'git:stashPop'],
    ['drop', 'git:stashDrop'],
  ] as const)(
    '%s calls %s and reloads list, stash count and status',
    async (kind, method) => {
      routeRpc({
        [method]: () => ({ success: true }),
        'git:stashList': () => ({ count: 1, entries: [ENTRIES[0]] }),
      });
      const result = await service.mutate(kind, ENTRIES[1]);
      expect(result).toEqual({ success: true });
      expect(mockRpcCall).toHaveBeenCalledWith(expect.anything(), method, {
        workspaceRoot: '/ws/a',
        index: 1,
        expectedHash: ENTRIES[1].hash,
      });
      expect(service.entries()).toEqual([ENTRIES[0]]);
      expect(gitBranches.refreshForCauses).toHaveBeenCalledWith(['refs-stash']);
      expect(gitStatus.refresh).toHaveBeenCalled();
      expect(service.busy()).toBe(false);
    },
  );

  it('reports a failed mutation without reloading', async () => {
    routeRpc({
      'git:stashPop': () => ({ success: false, error: 'conflict' }),
    });
    const result = await service.mutate('pop', ENTRIES[0]);
    expect(result).toEqual({ success: false, error: 'conflict' });
    expect(service.error()).toBe('conflict');
    expect(gitStatus.refresh).not.toHaveBeenCalled();
  });

  it('returns a successful mutation when reconciliation rejects', async () => {
    routeRpc({
      'git:stashApply': () => ({ success: true }),
      'git:stashList': () => ({ count: 2, entries: ENTRIES }),
    });
    gitBranches.refreshForCauses.mockRejectedValueOnce(
      new Error('refresh failed'),
    );

    await expect(service.mutate('apply', ENTRIES[0])).resolves.toEqual({
      success: true,
    });

    expect(service.error()).toBe(
      'Stash apply completed, but the view could not refresh.',
    );
  });

  it('reloads the list when the backend detects a shifted stash index', async () => {
    routeRpc({
      'git:stashPop': () => ({
        success: false,
        error: 'The stash list changed. Refresh and try again.',
      }),
      'git:stashList': () => ({ count: 1, entries: [ENTRIES[1]] }),
    });

    const result = await service.mutate('pop', ENTRIES[0]);

    expect(result.success).toBe(false);
    expect(service.entries()).toEqual([ENTRIES[1]]);
  });

  it('opens a stash file as a historical parent-vs-stash diff tab', async () => {
    routeRpc({
      'git:stashList': () => ({ count: 2, entries: ENTRIES }),
      'git:stashShow': () => ({
        success: true,
        files: [{ path: 'src/a.ts', status: 'M' }],
      }),
      'git:reviewChanges': () => ({
        success: true,
        base: { name: 'stash@{0}^1', sha: 'base' },
        head: { name: 'stash@{0}', sha: 'head' },
        mergeBaseSha: 'base',
        files: [],
        totals: { additions: 0, deletions: 0, binaryFiles: 0 },
      }),
      'git:reviewFile': () => ({
        success: true,
        path: 'src/a.ts',
        originalPath: 'src/a.ts',
        baseSha: 'base',
        headSha: 'head',
        original: { outcome: 'content', content: 'old' },
        modified: { outcome: 'content', content: 'new' },
      }),
    });
    await service.loadList();
    await service.select(ENTRIES[0]);
    await service.openFileDiff({ path: 'src/a.ts', status: 'M' });

    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:reviewChanges',
      {
        workspaceRoot: '/ws/a',
        base: `${ENTRIES[0].hash}^1`,
        head: ENTRIES[0].hash,
      },
    );
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:reviewFile',
      {
        workspaceRoot: '/ws/a',
        baseSha: 'base',
        headSha: 'head',
        path: 'src/a.ts',
      },
    );
    const tab = diffTabs.openHistoricalDiff.mock.calls[0][0] as EditorTab;
    expect(tab.diff?.provenance).toEqual({
      kind: 'historical',
      base: { name: `${ENTRIES[0].hash}^1`, sha: 'base' },
      head: { name: ENTRIES[0].hash, sha: 'head' },
    });
    expect(tab.fileName).toContain('WIP on main: tidy · 0123456');
    expect(tab.diff?.original).toBe('old');
    expect(tab.diff?.modified).toBe('new');
    expect(tab.diff?.hunks).toEqual([]);

    // Second file reuses the resolved refs.
    await service.openFileDiff({ path: 'src/a.ts', status: 'M' });
    expect(
      mockRpcCall.mock.calls.filter(([, m]) => m === 'git:reviewChanges'),
    ).toHaveLength(1);
  });

  it('does not open a diff when the stash selection changes during ref resolution', async () => {
    routeRpc({
      'git:stashList': () => ({ count: 2, entries: ENTRIES }),
      'git:stashShow': () => ({ success: true, files: [] }),
    });
    await service.loadList();
    await service.select(ENTRIES[0]);
    let finishRefs: (value: unknown) => void = () => undefined;
    mockRpcCall.mockImplementationOnce(
      () => new Promise((resolve) => (finishRefs = resolve)),
    );
    const pending = service.openFileDiff({ path: 'src/a.ts', status: 'M' });
    await service.select(ENTRIES[1]);
    finishRefs({
      success: true,
      data: {
        success: true,
        base: { sha: 'base' },
        head: { sha: 'head' },
        files: [],
        totals: { additions: 0, deletions: 0, binaryFiles: 0 },
      },
    });
    await pending;

    expect(diffTabs.openHistoricalDiff).not.toHaveBeenCalled();
    expect(
      mockRpcCall.mock.calls.filter(
        ([, method]) => method === 'git:reviewFile',
      ),
    ).toHaveLength(0);
  });

  it('does not open a diff when a mutation starts during ref resolution', async () => {
    routeRpc({
      'git:stashList': () => ({ count: 2, entries: ENTRIES }),
      'git:stashShow': () => ({ success: true, files: [] }),
      'git:stashApply': () => ({ success: true }),
    });
    await service.loadList();
    await service.select(ENTRIES[0]);
    let finishRefs: (value: unknown) => void = () => undefined;
    mockRpcCall.mockImplementationOnce(
      () => new Promise((resolve) => (finishRefs = resolve)),
    );
    const pending = service.openFileDiff({ path: 'src/a.ts', status: 'M' });
    await service.mutate('apply', ENTRIES[0]);
    finishRefs({
      success: true,
      data: {
        success: true,
        base: { sha: 'base' },
        head: { sha: 'head' },
        files: [],
        totals: { additions: 0, deletions: 0, binaryFiles: 0 },
      },
    });
    await pending;

    expect(diffTabs.openHistoricalDiff).not.toHaveBeenCalled();
  });

  it('invalidates a pre-mutation list response before reconciling', async () => {
    let finishOldList: (value: unknown) => void = () => undefined;
    mockRpcCall.mockImplementationOnce(
      () => new Promise((resolve) => (finishOldList = resolve)),
    );
    const oldList = service.loadList();
    routeRpc({
      'git:stashDrop': () => ({ success: true }),
      'git:stashList': () => ({ count: 1, entries: [ENTRIES[1]] }),
    });
    await service.mutate('drop', ENTRIES[0]);
    finishOldList({ success: true, data: { count: 2, entries: ENTRIES } });
    await oldList;

    expect(service.entries()).toEqual([ENTRIES[1]]);
  });

  it('clears filesLoading when an in-flight stashShow is collapsed', async () => {
    routeRpc({
      'git:stashList': () => ({ count: 2, entries: ENTRIES }),
    });
    await service.loadList();

    let finishShow: (value: unknown) => void = () => undefined;
    mockRpcCall.mockImplementationOnce(
      () => new Promise((resolve) => (finishShow = resolve)),
    );

    const pendingSelect = service.select(ENTRIES[0]);
    expect(service.filesLoading()).toBe(true);

    await service.select(ENTRIES[0]);
    expect(service.filesLoading()).toBe(false);

    finishShow({
      success: true,
      data: { success: true, files: [{ path: 'src/a.ts', status: 'M' }] },
    });
    await pendingSelect;

    expect(service.filesLoading()).toBe(false);
  });

  it('preserves a real list-reload failure instead of overwriting with STASH_LIST_CHANGED_ERROR', async () => {
    mockRpcCall.mockImplementation(async (_vscode, method) => {
      if (method === 'git:stashPop') {
        return {
          success: true,
          data: {
            success: false,
            error: 'The stash list changed. Refresh and try again.',
          },
        };
      }
      if (method === 'git:stashList') {
        return {
          success: false,
          error: 'Git index locked.',
        };
      }
      return { success: false, error: `unexpected ${method}` };
    });

    const result = await service.mutate('pop', ENTRIES[0]);

    expect(result.success).toBe(false);
    expect(service.error()).toBe('Git index locked.');
  });

  it('triggers a recovery list reload when a mutation fails and restores the mutation error', async () => {
    let finishList: (value: unknown) => void = () => undefined;
    mockRpcCall.mockImplementationOnce(
      () => new Promise((resolve) => (finishList = resolve)),
    );
    const inFlightList = service.loadList();

    routeRpc({
      'git:stashPop': () => ({
        success: false,
        error: 'Merge conflict in pop',
      }),
      'git:stashList': () => ({
        count: 1,
        entries: [ENTRIES[1]],
      }),
    });

    const outcome = await service.mutate('pop', ENTRIES[0]);

    expect(outcome.success).toBe(false);
    expect(service.error()).toBe('Merge conflict in pop');
    expect(service.entries()).toEqual([ENTRIES[1]]);

    finishList({ success: true, data: { count: 2, entries: ENTRIES } });
    await inFlightList;
    expect(service.entries()).toEqual([ENTRIES[1]]);
  });

  it('only opens the latest clicked file diff when concurrent openFileDiff requests resolve out of order', async () => {
    routeRpc({
      'git:stashList': () => ({ count: 2, entries: ENTRIES }),
      'git:stashShow': () => ({
        success: true,
        files: [
          { path: 'src/a.ts', status: 'M' },
          { path: 'src/b.ts', status: 'M' },
        ],
      }),
      'git:reviewChanges': () => ({
        success: true,
        base: { sha: 'base' },
        head: { sha: 'head' },
        files: [],
        totals: { additions: 0, deletions: 0, binaryFiles: 0 },
      }),
      'git:reviewFile': () => ({
        success: true,
        path: 'src/a.ts',
        originalPath: 'src/a.ts',
        baseSha: 'base',
        headSha: 'head',
        original: { outcome: 'content', content: 'old' },
        modified: { outcome: 'content', content: 'new' },
      }),
    });
    await service.loadList();
    await service.select(ENTRIES[0]);
    await service.openFileDiff({ path: 'src/a.ts', status: 'M' });
    diffTabs.openHistoricalDiff.mockClear();

    let finishFileA!: (value: unknown) => void;
    let finishFileB!: (value: unknown) => void;
    const promiseA = new Promise((resolve) => (finishFileA = resolve));
    const promiseB = new Promise((resolve) => (finishFileB = resolve));

    mockRpcCall.mockImplementation(async (_vscode, method, params) => {
      if (method === 'git:reviewFile') {
        const path = (params as { path: string }).path;
        if (path === 'src/a.ts') return promiseA;
        if (path === 'src/b.ts') return promiseB;
      }
      return { success: false, error: `unexpected ${method}` };
    });

    const pendingA = service.openFileDiff({ path: 'src/a.ts', status: 'M' });
    const pendingB = service.openFileDiff({ path: 'src/b.ts', status: 'M' });

    finishFileB({
      success: true,
      data: {
        success: true,
        path: 'src/b.ts',
        originalPath: 'src/b.ts',
        baseSha: 'base',
        headSha: 'head',
        original: { outcome: 'content', content: 'old-b' },
        modified: { outcome: 'content', content: 'new-b' },
      },
    });
    await pendingB;

    expect(diffTabs.openHistoricalDiff).toHaveBeenCalledTimes(1);
    const openedTabB = diffTabs.openHistoricalDiff.mock
      .calls[0][0] as EditorTab;
    expect(openedTabB.diff?.path).toBe('src/b.ts');

    finishFileA({
      success: true,
      data: {
        success: true,
        path: 'src/a.ts',
        originalPath: 'src/a.ts',
        baseSha: 'base',
        headSha: 'head',
        original: { outcome: 'content', content: 'old-a' },
        modified: { outcome: 'content', content: 'new-a' },
      },
    });
    await pendingA;

    expect(diffTabs.openHistoricalDiff).toHaveBeenCalledTimes(1);
  });
});
