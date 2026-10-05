/**
 * Session budget stage function (TASK_2026_597 N7): measure rules (F6),
 * percent bands, the compaction trigger, the rising rule, the revision rule
 * (F5) and measure stickiness.
 */

import 'reflect-metadata';

import type {
  SessionBudgetConfig,
  SessionBudgetState,
  SessionStatsEntry,
} from '@ptah-extension/shared';
import { SESSION_BUDGET_DEFAULT_CONFIG } from './session-budget-config.provider';
import {
  acceptsSessionBudgetSnapshot,
  effectiveSessionBudgetLimit,
  evaluateSessionBudget,
  measureSessionBudget,
  nextSessionBudgetStage,
  sessionBudgetPercent,
  sessionBudgetPercentBand,
} from './session-budget-stage';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';

function snapshot(
  overrides: Partial<SessionStatsEntry> = {},
): SessionStatsEntry {
  return {
    sessionId: SESSION_ID,
    model: 'claude-test',
    totalCost: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    messageCount: 1,
    status: 'ok',
    ...overrides,
  };
}

function config(
  overrides: Partial<SessionBudgetConfig> = {},
): SessionBudgetConfig {
  return { ...SESSION_BUDGET_DEFAULT_CONFIG, ...overrides };
}

const COST = config({ unit: 'cost' });

describe('measureSessionBudget — unit tokens', () => {
  const opts = { extensions: 0, stickyWeightedFallback: false };

  it('uses the displayed tokenCount against the token limit', () => {
    expect(
      measureSessionBudget(snapshot({ tokenCount: 12_345 }), config(), opts),
    ).toEqual({
      measure: 'tokens',
      used: 12_345,
      limit: 50_000_000,
      lowerBound: false,
    });
  });

  it('never coerces a missing tokenCount to 0', () => {
    expect(measureSessionBudget(snapshot(), config(), opts).used).toBeNull();
  });

  it('marks a partial-coverage figure as a lower bound', () => {
    expect(
      measureSessionBudget(
        snapshot({ tokenCount: 10, coverage: 'partial' }),
        config(),
        opts,
      ).lowerBound,
    ).toBe(true);
  });
});

describe('measureSessionBudget — unit cost (F6)', () => {
  const opts = { extensions: 0, stickyWeightedFallback: false };

  it('uses totalCost when it is known', () => {
    expect(
      measureSessionBudget(
        snapshot({ totalCost: 12.5, pricingCoverage: 'full' }),
        COST,
        opts,
      ),
    ).toEqual({ measure: 'cost', used: 12.5, limit: 30, lowerBound: false });
  });

  it('a provider-reported 0 is a known zero', () => {
    expect(
      measureSessionBudget(snapshot({ totalCost: 0 }), COST, opts),
    ).toMatchObject({ measure: 'cost', used: 0 });
  });

  it('uses knownCost as a lower bound when pricing is partial', () => {
    expect(
      measureSessionBudget(
        snapshot({ knownCost: 4, pricingCoverage: 'partial' }),
        COST,
        opts,
      ),
    ).toEqual({
      measure: 'cost-lower-bound',
      used: 4,
      limit: 30,
      lowerBound: true,
    });
  });

  it('partial pricing without knownCost has no figure', () => {
    expect(
      measureSessionBudget(snapshot({ pricingCoverage: 'partial' }), COST, opts)
        .used,
    ).toBeNull();
  });

  it('falls back to weighted tokens against fallbackWeightedTokens when nothing is priced', () => {
    expect(
      measureSessionBudget(
        snapshot({
          pricingCoverage: 'none',
          tokens: {
            input: 0,
            output: 1_100_000,
            cacheRead: 177_000_000,
            cacheCreation: 7_700_000,
          },
        }),
        COST,
        opts,
      ),
    ).toEqual({
      measure: 'weighted-fallback',
      used: expect.closeTo(32_825_000, 0),
      limit: 9_000_000,
      lowerBound: false,
    });
  });

  it('a sticky weighted-fallback session keeps the measure even when a price appears', () => {
    expect(
      measureSessionBudget(
        snapshot({ totalCost: 3, pricingCoverage: 'full' }),
        COST,
        { extensions: 0, stickyWeightedFallback: true },
      ).measure,
    ).toBe('weighted-fallback');
  });

  it('an extension adds 20% of the configured limit to every measure', () => {
    expect(
      measureSessionBudget(snapshot({ totalCost: 1 }), COST, {
        extensions: 2,
        stickyWeightedFallback: false,
      }).limit,
    ).toBeCloseTo(42, 10);
    expect(effectiveSessionBudgetLimit(50_000_000, 1)).toBe(60_000_000);
  });
});

