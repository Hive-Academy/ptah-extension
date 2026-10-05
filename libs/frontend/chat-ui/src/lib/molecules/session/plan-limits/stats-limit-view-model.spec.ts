import type {
  OwnerLimitEvidence,
  PlanLimitOwnerSnapshot,
  PlanLimitWindow,
  QuotaOwnerIdentityKind,
  QuotaOwnerRef,
} from '@ptah-extension/shared';
import { buildStatsLimitViewModel } from './stats-limit-view-model';
import type {
  LaneSubgroupModel,
  StatsLimitLaneRun,
  StatsLimitViewModelInput,
} from './stats-limit-view-model.types';

// Monday 5 Oct 2026 12:00 UTC. Times render in UTC with an explicit
// zone-name locale, so the text is the same on every machine.
const NOW = Date.UTC(2026, 9, 5, 12, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const UTC = { timeZone: 'UTC', zoneNameLocale: 'en-GB' } as const;

function owner(
  providerId: string,
  identityKind: QuotaOwnerIdentityKind,
  fingerprint: string,
  label: string,
): QuotaOwnerRef {
  return {
    key: `${providerId}#${identityKind}:${fingerprint}`,
    providerId,
    identityKind,
    label,
  };
}

// 16-hex fingerprints, so the display labels carry their key suffix
// ("Claude account · aaaa") the way real hashed keys do.
const CLAUDE_A = owner('claude-cli', 'account', 'aaaaaaaaaaaaaaaa', 'Claude account');
const CLAUDE_B = owner('claude-cli', 'account', 'bbbbbbbbbbbbbbbb', 'Claude account');
const CODEX = owner('openai-codex', 'cli-store', 'cccccccccccccccc', 'Codex account');
const ANTHROPIC_KEY = owner(
  'anthropic',
  'credential',
  'kkk',
  'Anthropic API key',
);
const PROXY = owner('unknown', 'unknown', 'ppp', 'Unknown owner');

function planWindow(overrides: Partial<PlanLimitWindow> = {}): PlanLimitWindow {
  return {
    key: 'five_hour',
    kind: 'five_hour',
    label: '5-hour',
    used: { kind: 'percent', percent: 40 },
    usedSource: 'provider-api',
    resetsAt: NOW + 3 * HOUR + 10 * MIN,
    resetSource: 'provider-api',
    lastResetAt: NOW - 2 * HOUR,
    observedAt: NOW - MIN,
    ...overrides,
  };
}

const weekly = (overrides: Partial<PlanLimitWindow> = {}) =>
  planWindow({
    key: 'weekly',
    kind: 'weekly',
    label: 'Weekly',
    resetsAt: NOW + 3 * DAY,
    lastResetAt: NOW - 4 * DAY,
    ...overrides,
  });

/** Opus-only exhaustion read from an error. */
const weeklyOpusExhausted = () =>
  planWindow({
    key: 'weekly_model:opus',
    kind: 'weekly_model',
    label: 'Weekly · Opus',
    modelScope: 'opus',
    used: { kind: 'percent', percent: 100 },
    resetsAt: NOW + 2 * DAY,
    lastResetAt: NOW - 5 * DAY,
    exhaustion: {
      observedAt: NOW - 10 * MIN,
      source: 'error-derived',
      resetsAt: NOW + 2 * DAY,
    },
  });

function snapshot(
  ref: QuotaOwnerRef,
  overrides: Partial<PlanLimitOwnerSnapshot> = {},
): PlanLimitOwnerSnapshot {
  return {
    owner: ref,
    status: 'available',
    windowSetEstablished: true,
    windows: [planWindow(), weekly()],
    ownerEvidence: [],
    ...overrides,
  };
}

let runSeq = 0;
function run(overrides: Partial<StatsLimitLaneRun> = {}): StatsLimitLaneRun {
  runSeq += 1;
  return {
    runId: `run-${runSeq}`,
    cli: 'ptah-cli',
    cliLabel: 'Claude',
    role: 'docs',
    model: 'sonnet',
    modelScope: 'sonnet',
    status: 'completed',
    restored: false,
    startedAt: NOW - HOUR,
    quotaOwner: CLAUDE_A,
    usageTotals: { inputTokens: 1000, outputTokens: 500, costUsd: 0.1 },
    ...overrides,
  };
}

function input(
  overrides: Partial<StatsLimitViewModelInput> = {},
): StatsLimitViewModelInput {
  return {
    sessionId: 'session-1',
    sessionOwnerKey: CLAUDE_A.key,
    sessionModelScope: 'sonnet',
    owners: [snapshot(CLAUDE_A)],
    laneRuns: [],
    now: NOW,
    time: UTC,
    ...overrides,
  };
}

function onlySubgroup(vm: ReturnType<typeof buildStatsLimitViewModel>) {
  expect(vm.laneTiles).toHaveLength(1);
  expect(vm.laneTiles[0].subgroups).toHaveLength(1);
  return vm.laneTiles[0].subgroups[0];
}

function noteTexts(group: LaneSubgroupModel): string[] {
  return group.notes.map((note) => note.text);
}

describe('buildStatsLimitViewModel', () => {
  describe('F53 owner identity (A1)', () => {
    it('same provider, account A session vs account B lane: different owner with full detail', () => {
      const vm = buildStatsLimitViewModel(
        input({
          owners: [snapshot(CLAUDE_A), snapshot(CLAUDE_B)],
          laneRuns: [run({ quotaOwner: CLAUDE_B })],
        }),
      );
      const group = onlySubgroup(vm);
      expect(group.ownerStatus).toBe('different');
      expect(group.ownerLabel).toBe('Different owner');
      expect(group.planTileChips).toEqual([]);
      expect(group.windows.map((entry) => entry.windowKey)).toEqual([
        'five_hour',
        'weekly',
      ]);
      expect(group.windows[0].resetFacts).toEqual([
        'Resets today 15:10 UTC · in 3h 10m',
      ]);
      expect(group.windows[0].sourceChips).toEqual(['Provider API']);
    });

    it('same provider and same account: "Same account as this session" with see-plan-tiles chips', () => {
      const vm = buildStatsLimitViewModel(input({ laneRuns: [run()] }));
      const group = onlySubgroup(vm);
      expect(group.ownerStatus).toBe('same');
      expect(group.ownerText).toBe(
        'Same account as this session · see plan tiles',
      );
      expect(group.windows).toEqual([]);
      expect(group.planTileChips).toEqual([
        {
          planTileId: `plan:${CLAUDE_A.key}:five_hour`,
          chip: { tone: 'success', glyph: '✓', text: '5-hour · OK' },
        },
        {
          planTileId: `plan:${CLAUDE_A.key}:weekly`,
          chip: { tone: 'success', glyph: '✓', text: 'Weekly · OK' },
        },
      ]);
      expect(group.state).toBe('confirmed-room');
      expect(vm.planTiles.map((tile) => tile.id)).toEqual(
        group.planTileChips.map((entry) => entry.planTileId),
      );
    });
  });

  describe('F54 unknown session owner', () => {
    it('shows an unavailable plan tile and never compares a lane with it', () => {
      const vm = buildStatsLimitViewModel(
        input({
          sessionOwnerKey: null,
          owners: [snapshot(CLAUDE_A)],
          laneRuns: [run()],
        }),
      );
      expect(vm.planTiles).toHaveLength(1);
      expect(vm.planTiles[0]).toMatchObject({
        id: 'plan-status:none',
        value: 'Unavailable',
      });
      expect(vm.indicator).toBeUndefined();
      const group = onlySubgroup(vm);
      expect(group.ownerLabel).toBe('Unknown owner');
      expect(group.ownerStatus).toBe('unknown-session-owner');
      expect(group.planTileChips).toEqual([]);
    });

    it('a lane whose own owner cannot be determined borrows no windows', () => {
      const vm = buildStatsLimitViewModel(
        input({
          owners: [snapshot(CLAUDE_A), snapshot(PROXY)],
          laneRuns: [run({ quotaOwner: PROXY })],
        }),
      );
      const group = onlySubgroup(vm);
      expect(group.ownerStatus).toBe('undetermined');
      expect(group.ownerText).toBe(
        "Limit unknown · quota owner cannot be determined; no other account's windows are borrowed",
      );
      expect(group.state).toBe('unknown');
      expect(group.windows).toEqual([]);
      expect(group.planTileChips).toEqual([]);
      expect(vm.laneTiles[0].limitChips).toEqual([
        {
          chip: { tone: 'neutral', glyph: '?', text: 'Limit unknown' },
          sourceChips: [],
        },
      ]);
    });
  });

  describe('F55 account change A to B, restored runs (G3)', () => {
    const owners = [snapshot(CLAUDE_A), snapshot(CLAUDE_B)];

    it('a restored run recorded on A in a session now on B is "Different owner"; a new run on B is "Same account"', () => {
      const vm = buildStatsLimitViewModel(
        input({
          sessionOwnerKey: CLAUDE_B.key,
          owners,
          laneRuns: [
            run({ restored: true, usageTotals: null, quotaOwner: CLAUDE_A }),
            run({ quotaOwner: CLAUDE_B }),
          ],
        }),
      );
      const [first, second] = vm.laneTiles[0].subgroups;
      expect(first.ownerStatus).toBe('different');
      expect(first.runs[0].stateText).toBe('Restored · completed');
      expect(first.runs[0].startedText).toBe('started today 11:00 UTC');
      expect(second.ownerStatus).toBe('same');
    });

    it('a run with no recorded owner is "owner not recorded", never the current owner', () => {
      const vm = buildStatsLimitViewModel(
        input({
          sessionOwnerKey: CLAUDE_B.key,
          owners,
          laneRuns: [run({ restored: true, quotaOwner: undefined })],
        }),
      );
      const group = onlySubgroup(vm);
      expect(group.ownerStatus).toBe('not-recorded');
      expect(group.ownerLabel).toBe('Unknown owner');
      expect(group.ownerText).toContain('Limit unknown · owner not recorded');
      expect(group.state).toBe('unknown');
      expect(group.windows).toEqual([]);
      expect(group.planTileChips).toEqual([]);
    });

    it('a malformed recorded owner reads as not recorded', () => {
      const malformed = {
        key: 42,
        providerId: 'claude-cli',
        identityKind: 'account',
      } as unknown as QuotaOwnerRef;
      const vm = buildStatsLimitViewModel(
        input({ laneRuns: [run({ quotaOwner: malformed })] }),
      );
      expect(onlySubgroup(vm).ownerStatus).toBe('not-recorded');
    });
  });

  describe('F56 no hidden windows (A2)', () => {
    it('Sonnet session, Opus lane on the same account, Opus-only exhaustion', () => {
      const claude = snapshot(CLAUDE_A, {
        windows: [planWindow(), weekly(), weeklyOpusExhausted()],
      });
      const vm = buildStatsLimitViewModel(
        input({
          owners: [claude],
          laneRuns: [
            run({ model: 'opus', modelScope: 'opus', role: 'refactor' }),
          ],
        }),
      );
      // No session plan tile for the Opus window; the Sonnet session is fine.
      expect(vm.planTiles.map((tile) => tile.id)).toEqual([
        `plan:${CLAUDE_A.key}:five_hour`,
        `plan:${CLAUDE_A.key}:weekly`,
      ]);
      expect(vm.indicator).toBeUndefined();

      const group = onlySubgroup(vm);
      expect(group.ownerStatus).toBe('same');
      expect(group.state).toBe('at-limit');
      expect(group.planTileChips.map((entry) => entry.chip.text)).toEqual([
        '5-hour · OK',
        'Weekly · OK',
      ]);
      expect(group.windows).toHaveLength(1);
      expect(group.windows[0]).toMatchObject({
        windowKey: 'weekly_model:opus',
        state: 'limit-reached',
        usedText: '100% used',
        percent: 100,
        resetFacts: ['Limit reached — resets Wed 7 Oct 12:00 UTC · in 2d 0h'],
        sourceChips: ['used · reset Provider API', 'limit From error'],
      });
      expect(vm.laneTiles[0].tone).toBe('error');
    });
  });

  describe('F57 stable tile ids', () => {
    it('keeps every tile id across a push with new usage values', () => {
      const build = (percent: number, tokens: number) =>
        buildStatsLimitViewModel(
          input({
            owners: [
              snapshot(CLAUDE_A, {
                windows: [planWindow({ used: { kind: 'percent', percent } })],
              }),
            ],
            laneRuns: [
              run({ runId: 'r1', usageTotals: { totalTokens: tokens } }),
            ],
          }),
        );
      const ids = (vm: ReturnType<typeof build>) => [
        ...vm.planTiles.map((tile) => tile.id),
        ...vm.laneTiles.map((tile) => tile.id),
        vm.subtotal?.id,
      ];
      expect(ids(build(40, 100))).toEqual(ids(build(95, 9000)));
      expect(ids(build(40, 100))).toEqual([
        `plan:${CLAUDE_A.key}:five_hour`,
        'lane:ptah-cli:docs',
        'lanes-subtotal',
      ]);
    });
  });

  describe('F58 session isolation', () => {
    it('each session shows only the runs it is given', () => {
      const a = buildStatsLimitViewModel(
        input({
          laneRuns: [
            run({ runId: 'a1', cli: 'codex', cliLabel: 'Codex', role: null }),
          ],
        }),
      );
      const b = buildStatsLimitViewModel(
        input({ sessionId: 'session-2', laneRuns: [run({ runId: 'b1' })] }),
      );
      expect(a.laneTiles.map((tile) => tile.id)).toEqual(['lane:codex:none']);
      expect(b.laneTiles.map((tile) => tile.id)).toEqual([
        'lane:ptah-cli:docs',
      ]);
      expect(a.laneTiles[0].subgroups[0].runs.map((row) => row.runId)).toEqual([
        'a1',
      ]);
      expect(b.laneTiles[0].subgroups[0].runs.map((row) => row.runId)).toEqual([
        'b1',
      ]);
    });
  });

  describe('F59 lane usage stays out of the session totals', () => {
    it('produces no session token or cost field', () => {
      const vm = buildStatsLimitViewModel(input({ laneRuns: [run()] }));
      expect(Object.keys(vm).sort()).toEqual([
        'laneTiles',
        'lanesCount',
        'planTiles',
        'subtotal',
      ]);
    });

    it.each([
      ['null', null],
      ['absent', undefined],
    ])('usageTotals %s reads unknown, never 0', (_label, usageTotals) => {
      const vm = buildStatsLimitViewModel(
        input({ laneRuns: [run({ restored: true, usageTotals })] }),
      );
      const tile = vm.laneTiles[0];
      expect(tile.tokensText).toBe('unknown tokens');
      expect(tile.costLine).toBe('cost unknown');
      expect(tile.subgroups[0].runs[0]).toMatchObject({
        tokensText: 'unknown',
        costText: 'unknown',
      });
      expect(vm.subtotal?.summary).toBe(
        '$0.00 known cost · 1 lane · 1 run · 1 cost unknown',
      );
    });

    it('an undefined field inside a total is unknown', () => {
      const vm = buildStatsLimitViewModel(
        input({
          laneRuns: [
            run({
              runId: 'known',
              usageTotals: { totalTokens: 1500, costUsd: 0.25 },
            }),
            run({ runId: 'partial', usageTotals: { inputTokens: 700 } }),
          ],
        }),
      );
      const tile = vm.laneTiles[0];
      expect(tile.tokensText).toBe('1.5k tokens');
      expect(tile.tokensUnknownText).toBe('+1 unknown');
      expect(tile.costLine).toBe('cost $0.25 (+1 unknown) · 2 runs');
      const rows = tile.subgroups[0].runs;
      expect(rows[1]).toMatchObject({
        label: 'Run 2',
        tokensText: 'unknown',
        costText: 'unknown',
      });
      expect(vm.subtotal).toEqual({
        id: 'lanes-subtotal',
        caption: 'lane · not in totals',
        tokensText: '1.5k tokens known',
        summary: '$0.25 known cost · 1 lane · 2 runs · 1 cost unknown',
      });
    });
  });

  describe('F60 collapsed indicator', () => {
    it('is absent when the session has room or its state is unknown', () => {
      expect(buildStatsLimitViewModel(input()).indicator).toBeUndefined();
      const noSource = snapshot(CLAUDE_A, {
        status: 'no-usage-source',
        windows: [],
        windowSetEstablished: false,
      });
      const vm = buildStatsLimitViewModel(input({ owners: [noSource] }));
      expect(vm.indicator).toBeUndefined();
      expect(vm.planTiles[0]).toMatchObject({
        value: 'No usage source',
        detailLines: [
          'Claude account · aaaa does not report plan usage, so no percentage is shown.',
        ],
      });
    });

    it('shows near limit with window, value and reset', () => {
      const vm = buildStatsLimitViewModel(
        input({
          owners: [
            snapshot(CLAUDE_A, {
              windows: [planWindow({ used: { kind: 'percent', percent: 94 } })],
            }),
          ],
        }),
      );
      expect(vm.indicator).toEqual({
        state: 'near-limit',
        tone: 'warning',
        text: 'Near · 5-hour 94% · resets today 15:10 UTC',
      });
      expect(vm.planTiles[0]).toMatchObject({
        value: '94% used',
        chip: { tone: 'warning', glyph: '▲', text: 'Near limit' },
        tone: 'warning',
      });
    });

    it('shows owner-level exhaustion with zero windows', () => {
      const evidence: OwnerLimitEvidence = {
        observedAt: NOW - 5 * MIN,
        source: 'stream-event',
        resetsAt: NOW + 5 * HOUR + 5 * MIN,
      };
      const vm = buildStatsLimitViewModel(
        input({
          owners: [
            snapshot(CLAUDE_A, {
              windows: [],
              windowSetEstablished: false,
              ownerEvidence: [evidence],
            }),
          ],
        }),
      );
      expect(vm.indicator).toEqual({
        state: 'at-limit',
        tone: 'error',
        text: 'At limit · window unknown · resets today 17:05 UTC',
      });
      expect(vm.planTiles).toEqual([
        expect.objectContaining({
          id: `plan-evidence:${CLAUDE_A.key}`,
          value: 'At limit',
          resetLine: 'window unknown · resets today 17:05 UTC · in 5h 5m',
          chip: { tone: 'error', glyph: '■', text: 'At limit' },
          sourceChips: ['Live event'],
        }),
      ]);
    });
  });

  describe('plan tiles', () => {
    it('a reset after the last observation reads unknown with passed and next reset apart', () => {
      const passed = planWindow({
        resetsAt: NOW - 40 * MIN,
        lastResetAt: undefined,
        observedAt: NOW - 68 * MIN,
        used: { kind: 'percent', percent: 80 },
      });
      const vm = buildStatsLimitViewModel(
        input({ owners: [snapshot(CLAUDE_A, { windows: [passed] })] }),
      );
      const tile = vm.planTiles[0];
      expect(tile).toMatchObject({
        value: 'unknown',
        resetLine: 'reset today 11:20 UTC passed · next unknown',
        chip: { tone: 'neutral', glyph: '↻', text: 'Reset · usage unknown' },
        sourceChips: ['Provider API'],
      });
      expect(tile.window?.percent).toBeUndefined();
      expect(tile.window?.resetFacts).toEqual([
        'Reset today 11:20 UTC · 40m ago came after the last observation (today 10:52 UTC): current usage unknown',
        'Next reset unknown',
      ]);
    });

    it('expired owner evidence never claims current exhaustion', () => {
      const vm = buildStatsLimitViewModel(
        input({
          owners: [
            snapshot(CLAUDE_A, {
              windows: [],
              ownerEvidence: [
                {
                  observedAt: NOW - 2 * HOUR,
                  source: 'error-derived',
                  resetsAt: NOW - 10 * MIN,
                },
              ],
            }),
          ],
        }),
      );
      expect(vm.indicator).toBeUndefined();
      expect(vm.planTiles[0]).toMatchObject({
        value: 'Limit hit · expired',
        resetLine: 'window unknown · reset today 11:50 UTC passed',
        chip: { tone: 'neutral', glyph: '↻', text: 'Expired' },
        tone: 'neutral',
      });
    });

    it('shows stale and active cooldown tiles', () => {
      const vm = buildStatsLimitViewModel(
        input({
          owners: [
            snapshot(CLAUDE_A, {
              status: 'stale',
              staleSince: NOW - 47 * MIN,
              windows: [planWindow()],
              cooldown: { until: NOW + 14 * MIN, observedAt: NOW - MIN },
            }),
          ],
        }),
      );
      expect(vm.planTiles.map((tile) => [tile.kind, tile.value])).toEqual([
        ['status', 'Stale'],
        ['window', '40% used'],
        ['cooldown', 'until today 12:14 UTC'],
      ]);
      expect(vm.planTiles[0].resetLine).toBe(
        'cached data · refresh failed today 11:13 UTC',
      );
      expect(vm.planTiles[1].chip?.text).toBe('Aged');
      expect(vm.planTiles[2].resetLine).toBe('retry delay, not a plan reset');
      expect(vm.planTiles[2].sourceChips).toEqual(['From error']);
    });

    it('keeps the owner suffix separate from the truncating caption lead', () => {
      const canonical = buildStatsLimitViewModel(input()).planTiles[0];
      const nonCanonicalOwner = { ...CLAUDE_A, key: 'claude-cli#account:short' };
      const nonCanonical = buildStatsLimitViewModel(
        input({
          sessionOwnerKey: nonCanonicalOwner.key,
          owners: [snapshot(nonCanonicalOwner)],
        }),
      ).planTiles[0];

      expect(canonical).toMatchObject({
        captionLead: 'Claude account plan limit',
        captionTail: '· aaaa',
        caption: 'Claude account plan limit · aaaa',
      });
      expect(nonCanonical.captionLead).toBe('Claude account plan limit');
      expect(nonCanonical.captionTail).toBeUndefined();
      expect(nonCanonical.caption).toBe('Claude account plan limit');
    });

    it('renders absolute times in the zone it is given', () => {
      const vm = buildStatsLimitViewModel(
        input({ time: { timeZone: 'Europe/Berlin', zoneNameLocale: 'en-GB' } }),
      );
      expect(vm.planTiles[0].resetLine).toBe(
        'resets today 17:10 CEST · in 3h 10m',
      );
    });
  });

  describe('saved-evidence owners (Batch 13 binding)', () => {
    it('(i) a past owner known only from saved evidence is last-known evidence, not a failure', () => {
      const past = snapshot(CLAUDE_B, {
        status: 'service-unavailable',
        windowSetEstablished: false,
        windows: [weekly({ used: { kind: 'percent', percent: 60 } })],
      });
      const vm = buildStatsLimitViewModel(
        input({
          owners: [snapshot(CLAUDE_A), past],
          laneRuns: [run({ quotaOwner: CLAUDE_B })],
        }),
      );
      const group = onlySubgroup(vm);
      expect(group.ownerStatus).toBe('different');
      expect(group.notes[0]).toEqual({
        tone: 'info',
        text: 'No current read for this account · showing its last-known evidence',
      });
      expect(group.windows.map((entry) => entry.windowKey)).toEqual(['weekly']);
      expect(noteTexts(group).join(' ')).not.toContain('service-unavailable');
      expect(vm.laneTiles[0].tone).toBe('neutral');
    });

    it('(i) the face of a last-known owner shows its own last-known value, never "Limit unknown" (G3)', () => {
      const past = snapshot(CLAUDE_B, {
        status: 'service-unavailable',
        windowSetEstablished: false,
        windows: [
          planWindow({ used: { kind: 'percent', percent: 20 } }),
          weekly({ used: { kind: 'percent', percent: 60 } }),
        ],
      });
      const vm = buildStatsLimitViewModel(
        input({
          // The session owner A has a weekly window at 40%; it is never borrowed.
          owners: [snapshot(CLAUDE_A), past],
          laneRuns: [
            run({ restored: true, usageTotals: null, quotaOwner: CLAUDE_B }),
          ],
        }),
      );
      const group = onlySubgroup(vm);
      const lastKnown = {
        tone: 'neutral',
        glyph: '◷',
        text: 'Last known · Weekly 60% used',
      };
      // No room is confirmed: the state stays unknown, only the wording follows the panel.
      expect(group.state).toBe('unknown');
      expect(group.stateChip).toEqual(lastKnown);
      expect(vm.laneTiles[0].limitChips).toEqual([
        { chip: lastKnown, sourceChips: ['Provider API'] },
      ]);
      expect(vm.laneTiles[0].tone).toBe('neutral');
    });

    it('(i) a last-known owner with only expired evidence names it on the face', () => {
      const past = snapshot(CLAUDE_B, {
        status: 'service-unavailable',
        windowSetEstablished: false,
        windows: [],
        ownerEvidence: [
          {
            observedAt: NOW - 3 * DAY,
            source: 'error-derived',
            resetsAt: NOW - DAY,
          },
        ],
      });
      const vm = buildStatsLimitViewModel(
        input({
          owners: [snapshot(CLAUDE_A), past],
          laneRuns: [run({ quotaOwner: CLAUDE_B })],
        }),
      );
      expect(vm.laneTiles[0].limitChips.map((face) => face.chip.text)).toEqual(
        ['Last known · limit evidence'],
      );
      expect(onlySubgroup(vm).state).toBe('unknown');
    });

    it('(i) a last-known owner with an unknown value keeps "Limit unknown" on the face', () => {
      const past = snapshot(CLAUDE_B, {
        status: 'service-unavailable',
        windowSetEstablished: false,
        windows: [weekly({ used: undefined, usedSource: undefined })],
      });
      const vm = buildStatsLimitViewModel(
        input({
          owners: [snapshot(CLAUDE_A), past],
          laneRuns: [run({ quotaOwner: CLAUDE_B })],
        }),
      );
      expect(vm.laneTiles[0].limitChips.map((face) => face.chip.text)).toEqual(
        ['Limit unknown'],
      );
    });

    it('(ii) a saved Claude account owner with no open session', () => {
      const saved = snapshot(CLAUDE_B, {
        status: 'service-unavailable',
        unavailableReason: 'no-open-session',
        windowSetEstablished: false,
        windows: [],
      });
      const vm = buildStatsLimitViewModel(
        input({
          owners: [snapshot(CLAUDE_A), saved],
          laneRuns: [run({ quotaOwner: CLAUDE_B })],
        }),
      );
      const group = onlySubgroup(vm);
      expect(group.notes).toEqual([
        {
          tone: 'info',
          text: 'No open session for this account · showing its last-known evidence',
        },
      ]);
      expect(group.state).toBe('unknown');
      // No evidence of its own: the session owner's windows are never borrowed.
      expect(group.stateChip.text).toBe('Limit unknown');
      expect(vm.laneTiles[0].limitChips.map((face) => face.chip.text)).toEqual(
        ['Limit unknown'],
      );
    });

    it('(iii) a saved Anthropic API-key owner is unsupported, with no windows', () => {
      const keyOwner = snapshot(ANTHROPIC_KEY, {
        status: 'unsupported-auth',
        windowSetEstablished: false,
        windows: [],
      });
      const vm = buildStatsLimitViewModel(
        input({
          owners: [snapshot(CLAUDE_A), keyOwner],
          laneRuns: [run({ quotaOwner: ANTHROPIC_KEY })],
        }),
      );
      const group = onlySubgroup(vm);
      expect(group.windows).toEqual([]);
      expect(group.notes).toEqual([
        {
          tone: 'neutral',
          text: 'Plan usage is not reported for this sign-in method',
        },
      ]);
      expect(noteTexts(group).join(' ')).not.toContain('last-known');
    });

    it('the session owner failing its read shows an Unavailable tile', () => {
      const vm = buildStatsLimitViewModel(
        input({
          owners: [
            snapshot(CLAUDE_A, {
              status: 'service-unavailable',
              unavailableReason: 'no-open-session',
              windowSetEstablished: false,
              windows: [],
            }),
          ],
        }),
      );
      expect(vm.planTiles).toEqual([
        expect.objectContaining({
          id: `plan-status:${CLAUDE_A.key}`,
          value: 'Unavailable',
          resetLine: 'no open session',
          caption: 'Claude account plan limit · aaaa',
          captionLead: 'Claude account plan limit',
          captionTail: '· aaaa',
        }),
      ]);
    });
  });

  describe('lane notes and face', () => {
    it('model-scope-unknown and estimated-limit are informational notes', () => {
      const codex = snapshot(CODEX, {
        windows: [planWindow(), weeklyOpusExhausted()],
        ownerEvidence: [
          { observedAt: NOW - MIN, source: 'estimated', resetsAt: NOW + HOUR },
        ],
      });
      const vm = buildStatsLimitViewModel(
        input({
          owners: [snapshot(CLAUDE_A), codex],
          laneRuns: [
            run({
              cli: 'codex',
              cliLabel: 'Codex',
              role: null,
              quotaOwner: CODEX,
              modelScope: null,
            }),
          ],
        }),
      );
      const group = onlySubgroup(vm);
      expect(group.state).toBe('unknown');
      expect(group.notes).toEqual(
        expect.arrayContaining([
          {
            tone: 'info',
            text: 'Model unknown · model-specific limits are not applied',
          },
          {
            tone: 'info',
            text: 'A local estimate suggests a limit · not confirmed',
          },
        ]),
      );
      expect(group.windows.map((entry) => entry.windowKey)).toEqual([
        'five_hour',
      ]);
    });

    it('subgroups by owner and model scope with affected-run wording', () => {
      const claude = snapshot(CLAUDE_A, {
        windows: [
          planWindow({ used: { kind: 'percent', percent: 93 } }),
          weeklyOpusExhausted(),
        ],
      });
      const vm = buildStatsLimitViewModel(
        input({
          owners: [claude],
          laneRuns: [
            run({ model: 'sonnet', modelScope: 'sonnet', status: 'running' }),
            run({ model: 'opus', modelScope: 'Opus' }),
          ],
        }),
      );
      const tile = vm.laneTiles[0];
      expect(tile.label).toBe('Claude · docs');
      expect(tile.caption).toBe('lane · not in totals');
      expect(tile.runChip).toEqual({
        tone: 'live',
        text: 'Live · 1 of 2 running',
      });
      expect(tile.subgroups.map((group) => group.key)).toEqual([
        `${CLAUDE_A.key}|sonnet`,
        `${CLAUDE_A.key}|opus`,
      ]);
      expect(tile.limitChips.map((entry) => entry.chip.text)).toEqual([
        'At limit · 1 of 2 runs (opus)',
        'Near limit · 1 of 2 runs (sonnet)',
      ]);
      expect(tile.limitChips[0].sourceChips).toEqual([
        'used · reset Provider API',
        'limit From error',
      ]);
    });

    it('a quota failure run marks the run chip', () => {
      const vm = buildStatsLimitViewModel(
        input({ laneRuns: [run({ status: 'failed', failureKind: 'quota' })] }),
      );
      expect(vm.laneTiles[0].runChip).toEqual({
        tone: 'error',
        glyph: '■',
        text: 'Quota failure',
      });
      expect(vm.lanesCount).toBe(1);
    });

    it('has no lane tiles or subtotal without runs', () => {
      const vm = buildStatsLimitViewModel(input());
      expect(vm.laneTiles).toEqual([]);
      expect(vm.subtotal).toBeUndefined();
      expect(vm.lanesCount).toBe(0);
    });
  });

  describe('failed refresh while data is held', () => {
    it('adds a neutral notice with the newest held observation in local time', () => {
      const vm = buildStatsLimitViewModel(
        input({
          refreshFailed: true,
          owners: [
            snapshot(CLAUDE_A, {
              windows: [
                planWindow({ observedAt: NOW - 2 * HOUR }),
                weekly({ observedAt: NOW - 3 * HOUR }),
              ],
              ownerEvidence: [
                {
                  observedAt: NOW - HOUR - 30 * MIN,
                  source: 'error-derived',
                },
              ],
            }),
          ],
        }),
      );
      expect(vm.refreshNotice).toBe(
        'Refresh failed — showing last observed data (observed today 10:30 UTC)',
      );
    });

    it('keeps the age-based window states as they are', () => {
      const failed = buildStatsLimitViewModel(input({ refreshFailed: true }));
      const ok = buildStatsLimitViewModel(input());
      expect(failed.planTiles).toEqual(ok.planTiles);
      expect(failed.indicator).toEqual(ok.indicator);
    });

    it('has no notice after a good read or when nothing is held', () => {
      expect(buildStatsLimitViewModel(input()).refreshNotice).toBeUndefined();
      expect(
        buildStatsLimitViewModel(input({ refreshFailed: false }))
          .refreshNotice,
      ).toBeUndefined();
      expect(
        buildStatsLimitViewModel(input({ refreshFailed: true, owners: [] }))
          .refreshNotice,
      ).toBeUndefined();
    });

    it('omits the time when no held owner has an observation', () => {
      const vm = buildStatsLimitViewModel(
        input({
          refreshFailed: true,
          owners: [snapshot(CLAUDE_A, { windows: [], ownerEvidence: [] })],
        }),
      );
      expect(vm.refreshNotice).toBe(
        'Refresh failed — showing last observed data',
      );
    });
  });
});
