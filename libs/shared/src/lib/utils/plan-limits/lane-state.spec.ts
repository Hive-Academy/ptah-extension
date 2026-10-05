import type {
  OwnerLimitEvidence,
  PlanLimitOwnerSnapshot,
  PlanLimitWindow,
  QuotaOwnerIdentityKind,
  QuotaOwnerRef,
} from '../../types/plan-limit.types';
import { FRESHNESS_MS, NEAR_LIMIT_PERCENT } from './evidence-precedence';
import {
  applicableLimits,
  applicableOwnerEvidence,
  applicableWindows,
  classifyLaneState,
  groupAlternatives,
  ownerRelation,
  windowModelScope,
  type LaneLimitState,
  type LaneStateContext,
  type OwnerRelation,
} from './lane-state';

const at = (day: number, hour: number, minute = 0): number =>
  Date.UTC(2026, 9, day, hour, minute);
const NOW = at(4, 12);
const MINUTE = 60_000;

const laneCtx = (
  overrides: Partial<LaneStateContext> = {},
): LaneStateContext => ({
  now: NOW,
  nearLimitPercent: NEAR_LIMIT_PERCENT,
  freshnessMs: FRESHNESS_MS,
  ...overrides,
});

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

const weekly = (overrides: Partial<PlanLimitWindow> = {}): PlanLimitWindow =>
  win({
    key: 'weekly',
    kind: 'weekly',
    label: 'Weekly',
    resetsAt: at(9, 7, 30),
    lastResetAt: at(2, 7, 30),
    used: { kind: 'percent', percent: 12 },
    ...overrides,
  });

const opusWeekly = (
  overrides: Partial<PlanLimitWindow> = {},
): PlanLimitWindow =>
  win({
    key: 'weekly_model:opus',
    kind: 'weekly_model',
    label: 'Weekly · Opus',
    modelScope: 'opus',
    resetsAt: at(5, 9),
    lastResetAt: Date.UTC(2026, 8, 28, 9),
    used: { kind: 'percent', percent: 100 },
    exhaustion: {
      observedAt: NOW - 10 * MINUTE,
      source: 'error-derived',
      modelScope: 'opus',
    },
    ...overrides,
  });

const ref = (
  providerId: string,
  identityKind: QuotaOwnerIdentityKind,
  key: string,
): QuotaOwnerRef => ({
  key: `${providerId}#${identityKind}:${key}`,
  providerId,
  identityKind,
  label: 'account',
});

const snapshot = (
  overrides: Partial<PlanLimitOwnerSnapshot> = {},
): PlanLimitOwnerSnapshot => ({
  owner: ref('anthropic', 'account', 'aaaa'),
  status: 'available',
  windowSetEstablished: true,
  windows: [win(), weekly()],
  ownerEvidence: [],
  ...overrides,
});

const ownerHit = (
  overrides: Partial<OwnerLimitEvidence> = {},
): OwnerLimitEvidence => ({
  observedAt: NOW - 5 * MINUTE,
  source: 'error-derived',
  ...overrides,
});

