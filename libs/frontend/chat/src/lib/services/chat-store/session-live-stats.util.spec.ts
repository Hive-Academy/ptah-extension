/**
 * Pure-function spec for `deriveLiveModelStats` — the ONE derivation behind the
 * context gauge, shared by tab and non-tab surfaces.
 *
 * TASK_2026_408 phase 2. The load-bearing rules pinned here:
 *   1. `lastTurnContextTokens: 0` is an HONEST reading, not an absence. Only
 *      null/undefined falls back to the cumulative sum. This is the total
 *      prompt size, including cached input; a fully cached nonempty prompt
 *      must still have nonzero context occupancy.
 *   2. The last turn's context fill and the session's cumulative token total
 *      are DIFFERENT numbers; the gauge must show the former when present.
 *   3. The cumulative fallback is not a context fill once the session has
 *      compacted or the sum has passed the window — it is suppressed (live:
 *      null), never rendered as a >100% fill.
 */

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
    costUSD: 0,
    cacheReadInputTokens: 12,
    ...overrides,
  };
}

describe('deriveLiveModelStats (session-live-stats.util)', () => {
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

  it('falls back to cumulative input + cacheRead + output only when lastTurnContextTokens is absent', () => {
    const derived = deriveLiveModelStats(
      [usage({ lastTurnContextTokens: undefined })],
      { stickyModel: null, hasCompacted: false },
    );

    expect(derived?.suppressed).toBe(false);
    // 30 input + 12 cacheRead + 9 output — the cumulative turn total.
    expect(derived?.live?.contextUsed).toBe(51);
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
    // null means "leave the displayed number alone" — never a wrong fill.
    expect(derived?.live).toBeNull();
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
    expect(derived?.live).toBeNull();
  });

  it('keeps a sticky model that appears in the turn as the primary model', () => {
    const derived = deriveLiveModelStats(
      [
        usage({ model: 'other-model', costUSD: 0.9, lastTurnContextTokens: 10 }),
        usage({ model: 'claude-sonnet-4', costUSD: 0.01, lastTurnContextTokens: 1000 }),
      ],
      { stickyModel: 'claude-sonnet-4', hasCompacted: false },
    );

    expect(derived?.primaryModel.model).toBe('claude-sonnet-4');
    expect(derived?.live?.contextUsed).toBe(1000);
  });

  it('ignores a sticky model that did not contribute to this turn', () => {
    const derived = deriveLiveModelStats(
      [usage({ model: 'claude-sonnet-4', costUSD: 0.05, lastTurnContextTokens: 500 })],
      { stickyModel: 'claude-opus-4', hasCompacted: false },
    );

    expect(derived?.primaryModel.model).toBe('claude-sonnet-4');
  });

  it('renders 0 contextPercent when the context window is unknown (0)', () => {
    const derived = deriveLiveModelStats(
      [usage({ contextWindow: 0, lastTurnContextTokens: 42 })],
      { stickyModel: null, hasCompacted: false },
    );

    expect(derived?.live?.contextUsed).toBe(42);
    expect(derived?.live?.contextPercent).toBe(0);
  });
});