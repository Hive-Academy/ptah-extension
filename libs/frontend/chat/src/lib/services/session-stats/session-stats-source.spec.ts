import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import { PlanLimitsStore } from '@ptah-extension/core';
import type { SessionStatsEntry } from '@ptah-extension/shared';
import { ChatStore } from '../chat.store';
import { injectSessionStatsSource } from './session-stats-source';

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
