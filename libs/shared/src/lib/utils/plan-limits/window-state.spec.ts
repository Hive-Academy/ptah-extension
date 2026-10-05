import type {
  OwnerLimitEvidence,
  PlanLimitWindow,
} from '../../types/plan-limit.types';
import { FRESHNESS_MS, NEAR_LIMIT_PERCENT } from './evidence-precedence';
import {
  activeEstimatedExhaustion,
  activeWindowExhaustion,
  classifyOwnerEvidence,
  classifyWindow,
  isActiveLimitEvidence,
  resetPassage,
  usedPercent,
  windowObservedAt,
  type PlanLimitStateContext,
} from './window-state';

/** Sunday 4 Oct 2026, 12:00 UTC: the injected clock for every case. */
const at = (day: number, hour: number, minute = 0): number =>
  Date.UTC(2026, 9, day, hour, minute);
const NOW = at(4, 12);
const MINUTE = 60_000;

const ctx = (
  overrides: Partial<PlanLimitStateContext> = {},
): PlanLimitStateContext => ({
  now: NOW,
  nearLimitPercent: NEAR_LIMIT_PERCENT,
  freshnessMs: FRESHNESS_MS,
  status: 'available',
  ...overrides,
});

/** A fresh, current-window, provider-reported window at 40 %. */
const win = (overrides: Partial<PlanLimitWindow> = {}): PlanLimitWindow => ({
  key: 'five_hour',
  kind: 'five_hour',
  label: '5-hour session',
  used: { kind: 'percent', percent: 40 },
  usedSource: 'provider-api',
  resetsAt: at(4, 15, 10),
  resetSource: 'provider-api',
  lastResetAt: at(4, 10, 10),
  observedAt: NOW - 2 * MINUTE,
  ...overrides,
});

const hit = (
  overrides: Partial<OwnerLimitEvidence> = {},
): OwnerLimitEvidence => ({
  observedAt: NOW - 5 * MINUTE,
  source: 'error-derived',
  ...overrides,
});

describe('classifyOwnerEvidence / isActiveLimitEvidence', () => {
  it('is active before its reset and expired at and after it', () => {
    const evidence = hit({ resetsAt: NOW + MINUTE });
    expect(classifyOwnerEvidence(evidence, NOW)).toBe('active');
    expect(classifyOwnerEvidence(evidence, NOW + MINUTE)).toBe('expired');
    expect(classifyOwnerEvidence(evidence, NOW + 2 * MINUTE)).toBe('expired');
  });

  it('stays active with an unknown reset (only the ledger clears it)', () => {
    expect(classifyOwnerEvidence(hit(), NOW + 30 * 24 * 60 * MINUTE)).toBe(
      'active',
    );
  });

  it('never counts estimated evidence as a limit', () => {
    expect(isActiveLimitEvidence(hit({ source: 'estimated' }), NOW)).toBe(
      false,
    );
    expect(isActiveLimitEvidence(hit({ source: 'stream-event' }), NOW)).toBe(
      true,
    );
  });
});

describe('usedPercent / windowObservedAt', () => {
  it('F3: an unknown used value has no percent, never 0', () => {
    expect(usedPercent(undefined)).toBeUndefined();
    expect(
      usedPercent({ kind: 'amount', amount: 3, limit: 0, unit: 'USD' }),
    ).toBeUndefined();
    expect(
      usedPercent({ kind: 'percent', percent: Number.NaN }),
    ).toBeUndefined();
    expect(
      usedPercent({
        kind: 'amount',
        amount: Number.NaN,
        limit: 5,
        unit: 'USD',
      }),
    ).toBeUndefined();
  });

  it('turns an amount into a percent of its limit', () => {
    expect(
      usedPercent({ kind: 'amount', amount: 3.2, limit: 50, unit: 'USD' }),
    ).toBeCloseTo(6.4);
  });

  it('prefers the per-field observation instant', () => {
    expect(windowObservedAt(win({ usedObservedAt: at(4, 9) }))).toBe(at(4, 9));
    expect(windowObservedAt(win())).toBe(NOW - 2 * MINUTE);
  });
});

