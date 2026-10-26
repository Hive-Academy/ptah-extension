import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { buildStatsLimitViewModel } from '@ptah-extension/chat-ui';
import { AgentMonitorStore, type MonitoredAgent } from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import { PlanLimitsStore } from '@ptah-extension/core';
import type { SessionStatsEntry } from '@ptah-extension/shared';
import { ChatStore } from '../chat.store';
import { injectSessionStatsSource, toStatsLimitLaneRun } from './session-stats-source';

describe('injectSessionStatsSource cache projection', () => {
  const cache = { ttl: '1h' as const, lastRequestAt: 1_000, expiresAt: 3_601_000 };
  const tab = signal<TabState | null>(null);
  const sessionId = signal<string | null>('main');
  const available = signal(true);
  const mainSnapshot = signal<SessionStatsEntry | null>(null);

  beforeEach(() => {
    tab.set(null);
    sessionId.set('main');
    available.set(true);
    mainSnapshot.set(null);
    TestBed.configureTestingModule({ providers: [
      { provide: ChatStore, useValue: { sessionStats: mainSnapshot, liveModelStats: signal(null), compactionCount: signal(0) } },
      { provide: PlanLimitsStore, useValue: { snapshot: signal(null) } },
      { provide: AgentMonitorStore, useValue: { agentsOwnedBySession: () => [] } },
    ] });
  });

  function source() {
    return TestBed.runInInjectionContext(() => injectSessionStatsSource({
      tab, sessionId, available, budget: () => null,
    }));
  }

  it('keeps a live owner cache on its selected tab and isolates a tab switch', () => {
    const stats = source();
    tab.set({ sessionStats: { cache } as SessionStatsEntry } as TabState);
    sessionId.set('selected');
    expect(stats.inputs()?.cache).toEqual(cache);
    expect(stats.inputs()?.sessionId).toBe('selected');
    tab.set({ sessionStats: null } as TabState);
    sessionId.set('other');
    expect(stats.inputs()?.cache).toBeNull();
    expect(stats.inputs()?.sessionId).toBe('other');
  });

  it('hides transcript-only or invalid cache while retaining the snapshot', () => {
    const stats = source();
    mainSnapshot.set({ tokenCount: 42 } as SessionStatsEntry);
    expect(stats.inputs()?.cache).toBeNull();
    mainSnapshot.set({ tokenCount: 42, cache: { ...cache, expiresAt: 'bad' } } as SessionStatsEntry);
    expect(stats.inputs()?.cache).toBeNull();
    expect(stats.inputs()?.snapshot?.tokenCount).toBe(42);
    available.set(false);
    expect(stats.inputs()).toBeNull();
  });
});

describe('lane usage mapping', () => {
  const agent = {
    agentId: 'restored', cli: 'codex', status: 'completed', restored: true,
    startedAt: 100, segments: [
      { type: 'info', content: '', usage: { inputTokens: 20, outputTokens: 7921, costUsd: 1.1586 } },
    ],
  } as MonitoredAgent;

  it('uses the lane card segment fallback, marks it partial, and leaves session totals separate', () => {
    const run = toStatsLimitLaneRun(agent);
    expect(run.usageTotals).toMatchObject({ inputTokens: 20, outputTokens: 7921, costUsd: 1.1586, partial: true });
    const model = buildStatsLimitViewModel({
      sessionId: 'owner', sessionOwnerKey: null, sessionModelScope: null,
      owners: [], laneRuns: [run], now: 200,
      time: { timeZone: 'UTC', zoneNameLocale: 'en' },
    });
    expect(model.subtotal?.tokensText).toContain('≥7.9k');
    expect(model.subtotal?.summary).toContain('≥$1.16');
  });

  it('prefers structured totals and never invents usage for an empty run', () => {
    const usageTotals = { inputTokens: 3, outputTokens: 5, costUsd: 0 };
    expect(toStatsLimitLaneRun({ ...agent, usageTotals }).usageTotals).toBe(usageTotals);
    expect(toStatsLimitLaneRun({ ...agent, segments: [] }).usageTotals).toBeNull();
  });
});
