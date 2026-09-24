import {
  deriveLiveModelStats,
  type TurnModelUsage,
} from './session-live-stats.util';

const WINDOW = 200_000;

function usage(overrides: Partial<TurnModelUsage> = {}): TurnModelUsage {
  return {
    model: 'claude-sonnet-4',
    inputTokens: 30,
    outputTokens: 9,
    contextWindow: WINDOW,
    contextCapacity: {
      tokens: WINDOW,
      source: 'sdk-native',
      providerId: null,
      model: 'claude-sonnet-4',
    },
    costUSD: 0,
    cacheReadInputTokens: 12,
    ...overrides,
  };
}

describe('deriveLiveModelStats (session-live-stats.util)', () => {
  it('never substitutes cumulative usage for a missing main context frame', () => {
    const row = {
      ...usage({ inputTokens: 50, outputTokens: 16, cacheReadInputTokens: 42 }),
      contextCapacity: {
        tokens: WINDOW,
        source: 'provider-catalog' as const,
        providerId: 'openai-codex',
        model: 'claude-sonnet-4',
      },
    };
    expect(deriveLiveModelStats([row], { hasCompacted: false })?.live).toEqual(
      expect.objectContaining({ contextKnown: false, contextPercent: 0 }),
    );
  });

  it.each([NaN, Infinity, -1])(
    'marks invalid main context unknown: %p',
    (lastTurnContextTokens) => {
      const derived = deriveLiveModelStats([usage({ lastTurnContextTokens })], {
        hasCompacted: false,
      });
      expect(derived?.live.contextKnown).toBe(false);
    },
  );

  it.each([
    undefined,
    {
      tokens: 200000,
      source: 'unknown' as const,
      providerId: 'openai-codex',
      model: 'claude-sonnet-4',
    },
    {
      tokens: 200000,
      source: 'provider-catalog' as const,
      providerId: null,
      model: 'claude-sonnet-4',
    },
    {
      tokens: 200000,
      source: 'provider-catalog' as const,
      providerId: 'openai-codex',
      model: 'different-model',
    },
    {
      tokens: NaN,
      source: 'sdk-native' as const,
      providerId: null,
      model: 'claude-sonnet-4',
    },
  ])('rejects unverified or mismatched capacity: %j', (contextCapacity) => {
    const derived = deriveLiveModelStats(
      [usage({ lastTurnContextTokens: 42, contextCapacity })],
      { hasCompacted: false },
    );
    expect(derived?.live).toEqual(
      expect.objectContaining({
        contextKnown: true,
        contextUsed: 42,
        contextWindow: 0,
        contextPercent: 0,
      }),
    );
  });

  it('returns null for an empty modelUsage list', () => {
    expect(
      deriveLiveModelStats([], { stickyModel: null, hasCompacted: false }),
    ).toBeNull();
  });

  it('treats lastTurnContextTokens 0 as a real reading — 0% fill, not a fallback', () => {
    const derived = deriveLiveModelStats(
      [usage({ lastTurnContextTokens: 0 })],
      { stickyModel: null, hasCompacted: false },
    );

    expect(derived).not.toBeNull();
    expect(derived?.suppressed).toBe(false);
    expect(derived?.live?.contextUsed).toBe(0);
    expect(derived?.live?.contextPercent).toBe(0);
  });

  it('publishes explicit unknown when lastTurnContextTokens is absent', () => {
    const derived = deriveLiveModelStats(
      [usage({ lastTurnContextTokens: undefined })],
      { stickyModel: null, hasCompacted: false },
    );

    expect(derived?.suppressed).toBe(true);
    // Cumulative usage is not a main context frame: 30 input + 12 cacheRead + 9 output — the cumulative turn total.
    expect(derived?.live?.contextKnown).toBe(false);
  });

  it('prefers the last turn context over the cumulative total when both exist', () => {
    const derived = deriveLiveModelStats(
      // Cumulative would read 51; the turn's real prompt was 4200.
      [usage({ lastTurnContextTokens: 4200 })],
      { stickyModel: null, hasCompacted: false },
    );

    expect(derived?.live?.contextUsed).toBe(4200);
    // 4200 / 200000 = 2.1%.
    expect(derived?.live?.contextPercent).toBe(2.1);
  });

  it('suppresses the fill when compacted and only the cumulative fallback exists', () => {
    const derived = deriveLiveModelStats(
      [usage({ lastTurnContextTokens: undefined })],
      { stickyModel: null, hasCompacted: true },
    );

    expect(derived?.suppressed).toBe(true);
    // Explicit unknown replaces any previously displayed fill.
    expect(derived?.live?.contextKnown).toBe(false);
  });

  it('does NOT suppress after compaction when the turn reported its own context fill', () => {
    const derived = deriveLiveModelStats(
      [usage({ lastTurnContextTokens: 1200 })],
      { stickyModel: null, hasCompacted: true },
    );

    expect(derived?.suppressed).toBe(false);
    expect(derived?.live?.contextUsed).toBe(1200);
  });

  it('suppresses when the cumulative fallback exceeds the context window', () => {
    const derived = deriveLiveModelStats(
      [
        usage({
          inputTokens: 190_000,
          outputTokens: 20_000,
          cacheReadInputTokens: 0,
          lastTurnContextTokens: undefined,
        }),
      ],
      { stickyModel: null, hasCompacted: false },
    );

    expect(derived?.suppressed).toBe(true);
    expect(derived?.live?.contextKnown).toBe(false);
  });

  it('keeps a sticky model that appears in the turn as the primary model', () => {
    const derived = deriveLiveModelStats(
      [
        usage({
          model: 'other-model',
          costUSD: 0.9,
          lastTurnContextTokens: 10,
        }),
        usage({
          model: 'claude-sonnet-4',
          costUSD: 0.01,
          lastTurnContextTokens: 1000,
        }),
      ],
      { stickyModel: 'claude-sonnet-4', hasCompacted: false },
    );

    expect(derived?.primaryModel.model).toBe('claude-sonnet-4');
    expect(derived?.live?.contextUsed).toBe(1000);
  });

  it('ignores a sticky model that did not contribute to this turn', () => {
    const derived = deriveLiveModelStats(
      [
        usage({
          model: 'claude-sonnet-4',
          costUSD: 0.05,
          lastTurnContextTokens: 500,
        }),
      ],
      { stickyModel: 'claude-opus-4', hasCompacted: false },
    );

    expect(derived?.primaryModel.model).toBe('claude-sonnet-4');
  });

  it('renders 0 contextPercent when the context window is unknown (0)', () => {
    const derived = deriveLiveModelStats(
      [
        usage({
          contextWindow: 0,
          contextCapacity: undefined,
          lastTurnContextTokens: 42,
        }),
      ],
      { stickyModel: null, hasCompacted: false },
    );

    expect(derived?.live?.contextUsed).toBe(42);
    expect(derived?.live?.contextPercent).toBe(0);
  });
});