describe('classifyWindow — first-match order (Decision 1)', () => {
  it('1 limit-reached: active non-estimated exhaustion beats stale and aged', () => {
    const window = win({
      exhaustion: hit({ resetsAt: at(5, 9) }),
      observedAt: NOW - 120 * MINUTE,
    });
    expect(classifyWindow(window, ctx({ status: 'stale' }))).toBe(
      'limit-reached',
    );
  });

  it('1 limit-reached: an exhaustion with no reset of its own expires at a later window reset', () => {
    const window = win({ exhaustion: hit(), resetsAt: at(4, 15, 10) });
    expect(classifyWindow(window, ctx())).toBe('limit-reached');
    expect(activeWindowExhaustion(window, NOW)?.resetsAt).toBe(at(4, 15, 10));
    expect(classifyWindow(window, ctx({ now: at(4, 15, 10) }))).not.toBe(
      'limit-reached',
    );
  });

  it('1 limit-reached: a window reset older than the exhaustion cannot clear it', () => {
    const window = win({
      exhaustion: hit({ observedAt: NOW - MINUTE }),
      resetsAt: NOW - 2 * MINUTE,
    });
    expect(classifyWindow(window, ctx())).toBe('limit-reached');
  });

  it('1 does not apply to estimated exhaustion', () => {
    const window = win({ exhaustion: hit({ source: 'estimated' }) });
    expect(classifyWindow(window, ctx())).toBe('ok');
    expect(activeEstimatedExhaustion(window, NOW)).toBeDefined();
    expect(activeWindowExhaustion(window, NOW)).toBeUndefined();
  });

  it('F4 2a: reset passed with no newer observation reads "reset, usage unknown"', () => {
    const window = win({
      used: { kind: 'percent', percent: 97 },
      resetsAt: at(4, 11, 20),
      lastResetAt: at(4, 6, 20),
      observedAt: at(4, 10, 52),
    });
    expect(classifyWindow(window, ctx())).toBe('reset-usage-unknown');
    expect(resetPassage(window, NOW)).toEqual({
      passedAt: at(4, 11, 20),
      lastObservedAt: at(4, 10, 52),
    });
  });

  it('2 is checked before stale and aged', () => {
    const window = win({
      resetsAt: at(4, 11, 20),
      observedAt: at(4, 10, 52),
    });
    expect(classifyWindow(window, ctx({ status: 'stale' }))).toBe(
      'reset-usage-unknown',
    );
  });

  it('2b: an observation before the known last reset, with the next reset kept apart', () => {
    const window = win({
      lastResetAt: at(4, 11, 40),
      resetsAt: at(4, 16, 40),
      observedAt: at(4, 11, 38),
    });
    for (const freshnessMs of [5, 15, 30].map((m) => m * MINUTE)) {
      expect(classifyWindow(window, ctx({ freshnessMs }))).toBe(
        'reset-usage-unknown',
      );
    }
    expect(resetPassage(window, NOW)).toEqual({
      passedAt: at(4, 11, 40),
      nextResetAt: at(4, 16, 40),
      lastObservedAt: at(4, 11, 38),
    });
  });

  it('2a wins over 2b: a passed reported reset is the passed reset, next unknown', () => {
    const window = win({
      lastResetAt: at(4, 11, 40),
      resetsAt: at(4, 11, 50),
      observedAt: at(4, 11, 45),
    });
    expect(resetPassage(window, NOW)).toEqual({
      passedAt: at(4, 11, 50),
      lastObservedAt: at(4, 11, 45),
    });
  });

  it('an expired exhaustion falls through to "reset, usage unknown"', () => {
    const window = win({
      exhaustion: hit({ observedAt: at(4, 10), resetsAt: at(4, 11) }),
      resetsAt: at(4, 11),
      observedAt: at(4, 10),
    });
    expect(classifyWindow(window, ctx())).toBe('reset-usage-unknown');
  });

  it('F3 3: no used value is "usage unknown", never 0', () => {
    expect(classifyWindow(win({ used: undefined }), ctx())).toBe(
      'usage-unknown',
    );
    expect(
      classifyWindow(
        win({ used: { kind: 'amount', amount: 0, limit: 0, unit: 'USD' } }),
        ctx(),
      ),
    ).toBe('usage-unknown');
  });

  it('4 estimate-only: the used value is estimated', () => {
    expect(
      classifyWindow(
        win({
          usedSource: 'estimated',
          used: { kind: 'percent', percent: 99 },
        }),
        ctx(),
      ),
    ).toBe('estimate-only');
  });

  it('5 aged: older than the freshness bound, or provider status stale', () => {
    const codexAged = win({
      lastResetAt: at(4, 11, 10),
      observedAt: at(4, 11, 38),
    });
    expect(classifyWindow(codexAged, ctx())).toBe('aged');
    expect(classifyWindow(codexAged, ctx({ freshnessMs: 30 * MINUTE }))).toBe(
      'ok',
    );
    expect(classifyWindow(win(), ctx({ status: 'stale' }))).toBe('aged');
  });

  it('5 aged: exactly at the freshness bound is still fresh', () => {
    const window = win({ observedAt: NOW - FRESHNESS_MS });
    expect(classifyWindow(window, ctx())).toBe('ok');
    expect(
      classifyWindow(win({ observedAt: NOW - FRESHNESS_MS - 1 }), ctx()),
    ).toBe('aged');
  });

  it('6 not-confirmed: last reset unknown', () => {
    expect(
      classifyWindow(
        win({ lastResetAt: undefined, used: { kind: 'percent', percent: 97 } }),
        ctx(),
      ),
    ).toBe('not-confirmed');
  });

  it('7 near-limit at or above the threshold, ok below it', () => {
    expect(
      classifyWindow(win({ used: { kind: 'percent', percent: 90 } }), ctx()),
    ).toBe('near-limit');
    expect(
      classifyWindow(win({ used: { kind: 'percent', percent: 89.9 } }), ctx()),
    ).toBe('ok');
    expect(
      classifyWindow(
        win({ used: { kind: 'amount', amount: 47.5, limit: 50, unit: 'USD' } }),
        ctx(),
      ),
    ).toBe('near-limit');
  });

  it('post-reset fresh observation is ok', () => {
    const window = win({
      used: { kind: 'percent', percent: 3 },
      lastResetAt: at(4, 11, 20),
      resetsAt: at(4, 16, 20),
      observedAt: at(4, 11, 50),
    });
    expect(classifyWindow(window, ctx())).toBe('ok');
  });

  it('F2: a provider-api used value beside an estimated reset is not "estimate only"', () => {
    const window = win({ resetSource: 'estimated' });
    expect(classifyWindow(window, ctx())).toBe('ok');
  });
});

