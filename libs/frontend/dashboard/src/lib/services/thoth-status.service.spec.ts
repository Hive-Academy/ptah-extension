import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import { MemoryRpcService } from '@ptah-extension/memory-curator-ui';
import { SkillSynthesisRpcService } from '@ptah-extension/skill-synthesis-ui';
import { CronRpcService } from '@ptah-extension/cron-scheduler-ui';
import { GatewayRpcService } from '@ptah-extension/messaging-gateway-ui';
import {
  MESSAGE_TYPES,
  type GatewayBindingDto,
  type GatewayListBindingsResult,
  type GatewayStatusResult,
  type CronListResult,
  type MemoryStatsResult,
  type ScheduledJobDto,
  type SkillSynthesisCandidateSummary,
} from '@ptah-extension/shared';

import { ThothStatusService } from './thoth-status.service';

interface VscodeStub {
  config: ReturnType<typeof signal<{ isElectron: boolean }>>;
}

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

describe('ThothStatusService', () => {
  let memoryRpc: jest.Mocked<MemoryRpcService>;
  let skillsRpc: jest.Mocked<SkillSynthesisRpcService>;
  let cronRpc: jest.Mocked<CronRpcService>;
  let gatewayRpc: jest.Mocked<GatewayRpcService>;
  let vscode: VscodeStub;
  let appState: AppStateStub;

  beforeEach(() => {
    memoryRpc = {
      stats: jest.fn(),
    } as unknown as jest.Mocked<MemoryRpcService>;
    skillsRpc = {
      listCandidates: jest.fn(),
    } as unknown as jest.Mocked<SkillSynthesisRpcService>;
    cronRpc = {
      list: jest.fn(),
    } as unknown as jest.Mocked<CronRpcService>;
    gatewayRpc = {
      status: jest.fn(),
      listBindings: jest.fn(),
    } as unknown as jest.Mocked<GatewayRpcService>;
    vscode = { config: signal({ isElectron: true }) };
    appState = { workspaceInfo: signal<{ path: string } | null>(null) };

    TestBed.configureTestingModule({
      providers: [
        ThothStatusService,
        { provide: VSCodeService, useValue: vscode },
        { provide: AppStateManager, useValue: appState },
        { provide: MemoryRpcService, useValue: memoryRpc },
        { provide: SkillSynthesisRpcService, useValue: skillsRpc },
        { provide: CronRpcService, useValue: cronRpc },
        { provide: GatewayRpcService, useValue: gatewayRpc },
      ],
    });
  });

  it('aggregates all four pillars on the Electron path', async () => {
    vscode.config.set({ isElectron: true });

    const memStats: MemoryStatsResult = {
      core: 12,
      recall: 4,
      archival: 2,
      codeIndex: 0,
      lastCuratedAt: null,
    };
    memoryRpc.stats.mockResolvedValue(memStats);

    const candidates: SkillSynthesisCandidateSummary[] = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: 'a' } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: 'b' } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: 'c' } as any,
    ];
    skillsRpc.listCandidates.mockResolvedValue(candidates);

    const cronList: CronListResult = {
      jobs: [
        makeJob({ id: '1', nextRunAt: 5_000 }),
        makeJob({ id: '2', nextRunAt: 1_000 }),
        makeJob({ id: '3', nextRunAt: null }),
      ],
    };
    cronRpc.list.mockResolvedValue(cronList);

    const status: GatewayStatusResult = {
      enabled: true,
      adapters: [
        { platform: 'telegram', running: true },
        { platform: 'discord', running: false, lastError: 'boom' },
      ],
    };
    const bindings: GatewayListBindingsResult = {
      bindings: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'b1' } as any,
      ],
    };
    gatewayRpc.status.mockResolvedValue(status);
    gatewayRpc.listBindings.mockResolvedValue(bindings);

    const service = TestBed.inject(ThothStatusService);
    await service.refresh();

    const summary = service.summary();

    expect(summary.memory).toEqual({
      available: true,
      totalFacts: 18,
      queueLength: 4,
    });
    expect(summary.skills).toEqual({
      available: true,
      pendingCandidates: 3,
    });
    expect(summary.cron).toEqual({
      available: true,
      totalJobs: 3,
      nextRunAt: 1_000,
    });
    expect(summary.gateway.available).toBe(true);
    if (summary.gateway.available) {
      expect(summary.gateway.pendingBindings).toBe(1);
      const telegram = summary.gateway.platforms.find(
        (p) => p.platform === 'telegram',
      );
      const discord = summary.gateway.platforms.find(
        (p) => p.platform === 'discord',
      );
      const slack = summary.gateway.platforms.find(
        (p) => p.platform === 'slack',
      );
      expect(telegram?.state).toBe('running');
      expect(discord?.state).toBe('error');
      expect(discord?.lastError).toBe('boom');
      expect(slack?.state).toBe('disabled');
    }

    expect(summary.errors.memory).toBeNull();
    expect(summary.errors.gateway).toBeNull();
    expect(summary.lastUpdatedAt).not.toBeNull();
    expect(service.hasLoadedOnce()).toBe(true);

    expect(skillsRpc.listCandidates).toHaveBeenCalledWith({
      status: 'candidate',
    });
    expect(gatewayRpc.listBindings).toHaveBeenCalledWith({ status: 'pending' });
  });

  it('returns desktop-only state for cron and gateway when not Electron', async () => {
    vscode.config.set({ isElectron: false });

    memoryRpc.stats.mockResolvedValue({
      core: 1,
      recall: 0,
      archival: 0,
      codeIndex: 0,
      lastCuratedAt: null,
    });
    skillsRpc.listCandidates.mockResolvedValue([]);

    const service = TestBed.inject(ThothStatusService);
    await service.refresh();

    const summary = service.summary();

    expect(cronRpc.list).not.toHaveBeenCalled();
    expect(gatewayRpc.status).not.toHaveBeenCalled();
    expect(gatewayRpc.listBindings).not.toHaveBeenCalled();

    expect(summary.cron).toEqual({ available: false, reason: 'desktop-only' });
    expect(summary.gateway).toEqual({
      available: false,
      reason: 'desktop-only',
    });
    expect(summary.memory.available).toBe(true);
    expect(summary.skills.available).toBe(true);
  });

  it('refreshIfNeeded only loads once across multiple calls', async () => {
    vscode.config.set({ isElectron: false });
    memoryRpc.stats.mockResolvedValue({
      core: 0,
      recall: 0,
      archival: 0,
      codeIndex: 0,
      lastCuratedAt: null,
    });
    skillsRpc.listCandidates.mockResolvedValue([]);

    const service = TestBed.inject(ThothStatusService);
    await service.refreshIfNeeded();
    await service.refreshIfNeeded();
    await service.refreshIfNeeded();

    expect(memoryRpc.stats).toHaveBeenCalledTimes(1);
    expect(skillsRpc.listCandidates).toHaveBeenCalledTimes(1);
  });

  it('derives running state even when the master enabled flag is false', async () => {
    vscode.config.set({ isElectron: true });

    memoryRpc.stats.mockResolvedValue({
      core: 0,
      recall: 0,
      archival: 0,
      codeIndex: 0,
      lastCuratedAt: null,
    });
    skillsRpc.listCandidates.mockResolvedValue([]);
    cronRpc.list.mockResolvedValue({ jobs: [] });
    gatewayRpc.status.mockResolvedValue({
      enabled: false,
      adapters: [
        { platform: 'discord', running: true },
        { platform: 'telegram', running: false },
      ],
    });
    gatewayRpc.listBindings.mockResolvedValue({ bindings: [] });

    const service = TestBed.inject(ThothStatusService);
    await service.refresh();

    const summary = service.summary();
    expect(summary.gateway.available).toBe(true);
    if (summary.gateway.available) {
      const discord = summary.gateway.platforms.find(
        (p) => p.platform === 'discord',
      );
      const telegram = summary.gateway.platforms.find(
        (p) => p.platform === 'telegram',
      );
      const slack = summary.gateway.platforms.find(
        (p) => p.platform === 'slack',
      );
      expect(discord?.state).toBe('running');
      expect(telegram?.state).toBe('enabled');
      expect(slack?.state).toBe('disabled');
    }
  });

  describe('handleMessage', () => {
    it('declares GATEWAY_STATUS_CHANGED as its handled message type', () => {
      const service = TestBed.inject(ThothStatusService);
      expect(service.handledMessageTypes).toEqual([
        MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
      ]);
    });

    it('updates platform state live and preserves the last pending count', async () => {
      vscode.config.set({ isElectron: true });

      memoryRpc.stats.mockResolvedValue({
        core: 0,
        recall: 0,
        archival: 0,
        codeIndex: 0,
        lastCuratedAt: null,
      });
      skillsRpc.listCandidates.mockResolvedValue([]);
      cronRpc.list.mockResolvedValue({ jobs: [] });
      gatewayRpc.status.mockResolvedValue({
        enabled: false,
        adapters: [{ platform: 'discord', running: false }],
      });
      const stubBinding = (id: string): GatewayBindingDto =>
        ({ id }) as Partial<GatewayBindingDto> & {
          id: string;
        } as GatewayBindingDto;
      gatewayRpc.listBindings.mockResolvedValue({
        bindings: [stubBinding('b1'), stubBinding('b2')],
      });

      const service = TestBed.inject(ThothStatusService);
      await service.refresh();

      service.handleMessage({
        type: MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
        payload: {
          status: {
            enabled: true,
            adapters: [{ platform: 'discord', running: true }],
          },
          origin: 'user-action',
        },
      });

      const summary = service.summary();
      expect(summary.gateway.available).toBe(true);
      if (summary.gateway.available) {
        expect(summary.gateway.pendingBindings).toBe(2);
        const discord = summary.gateway.platforms.find(
          (p) => p.platform === 'discord',
        );
        expect(discord?.state).toBe('running');
      }
    });

    it('applies a status event that arrives before the first refresh', () => {
      const service = TestBed.inject(ThothStatusService);

      service.handleMessage({
        type: MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
        payload: {
          status: {
            enabled: false,
            adapters: [{ platform: 'discord', running: true }],
          },
          origin: null,
        },
      });

      const summary = service.summary();
      expect(summary.gateway).toEqual({
        available: true,
        pendingBindings: 0,
        platforms: [
          { platform: 'telegram', state: 'disabled' },
          { platform: 'discord', state: 'running' },
          { platform: 'slack', state: 'disabled' },
        ],
      });
    });

    it('surfaces adapter errors and clears a stale gateway error', async () => {
      vscode.config.set({ isElectron: true });

      memoryRpc.stats.mockResolvedValue({
        core: 0,
        recall: 0,
        archival: 0,
        codeIndex: 0,
        lastCuratedAt: null,
      });
      skillsRpc.listCandidates.mockResolvedValue([]);
      cronRpc.list.mockResolvedValue({ jobs: [] });
      gatewayRpc.status.mockRejectedValue(new Error('gateway boom'));
      gatewayRpc.listBindings.mockResolvedValue({ bindings: [] });

      const service = TestBed.inject(ThothStatusService);
      await service.refresh();
      expect(service.summary().errors.gateway).toBe('gateway boom');

      service.handleMessage({
        type: MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
        payload: {
          status: {
            enabled: true,
            adapters: [
              { platform: 'discord', running: false, lastError: 'token bad' },
            ],
          },
          origin: null,
        },
      });

      const summary = service.summary();
      expect(summary.errors.gateway).toBeNull();
      expect(summary.gateway.available).toBe(true);
      if (summary.gateway.available) {
        const discord = summary.gateway.platforms.find(
          (p) => p.platform === 'discord',
        );
        expect(discord?.state).toBe('error');
        expect(discord?.lastError).toBe('token bad');
      }
    });

    it('ignores events without a status payload', () => {
      const service = TestBed.inject(ThothStatusService);
      const before = service.summary().gateway;

      service.handleMessage({ type: MESSAGE_TYPES.GATEWAY_STATUS_CHANGED });
      service.handleMessage({
        type: MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
        payload: {},
      });

      expect(service.summary().gateway).toEqual(before);
    });
  });

  describe('workspace scoping', () => {
    const emptyStats: MemoryStatsResult = {
      core: 0,
      recall: 0,
      archival: 0,
      codeIndex: 0,
      lastCuratedAt: null,
    };

    beforeEach(() => {
      vscode.config.set({ isElectron: true });
      memoryRpc.stats.mockResolvedValue(emptyStats);
      skillsRpc.listCandidates.mockResolvedValue([]);
      cronRpc.list.mockResolvedValue({ jobs: [] });
      gatewayRpc.status.mockResolvedValue({ enabled: false, adapters: [] });
      gatewayRpc.listBindings.mockResolvedValue({ bindings: [] });
    });

    it('scopes memory stats to the active workspace root', async () => {
      appState.workspaceInfo.set({ path: '/ws-a' });

      const service = TestBed.inject(ThothStatusService);
      await service.refresh();

      expect(memoryRpc.stats).toHaveBeenCalledWith('/ws-a');
    });

    it('passes null when no workspace is open (global stats)', async () => {
      const service = TestBed.inject(ThothStatusService);
      await service.refresh();

      expect(memoryRpc.stats).toHaveBeenCalledWith(null);
    });

    it('re-refreshes all pillars when the workspace root changes', async () => {
      appState.workspaceInfo.set({ path: '/ws-a' });

      const service = TestBed.inject(ThothStatusService);
      TestBed.tick(); // first effect run only records the current root
      expect(memoryRpc.stats).not.toHaveBeenCalled();

      await service.refresh();
      expect(memoryRpc.stats).toHaveBeenCalledTimes(1);

      appState.workspaceInfo.set({ path: '/ws-b' });
      TestBed.tick();
      await Promise.resolve();

      expect(memoryRpc.stats).toHaveBeenCalledTimes(2);
      expect(memoryRpc.stats).toHaveBeenLastCalledWith('/ws-b');
      expect(skillsRpc.listCandidates).toHaveBeenCalledTimes(2);
      expect(cronRpc.list).toHaveBeenCalledTimes(2);
    });

    it('does not refresh when workspaceInfo re-emits the same root', async () => {
      appState.workspaceInfo.set({ path: '/ws-a' });

      const service = TestBed.inject(ThothStatusService);
      TestBed.tick();
      await service.refresh();
      expect(memoryRpc.stats).toHaveBeenCalledTimes(1);

      appState.workspaceInfo.set({ path: '/ws-a' });
      TestBed.tick();
      await Promise.resolve();

      expect(memoryRpc.stats).toHaveBeenCalledTimes(1);
    });
  });

  it('isolates a failing pillar from the others', async () => {
    vscode.config.set({ isElectron: true });

    memoryRpc.stats.mockRejectedValue(new Error('memory boom'));
    skillsRpc.listCandidates.mockResolvedValue([]);
    cronRpc.list.mockResolvedValue({ jobs: [] });
    gatewayRpc.status.mockResolvedValue({ enabled: false, adapters: [] });
    gatewayRpc.listBindings.mockResolvedValue({ bindings: [] });

    const service = TestBed.inject(ThothStatusService);
    await service.refresh();

    const summary = service.summary();
    expect(summary.memory).toEqual({ available: false, reason: 'error' });
    expect(summary.errors.memory).toBe('memory boom');
    expect(summary.skills.available).toBe(true);
    expect(summary.cron.available).toBe(true);
    expect(summary.gateway.available).toBe(true);
  });
});