describe('ownerRelation (Decision 3, R7)', () => {
  it.each<
    [
      string,
      QuotaOwnerRef | null | undefined,
      QuotaOwnerRef | null | undefined,
      OwnerRelation,
    ]
  >([
    ['missing left', undefined, ref('p', 'account', 'k'), 'unknown'],
    ['missing right', ref('p', 'account', 'k'), null, 'unknown'],
    [
      'both unknown, equal keys',
      ref('p', 'unknown', 'k'),
      ref('p', 'unknown', 'k'),
      'unknown',
    ],
    [
      'unknown vs account, same provider',
      ref('p', 'unknown', 'k'),
      ref('p', 'account', 'k'),
      'unknown',
    ],
    [
      'unknown vs account, other provider',
      ref('p', 'unknown', 'k'),
      ref('q', 'account', 'k'),
      'unknown',
    ],
    [
      'account, equal keys',
      ref('p', 'account', 'k'),
      ref('p', 'account', 'k'),
      'same',
    ],
    [
      'account, keys differ',
      ref('p', 'account', 'k'),
      ref('p', 'account', 'j'),
      'different',
    ],
    [
      'account, providers differ',
      ref('p', 'account', 'k'),
      ref('q', 'account', 'k'),
      'different',
    ],
    [
      'account vs credential, same provider',
      ref('p', 'account', 'k'),
      ref('p', 'credential', 'k'),
      'unknown',
    ],
    [
      'account vs credential, other provider',
      ref('p', 'account', 'k'),
      ref('q', 'credential', 'k'),
      'different',
    ],
    [
      'credential, equal keys',
      ref('p', 'credential', 'k'),
      ref('p', 'credential', 'k'),
      'same',
    ],
    [
      'cli-store, equal keys',
      ref('p', 'cli-store', 'k'),
      ref('p', 'cli-store', 'k'),
      'same',
    ],
    [
      'cli-store vs credential, same provider',
      ref('p', 'cli-store', 'k'),
      ref('p', 'credential', 'k'),
      'unknown',
    ],
  ])('%s → %s', (_name, a, b, expected) => {
    expect(ownerRelation(a, b)).toBe(expected);
    expect(ownerRelation(b, a)).toBe(expected);
  });

  it('R7: equal raw keys with an unknown kind are never "same"', () => {
    const shared: QuotaOwnerRef = {
      key: 'p#unknown:abc',
      providerId: 'p',
      identityKind: 'unknown',
      label: 'account',
    };
    expect(ownerRelation(shared, { ...shared })).toBe('unknown');
    expect(ownerRelation(shared, { ...shared, identityKind: 'account' })).toBe(
      'unknown',
    );
  });

  it('full truth table over kinds × provider × key is symmetric and follows the rule', () => {
    const kinds: QuotaOwnerIdentityKind[] = [
      'account',
      'credential',
      'cli-store',
      'unknown',
    ];
    for (const kindA of kinds) {
      for (const kindB of kinds) {
        for (const sameProvider of [true, false]) {
          for (const sameKey of [true, false]) {
            const a: QuotaOwnerRef = {
              key: 'K',
              providerId: 'p',
              identityKind: kindA,
              label: 'x',
            };
            const b: QuotaOwnerRef = {
              key: sameKey ? 'K' : 'J',
              providerId: sameProvider ? 'p' : 'q',
              identityKind: kindB,
              label: 'x',
            };
            let expected: OwnerRelation;
            if (kindA === 'unknown' || kindB === 'unknown')
              expected = 'unknown';
            else if (!sameProvider) expected = 'different';
            else if (kindA !== kindB) expected = 'unknown';
            else expected = sameKey ? 'same' : 'different';
            expect(ownerRelation(a, b)).toBe(expected);
            expect(ownerRelation(b, a)).toBe(expected);
          }
        }
      }
    }
  });
});