describe('F11 / F25: independent windows expire at their own resets', () => {
  const fiveHour = win({
    exhaustion: hit({ resetsAt: at(4, 15, 10) }),
    resetsAt: at(4, 15, 10),
    observedAt: NOW - 5 * MINUTE,
  });
  const weekly = win({
    key: 'weekly',
    kind: 'weekly',
    label: 'Weekly',
    exhaustion: hit({ resetsAt: at(5, 9) }),
    resetsAt: at(5, 9),
    lastResetAt: Date.UTC(2026, 8, 28, 9),
    observedAt: NOW - 5 * MINUTE,
  });

  it('F11: both exhausted with different resets', () => {
    expect(classifyWindow(fiveHour, ctx())).toBe('limit-reached');
    expect(classifyWindow(weekly, ctx())).toBe('limit-reached');
    expect(activeWindowExhaustion(fiveHour, NOW)?.resetsAt).not.toBe(
      activeWindowExhaustion(weekly, NOW)?.resetsAt,
    );
  });

  it('F25: the 5-hour window expires at 15:10 while the weekly one stays exhausted', () => {
    const justBefore = ctx({ now: at(4, 15, 10) - 1 });
    expect(classifyWindow(fiveHour, justBefore)).toBe('limit-reached');

    const atReset = ctx({ now: at(4, 15, 10) });
    expect(classifyWindow(fiveHour, atReset)).toBe('reset-usage-unknown');
    expect(classifyWindow(weekly, atReset)).toBe('limit-reached');

    const afterWeekly = ctx({ now: at(5, 9) });
    expect(classifyWindow(weekly, afterWeekly)).toBe('reset-usage-unknown');
  });
});
