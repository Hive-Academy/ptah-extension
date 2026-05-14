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
