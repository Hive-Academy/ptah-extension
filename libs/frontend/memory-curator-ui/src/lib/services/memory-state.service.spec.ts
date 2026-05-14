/**
 * MemoryStateService — scopeFilter behavior (TASK_2026_121 Batch A).
 *
 * Verifies:
 *  1. Default scope is `'workspace'`.
 *  2. `setScopeFilter('all')` causes `refresh()` to omit `workspaceRoot`.
 *  3. `setScopeFilter('workspace')` causes `refresh()` to pass the active
 *     workspace path through `MemoryRpcService.list`.
 *  4. `loadStats()` honors the same scope decision (passes `null` in `'all'`
 *     mode, the workspace path in `'workspace'` mode).
 */
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import { MemoryRpcService } from './memory-rpc.service';
import { MemoryStateService } from './memory-state.service';

describe('MemoryStateService — scopeFilter', () => {
  let service: MemoryStateService;
  let listMock: jest.Mock;
  let statsMock: jest.Mock;
  const workspaceSignal = signal<{
    path: string;
    name: string;
    type: string;
  } | null>({
    path: 'D:/ws',
    name: 'ws',
    type: 'workspace',
  });

  beforeEach(() => {
    listMock = jest.fn().mockResolvedValue({ memories: [] });
    statsMock = jest.fn().mockResolvedValue({
      core: 0,
      recall: 0,
      archival: 0,
      lastCuratedAt: null,
    });

    TestBed.configureTestingModule({
      providers: [
        MemoryStateService,
        {
          provide: MemoryRpcService,
          useValue: { list: listMock, stats: statsMock },
        },
        {
          provide: AppStateManager,
          useValue: { workspaceInfo: workspaceSignal },
        },
      ],
    });
    service = TestBed.inject(MemoryStateService);
  });

  it('defaults to scopeFilter === "workspace"', () => {
    expect(service.scopeFilter()).toBe('workspace');
  });

  it('setScopeFilter("all") makes refresh() omit workspaceRoot', async () => {
    service.setScopeFilter('all');
    await service.refresh();

    expect(listMock).toHaveBeenCalledTimes(1);
    const args = listMock.mock.calls[0][0];
    expect(args.workspaceRoot).toBeUndefined();
  });

  it('refresh() in "workspace" scope forwards the active workspace path', async () => {
    service.setScopeFilter('workspace');
    await service.refresh();

    expect(listMock).toHaveBeenCalledTimes(1);
    const args = listMock.mock.calls[0][0];
    expect(args.workspaceRoot).toBe('D:/ws');
  });

  it('loadStats() passes null in "all" scope, the workspace path otherwise', async () => {
    service.setScopeFilter('all');
    await service.loadStats();
    expect(statsMock).toHaveBeenLastCalledWith(null);

    service.setScopeFilter('workspace');
    await service.loadStats();
    expect(statsMock).toHaveBeenLastCalledWith('D:/ws');
  });

  it('switching scope "all" → "workspace" restores workspace-scoped list calls', async () => {
    service.setScopeFilter('all');
    await service.refresh();
    expect(listMock.mock.calls[0][0].workspaceRoot).toBeUndefined();

    service.setScopeFilter('workspace');
    await service.refresh();
    expect(listMock.mock.calls[1][0].workspaceRoot).toBe('D:/ws');
  });
});

// ---------------------------------------------------------------------------
// MemoryStateService — search() scopeFilter wiring (TASK_2026_122)
// ---------------------------------------------------------------------------