describe('applicableWindows / applicableOwnerEvidence (Req 4.5)', () => {
  const owner = snapshot({
    windows: [win(), weekly(), opusWeekly()],
    ownerEvidence: [ownerHit({ modelScope: 'opus' }), ownerHit()],
  });

  it('F22: a Sonnet scope never sees the Opus window or Opus-only evidence', () => {
    expect(applicableWindows(owner, 'sonnet').map((w) => w.key)).toEqual([
      'five_hour',
      'weekly',
    ]);
    expect(applicableOwnerEvidence(owner, 'sonnet')).toEqual([ownerHit()]);
  });

  it('an Opus scope sees unscoped windows plus its own (case-insensitive)', () => {
    expect(applicableWindows(owner, 'Opus').map((w) => w.key)).toEqual([
      'five_hour',
      'weekly',
      'weekly_model:opus',
    ]);
    expect(applicableOwnerEvidence(owner, ' OPUS ')).toHaveLength(2);
  });

  it('an unknown scope matches unscoped windows only and records the omission', () => {
    expect(applicableWindows(owner, null).map((w) => w.key)).toEqual([
      'five_hour',
      'weekly',
    ]);
    expect(applicableWindows(owner, '  ').map((w) => w.key)).toEqual([
      'five_hour',
      'weekly',
    ]);
    expect(applicableLimits(owner, null).modelScopeUnresolved).toBe(true);
    expect(applicableLimits(owner, '  ').modelScopeUnresolved).toBe(true);
    expect(applicableLimits(owner, 'opus').modelScopeUnresolved).toBe(false);
  });

  it('scope completeness covers model-scoped evidence and weekly_model keys', () => {
    const evidenceOnly = snapshot({
      ownerEvidence: [ownerHit({ modelScope: 'opus' })],
    });
    expect(applicableLimits(evidenceOnly, undefined).modelScopeUnresolved).toBe(
      true,
    );
    const keyOnly = snapshot({
      windows: [win(), opusWeekly({ modelScope: undefined })],
    });
    expect(applicableLimits(keyOnly, null).modelScopeUnresolved).toBe(true);
    expect(applicableLimits(snapshot(), null).modelScopeUnresolved).toBe(false);
  });

  it('reads the scope from a weekly_model key when none is declared', () => {
    expect(windowModelScope({ key: 'weekly_model:Sonnet' })).toBe('sonnet');
    expect(windowModelScope({ key: 'weekly' })).toBeUndefined();
    const keyOnly = opusWeekly({ modelScope: undefined });
    expect(
      applicableWindows(snapshot({ windows: [keyOnly] }), 'sonnet'),
    ).toEqual([]);
  });
});

