import {
  applicableLimits,
  classifyLaneState,
  FRESHNESS_MS,
  NEAR_LIMIT_PERCENT,
  type CliDetectionResult,
  type LaneLookupFailure,
  type OwnerLimitEvidence,
  type PlanLimitOwnerSnapshot,
  type PlanLimitWindow,
} from '@ptah-extension/shared';
import {
  findAgentLimit,
  formatAlternatives,
  formatLimitColumn,
  formatPlanLimitsSection,
  formatSpawnLimitBlock,
  spawnRequestTarget,
  targetRowKey,
  type AgentLimit,
} from './agent-limit.formatter';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** 2026-10-03 12:00 UTC, the design §5 sample clock. */
const NOW = Date.UTC(2026, 9, 3, 12, 0);

const FIVE_HOUR_NEAR: PlanLimitWindow = {
  key: 'five_hour',
  kind: 'five_hour',
  label: '5-hour session',
  used: { kind: 'percent', percent: 94 },
  usedSource: 'provider-api',
  resetsAt: NOW + 3 * HOUR + 10 * MIN,
  resetSource: 'provider-api',
  lastResetAt: NOW - HOUR - 50 * MIN,
  observedAt: NOW - MIN,
};

const WEEKLY_OPUS_EXHAUSTED: PlanLimitWindow = {
  key: 'weekly_model:opus',
  kind: 'weekly_model',
  label: 'Weekly · Opus',
  modelScope: 'opus',
  used: { kind: 'percent', percent: 100 },
  usedSource: 'provider-api',
  resetsAt: NOW + DAY + 21 * HOUR,
  resetSource: 'provider-api',
  lastResetAt: NOW - 5 * DAY,
  exhaustion: { observedAt: NOW - 5 * MIN, source: 'error-derived' },
  observedAt: NOW - MIN,
};

const FIVE_HOUR_ROOM: PlanLimitWindow = {
  key: 'five_hour',
  kind: 'five_hour',
  label: '5-hour session',
  used: { kind: 'percent', percent: 38 },
  usedSource: 'provider-api',
  resetsAt: NOW + 4 * HOUR + 40 * MIN,
  resetSource: 'provider-api',
  lastResetAt: NOW - 20 * MIN,
  observedAt: NOW - MIN,
};

const WEEKLY_ROOM: PlanLimitWindow = {
  key: 'weekly',
  kind: 'weekly',
  label: 'Weekly',
  used: { kind: 'percent', percent: 12 },
  usedSource: 'provider-api',
  resetsAt: NOW + 5 * DAY + 19 * HOUR + 30 * MIN,
  resetSource: 'provider-api',
  lastResetAt: NOW - DAY,
  observedAt: NOW - MIN,
};

/** Fresh unofficial value, last reset unknown: "not confirmed". */
const FIVE_HOUR_NOT_CONFIRMED: PlanLimitWindow = {
  key: 'five_hour',
  kind: 'five_hour',
  label: '5-hour session',
  used: { kind: 'percent', percent: 57 },
  usedSource: 'provider-unofficial',
  resetsAt: NOW + 5 * HOUR,
  resetSource: 'estimated',
  observedAt: NOW - MIN,
};

const WEEKLY_USAGE_UNKNOWN: PlanLimitWindow = {
  key: 'weekly',
  kind: 'weekly',
  label: 'Weekly',
  observedAt: NOW - MIN,
};

const FIVE_HOUR_ESTIMATE: PlanLimitWindow = {
  key: 'five_hour',
  kind: 'five_hour',
  label: '5-hour session',
  used: { kind: 'percent', percent: 80 },
  usedSource: 'estimated',
  resetsAt: NOW + 2 * HOUR,
  resetSource: 'estimated',
  lastResetAt: NOW - 3 * HOUR,
  observedAt: NOW - MIN,
};

function snapshot(
  overrides: Partial<PlanLimitOwnerSnapshot> = {},
): PlanLimitOwnerSnapshot {
  return {
    owner: {
      key: 'provider#account:fingerprint',
      providerId: 'provider',
      identityKind: 'account',
      label: 'Account',
    },
    status: 'available',
    windowSetEstablished: true,
    windows: [],
    ownerEvidence: [],
    ...overrides,
  };
}

function cliRow(cli: CliDetectionResult['cli']): CliDetectionResult {
  return { cli, installed: true, messagingMode: 'steer' };
}

