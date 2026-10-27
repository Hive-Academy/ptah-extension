import type { ActivityDay, PlanRingData } from '@ptah-extension/chat-ui';
import type {
  PlanLimitOwnerSnapshot,
  PlanLimitsSnapshot,
  PlanLimitWindow,
  UsageFact,
  UsageSummary,
} from '@ptah-extension/shared';
import {
  ACTIVITY_DAY_COUNT,
  SPEND_DAY_COUNT,
  dayWindow,
  hasUsage,
  lastNDays,
  localDayKey,
  selectPlanRing,
  toActivityDays,
  totals,
  usageDayWindow,
  utcDayKey,
} from './usage-vitals.model';

function fact(day: string, overrides: Partial<UsageFact> = {}): UsageFact {
  return {
    day,
    providerId: 'anthropic',
    modelId: 'claude',
    inputUncachedTokens: 10,
    cacheReadTokens: 20,
    cacheWriteTokens: 30,
    outputTokens: 40,
    costUsd: 1.5,
    cacheSavingsUsd: null,
    costSource: 'model-priced',
    requestCount: 2,
    sourceId: 'claude-code',
    ...overrides,
  };
}

const UNPRICED = { costUsd: null, costSource: 'unpriced' } as const;

function summary(facts: UsageFact[]): UsageSummary {
  return {
    version: 1,
    generatedAt: '2026-10-26T12:00:00.000Z',
    timeZone: 'UTC',
    fromDay: '2026-07-29',
    untilDayExclusive: '2026-10-28',
    facts,
    sources: [],
    pricing: { source: 'bundled', asOf: null },
  };
}

/** UTC-8 at 20:00 on Oct 26: the host already keys today's facts Oct 27. */
const BEHIND_EVENING = { local: '2026-10-26', utc: '2026-10-27' };
/** UTC+13 at 00:30 on Oct 26: the host still keys facts Oct 25. */
const AHEAD_AFTER_MIDNIGHT = { local: '2026-10-26', utc: '2026-10-25' };

const grid = (clock: { local: string; utc: string }): string[] =>
  dayWindow(clock.local, clock.utc, ACTIVITY_DAY_COUNT);
const week = (clock: { local: string; utc: string }): string[] =>
  dayWindow(clock.local, clock.utc, SPEND_DAY_COUNT);