describe('classifyLaneState (design §2.2)', () => {
  const classify = (
    owner: PlanLimitOwnerSnapshot,
    scope: string | null,
    overrides: Partial<LaneStateContext> = {},
  ) => classifyLaneState(applicableLimits(owner, scope), laneCtx(overrides));

  it('F22: Opus-only exhaustion puts the Opus lane at limit and leaves Sonnet with room', () => {
    const owner = snapshot({ windows: [win(), weekly(), opusWeekly()] });

    const opus = classify(owner, 'opus');
    expect(opus.state).toBe('at-limit');
    expect(opus.reasons).toEqual([
      expect.objectContaining({
        kind: 'window-limit',
        window: expect.objectContaining({ key: 'weekly_model:opus' }),
      }),
    ]);

    const sonnet = classify(owner, 'sonnet');
    expect(sonnet.state).toBe('confirmed-room');
    expect(sonnet.windows.map((w) => w.window.key)).toEqual([
      'five_hour',
      'weekly',
    ]);
  });

  it('unknown scope + fresh ok unscoped windows + exhausted weekly_model:opus is unknown, never confirmed room', () => {
    const owner = snapshot({ windows: [win(), weekly(), opusWeekly()] });
    for (const scope of [null, '', '  ']) {
      const result = classify(owner, scope);
      expect(result.state).toBe('unknown');
      expect(result.state).not.toBe('confirmed-room');
      expect(result.reasons).toEqual([{ kind: 'model-scope-unknown' }]);
      // The Opus window may not apply, so it is not shown as the lane's limit.
      expect(result.windows.map((w) => w.window.key)).toEqual([
        'five_hour',
        'weekly',
      ]);
    }
  });

  it('unknown scope + model-scoped owner evidence is unknown, never confirmed room', () => {
    const owner = snapshot({
      ownerEvidence: [ownerHit({ modelScope: 'opus' })],
    });
    const result = classify(owner, null);
    expect(result.state).toBe('unknown');
    expect(result.reasons).toEqual([{ kind: 'model-scope-unknown' }]);
  });

  it('unknown scope still reaches at-limit from an unscoped exhaustion', () => {
    const owner = snapshot({
      windows: [win(), weekly(), opusWeekly()],
      ownerEvidence: [ownerHit({ resetsAt: at(4, 17, 5) })],
    });
    expect(classify(owner, null).state).toBe('at-limit');
  });

  it('unknown scope with only unscoped windows still confirms room', () => {
    const result = classify(snapshot(), null);
    expect(result.state).toBe('confirmed-room');
    expect(result.reasons).toEqual([]);
    expect(result.windows.map((w) => w.window.key)).toEqual([
      'five_hour',
      'weekly',
    ]);
  });

  it('owner-level evidence puts the lane at limit with zero windows', () => {
    const owner = snapshot({
      status: 'no-usage-source',
      windowSetEstablished: false,
      windows: [],
      ownerEvidence: [ownerHit({ resetsAt: at(4, 17, 5) })],
    });
    const result = classify(owner, 'sonnet');
    expect(result.state).toBe('at-limit');
    expect(result.reasons).toEqual([
      { kind: 'owner-limit', evidence: owner.ownerEvidence[0] },
    ]);
  });

  it('expired owner evidence no longer counts', () => {
    const owner = snapshot({
      ownerEvidence: [ownerHit({ resetsAt: at(4, 11, 50) })],
    });
    expect(classify(owner, 'sonnet').state).toBe('confirmed-room');
  });

  it('active estimated evidence is never at limit and never room', () => {
    const owner = snapshot({
      ownerEvidence: [ownerHit({ source: 'estimated' })],
    });
    const result = classify(owner, 'sonnet');
    expect(result.state).toBe('unknown');
    expect(result.reasons).toEqual([
      { kind: 'estimated-limit', evidence: owner.ownerEvidence[0] },
    ]);
  });

  it('estimated window exhaustion blocks room', () => {
    const exhaustion = ownerHit({ source: 'estimated' });
    const result = classify(snapshot({ windows: [win({ exhaustion })] }), null);
    expect(result.state).toBe('unknown');
    expect(result.reasons).toEqual([
      expect.objectContaining({ kind: 'estimated-limit' }),
    ]);
  });

  it('stale status with a live limit is still at limit', () => {
    const owner = snapshot({
      status: 'stale',
      windows: [
        weekly({
          exhaustion: { observedAt: NOW - MINUTE, source: 'stream-event' },
          observedAt: NOW - 47 * MINUTE,
        }),
      ],
    });
    expect(classify(owner, null).state).toBe('at-limit');
  });

  it('F45: a fresh 95 % window is near limit', () => {
    const owner = snapshot({
      windows: [win({ used: { kind: 'percent', percent: 95 } }), weekly()],
    });
    const result = classify(owner, null);
    expect(result.state).toBe('near-limit');
    expect(result.reasons).toEqual([
      expect.objectContaining({
        kind: 'window-near-limit',
        window: expect.objectContaining({ key: 'five_hour' }),
      }),
    ]);
  });

  it('a partial event can establish near limit', () => {
    const owner = snapshot({
      windowSetEstablished: false,
      windows: [
        win({
          usedSource: 'stream-event',
          used: { kind: 'percent', percent: 93 },
        }),
      ],
    });
    expect(classify(owner, null).state).toBe('near-limit');
  });

  it('F46: a full fresh set below the threshold is confirmed room, with no reasons', () => {
    const result = classify(snapshot(), 'sonnet');
    expect(result.state).toBe('confirmed-room');
    expect(result.reasons).toEqual([]);
  });

  it('F42: an empty window set is unknown', () => {
    const result = classify(snapshot({ windows: [] }), null);
    expect(result.state).toBe('unknown');
    expect(result.reasons).toEqual([{ kind: 'no-windows' }]);
  });

  it('F43: a single partial event below the threshold is unknown', () => {
    const owner = snapshot({
      windowSetEstablished: false,
      windows: [win({ usedSource: 'stream-event' })],
    });
    const result = classify(owner, null);
    expect(result.state).toBe('unknown');
    expect(result.reasons).toEqual([{ kind: 'window-set-not-established' }]);
  });

  it('F44: an aged snapshot observed after the last reset is unknown', () => {
    const owner = snapshot({
      windows: [win({ observedAt: NOW - 22 * MINUTE }), weekly()],
    });
    const result = classify(owner, null);
    expect(result.state).toBe('unknown');
    expect(result.reasons).toEqual([
      expect.objectContaining({ kind: 'window-state', state: 'aged' }),
    ]);
  });

  it('F3/F4: unknown usage and a passed reset each keep the lane unknown', () => {
    const owner = snapshot({
      windows: [
        win({ used: undefined }),
        weekly({ resetsAt: at(4, 11, 20), observedAt: at(4, 10, 52) }),
      ],
    });
    const result = classify(owner, null);
    expect(result.state).toBe('unknown');
    expect(result.reasons).toEqual([
      expect.objectContaining({ kind: 'window-state', state: 'usage-unknown' }),
      expect.objectContaining({
        kind: 'window-state',
        state: 'reset-usage-unknown',
      }),
    ]);
  });

  it('an active cooldown blocks room; an expired one does not', () => {
    const active = snapshot({
      cooldown: { until: NOW + 10 * MINUTE, observedAt: NOW - MINUTE },
    });
    expect(classify(active, null).reasons).toEqual([
      { kind: 'cooldown-active', cooldown: active.cooldown },
    ]);
    const expired = snapshot({
      cooldown: { until: NOW, observedAt: NOW - 20 * MINUTE },
    });
    expect(classify(expired, null).state).toBe('confirmed-room');
  });

  it('stale, no-usage-source and failure statuses each give a stated reason', () => {
    expect(classify(snapshot({ status: 'stale' }), null).reasons[0]).toEqual({
      kind: 'stale',
    });
    expect(
      classify(snapshot({ status: 'no-usage-source', windows: [] }), null)
        .reasons,
    ).toEqual([{ kind: 'no-usage-source' }, { kind: 'no-windows' }]);
    expect(
      classify(snapshot({ status: 'service-unavailable' }), null).reasons,
    ).toEqual([{ kind: 'status', status: 'service-unavailable' }]);
  });

  it('a timed-out lookup is unknown even when a cached snapshot looks healthy', () => {
    const result = classify(snapshot(), null, { lookupFailure: 'timed-out' });
    expect(result.state).toBe('unknown');
    expect(result.reasons).toEqual([
      { kind: 'lookup-failed', failure: 'timed-out' },
    ]);
  });

  it('no snapshot for the lane’s own owner is unknown and borrows nothing', () => {
    expect(classifyLaneState(undefined, laneCtx())).toEqual({
      state: 'unknown',
      reasons: [{ kind: 'no-snapshot' }],
      windows: [],
    });
    expect(
      classifyLaneState(undefined, laneCtx({ lookupFailure: 'failed' }))
        .reasons,
    ).toEqual([{ kind: 'lookup-failed', failure: 'failed' }]);
  });

  it('not-confirmed windows keep the lane unknown', () => {
    const owner = snapshot({ windows: [win({ lastResetAt: undefined })] });
    expect(classify(owner, null).reasons).toEqual([
      expect.objectContaining({ kind: 'window-state', state: 'not-confirmed' }),
    ]);
  });
});

describe('groupAlternatives', () => {
  it('splits rows into the four groups and keeps input order', () => {
    const rows: Array<{ id: string; state: LaneLimitState }> = [
      { id: 'a', state: 'unknown' },
      { id: 'b', state: 'confirmed-room' },
      { id: 'c', state: 'at-limit' },
      { id: 'd', state: 'near-limit' },
      { id: 'e', state: 'confirmed-room' },
      { id: 'f', state: 'unknown' },
    ];
    const groups = groupAlternatives(rows);
    expect(groups.confirmedRoom.map((r) => r.id)).toEqual(['b', 'e']);
    expect(groups.nearLimit.map((r) => r.id)).toEqual(['d']);
    expect(groups.unknown.map((r) => r.id)).toEqual(['a', 'f']);
    expect(groups.atLimit.map((r) => r.id)).toEqual(['c']);
  });

  it('returns four empty groups for an empty roster', () => {
    expect(groupAlternatives([])).toEqual({
      confirmedRoom: [],
      nearLimit: [],
      unknown: [],
      atLimit: [],
    });
  });
});
