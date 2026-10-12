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
  effectiveLaneState,
  formatAlternatives,
  formatLimitColumn,
  laneBlock,
  type AgentLimit,
} from './agent-limit.formatter';
import {
  formatSpawnRefusal,
  rowsWithSpawnModel,
  spawnGateVerdict,
  type SpawnGateVerdict,
} from './agent-spawn-limit-gate';

const MIN = 60_000;
const HOUR = 60 * MIN;
/** 2026-10-03 12:00 UTC. */
const NOW = Date.UTC(2026, 9, 3, 12, 0);

function window(
  percent: number,
  overrides: Partial<PlanLimitWindow> = {},
): PlanLimitWindow {
  return {
    key: 'five_hour',
    kind: 'five_hour',
    label: '5-hour session',
    used: { kind: 'percent', percent },
    usedSource: 'provider-api',
    resetsAt: NOW + 2 * HOUR,
    resetSource: 'provider-api',
    lastResetAt: NOW - 3 * HOUR,
    observedAt: NOW - MIN,
    ...overrides,
  };
}

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

function cliRow(
  cli: CliDetectionResult['cli'],
  overrides: Partial<CliDetectionResult> = {},
): CliDetectionResult {
  return { cli, installed: true, messagingMode: 'steer', ...overrides };
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
  options: {
    lookup?: AgentLimit['lookup'];
    lookupFailure?: LaneLookupFailure;
  } = {},
): AgentLimit {
  const state = classifyLaneState(owner && applicableLimits(owner, null), {
    now: NOW,
    nearLimitPercent: NEAR_LIMIT_PERCENT,
    freshnessMs: FRESHNESS_MS,
    lookupFailure: options.lookupFailure,
  });
  const lookup = options.lookup ?? 'ok';
  return owner
    ? { row, lookup, owner: owner.owner, snapshot: owner, state }
    : { row, lookup, state };
}

const EXHAUSTED = lane(
  cliRow('codex'),
  snapshot({
    windows: [
      window(100, {
        exhaustion: { observedAt: NOW - 5 * MIN, source: 'error-derived' },
      }),
    ],
  }),
);
const OWNER_HIT: OwnerLimitEvidence = {
  observedAt: NOW - 10 * MIN,
  source: 'error-derived',
};
const OWNER_LEVEL = lane(
  cliRow('opencode'),
  snapshot({ status: 'no-usage-source', ownerEvidence: [OWNER_HIT] }),
);
const COOLING = lane(
  cliRow('codex'),
  snapshot({
    windows: [window(40)],
    cooldown: { until: NOW + 15 * MIN, observedAt: NOW - MIN },
  }),
);
const FULL = lane(cliRow('antigravity'), snapshot({ windows: [window(100)] }));
const ROOM = lane(cliRow('copilot'), snapshot({ windows: [window(20)] }));

function blocked(
  verdict: SpawnGateVerdict,
): Extract<SpawnGateVerdict, { kind: 'blocked' }> {
  if (verdict.kind !== 'blocked') {
    throw new Error(`expected a blocked verdict, got ${verdict.kind}`);
  }
  return verdict;
}

describe('laneBlock', () => {
  it('blocks an exhausted window and carries its reset', () => {
    expect(laneBlock(EXHAUSTED, NOW)).toEqual({
      kind: 'window',
      resetsAt: NOW + 2 * HOUR,
      detail: '5-hour session limit reached',
    });
  });

  it('blocks owner-level evidence without a reset as reset unknown', () => {
    expect(laneBlock(OWNER_LEVEL, NOW)).toEqual({
      kind: 'owner',
      resetsAt: undefined,
      detail: 'usage limit hit, window unknown',
    });
  });

  it('blocks an active cooldown until the cooldown ends', () => {
    expect(laneBlock(COOLING, NOW)).toEqual({
      kind: 'cooldown',
      resetsAt: NOW + 15 * MIN,
      detail: 'cooldown active',
    });
  });

  it('does not block on an expired cooldown', () => {
    const expired = lane(
      cliRow('codex'),
      snapshot({
        windows: [window(40)],
        cooldown: { until: NOW - MIN, observedAt: NOW - 2 * MIN },
      }),
    );
    expect(laneBlock(expired, NOW)).toBeUndefined();
  });

  it('does not block a malformed row without a snapshot', () => {
    const malformed: AgentLimit = {
      row: EXHAUSTED.row,
      lookup: EXHAUSTED.lookup,
      state: EXHAUSTED.state,
    };
    expect(laneBlock(malformed, NOW)).toBeUndefined();
  });

  it('blocks a fresh 100 % window the engine files as near limit', () => {
    expect(FULL.state.state).toBe('near-limit');
    expect(laneBlock(FULL, NOW)).toEqual({
      kind: 'full-window',
      resetsAt: NOW + 2 * HOUR,
      detail: '5-hour session 100%',
    });
  });

  it('does not block a 99 % window', () => {
    const almost = lane(cliRow('antigravity'), snapshot({ windows: [window(99)] }));
    expect(laneBlock(almost, NOW)).toBeUndefined();
    expect(effectiveLaneState(almost, NOW)).toBe('near-limit');
  });

  it('does not block a 100 % window whose reset has passed', () => {
    const passed = lane(
      cliRow('antigravity'),
      snapshot({ windows: [window(100, { resetsAt: NOW - MIN })] }),
    );
    expect(laneBlock(passed, NOW)).toBeUndefined();
  });

  it('reads every blocked lane as at limit', () => {
    for (const limit of [EXHAUSTED, OWNER_LEVEL, COOLING, FULL]) {
      expect(effectiveLaneState(limit, NOW)).toBe('at-limit');
    }
    expect(effectiveLaneState(ROOM, NOW)).toBe('confirmed-room');
  });
});