function ptahCliRow(id: string, name: string): CliDetectionResult {
  return {
    cli: 'ptah-cli',
    installed: true,
    messagingMode: 'queue',
    ptahCliId: id,
    ptahCliName: name,
  };
}

/** A lane result exactly as `LaneLimitLookupService` builds it. */
function lane(
  row: CliDetectionResult,
  owner: PlanLimitOwnerSnapshot | undefined,
  options: { modelScope?: string; lookupFailure?: LaneLookupFailure } = {},
): AgentLimit {
  const state = classifyLaneState(
    owner && applicableLimits(owner, options.modelScope ?? null),
    {
      now: NOW,
      nearLimitPercent: NEAR_LIMIT_PERCENT,
      freshnessMs: FRESHNESS_MS,
      lookupFailure: options.lookupFailure,
    },
  );
  const lookup =
    options.lookupFailure === 'timed-out'
      ? 'timeout'
      : options.lookupFailure === 'failed'
        ? 'failed'
        : 'ok';
  return owner
    ? { row, lookup, owner: owner.owner, snapshot: owner, state }
    : { row, lookup, state };
}

const OWNER_HIT: OwnerLimitEvidence = {
  observedAt: NOW - 20 * MIN,
  source: 'error-derived',
};

// The design §5.1 sample roster (rows named by the formatter's own rule).
const nearLane = lane(
  cliRow('copilot'),
  snapshot({ windows: [FIVE_HOUR_NEAR] }),
);
const atLimitLane = lane(
  cliRow('copilot'),
  snapshot({ windows: [FIVE_HOUR_NEAR, WEEKLY_OPUS_EXHAUSTED] }),
  { modelScope: 'opus' },
);
const roomLane = lane(
  cliRow('codex'),
  snapshot({ windows: [FIVE_HOUR_ROOM, WEEKLY_ROOM] }),
);
const notConfirmedLane = lane(
  cliRow('antigravity'),
  snapshot({ windows: [FIVE_HOUR_NOT_CONFIRMED, WEEKLY_USAGE_UNKNOWN] }),
);
const ownerLevelLane = lane(
  cliRow('opencode'),
  snapshot({ status: 'no-usage-source', ownerEvidence: [OWNER_HIT] }),
);
const timedOutLane = lane(ptahCliRow('glm-1', 'Glm'), undefined, {
  lookupFailure: 'timed-out',
});
const ROSTER = [
  atLimitLane,
  roomLane,
  notConfirmedLane,
  ownerLevelLane,
  timedOutLane,
];

