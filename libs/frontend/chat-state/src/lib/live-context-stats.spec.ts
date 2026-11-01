import { contextFillStats, liveContextStats } from './live-context-stats';
import type { LiveModelStatsPayload } from './tab-state.types';

const MODEL = 'claude-sonnet-4-5';

const capacity = {
  tokens: 200_000,
  source: 'provider-catalog' as const,
  providerId: 'anthropic',
  model: MODEL,
};

const prior: LiveModelStatsPayload = {
  model: MODEL,
  contextKnown: true,
  contextCapacity: capacity,
  contextUsed: 40_000,
  contextWindow: 200_000,
  contextPercent: 20,
};

describe('contextFillStats', () => {
  it.each([
    { window: 200_000, used: 130_000, percent: 65 }, // F2
    { window: 1_000_000, used: 130_000, percent: 13 }, // F3
    { window: 200_000, used: 30_000, percent: 15 }, // F8
  ])('reports $percent% for $used used in a $window trusted window', ({ window, used, percent }) => {
    expect(contextFillStats({
      ...prior,
      contextCapacity: { ...capacity, tokens: window, source: 'sdk-native' },
    }, used)).toEqual(expect.objectContaining({
      contextUsed: used,
      contextWindow: window,
      contextPercent: percent,
    }));
  });

  it('replaces the fill and reuses the prior trusted capacity', () => {
    expect(contextFillStats(prior, 60_000)).toEqual({
      ...prior,
      contextUsed: 60_000,
      contextPercent: 30,
    });
  });

  it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'returns null for the non-positive or non-finite count %p',
    (tokens) => {
      expect(contextFillStats(prior, tokens)).toBeNull();
    },
  );

  it('returns null without a prior reading', () => {
    expect(contextFillStats(null, 60_000)).toBeNull();
  });

  it.each([
    { ...capacity, providerId: '' },
    { ...capacity, model: 'another-model' },
    { ...capacity, source: 'unknown' as const, tokens: null },
  ])('reports an unknown window for untrusted capacity %j (F6)', (untrustedCapacity) => {
    expect(contextFillStats({ ...prior, contextCapacity: untrustedCapacity }, 60_000)).toEqual(
      expect.objectContaining({ contextWindow: 0, contextPercent: 0 }),
    );
  });
});

describe('liveContextStats', () => {
  it('applies a same-model reading under normalizeModelKey', () => {
    expect(
      liveContextStats(prior, {
        model: 'Anthropic/Claude-Sonnet-4-5-20250929',
        contextTokens: 60_000,
      })?.contextUsed,
    ).toBe(60_000);
  });

  it('returns null on a model mismatch or with no prior reading', () => {
    const context = { model: 'claude-opus-4-1', contextTokens: 60_000 };
    expect(liveContextStats(prior, context)).toBeNull();
    expect(
      liveContextStats(undefined, { model: MODEL, contextTokens: 60_000 }),
    ).toBeNull();
  });
});