describe('spawnGateVerdict', () => {
  const LIMITS = [EXHAUSTED, ROOM, FULL];

  it('blocks the named at-limit lane', () => {
    const verdict = blocked(spawnGateVerdict(LIMITS, { cli: 'codex' }, NOW));
    expect(verdict.limit).toBe(EXHAUSTED);
    expect(verdict.block.kind).toBe('window');
  });

  it('clears a lane with room', () => {
    expect(spawnGateVerdict(LIMITS, { cli: 'copilot' }, NOW)).toEqual({
      kind: 'clear',
    });
  });

  it('clears an auto-detected spawn', () => {
    expect(spawnGateVerdict(LIMITS, undefined, NOW)).toEqual({
      kind: 'clear',
    });
  });

  it('clears a lane with no row, so the spawn error stays the answer', () => {
    expect(spawnGateVerdict(LIMITS, { cli: 'cursor' }, NOW)).toEqual({
      kind: 'clear',
    });
  });

  it('clears an uninstalled or disabled lane', () => {
    const uninstalled = { ...EXHAUSTED, row: cliRow('codex', { installed: false }) };
    const disabled = { ...EXHAUSTED, row: cliRow('codex', { disabled: true }) };
    expect(spawnGateVerdict([uninstalled], { cli: 'codex' }, NOW).kind).toBe(
      'clear',
    );
    expect(spawnGateVerdict([disabled], { cli: 'codex' }, NOW).kind).toBe(
      'clear',
    );
  });

  it('resolves ptahCliId over cli', () => {
    const glm = lane(
      ptahCliRow('glm-1', 'Glm'),
      snapshot({ ownerEvidence: [OWNER_HIT] }),
    );
    const verdict = spawnGateVerdict(
      [EXHAUSTED, glm],
      { cli: 'ptah-cli', ptahCliId: 'glm-1' },
      NOW,
    );
    expect(blocked(verdict).limit).toBe(glm);
  });

  it('answers unknown with its cause when nothing blocks', () => {
    const untracked = lane(cliRow('cursor'), undefined, { lookup: 'no-owner' });
    expect(spawnGateVerdict([untracked], { cli: 'cursor' }, NOW)).toEqual({
      kind: 'unknown',
      reason: 'limits not tracked',
    });
    const timedOut = lane(cliRow('codex'), undefined, {
      lookup: 'timeout',
      lookupFailure: 'timed-out',
    });
    expect(spawnGateVerdict([timedOut], { cli: 'codex' }, NOW)).toEqual({
      kind: 'unknown',
      reason: 'limit lookup timed out',
    });
  });
});

describe('formatSpawnRefusal', () => {
  it('names the lane, the reset and the alternatives', () => {
    const limits = [EXHAUSTED, ROOM];
    const verdict = blocked(spawnGateVerdict(limits, { cli: 'codex' }, NOW));
    expect(formatSpawnRefusal(limits, verdict, NOW)).toBe(
      'agent_spawn refused: codex is at its plan limit (5-hour session limit reached). ' +
        'Free again 2026-10-03 14:00 UTC (in 2h 0m). Nothing was spawned. ' +
        'Pass "force": true to spawn anyway, or pick a lane with room below.\n\n' +
        formatAlternatives(limits, { targetRowKey: 'codex:', now: NOW }),
    );
  });

  it('says the reset time is unknown when a hit has none', () => {
    const verdict = blocked(
      spawnGateVerdict([OWNER_LEVEL], { cli: 'opencode' }, NOW),
    );
    expect(formatSpawnRefusal([OWNER_LEVEL], verdict, NOW)).toContain(
      '(usage limit hit, window unknown). Reset time unknown. Nothing was spawned.',
    );
  });
});

describe('limit column for gate-only blocks', () => {
  it('shows an active cooldown as at limit with its retry time', () => {
    expect(formatLimitColumn(COOLING, NOW)).toBe(
      'AT LIMIT (cooldown, retry after 2026-10-03 12:15 UTC)',
    );
  });

  it('shows a fresh 100 % window as at limit with its reset', () => {
    expect(formatLimitColumn(FULL, NOW)).toBe(
      'AT LIMIT (5-hour session 100%, resets 2026-10-03 14:00 UTC)',
    );
  });

  it('groups gate-blocked lanes under At limit', () => {
    const text = formatAlternatives([COOLING, FULL, ROOM], { now: NOW });
    const atLimit = text.slice(text.indexOf('**At limit:**'));
    expect(atLimit).toContain('- codex:');
    expect(atLimit).toContain('- antigravity:');
    expect(atLimit).not.toContain('- copilot:');
  });
});

describe('rowsWithSpawnModel', () => {
  it('sets the model on the target row only', () => {
    const rows = [cliRow('opencode'), cliRow('codex')];
    expect(
      rowsWithSpawnModel(rows, { cli: 'opencode' }, 'opencode-go/model'),
    ).toEqual([{ ...rows[0], model: 'opencode-go/model' }, rows[1]]);
  });

  it('returns the rows unchanged without a model', () => {
    const rows = [cliRow('opencode')];
    expect(rowsWithSpawnModel(rows, { cli: 'opencode' }, undefined)).toBe(rows);
  });
});