describe('agent limit formatter (TASK_2026_596 Batch 14)', () => {
  it('F42 snapshots the near-limit list state verbatim', () => {
    expect(formatLimitColumn(nearLane, NOW)).toBe(
      'near limit (5-hour session 94%)',
    );
  });

  it('F43 snapshots the exhausted window state verbatim', () => {
    expect(atLimitLane.state.state).toBe('at-limit');
    expect(formatLimitColumn(atLimitLane, NOW)).toBe(
      'AT LIMIT (Weekly · Opus, resets 2026-10-05 09:00 UTC)',
    );
  });

  it('F44 uses a stable cli plus ptahCliId row key for two lanes', () => {
    const first = lane(ptahCliRow('one', 'One'), undefined, {
      lookupFailure: 'failed',
    });
    const second = lane(ptahCliRow('two', 'Two'), undefined, {
      lookupFailure: 'failed',
    });
    expect(
      findAgentLimit([first, second], { cli: 'ptah-cli', ptahCliId: 'two' }),
    ).toBe(second);
    expect(targetRowKey(second.row)).toBe('ptah-cli:two');
  });

  it('F44 resolves a spawn request to the lane agent.spawn runs', () => {
    expect(spawnRequestTarget({ ptahCliId: 'glm-1' })).toEqual({
      cli: 'ptah-cli',
      ptahCliId: 'glm-1',
    });
    expect(spawnRequestTarget({ cli: 'codex', ptahCliId: 'glm-1' })).toEqual({
      cli: 'ptah-cli',
      ptahCliId: 'glm-1',
    });
    expect(spawnRequestTarget({ cli: 'codex' })).toEqual({ cli: 'codex' });
    expect(spawnRequestTarget({})).toBeUndefined();
  });

  it('F45 snapshots lookup timeout as unknown, never zero', () => {
    expect(formatLimitColumn(timedOutLane, NOW)).toBe(
      'unknown (limit lookup timed out)',
    );
  });

  it('F46 snapshots owner-level exhaustion with the §5.1 list wording', () => {
    expect(formatLimitColumn(ownerLevelLane, NOW)).toBe(
      'AT LIMIT (window unknown, reset unknown) [error-derived] · no usage source',
    );
  });

  it('F46 renders a not-confirmed lane with its window reason', () => {
    expect(formatLimitColumn(notConfirmedLane, NOW)).toBe(
      'unknown (5-hour session: last reset unknown)',
    );
  });

  it('uses the §2.2 reason labels for aged and partial window sets', () => {
    const aged = lane(
      cliRow('codex'),
      snapshot({ status: 'stale', windows: [FIVE_HOUR_ROOM] }),
    );
    expect(formatLimitColumn(aged, NOW)).toBe('unknown (aged value)');
    const partial = lane(
      cliRow('copilot'),
      snapshot({ windowSetEstablished: false, windows: [FIVE_HOUR_ROOM] }),
    );
    expect(formatLimitColumn(partial, NOW)).toBe(
      'unknown (window set not established, partial data)',
    );
  });

  it('prints the §5.1 Plan limits rows verbatim', () => {
    const section = formatPlanLimitsSection(ROSTER, NOW);
    expect(section).toContain(
      '### Plan limits\n\n| Agent | Window | Used | State | Reset | Source |\n| --- | --- | --- | --- | --- | --- |',
    );
    expect(section).toContain(
      '| copilot | 5-hour session | 94% | near limit | resets 2026-10-03 15:10 UTC (in 3h 10m) | provider-api |',
    );
    expect(section).toContain(
      '| copilot | Weekly · Opus | 100% | LIMIT REACHED | resets 2026-10-05 09:00 UTC (in 1d 21h) | used+reset provider-api; limit error-derived |',
    );
    expect(section).toContain(
      '| antigravity | 5-hour session | 57% | not confirmed (last reset unknown) | resets 2026-10-03 17:00 UTC (in 5h 0m) | used provider-unofficial; reset estimated |',
    );
    expect(section).toContain(
      '| antigravity | Weekly | unknown | unknown | reset unknown | - |',
    );
    expect(section).toContain(
      '| opencode | (none) | no usage source | AT LIMIT (owner level, window unknown) | reset unknown | error-derived |',
    );
    expect(section).toContain(
      '| Glm | (none) | unknown | limit lookup timed out | - | - |',
    );
  });

  it('prints the §5.1 alternatives lines verbatim', () => {
    const text = formatAlternatives(ROSTER, { now: NOW });
    expect(text).toContain(
      '**Confirmed room:**\n- codex: 5-hour session 38%, resets 2026-10-03 16:40 UTC (in 4h 40m) [provider-api]; Weekly 12%, resets 2026-10-09 07:30 UTC (in 5d 19h) [provider-api]',
    );
    expect(text).toContain('**Near limit:** none');
    expect(text).toContain(
      '- antigravity: not confirmed: 5-hour session: last reset unknown. 5-hour session 57% (not confirmed, last reset unknown), resets 2026-10-03 17:00 UTC (in 5h 0m) [used provider-unofficial; reset estimated]; Weekly used unknown, reset unknown',
    );
    expect(text).toContain('- Glm: limit lookup timed out; no windows known');
    expect(text).toContain(
      '- copilot: 5-hour session 94% (near limit), resets 2026-10-03 15:10 UTC (in 3h 10m) [provider-api]; Weekly · Opus 100% (LIMIT REACHED), resets 2026-10-05 09:00 UTC (in 1d 21h) [used+reset provider-api; limit error-derived]',
    );
    expect(text).toContain(
      '- opencode: at limit, window unknown, reset unknown [error-derived] · no usage source',
    );
  });

  it('F47 keeps the alternatives heading adjacent to its sentence', () => {
    expect(
      formatAlternatives([nearLane], {
        targetRowKey: 'ptah-cli:other',
        now: NOW,
      }),
    ).toContain(
      '### Alternatives by limit state\nNo other lane has confirmed room.',
    );
  });

  it('prints the every-lane-at-limit and single-lane sentences', () => {
    expect(
      formatAlternatives([atLimitLane, ownerLevelLane], { now: NOW }),
    ).toContain(
      'No lane has room: every lane is at its limit. Known resets are listed below.',
    );
    expect(
      formatAlternatives([nearLane], { targetRowKey: 'copilot:', now: NOW }),
    ).toBe(
      [
        '### Alternatives by limit state\nNo other lanes are available to list. This does not mean any lane is at its limit.',
        '**Confirmed room:** none',
        '**Near limit:** none',
        '**Unknown:** none',
        '**At limit:** none',
      ].join('\n\n'),
    );
  });

  it('F48 snapshots a warning with its window, reset and source', () => {
    const block = formatSpawnLimitBlock(
      [nearLane],
      { cli: 'copilot' },
      false,
      NOW,
    );
    expect(block).toContain('**Limit state:** near limit (5-hour session 94%)');
    expect(block).toContain(
      '> WARNING: 5-hour session is 94% used; resets 2026-10-03 15:10 UTC (in 3h 10m) [provider-api]. The spawn was still started.',
    );
  });

  it('F48 names the owner-level hit in the warning of a failed spawn', () => {
    const block = formatSpawnLimitBlock(
      [ownerLevelLane],
      { cli: 'opencode' },
      true,
      NOW,
    );
    expect(block).toContain(
      '> WARNING: opencode hit a usage limit at 2026-10-03 11:40 UTC [error-derived]. Window unknown, reset unknown. The spawn was still attempted.',
    );
  });

  it('F49 shows an estimated limit as a note even when it is not the first reason', () => {
    const estimatedHit: OwnerLimitEvidence = {
      observedAt: NOW - 10 * MIN,
      source: 'estimated',
      resetsAt: NOW + HOUR,
    };
    const estimated = lane(
      cliRow('copilot'),
      snapshot({
        windowSetEstablished: false,
        windows: [FIVE_HOUR_ROOM],
        ownerEvidence: [estimatedHit],
      }),
    );
    const kinds = estimated.state.reasons.map((reason) => reason.kind);
    expect(kinds[0]).toBe('window-set-not-established');
    expect(kinds).toContain('estimated-limit');

    const output = formatSpawnLimitBlock(
      [estimated],
      { cli: 'copilot' },
      false,
      NOW,
    );
    expect(output).toContain(
      '> Note (estimate, not a warning): estimated limit reached, resets 2026-10-03 13:00 UTC (in 1h 0m) [estimated]; no provider confirmation.',
    );
    expect(output).not.toContain('WARNING');
  });

  it('F49 shows an estimate-only window as a note, never a warning', () => {
    const estimated = lane(
      cliRow('codex'),
      snapshot({ windows: [FIVE_HOUR_ESTIMATE] }),
    );
    const output = formatSpawnLimitBlock(
      [estimated],
      { cli: 'codex' },
      false,
      NOW,
    );
    expect(output).toContain(
      '> Note (estimate, not a warning): 5-hour session estimated at 80% used [estimated]; no provider confirmation.',
    );
    expect(output).not.toContain('WARNING');
  });

  it('F50 keeps an unmatched spawn target as unknown', () => {
    expect(
      formatSpawnLimitBlock(
        [roomLane],
        { cli: 'ptah-cli', ptahCliId: 'missing' },
        true,
        NOW,
      ),
    ).toContain('**Limit state:** unknown (limit lookup failed)');
  });

  it('F51 labels cooldown as retry delay rather than a plan reset', () => {
    const cooling = lane(
      cliRow('codex'),
      snapshot({
        windows: [FIVE_HOUR_ROOM],
        cooldown: { until: NOW + MIN, observedAt: NOW - MIN },
      }),
    );
    const block = formatSpawnLimitBlock(
      [cooling],
      { cli: 'codex' },
      false,
      NOW,
    );
    expect(block).toContain(
      '**Limit state:** unknown (cooldown active until 2026-10-03 12:01 UTC)',
    );
    expect(block).toContain(
      '**Cooldown:** retrying after 2026-10-03 12:01 UTC (in 1m). This is a retry delay, not a plan reset.',
    );
  });

  it('F51 omits an expired cooldown', () => {
    const expired = lane(
      cliRow('codex'),
      snapshot({
        windows: [FIVE_HOUR_ROOM],
        cooldown: { until: NOW - MIN, observedAt: NOW - 2 * MIN },
      }),
    );
    expect(
      formatSpawnLimitBlock([expired], { cli: 'codex' }, false, NOW),
    ).not.toContain('**Cooldown:**');
  });
});
