import type { SessionStatsEntry } from '@ptah-extension/shared';
import { compactSessionMetrics, contextDetailsText, costDetailsText, sessionContextCue, tokenDetailsText, type SessionStatsInputs } from './session-stats-view';
import type { LiveModelStats } from './session-stats-summary.component';

const liveContext: LiveModelStats = {
  model: 'claude-sonnet-4-5',
  contextKnown: true,
  contextCapacity: {
    tokens: 200_000,
    source: 'sdk-native',
    providerId: null,
    model: 'claude-sonnet-4-5',
  },
  contextUsed: 130_000,
  contextWindow: 200_000,
  contextPercent: 65,
};

describe('sessionContextCue', () => {
  it.each([
    { window: 200_000, percent: 65 }, // F2
    { window: 1_000_000, percent: 13 }, // F3
  ])('shows $percent% for a trusted $window window', ({ window, percent }) => {
    expect(sessionContextCue({
      ...liveContext,
      contextCapacity: { ...liveContext.contextCapacity!, tokens: window },
      contextWindow: window,
      contextPercent: percent,
    })).toEqual({
      hasLive: true,
      known: true,
      percent,
      label: `${percent}%`,
      usedTokens: 130_000,
    });
  });

  it.each([
    { contextCapacity: { ...liveContext.contextCapacity!, source: 'unknown' as const } },
    { contextCapacity: { ...liveContext.contextCapacity!, source: 'provider-catalog' as const, providerId: null } },
    { contextCapacity: { ...liveContext.contextCapacity!, model: 'another-model' } },
    { contextWindow: 1_000_000 },
  ])('shows an em dash for an untrusted or mismatched window (F6): %j', (change) => {
    expect(sessionContextCue({ ...liveContext, ...change })).toEqual({
      hasLive: true,
      known: false,
      percent: null,
      label: '\u2014',
      usedTokens: null,
    });
  });
});

const empty: SessionStatsInputs = {
  sessionId: 'one', snapshot: null, liveModelStats: null, compactionCount: 0,
  limits: null, budget: null,
  context: { hasLive: false, known: false, percent: null, label: '—', usedTokens: null },
  limitSummary: { state: 'none', text: null, extra: 0, source: null, fullText: null },
};
const snapshot: SessionStatsEntry = {
  sessionId: 'one', model: 'test-model', totalCost: 0, knownCost: 0, tokenCount: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  messageCount: 0, agentSessionCount: 2, status: 'ok', pricingCoverage: 'full', scope: 'session', revision: 1,
};

describe('compactSessionMetrics', () => {
  it('gives missing values field-specific labels and omits unknown time', () => {
    expect(compactSessionMetrics(empty)).toEqual([
      { id: 'context', label: 'Ctx', value: '—', ariaLabel: 'Context unavailable', unavailable: true },
      { id: 'tokens', label: 'Tokens', value: '—', ariaLabel: 'Tokens unavailable', unavailable: true },
      { id: 'cost', label: 'Cost', value: '—', ariaLabel: 'Cost unavailable', unavailable: true },
    ]);
  });
  it('preserves measured zero', () => {
    const metrics = compactSessionMetrics({ ...empty, snapshot });
    expect(metrics[1]).toMatchObject({ value: '0', unavailable: false });
    expect(metrics[2]).toMatchObject({ value: '$0.0000', unavailable: false });
  });
  it('formats existing totals with partial/estimate markers and full accessible values', () => {
    const metrics = compactSessionMetrics({ ...empty, snapshot: {
      ...snapshot, tokenCount: 12345, coverage: 'partial', provisional: true,
      totalCost: null, knownCost: 0.12, pricingCoverage: 'partial', durationMs: 65000,
    }});
    expect(metrics[1].value).toBe('~≥12.3k');
    expect(metrics[1].ariaLabel).toBe(`Tokens estimated at least ${(12345).toLocaleString()}`);
    expect(metrics[2].value).toBe('~≥$0.12');
    expect(metrics[2].ariaLabel).toContain('known subtotal 0.12 US dollars');
    expect(metrics[3]).toMatchObject({ id: 'time', value: '1m 5s', ariaLabel: 'Time 1 minute 5 seconds' });
  });
  it.each([
    [0.2400000001, '0.24'],
    [0.00012345, '0.0001'],
    [0, '0.0000'],
  ])('formats the accessible cost for %s without floating-point noise', (cost, expected) => {
    const metrics = compactSessionMetrics({ ...empty, snapshot: { ...snapshot, totalCost: cost } });
    expect(metrics[2].ariaLabel).toBe(`Cost ${expected} US dollars`);
  });
  it.each([
    [252000, '4m 12s', '4 minutes 12 seconds'],
    [61000, '1m 1s', '1 minute 1 second'],
    [60000, '1m 0s', '1 minute 0 seconds'],
    [12500, '12.5s', '12.5 seconds'],
    [1000, '1.0s', '1.0 second'],
    [850, '850ms', '850 milliseconds'],
    [1, '1ms', '1 millisecond'],
  ])('speaks duration %s using the displayed precision', (durationMs, value, spoken) => {
    const metrics = compactSessionMetrics({ ...empty, snapshot: { ...snapshot, durationMs } });
    expect(metrics[3]).toMatchObject({ value, ariaLabel: `Time ${spoken}` });
  });
  it('uses the approved missing detail copy', () => {
    expect(contextDetailsText(null, 0)).toBe('Context unavailable');
    expect(tokenDetailsText(null, null)).toContain('Tokens unavailable');
    expect(costDetailsText(null, null)).toContain('Cost unavailable');
  });
});

