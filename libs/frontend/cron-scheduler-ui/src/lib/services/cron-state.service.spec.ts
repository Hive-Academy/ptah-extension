import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import type { CronListResult, ScheduledJobDto } from '@ptah-extension/shared';

import { CronRpcService } from './cron-rpc.service';
import { CronStateService } from './cron-state.service';

interface AppStateStub {
  workspaceInfo: ReturnType<typeof signal<{ path: string } | null>>;
}

function makeJob(over: Partial<ScheduledJobDto>): ScheduledJobDto {
  return {
    id: over.id ?? 'job-1',
    name: over.name ?? 'sample',
    cronExpr: over.cronExpr ?? '* * * * *',
    timezone: over.timezone ?? 'UTC',
    prompt: over.prompt ?? 'noop',
    workspaceRoot: over.workspaceRoot ?? null,
    enabled: over.enabled ?? true,
    createdAt: over.createdAt ?? 0,
    updatedAt: over.updatedAt ?? 0,
    lastRunAt: over.lastRunAt ?? null,
    nextRunAt: over.nextRunAt ?? null,
  };
}

describe('CronStateService', () => {
  let rpc: jest.Mocked<CronRpcService>;
  let appState: AppStateStub;

  beforeEach(() => {
    rpc = {
      list: jest.fn().mockResolvedValue({ jobs: [] } as CronListResult),
    } as unknown as jest.Mocked<CronRpcService>;
    appState = { workspaceInfo: signal<{ path: string } | null>(null) };

    TestBed.configureTestingModule({
      providers: [
        CronStateService,
        { provide: CronRpcService, useValue: rpc },
        { provide: AppStateManager, useValue: appState },
      ],
    });
  });

  it('defaults the scope filter to "workspace"', () => {
    const service = TestBed.inject(CronStateService);
    expect(service.scopeFilter()).toBe('workspace');
  });

  it('scopes cron:list to the active workspace root under "workspace" scope', async () => {
    appState.workspaceInfo.set({ path: '/ws-a' });

    const service = TestBed.inject(CronStateService);
    await service.refresh();

    expect(rpc.list).toHaveBeenCalledWith({ workspaceRoot: '/ws-a' });
  });

  it('lists globally under "workspace" scope when no workspace is open', async () => {
    const service = TestBed.inject(CronStateService);
    await service.refresh();

    expect(rpc.list).toHaveBeenCalledWith({});
  });

  it('lists globally under "all" scope even when a workspace is open', async () => {
    appState.workspaceInfo.set({ path: '/ws-a' });

    const service = TestBed.inject(CronStateService);
    service.setScopeFilter('all');
    await Promise.resolve();

    expect(service.scopeFilter()).toBe('all');
    expect(rpc.list).toHaveBeenLastCalledWith({});
  });

  it('setScopeFilter re-lists when the scope actually changes', async () => {
    appState.workspaceInfo.set({ path: '/ws-a' });

    const service = TestBed.inject(CronStateService);
    await service.refresh();
    rpc.list.mockClear();

    service.setScopeFilter('all');
    await Promise.resolve();

    expect(rpc.list).toHaveBeenCalledTimes(1);
    expect(rpc.list).toHaveBeenCalledWith({});
  });

  it('setScopeFilter is a no-op when the scope is unchanged', async () => {
    const service = TestBed.inject(CronStateService);
    await service.refresh();
    rpc.list.mockClear();

    service.setScopeFilter('workspace'); // already the default

    expect(rpc.list).not.toHaveBeenCalled();
  });

  it('re-lists when the workspace root changes under "workspace" scope', async () => {
    appState.workspaceInfo.set({ path: '/ws-a' });

    const service = TestBed.inject(CronStateService);
    TestBed.tick(); // first effect run only records the current root
    expect(rpc.list).not.toHaveBeenCalled();

    await service.refresh();
    expect(rpc.list).toHaveBeenCalledTimes(1);

    appState.workspaceInfo.set({ path: '/ws-b' });
    TestBed.tick();
    await Promise.resolve();

    expect(rpc.list).toHaveBeenCalledTimes(2);
    expect(rpc.list).toHaveBeenLastCalledWith({ workspaceRoot: '/ws-b' });
  });

  it('does not re-list on workspace change under "all" scope', async () => {
    appState.workspaceInfo.set({ path: '/ws-a' });

    const service = TestBed.inject(CronStateService);
    TestBed.tick();
    service.setScopeFilter('all');
    await Promise.resolve();
    rpc.list.mockClear();

    appState.workspaceInfo.set({ path: '/ws-b' });
    TestBed.tick();
    await Promise.resolve();

    expect(rpc.list).not.toHaveBeenCalled();
  });

  it('does not render a stale list after the workspace switched', async () => {
    const resolvers: Array<(r: CronListResult) => void> = [];
    rpc.list.mockImplementation(
      () =>
        new Promise<CronListResult>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    appState.workspaceInfo.set({ path: '/ws-a' });
    const service = TestBed.inject(CronStateService);
    TestBed.tick(); // record /ws-a without firing a list

    // Refresh for /ws-a (token 1) — response deliberately left pending.
    const stalePromise = service.refresh();

    // Switch to /ws-b — the effect fires a fresh refresh (token 2).
    appState.workspaceInfo.set({ path: '/ws-b' });
    TestBed.tick();
    await Promise.resolve();

    expect(resolvers).toHaveLength(2);

    // Newer (B) resolves first and renders.
    resolvers[1]({ jobs: [makeJob({ id: 'b1', workspaceRoot: '/ws-b' })] });
    await Promise.resolve();
    expect(service.jobs().map((j) => j.id)).toEqual(['b1']);

    // Stale (A) resolves last but must NOT overwrite the current view.
    resolvers[0]({ jobs: [makeJob({ id: 'a1', workspaceRoot: '/ws-a' })] });
    await stalePromise;
    await Promise.resolve();

    expect(service.jobs().map((j) => j.id)).toEqual(['b1']);
  });
});