describe('MemoryStateService — search() scopeFilter', () => {
  let service: MemoryStateService;
  let searchMock: jest.Mock;
  let listMock: jest.Mock;
  const workspaceSignal = signal<{
    path: string;
    name: string;
    type: string;
  } | null>({
    path: 'D:/ws',
    name: 'ws',
    type: 'workspace',
  });

  beforeEach(() => {
    searchMock = jest.fn().mockResolvedValue({ hits: [], bm25Only: false });
    listMock = jest.fn().mockResolvedValue({ memories: [] });

    TestBed.configureTestingModule({
      providers: [
        MemoryStateService,
        {
          provide: MemoryRpcService,
          useValue: {
            list: listMock,
            search: searchMock,
            stats: jest.fn().mockResolvedValue({
              core: 0,
              recall: 0,
              archival: 0,
              lastCuratedAt: null,
            }),
          },
        },
        {
          provide: AppStateManager,
          useValue: { workspaceInfo: workspaceSignal },
        },
      ],
    });
    service = TestBed.inject(MemoryStateService);
  });

  it('search() in "workspace" scope passes the active workspace path as workspaceRoot', async () => {
    service.setScopeFilter('workspace');
    await service.search('hello');

    expect(searchMock).toHaveBeenCalledTimes(1);
    const workspaceRoot = (
      searchMock.mock.calls[0] as [string, number, string | undefined]
    )[2];
    expect(workspaceRoot).toBe('D:/ws');
  });

  it('search() in "all" scope omits workspaceRoot (undefined)', async () => {
    service.setScopeFilter('all');
    await service.search('hello');

    expect(searchMock).toHaveBeenCalledTimes(1);
    const workspaceRoot = (
      searchMock.mock.calls[0] as [string, number, string | undefined]
    )[2];
    expect(workspaceRoot).toBeUndefined();
  });

  it('search() with empty query falls back to refresh() instead of calling search RPC', async () => {
    service.setScopeFilter('workspace');
    await service.search('   ');

    expect(searchMock).not.toHaveBeenCalled();
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('switching scope from "workspace" to "all" makes subsequent search() global', async () => {
    service.setScopeFilter('workspace');
    await service.search('hello');
    const firstRoot = (
      searchMock.mock.calls[0] as [string, number, string | undefined]
    )[2];
    expect(firstRoot).toBe('D:/ws');

    service.setScopeFilter('all');
    await service.search('hello');
    const secondRoot = (
      searchMock.mock.calls[1] as [string, number, string | undefined]
    )[2];
    expect(secondRoot).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MemoryStateService — workspace-scope race guard (TASK_2026_122 follow-up A)
//
// When the user has scope set to 'workspace' but `appState.workspaceInfo()`
// has not yet resolved (early-mount race), the RPC MUST NOT silently fall
// through to a global call. Instead the service surfaces a user-facing error
// and clears entries/leaves stats untouched.
// ---------------------------------------------------------------------------

describe('MemoryStateService — workspace-scope race guard', () => {
  let service: MemoryStateService;
  let searchMock: jest.Mock;
  let listMock: jest.Mock;
  let statsMock: jest.Mock;
  const workspaceSignal = signal<{
    path: string;
    name: string;
    type: string;
  } | null>(null);

  const EXPECTED_ERROR =
    'No workspace is open — switch to "All workspaces" to see cross-workspace memories.';

  beforeEach(() => {
    workspaceSignal.set(null);
    searchMock = jest.fn().mockResolvedValue({ hits: [], bm25Only: false });
    listMock = jest.fn().mockResolvedValue({ memories: [] });
    statsMock = jest.fn().mockResolvedValue({
      core: 0,
      recall: 0,
      archival: 0,
      lastCuratedAt: null,
    });

    TestBed.configureTestingModule({
      providers: [
        MemoryStateService,
        {
          provide: MemoryRpcService,
          useValue: { list: listMock, search: searchMock, stats: statsMock },
        },
        {
          provide: AppStateManager,
          useValue: { workspaceInfo: workspaceSignal },
        },
      ],
    });
    service = TestBed.inject(MemoryStateService);
  });

  it('search() in "workspace" scope with unresolved workspaceInfo does NOT call RPC, sets error, clears loading', async () => {
    service.setScopeFilter('workspace');
    await service.search('hello');

    expect(searchMock).not.toHaveBeenCalled();
    expect(service.error()).toBe(EXPECTED_ERROR);
    expect(service.loading()).toBe(false);
    expect(service.entries()).toEqual([]);
  });

  it('refresh() in "workspace" scope with unresolved workspaceInfo does NOT call RPC, sets error', async () => {
    service.setScopeFilter('workspace');
    await service.refresh();

    expect(listMock).not.toHaveBeenCalled();
    expect(service.error()).toBe(EXPECTED_ERROR);
    expect(service.loading()).toBe(false);
  });

  it('loadStats() in "workspace" scope with unresolved workspaceInfo does NOT call RPC, sets error, leaves stats untouched', async () => {
    service.setScopeFilter('workspace');
    await service.loadStats();

    expect(statsMock).not.toHaveBeenCalled();
    expect(service.error()).toBe(EXPECTED_ERROR);
    expect(service.stats()).toBeNull();
  });

  it('guard fires only for "workspace" scope: search() in "all" scope with null workspaceInfo proceeds normally', async () => {
    service.setScopeFilter('all');
    await service.search('hello');

    expect(searchMock).toHaveBeenCalledTimes(1);
    const workspaceRoot = (
      searchMock.mock.calls[0] as [string, number, string | undefined]
    )[2];
    expect(workspaceRoot).toBeUndefined();
    expect(service.error()).toBeNull();
  });

  it('after workspaceInfo resolves, a subsequent search() proceeds and resets the sticky error', async () => {
    service.setScopeFilter('workspace');
    await service.search('hello');
    expect(service.error()).toBe(EXPECTED_ERROR);
    expect(searchMock).not.toHaveBeenCalled();

    // Workspace becomes available (e.g. AppStateManager signal resolves).
    workspaceSignal.set({ path: 'D:/ws', name: 'ws', type: 'workspace' });
    await service.search('hello');

    expect(searchMock).toHaveBeenCalledTimes(1);
    const workspaceRoot = (
      searchMock.mock.calls[0] as [string, number, string | undefined]
    )[2];
    expect(workspaceRoot).toBe('D:/ws');
    expect(service.error()).toBeNull();
  });
});
