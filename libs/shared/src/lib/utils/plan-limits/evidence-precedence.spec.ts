import {
  FRESHNESS_MS,
  LIMIT_LOOKUP_DEADLINE_MS,
  NEAR_LIMIT_PERCENT,
  supersedes,
  type PlanLimitEvidenceStamp,
} from './evidence-precedence';

const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const MINUTE = 60_000;

describe('supersedes', () => {
  describe('F21 rule: newer non-stale evidence wins', () => {
    it('replaces older evidence with newer evidence', () => {
      const prev: PlanLimitEvidenceStamp = {
        observedAt: T0,
        source: 'provider-api',
      };
      const next: PlanLimitEvidenceStamp = {
        observedAt: T0 + MINUTE,
        source: 'provider-api',
      };
      expect(supersedes(next, prev)).toBe(true);
      expect(supersedes(prev, next)).toBe(false);
    });

    it('on an equal instant, only fresh evidence replaces stale evidence', () => {
      const stale: PlanLimitEvidenceStamp = {
        observedAt: T0,
        source: 'provider-api',
        stale: true,
      };
      const fresh: PlanLimitEvidenceStamp = {
        observedAt: T0,
        source: 'provider-api',
      };
      expect(supersedes(fresh, stale)).toBe(true);
      expect(supersedes(stale, fresh)).toBe(false);
      expect(supersedes(fresh, fresh)).toBe(false);
    });
  });

  describe('F21 rule: estimated never supersedes real evidence observed after the last reset', () => {
    const lastResetAt = T0;
    const real: PlanLimitEvidenceStamp = {
      observedAt: T0 + MINUTE,
      source: 'provider-api',
    };
    const newerEstimate: PlanLimitEvidenceStamp = {
      observedAt: T0 + 10 * MINUTE,
      source: 'estimated',
    };

    it('keeps post-reset real evidence even when the estimate is newer', () => {
      expect(supersedes(newerEstimate, real, lastResetAt)).toBe(false);
    });

    it('keeps real evidence when the last reset is unknown', () => {
      expect(supersedes(newerEstimate, real)).toBe(false);
      expect(supersedes(newerEstimate, real, Number.NaN)).toBe(false);
    });

    it('lets a newer estimate replace real evidence from before the reset', () => {
      const preReset: PlanLimitEvidenceStamp = {
        observedAt: T0 - MINUTE,
        source: 'stream-event',
      };
      expect(supersedes(newerEstimate, preReset, lastResetAt)).toBe(true);
    });

    it('orders estimates among themselves by recency', () => {
      const olderEstimate: PlanLimitEvidenceStamp = {
        observedAt: T0 + MINUTE,
        source: 'estimated',
      };
      expect(supersedes(newerEstimate, olderEstimate, lastResetAt)).toBe(true);
    });

    it('lets real evidence replace an estimate', () => {
      const estimate: PlanLimitEvidenceStamp = {
        observedAt: T0,
        source: 'estimated',
      };
      expect(supersedes(real, estimate, lastResetAt)).toBe(true);
    });
  });

  describe('F21 rule: stale API data never clears a newer live exhaustion', () => {
    const staleRead: PlanLimitEvidenceStamp = {
      observedAt: T0,
      source: 'provider-api',
      stale: true,
    };

    it.each(['stream-event', 'error-derived'] as const)(
      'keeps a newer %s exhaustion',
      (source) => {
        const exhaustion: PlanLimitEvidenceStamp = {
          observedAt: T0 + MINUTE,
          source,
          exhausted: true,
        };
        expect(supersedes(staleRead, exhaustion)).toBe(false);
      },
    );

    it('keeps a live exhaustion observed at the same instant', () => {
      const exhaustion: PlanLimitEvidenceStamp = {
        observedAt: T0,
        source: 'stream-event',
        exhausted: true,
        stale: true,
      };
      expect(supersedes(staleRead, exhaustion)).toBe(false);
    });

    it('lets a fresh read observed after the exhaustion clear it', () => {
      const exhaustion: PlanLimitEvidenceStamp = {
        observedAt: T0,
        source: 'error-derived',
        exhausted: true,
      };
      const freshRead: PlanLimitEvidenceStamp = {
        observedAt: T0 + MINUTE,
        source: 'provider-api',
      };
      expect(supersedes(freshRead, exhaustion)).toBe(true);
    });
  });

  it('takes any valid evidence when nothing is held', () => {
    expect(supersedes({ observedAt: T0, source: 'estimated' }, undefined)).toBe(
      true,
    );
    expect(
      supersedes(
        { observedAt: T0, source: 'provider-api' },
        { observedAt: Number.NaN, source: 'provider-api' },
      ),
    ).toBe(true);
  });

  it('never lets evidence with an invalid instant supersede', () => {
    const invalid: PlanLimitEvidenceStamp = {
      observedAt: Number.NaN,
      source: 'provider-api',
    };
    expect(supersedes(invalid, undefined)).toBe(false);
    expect(
      supersedes(invalid, { observedAt: T0, source: 'provider-api' }),
    ).toBe(false);
  });
});

describe('plan-limit constants', () => {
  it('match the plan values', () => {
    expect(NEAR_LIMIT_PERCENT).toBe(90);
    expect(FRESHNESS_MS).toBe(15 * MINUTE);
    expect(LIMIT_LOOKUP_DEADLINE_MS).toBe(3_000);
  });
});
