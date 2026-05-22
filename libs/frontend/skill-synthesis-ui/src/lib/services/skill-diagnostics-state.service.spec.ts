import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { SkillDiagnosticsResult } from '@ptah-extension/shared';

import { SkillDiagnosticsRpcService } from './skill-diagnostics-rpc.service';
import { SkillDiagnosticsStateService } from './skill-diagnostics-state.service';

describe('SkillDiagnosticsStateService', () => {
  let service: SkillDiagnosticsStateService;
  let diagnostics: jest.Mock;
  let analyzeNow: jest.Mock;
  let setTriggers: jest.Mock;
  let getTriggers: jest.Mock;

  const workspaceSignal = signal<{
    name: string;
    path: string;
    type: string;
  } | null>({ name: 'w', path: '/ws', type: 'workspace' });
  const activeTabSignal = signal<{ claudeSessionId: string | null } | null>({
    claudeSessionId: 'sess-real-uuid',
  });

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

    workspaceSignal.set({ name: 'w', path: '/ws', type: 'workspace' });
    activeTabSignal.set({ claudeSessionId: 'sess-real-uuid' });

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
            workspaceInfo: workspaceSignal,
          },
        },
        {
          provide: TabManagerService,
          useValue: { activeTab: activeTabSignal },
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

  it('analyzeNow() passes the real claudeSessionId from TabManager with force=true and refreshes', async () => {
    await service.analyzeNow();
    expect(analyzeNow).toHaveBeenCalledWith({
      sessionId: 'sess-real-uuid',
      workspaceRoot: '/ws',
      force: true,
    });
    // The literal 'manual' must NEVER be sent — Trajectory extractor would
    // look up ~/.claude/projects/<encoded>/manual.jsonl and always report
    // tooFewTurns, skewing the eligibility histogram.
    expect(analyzeNow).not.toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'manual' }),
    );
    expect(diagnostics).toHaveBeenCalled();
  });

  it('analyzeNow() no-ops + sets error when there is no active session', async () => {
    activeTabSignal.set(null);

    await service.analyzeNow();

    expect(analyzeNow).not.toHaveBeenCalled();
    expect(service.error()).toBe('No active session to analyze.');
  });

  it('analyzeNow() no-ops + sets error when active tab has a null claudeSessionId', async () => {
    activeTabSignal.set({ claudeSessionId: null });

    await service.analyzeNow();

    expect(analyzeNow).not.toHaveBeenCalled();
    expect(service.error()).toBe('No active session to analyze.');
  });

  it('analyzeNow() blocks when no workspace is open', async () => {
    workspaceSignal.set(null);

    await service.analyzeNow();

    expect(analyzeNow).not.toHaveBeenCalled();
    expect(service.error()).toBe('No active workspace');
  });

  it('hasActiveSession reflects TabManager.activeTab().claudeSessionId presence', () => {
    expect(service.hasActiveSession()).toBe(true);

    activeTabSignal.set({ claudeSessionId: null });
    expect(service.hasActiveSession()).toBe(false);

    activeTabSignal.set(null);
    expect(service.hasActiveSession()).toBe(false);

    activeTabSignal.set({ claudeSessionId: 'sess-real-uuid' });
    expect(service.hasActiveSession()).toBe(true);
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
