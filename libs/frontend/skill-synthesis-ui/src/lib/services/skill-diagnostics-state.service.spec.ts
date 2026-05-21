import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import type { SkillDiagnosticsResult } from '@ptah-extension/shared';

import { SkillDiagnosticsRpcService } from './skill-diagnostics-rpc.service';
import { SkillDiagnosticsStateService } from './skill-diagnostics-state.service';

describe('SkillDiagnosticsStateService', () => {
  let service: SkillDiagnosticsStateService;
  let diagnostics: jest.Mock;
  let analyzeNow: jest.Mock;
  let setTriggers: jest.Mock;
  let getTriggers: jest.Mock;

  const snapshot: SkillDiagnosticsResult = {
    lastAnalyzeRunAt: 1234,
    lastCuratorPassAt: 4321,
    totalCandidates: 5,
    totalPromoted: 2,
    totalRejected: 1,
    totalInvocations: 9,
    activeSkills: 3,
    eligibilityHistogram: {
      tooFewTurns: 1,
      lowFidelity: 2,
      insufficientAbstraction: 3,
      accepted: 4,
    },
    recentEvents: [{ kind: 'analyze-run', timestamp: 1, sessionId: 'a' }],
    triggers: { sessionEnd: true, idleMs: 60_000, bootScan: false },
  };

  beforeEach(() => {
    jest.useFakeTimers();
    diagnostics = jest.fn().mockResolvedValue(snapshot);
    analyzeNow = jest.fn().mockResolvedValue({
      success: true,
      startedAt: 0,
      completedAt: 1,
      candidateId: null,
      reason: null,
    });
    setTriggers = jest.fn().mockResolvedValue({ triggers: snapshot.triggers });
    getTriggers = jest.fn().mockResolvedValue({ triggers: snapshot.triggers });

    TestBed.configureTestingModule({
      providers: [
        SkillDiagnosticsStateService,
        {
          provide: SkillDiagnosticsRpcService,
          useValue: { diagnostics, analyzeNow, setTriggers, getTriggers },
        },
        {
          provide: AppStateManager,
          useValue: {
            workspaceInfo: signal({
              name: 'w',
              path: '/ws',
              type: 'workspace',
            }),
          },
        },
      ],
    });
    service = TestBed.inject(SkillDiagnosticsStateService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('refresh() calls diagnostics and projects into signals', async () => {
    await service.refresh();
    expect(diagnostics).toHaveBeenCalledWith({ workspaceRoot: '/ws' });
    expect(service.lastAnalyzeRunAt()).toBe(1234);
    expect(service.lastCuratorPassAt()).toBe(4321);
    expect(service.byStatus().totalCandidates).toBe(5);
    expect(service.triggers().idleMs).toBe(60_000);
    expect(service.eligibilityHistogram().accepted).toBe(4);
    expect(service.sessionsAnalyzedToday()).toBe(10);
    expect(service.recentEvents()).toHaveLength(1);
    expect(service.loading()).toBe(false);
    expect(service.error()).toBeNull();
  });

  it('refresh() surfaces RPC errors through the error signal', async () => {
    diagnostics.mockRejectedValueOnce(new Error('rpc down'));
    await service.refresh();
    expect(service.error()).toBe('rpc down');
    expect(service.loading()).toBe(false);
  });

  it('analyzeNow() dispatches with force=true and refreshes', async () => {
    await service.analyzeNow();
    expect(analyzeNow).toHaveBeenCalledWith({
      sessionId: 'manual',
      workspaceRoot: '/ws',
      force: true,
    });
    expect(diagnostics).toHaveBeenCalled();
  });

  it('setTriggers() persists and refreshes', async () => {
    await service.setTriggers({ bootScan: false });
    expect(setTriggers).toHaveBeenCalledWith({ bootScan: false });
    expect(diagnostics).toHaveBeenCalled();
  });

  it('startPolling() installs interval; stopPolling() at last subscriber tears down', async () => {
    service.startPolling();
    expect(diagnostics).not.toHaveBeenCalled();

    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    expect(diagnostics).toHaveBeenCalledTimes(1);

    service.startPolling();
    service.stopPolling();
    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    expect(diagnostics).toHaveBeenCalledTimes(2);

    service.stopPolling();
    diagnostics.mockClear();
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(diagnostics).not.toHaveBeenCalled();
  });
});