describe('sessionBudgetPercentBand — boundaries', () => {
  const limit = 1000;
  it.each([
    [0, 'normal'],
    [499, 'normal'],
    [499.999, 'normal'],
    [500, 'tighten'],
    [799, 'tighten'],
    [799.999, 'tighten'],
    [800, 'handoff'],
    [999, 'handoff'],
    [999.999, 'handoff'],
    [1000, 'limit'],
    [5000, 'limit'],
  ] as const)('used %p of 1000 → %s', (used, stage) => {
    expect(sessionBudgetPercentBand(used, limit, config())).toBe(stage);
  });

  it.each([
    [49.9, 'normal'],
    [50, 'tighten'],
    [79.9, 'tighten'],
    [80, 'handoff'],
    [99.9, 'handoff'],
    [100, 'limit'],
  ] as const)('%p%% of the 50M default → %s', (percent, stage) => {
    const used = (50_000_000 * percent) / 100;
    expect(sessionBudgetPercentBand(used, 50_000_000, config())).toBe(stage);
  });

  it('an exact 50% / 80% / 100% USD figure is not rounded below its band', () => {
    expect(sessionBudgetPercentBand(15, 30, config())).toBe('tighten');
    expect(sessionBudgetPercentBand(24, 30, config())).toBe('handoff');
    expect(sessionBudgetPercentBand(30, 30, config())).toBe('limit');
  });

  it('no figure → unknown', () => {
    expect(sessionBudgetPercentBand(null, 1000, config())).toBe('unknown');
    expect(sessionBudgetPercent(null, 1000)).toBeNull();
  });

  it('honours configured bands', () => {
    const c = config({ tightenPercent: 10, handoffPercent: 20 });
    expect(sessionBudgetPercentBand(9, 100, c)).toBe('normal');
    expect(sessionBudgetPercentBand(10, 100, c)).toBe('tighten');
    expect(sessionBudgetPercentBand(20, 100, c)).toBe('handoff');
  });
});

describe('nextSessionBudgetStage', () => {
  const base = {
    compactions: 0,
    handoffAfterCompactions: 3,
    previous: null,
    resetStage: false,
  };

  it('the compaction trigger raises to handoff at handoffAfterCompactions', () => {
    expect(
      nextSessionBudgetStage({ ...base, band: 'normal', compactions: 2 }),
    ).toBe('normal');
    expect(
      nextSessionBudgetStage({ ...base, band: 'normal', compactions: 3 }),
    ).toBe('handoff');
    expect(
      nextSessionBudgetStage({ ...base, band: 'unknown', compactions: 3 }),
    ).toBe('handoff');
    expect(
      nextSessionBudgetStage({ ...base, band: 'limit', compactions: 3 }),
    ).toBe('limit');
  });

  it('stages only rise', () => {
    expect(
      nextSessionBudgetStage({ ...base, band: 'normal', previous: 'handoff' }),
    ).toBe('handoff');
    expect(
      nextSessionBudgetStage({ ...base, band: 'limit', previous: 'tighten' }),
    ).toBe('limit');
  });

  it('a reset (extend or settings change) drops the floor', () => {
    expect(
      nextSessionBudgetStage({
        ...base,
        band: 'handoff',
        previous: 'limit',
        resetStage: true,
      }),
    ).toBe('handoff');
  });
});

describe('acceptsSessionBudgetSnapshot — revision rule (F5)', () => {
  it('accepts anything without a state', () => {
    expect(acceptsSessionBudgetSnapshot(null, undefined, 'loaded')).toBe(true);
    expect(acceptsSessionBudgetSnapshot(null, 3, 'live')).toBe(true);
  });

  it('ignores a lower revision and accepts an equal or higher one', () => {
    expect(acceptsSessionBudgetSnapshot({ revision: 5 }, 4, 'live')).toBe(
      false,
    );
    expect(acceptsSessionBudgetSnapshot({ revision: 5 }, 5, 'live')).toBe(true);
    expect(acceptsSessionBudgetSnapshot({ revision: 5 }, 6, 'loaded')).toBe(
      true,
    );
  });

  it('a resume snapshot without revision is accepted only when no state exists', () => {
    expect(
      acceptsSessionBudgetSnapshot({ revision: null }, undefined, 'loaded'),
    ).toBe(false);
    expect(
      acceptsSessionBudgetSnapshot({ revision: 2 }, undefined, 'loaded'),
    ).toBe(false);
  });

  it('a live snapshot without revision is ignored once a revisioned one was accepted', () => {
    expect(
      acceptsSessionBudgetSnapshot({ revision: 2 }, undefined, 'live'),
    ).toBe(false);
    expect(
      acceptsSessionBudgetSnapshot({ revision: null }, undefined, 'live'),
    ).toBe(true);
  });
});

