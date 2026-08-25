import { TestBed } from '@angular/core/testing';
import { SurfaceSessionStatsRegistry } from './surface-session-stats.registry';

describe('SurfaceSessionStatsRegistry', () => {
  let svc: SurfaceSessionStatsRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SurfaceSessionStatsRegistry],
    });
    svc = TestBed.inject(SurfaceSessionStatsRegistry);
  });

  const live = {
    model: 'claude-opus-5',
    contextUsed: 1000,
    contextWindow: 1_000_000,
    contextPercent: 0.1,
  };

  it('returns null for a session it has never seen', () => {
    expect(svc.peek('nope')).toBeNull();
    expect(svc.stats('nope')()).toBeNull();
  });

  it('accumulates totals across turns while replacing live stats', () => {
    svc.record('s1', {
      live,
      modelUsage: [
        {
          model: 'claude-opus-5',
          inputTokens: 10,
          outputTokens: 20,
          costUSD: 0.5,
          contextWindow: 1_000_000,
        },
      ],
      cost: 0.5,
      tokens: { input: 10, output: 20, cacheRead: 5, cacheCreation: 1 },
    });
    svc.record('s1', {
      live: { ...live, contextUsed: 2000, contextPercent: 0.2 },
      modelUsage: null,
      cost: 0.25,
      tokens: { input: 4, output: 6 },
    });

    const stats = svc.peek('s1');
    // Totals ADD; live stats REPLACE. Same split the tab path uses, so a
    // surface and a tab cannot report different numbers for the same turns.
    expect(stats?.totals.totalCost).toBeCloseTo(0.75);
    expect(stats?.totals.tokens).toEqual({
      input: 14,
      output: 26,
      cacheRead: 5,
      cacheCreation: 1,
    });
    expect(stats?.totals.messageCount).toBe(2);
    expect(stats?.live?.contextUsed).toBe(2000);
    // A null breakdown on a later turn keeps the last known one.
    expect(stats?.modelUsage?.length).toBe(1);
  });

  it('leaves the running total alone when a turn has no known cost', () => {
    svc.record('s1', {
      live: null,
      modelUsage: null,
      cost: 0.4,
      tokens: { input: 1, output: 1 },
    });
    svc.record('s1', {
      live: null,
      modelUsage: null,
      cost: null,
      tokens: { input: 1, output: 1 },
    });

    // Coercing an unknown cost to 0 would claim the turn was free — the same
    // false-free-tier bug the per-model breakdown already guards against.
    expect(svc.peek('s1')?.totals.totalCost).toBeCloseTo(0.4);
    expect(svc.peek('s1')?.totals.messageCount).toBe(2);
  });

  it('keeps sessions independent and clears one at a time', () => {
    svc.record('s1', {
      live: null,
      modelUsage: null,
      cost: 1,
      tokens: { input: 1, output: 1 },
    });
    svc.record('s2', {
      live: null,
      modelUsage: null,
      cost: 2,
      tokens: { input: 1, output: 1 },
    });

    svc.clear('s1');

    expect(svc.peek('s1')).toBeNull();
    expect(svc.peek('s2')?.totals.totalCost).toBe(2);
  });

  it('ignores a blank session id', () => {
    svc.record('', {
      live: null,
      modelUsage: null,
      cost: 1,
      tokens: { input: 1, output: 1 },
    });
    expect(svc.sessions()).toEqual([]);
  });
});
