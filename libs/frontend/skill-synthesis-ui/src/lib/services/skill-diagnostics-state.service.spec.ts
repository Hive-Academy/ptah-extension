import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type {
  SkillDiagnosticsResult,
  SkillSynthesisEventWire,
} from '@ptah-extension/shared';

import { SkillDiagnosticsRpcService } from './skill-diagnostics-rpc.service';
import { SkillsPausedError } from './skill-synthesis-rpc.service';
import { SKILLS_PAUSED_NOTICE } from './skill-synthesis-state.service';
import {
  SKILL_EVENT_WINDOW,
  SkillDiagnosticsStateService,
} from './skill-diagnostics-state.service';

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
    // Batch 11 (2c1c8840b) made activeSkills resident-only, so it cannot exceed totalPromoted.
    activeSkills: 2,
    totalMerged: 0,
    totalRetired: 0,
    totalDormant: 0,
    eligibilityHistogram: {
      prefilterTooThin: 1,
      prefilterRejected: 5,
      accepted: 4,
    },
    recentEvents: [
      {
        id: '01HZZZZZZZZZZZZZZZZZZZZZ00',
        kind: 'analyze-run',
        timestamp: 1,
        sessionId: 'a',
      },
    ],
    triggers: { idleMs: 60_000, bootScan: false },
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
    expect(diagnostics).toHaveBeenCalledWith({
      workspaceRoot: '/ws',
      eventLimit: SKILL_EVENT_WINDOW,
    });
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

  it('refresh() projects the merged, retired and dormant counts into byStatus', async () => {
    diagnostics.mockResolvedValueOnce({
      ...snapshot,
      totalPromoted: 3,
      activeSkills: 2,
      totalMerged: 4,
      totalRetired: 6,
      totalDormant: 1,
    });
    await service.refresh();
    expect(service.byStatus()).toEqual({
      totalCandidates: 5,
      totalPromoted: 3,
      totalRejected: 1,
      activeSkills: 2,
      totalInvocations: 9,
      totalMerged: 4,
      totalRetired: 6,
      totalDormant: 1,
    });
  });

  it('refresh() defaults missing lifecycle counts to zero', async () => {
    // A backend older than the lifecycle counters omits the three fields.
    const olderSnapshot: Record<string, unknown> = { ...snapshot };
    delete olderSnapshot['totalMerged'];
    delete olderSnapshot['totalRetired'];
    delete olderSnapshot['totalDormant'];
    diagnostics.mockResolvedValueOnce(olderSnapshot);
    await service.refresh();
    expect(service.byStatus().totalMerged).toBe(0);
    expect(service.byStatus().totalRetired).toBe(0);
    expect(service.byStatus().totalDormant).toBe(0);
  });

  it('starts with zeroed lifecycle counts before the first snapshot', () => {
    expect(service.byStatus().totalMerged).toBe(0);
    expect(service.byStatus().totalRetired).toBe(0);
    expect(service.byStatus().totalDormant).toBe(0);
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

  it('analyzeNow() resolves "paused" and shows a paused notice on a PAUSED refusal', async () => {
    analyzeNow.mockRejectedValueOnce(new SkillsPausedError());

    await expect(service.analyzeNow()).resolves.toBe('paused');

    expect(service.error()).toBeNull();
    expect(service.pausedNotice()).toBe(SKILLS_PAUSED_NOTICE);
    expect(service.loading()).toBe(false);
  });

  it('analyzeNow() keeps other failures as errors and resolves "done"', async () => {
    analyzeNow.mockRejectedValueOnce(new Error('model down'));

    await expect(service.analyzeNow()).resolves.toBe('done');

    expect(service.error()).toBe('model down');
    expect(service.pausedNotice()).toBeNull();
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

  describe('recent events (newest-first, deduped by id)', () => {
    const ev = (
      id: string,
      timestamp: number,
      overrides: Partial<SkillSynthesisEventWire> = {},
    ): SkillSynthesisEventWire => ({
      id,
      kind: 'analyze-run',
      timestamp,
      sessionId: 's',
      ...overrides,
    });
    const ids = (): string[] => service.recentEvents().map((e) => e.id);

    it('sends the window constant (50) as eventLimit on refresh', async () => {
      expect(SKILL_EVENT_WINDOW).toBe(50);
      await service.refresh();
      expect(diagnostics).toHaveBeenCalledWith(
        expect.objectContaining({ eventLimit: 50 }),
      );
    });

    it('puts a newer live event first', async () => {
      diagnostics.mockResolvedValueOnce({
        ...snapshot,
        recentEvents: [ev('B', 200), ev('A', 100)],
      });
      await service.refresh();

      service.pushLiveEvent(ev('C', 300));

      expect(service.recentEvents()[0].id).toBe('C');
      expect(ids()).toEqual(['C', 'B', 'A']);
    });

    it('normalises an oldest-first snapshot to newest-first', async () => {
      diagnostics.mockResolvedValueOnce({
        ...snapshot,
        recentEvents: [
          ev('A', 100),
          ev('B', 200),
          ev('C2', 300),
          ev('C1', 300),
        ],
      });
      await service.refresh();
      // Same millisecond: the greater ULID is the later event.
      expect(ids()).toEqual(['C2', 'C1', 'B', 'A']);
    });

    it('drops repeated ids inside one snapshot', async () => {
      diagnostics.mockResolvedValueOnce({
        ...snapshot,
        recentEvents: [ev('B', 200), ev('B', 200), ev('A', 100)],
      });
      await service.refresh();
      expect(ids()).toEqual(['B', 'A']);
    });

    it('ignores a live event whose id is already listed, without bumping the histogram twice', async () => {
      const ineligible = ev('I1', 500, {
        kind: 'ineligible',
        stats: { reason: 'prefilterRejected' },
      });
      diagnostics.mockResolvedValueOnce({
        ...snapshot,
        recentEvents: [ev('A', 100)],
      });
      await service.refresh();
      const before = service.eligibilityHistogram().prefilterRejected;

      service.pushLiveEvent(ineligible);
      service.pushLiveEvent(ineligible);

      expect(ids()).toEqual(['I1', 'A']);
      expect(service.eligibilityHistogram().prefilterRejected).toBe(before + 1);
    });

    it('ignores a live event already delivered by the snapshot', async () => {
      const analyzed = ev('S1', 900);
      diagnostics.mockResolvedValueOnce({
        ...snapshot,
        lastAnalyzeRunAt: 900,
        recentEvents: [analyzed],
      });
      await service.refresh();

      service.pushLiveEvent(analyzed);

      expect(ids()).toEqual(['S1']);
    });

    it('inserts an out-of-order live event at its sorted position and keeps the latest run time', async () => {
      diagnostics.mockResolvedValueOnce({
        ...snapshot,
        lastAnalyzeRunAt: 300,
        recentEvents: [ev('C', 300), ev('A', 100)],
      });
      await service.refresh();

      service.pushLiveEvent(ev('B', 200));

      expect(ids()).toEqual(['C', 'B', 'A']);
      expect(service.lastAnalyzeRunAt()).toBe(300);
    });

    it('orders two same-millisecond live events by id', () => {
      service.pushLiveEvent(ev('01J0000000000000000000000B', 1000));
      service.pushLiveEvent(ev('01J0000000000000000000000A', 1000));
      service.pushLiveEvent(ev('01J0000000000000000000000C', 1000));
      expect(ids()).toEqual([
        '01J0000000000000000000000C',
        '01J0000000000000000000000B',
        '01J0000000000000000000000A',
      ]);
    });

    it('caps the list at the window, keeping the newest events', () => {
      for (let i = 0; i < SKILL_EVENT_WINDOW + 5; i++) {
        service.pushLiveEvent(ev('E' + String(i).padStart(3, '0'), i));
      }
      const list = service.recentEvents();
      expect(list).toHaveLength(SKILL_EVENT_WINDOW);
      expect(list[0].id).toBe('E054');
      expect(list[list.length - 1].id).toBe('E005');
    });

    it('drops a live event older than a full window', () => {
      for (let i = 1; i <= SKILL_EVENT_WINDOW; i++) {
        service.pushLiveEvent(ev('E' + String(i).padStart(3, '0'), i));
      }
      service.pushLiveEvent(ev('OLD', 0));
      expect(service.recentEvents()).toHaveLength(SKILL_EVENT_WINDOW);
      expect(ids()).not.toContain('OLD');
    });
  });
});