describe('evaluateSessionBudget', () => {
  const evaluate = (
    s: SessionStatsEntry,
    previous: SessionBudgetState | null,
    extra: Partial<{
      config: SessionBudgetConfig;
      compactions: number;
      extensions: number;
      resetStage: boolean;
      resetMeasure: boolean;
    }> = {},
  ): SessionBudgetState => ({
    sessionId: SESSION_ID,
    ...evaluateSessionBudget({
      snapshot: s,
      config: extra.config ?? config(),
      previous,
      compactions: extra.compactions ?? 0,
      extensions: extra.extensions ?? 0,
      resetStage: extra.resetStage ?? false,
      resetMeasure: extra.resetMeasure ?? false,
    }),
  });

  it('first figure: used equals the snapshot tokenCount (same figure as the chip)', () => {
    const state = evaluate(
      snapshot({ tokenCount: 25_000_000, revision: 7 }),
      null,
    );
    expect(state).toEqual({
      sessionId: SESSION_ID,
      stage: 'tighten',
      unit: 'tokens',
      measure: 'tokens',
      used: 25_000_000,
      limit: 50_000_000,
      percent: 50,
      lowerBound: false,
      revision: 7,
      compactions: 0,
      extensions: 0,
      blocked: false,
    });
  });

  it('no figure before the first one → unknown, never blocked', () => {
    const state = evaluate(snapshot({ revision: 1 }), null);
    expect(state.stage).toBe('unknown');
    expect(state.used).toBeNull();
    expect(state.percent).toBeNull();
    expect(state.blocked).toBe(false);
  });

  it('a snapshot with no figure keeps the previous figure and stage', () => {
    const first = evaluate(
      snapshot({ tokenCount: 42_000_000, revision: 1 }),
      null,
    );
    const next = evaluate(snapshot({ revision: 2 }), first);
    expect(next.stage).toBe('handoff');
    expect(next.used).toBe(42_000_000);
    expect(next.revision).toBe(2);
  });

  it('a kept figure from another measure uses the current extended limit', () => {
    const priced = evaluate(
      snapshot({ totalCost: 1, pricingCoverage: 'full', revision: 1 }),
      null,
      { config: COST },
    );
    expect(priced.measure).toBe('cost');
    const next = evaluate(
      snapshot({ pricingCoverage: 'partial', revision: 2 }),
      priced,
      { config: COST, extensions: 1 },
    );
    expect(next.measure).toBe('cost');
    expect(next.used).toBe(1);
    expect(next.limit).toBeCloseTo(COST.usd * 1.2, 6);
  });

  it('at 100% with blockAtLimit the state is blocked; without it, not', () => {
    expect(evaluate(snapshot({ tokenCount: 50_000_000 }), null).blocked).toBe(
      true,
    );
    expect(
      evaluate(snapshot({ tokenCount: 50_000_000 }), null, {
        config: config({ blockAtLimit: false }),
      }),
    ).toMatchObject({ stage: 'limit', blocked: false });
  });

  it('extend: +20% limit and the stage recomputed without the floor', () => {
    const atLimit = evaluate(snapshot({ tokenCount: 52_000_000 }), null);
    const extended = evaluate(snapshot({ tokenCount: 52_000_000 }), atLimit, {
      extensions: 1,
      resetStage: true,
    });
    expect(extended).toMatchObject({
      stage: 'handoff',
      limit: 60_000_000,
      extensions: 1,
      blocked: false,
    });
  });

  it('weighted-fallback stays sticky until a settings change', () => {
    const none = evaluate(
      snapshot({
        pricingCoverage: 'none',
        tokens: { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 },
      }),
      null,
      { config: COST },
    );
    expect(none.measure).toBe('weighted-fallback');
    const priced = snapshot({ totalCost: 1, pricingCoverage: 'full' });
    expect(evaluate(priced, none, { config: COST }).measure).toBe(
      'weighted-fallback',
    );
    expect(
      evaluate(priced, none, {
        config: COST,
        resetMeasure: true,
        resetStage: true,
      }).measure,
    ).toBe('cost');
  });

  it('lower bound: partial pricing measures ≥ knownCost', () => {
    const state = evaluate(
      snapshot({ knownCost: 27, pricingCoverage: 'partial' }),
      null,
      { config: COST },
    );
    expect(state).toMatchObject({
      measure: 'cost-lower-bound',
      used: 27,
      lowerBound: true,
      stage: 'handoff',
    });
  });

  it('the compaction count raises a low figure to handoff', () => {
    expect(
      evaluate(snapshot({ tokenCount: 1 }), null, { compactions: 3 }).stage,
    ).toBe('handoff');
  });
});