describe('day keys and the day window', () => {
  it('formats local and UTC calendar days', () => {
    const date = new Date(Date.UTC(2026, 9, 26, 12));
    expect(utcDayKey(date)).toBe('2026-10-26');
    expect(localDayKey(new Date(2026, 9, 26, 0, 30))).toBe('2026-10-26');
  });

  it('ends at the UTC day for a user behind UTC in the evening', () => {
    expect(week(BEHIND_EVENING)).toEqual([
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
    ]);
  });

  it('ends at the local day for a user ahead of UTC just after midnight', () => {
    expect(week(AHEAD_AFTER_MIDNIGHT).at(-1)).toBe('2026-10-26');
    expect(week(AHEAD_AFTER_MIDNIGHT)[0]).toBe('2026-10-20');
  });

  it('steps across month boundaries', () => {
    expect(dayWindow('2026-11-02', '2026-11-02', 4)).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  it('is empty for an invalid date, key or count', () => {
    expect(usageDayWindow(new Date(Number.NaN), 7)).toEqual([]);
    expect(dayWindow('NaN-NaN-NaN', '2026-10-26', 7)).toEqual([]);
    expect(dayWindow('2026-10-26', '2026-10-26', 0)).toEqual([]);
    expect(dayWindow('2026-10-26', '2026-10-26', 1.5)).toEqual([]);
  });

  it('builds the window from the local and UTC day of now', () => {
    const now = new Date(Date.UTC(2026, 9, 26, 12));
    expect(usageDayWindow(now, 3)).toEqual(
      dayWindow(localDayKey(now), utcDayKey(now), 3),
    );
  });

  it('fits every day of a 90-day summary in the 91-day grid either way', () => {
    // Host window: the 90 UTC days ending at the UTC day of now.
    for (const clock of [BEHIND_EVENING, AHEAD_AFTER_MIDNIGHT]) {
      const fetched = dayWindow(clock.utc, clock.utc, 90);
      const cells = new Set(grid(clock));
      expect(fetched.every((day) => cells.has(day))).toBe(true);
    }
  });
});

describe('toActivityDays', () => {
  it('returns one cell per window day, zero where there are no facts', () => {
    const activity = toActivityDays(summary([]), grid(AHEAD_AFTER_MIDNIGHT));

    expect(activity?.days).toHaveLength(ACTIVITY_DAY_COUNT);
    expect(activity?.today).toBe('2026-10-26');
    expect(activity?.days.at(-1)).toEqual({ date: '2026-10-26', value: 0 });
  });

  it("keeps today's facts for a user behind UTC in the evening", () => {
    const activity = toActivityDays(
      summary([
        fact('2026-10-27', { requestCount: 3 }),
        fact('2026-10-27', { requestCount: 4 }),
        fact('2026-10-26', { requestCount: 1 }),
      ]),
      grid(BEHIND_EVENING),
    );

    expect(activity?.metric).toBe('requests');
    expect(activity?.today).toBe('2026-10-27');
    expect(activity?.days.at(-1)).toEqual({ date: '2026-10-27', value: 7 });
    expect(activity?.days.at(-2)).toEqual({ date: '2026-10-26', value: 1 });
  });

  it('places the latest UTC day on yesterday for a user ahead of UTC', () => {
    const activity = toActivityDays(
      summary([fact('2026-10-25', { requestCount: 5 })]),
      grid(AHEAD_AFTER_MIDNIGHT),
    );

    expect(activity?.days.at(-1)?.value).toBe(0);
    expect(activity?.days.at(-2)).toEqual({ date: '2026-10-25', value: 5 });
  });

  it('falls back to token sums when a fact in the window has no request count', () => {
    const activity = toActivityDays(
      summary([
        fact('2026-10-26', { requestCount: undefined }),
        fact('2026-10-26', { requestCount: 9 }),
      ]),
      grid(AHEAD_AFTER_MIDNIGHT),
    );

    expect(activity?.metric).toBe('tokens');
    expect(activity?.days.at(-1)?.value).toBe(200);
  });

  it('is null for an empty window', () => {
    expect(toActivityDays(summary([fact('2026-10-26')]), [])).toBeNull();
  });

  it('days match the activity grid input type', () => {
    const days: readonly ActivityDay[] =
      toActivityDays(summary([]), grid(BEHIND_EVENING))?.days ?? [];
    expect(days.length).toBe(ACTIVITY_DAY_COUNT);
  });
});

describe('totals and hasUsage', () => {
  it('sums the four token fields and the priced cost inside the window', () => {
    const result = totals(
      summary([
        fact('2026-10-26'),
        fact('2026-10-25', { ...UNPRICED }),
        fact('2026-10-19'),
      ]),
      week(AHEAD_AFTER_MIDNIGHT),
    );

    expect(result).toEqual({ tokens: 200, costUsd: 1.5 });
  });

  it("counts today's facts behind UTC exactly once, like the bars", () => {
    const usage = summary([fact('2026-10-27', { costUsd: 2 })]);
    const window = week(BEHIND_EVENING);

    expect(totals(usage, window).costUsd).toBe(2);
    expect(lastNDays(usage, window).at(-1)).toBe(2);
  });

  it('reports a null cost when every fact is unpriced', () => {
    expect(
      totals(summary([fact('2026-10-26', { ...UNPRICED })]), week(AHEAD_AFTER_MIDNIGHT)),
    ).toEqual({ tokens: 100, costUsd: null });
  });

  it('ignores non-finite numbers', () => {
    expect(
      totals(
        summary([fact('2026-10-26', { outputTokens: Number.NaN, costUsd: Number.POSITIVE_INFINITY })]),
        week(AHEAD_AFTER_MIDNIGHT),
      ),
    ).toEqual({ tokens: 60, costUsd: null });
  });

  it('handles an empty summary', () => {
    expect(totals(summary([]), week(AHEAD_AFTER_MIDNIGHT))).toEqual({ tokens: 0, costUsd: null });
    expect(hasUsage(summary([]))).toBe(false);
    expect(hasUsage(summary([fact('2026-10-26')]))).toBe(true);
  });
});

describe('lastNDays', () => {
  it('returns spend per day, oldest first, null without a priced fact', () => {
    const bars = lastNDays(
      summary([
        fact('2026-10-26', { costUsd: 2 }),
        fact('2026-10-26', { costUsd: 0.5 }),
        fact('2026-10-24', { ...UNPRICED }),
        fact('2026-10-20', { costUsd: 0 }),
      ]),
      week(AHEAD_AFTER_MIDNIGHT),
    );

    expect(bars).toEqual([0, null, null, null, null, null, 2.5]);
  });
});

describe('selectPlanRing', () => {
  const NOW = Date.UTC(2026, 9, 26, 12);

  function window(overrides: Partial<PlanLimitWindow>): PlanLimitWindow {
    return {
      key: 'five_hour',
      kind: 'five_hour',
      label: '5-hour',
      observedAt: NOW,
      ...overrides,
    };
  }

  function owner(key: string, windows: PlanLimitWindow[]): PlanLimitOwnerSnapshot {
    return {
      owner: { key, providerId: 'anthropic', identityKind: 'account', label: 'Claude account' },
      status: 'available',
      windowSetEstablished: true,
      windows,
      ownerEvidence: [],
    };
  }

  function snapshot(
    owners: PlanLimitOwnerSnapshot[],
    sessionOwners: PlanLimitsSnapshot['sessionOwners'] = {},
  ): PlanLimitsSnapshot {
    return { generatedAt: NOW, owners, sessionOwners };
  }

  const unknownOwner = owner('a', [window({ label: 'unknown' })]);
  const firstKnown = owner('b', [
    window({ used: { kind: 'percent', percent: 30 }, resetsAt: NOW + 60_000 }),
    window({
      key: 'weekly',
      kind: 'weekly',
      label: 'Weekly',
      used: { kind: 'amount', amount: 45, limit: 50, unit: 'requests' },
    }),
  ]);
  const sessionOwned = owner('c', [
    window({ used: { kind: 'percent', percent: 140 }, resetsAt: NOW - 5 }),
  ]);

  it('returns null without a snapshot or a known window', () => {
    expect(selectPlanRing(null, null, NOW)).toBeNull();
    expect(selectPlanRing(snapshot([unknownOwner]), null, NOW)).toBeNull();
  });

  it('picks the first owner with a known window, then its highest used window', () => {
    const ring: PlanRingData | null = selectPlanRing(
      snapshot([unknownOwner, firstKnown]),
      null,
      NOW,
    );
    expect(ring).toEqual({ percent: 90, label: 'Weekly', resetsInMs: null });
  });

  it("uses the session's owner and clamps percent and reset delay", () => {
    expect(
      selectPlanRing(
        snapshot([firstKnown, sessionOwned], {
          s1: { ownerKey: 'c', modelScope: null },
        }),
        's1',
        NOW,
      ),
    ).toEqual({ percent: 100, label: '5-hour', resetsInMs: 0 });
  });

  it('gives an unknown reset for a non-finite now', () => {
    expect(
      selectPlanRing(snapshot([sessionOwned]), null, Number.NaN)?.resetsInMs,
    ).toBeNull();
  });

  it("shows nothing rather than another account when the session's owner has no reading", () => {
    expect(
      selectPlanRing(
        snapshot([unknownOwner, firstKnown], {
          s1: { ownerKey: 'a', modelScope: null },
        }),
        's1',
        NOW,
      ),
    ).toBeNull();
  });

  it('falls back to the first known owner while the session owner is unresolved', () => {
    expect(
      selectPlanRing(
        snapshot([firstKnown], { s1: { ownerKey: null, modelScope: null } }),
        's1',
        NOW,
      )?.percent,
    ).toBe(90);
  });
});
