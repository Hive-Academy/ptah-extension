/**
 * Stats-grid limit view model (TASK_2026_596, Component 15; design §3 with
 * the Gate 1.7 amendments A1-A3).
 *
 * Pure: the clock (`now`), the time zone and the zone-name locale come in the
 * input, so the same snapshot renders the same text on every machine. Every
 * state decision is delegated to the shared plan-limit engine
 * (`classifyWindow` through `classifyLaneState`, `applicableLimits`,
 * `ownerRelation`); this file only arranges the results into tiles and text.
 *
 * Rules carried here:
 * - Unknown is never 0. A missing used value, token count or cost reads
 *   "unknown"; `usageTotals` that is `null` or absent is unknown.
 * - Lane usage never enters the session totals (Req 8.5): this model has no
 *   session token or cost field at all, only the lane tiles and their own
 *   subtotal.
 * - A lane run is judged on the owner recorded at its run (G3). A run with no
 *   valid recorded owner is "Unknown owner · owner not recorded" and never
 *   borrows the session's or any other owner's windows (R7).
 * - "Same account" only when `ownerRelation` says `same` (A1); "see plan
 *   tiles" replaces a window's detail only when a session plan tile renders
 *   that same window (A2).
 * - A snapshot listed from saved evidence alone arrives as
 *   `service-unavailable` (with `no-open-session` for a Claude account). It
 *   is shown as that owner's last-known evidence, by owner comparison, never
 *   as a live read failure. An Anthropic API-key owner arrives as
 *   `unsupported-auth` with no windows and is shown as unsupported.
 */
import {
  formatLocalAbsolute,
  FRESHNESS_MS,
  NEAR_LIMIT_PERCENT,
  windowObservedAt,
} from '@ptah-extension/shared';
import { groupLaneRuns, laneTile, runRow, subtotalTile } from './lane-tiles';
import { sessionPlan } from './plan-limit-tiles';
import type {
  StatsLimitContext,
  StatsLimitViewModel,
  StatsLimitViewModelInput,
  ProviderLaneLimitModel,
  InspectorLaneRunDetail,
} from './stats-limit-view-model.types';

export function buildStatsLimitViewModel(
  input: StatsLimitViewModelInput,
): StatsLimitViewModel {
  const ctx: StatsLimitContext = {
    now: input.now,
    time: input.time,
    lane: {
      now: input.now,
      nearLimitPercent: NEAR_LIMIT_PERCENT,
      freshnessMs: FRESHNESS_MS,
    },
  };
  const session = sessionPlan(input, ctx);
  const laneTiles = groupLaneRuns(input.laneRuns).map((runs) =>
    laneTile(runs, input.owners, session, ctx),
  );
  const refreshNotice = refreshFailedNotice(input);
  const inspectorRuns: InspectorLaneRunDetail[] = input.laneRuns.map(run => {
    const tile = laneTile([run], input.owners, session, ctx);
    const subgroup = tile.subgroups[0];
    return {
      runId: run.runId,
      cliLabel: run.cliLabel,
      role: run.role ?? null,
      row: runRow(run, 0, ctx),
      ownerText: subgroup?.ownerText ?? 'Unknown owner',
      notes: subgroup?.notes.map(note => note.text) ?? [],
      evidenceLines: [
        ...(subgroup?.evidenceLines ?? []),
        ...(subgroup?.cooldownLine ? [subgroup.cooldownLine] : []),
        ...(subgroup?.planTileChips.map(ref => {
          const planTile = session.tiles.find(tile => tile.id === ref.planTileId);
          return planTile ? `${planTile.label}: ${planTile.value} · ${planTile.resetLine} · ${planTile.sourceChips.join(', ')}` : ref.chip.text;
        }) ?? []),
      ],
      windows: subgroup?.windows ?? [],
    };
  });
  const providers = new Map<string, StatsLimitViewModelInput['laneRuns'][number][]>();
  for (const run of input.laneRuns) {
    const group = providers.get(run.cli) ?? [];
    group.push(run);
    providers.set(run.cli, group);
  }
  const providerLimits: ProviderLaneLimitModel[] = [...providers].map(([cli, runs]) => {
    const ownerKeys = [...new Set(runs.map(run => run.quotaOwner?.key).filter((key): key is string => !!key))];
    const ownerDetails = ownerKeys.flatMap(key => {
      const owner = input.owners.find(snapshot => snapshot.owner.key === key);
      if (!owner) return [`${key} · Usage unknown`];
      const plan = sessionPlan({ ...input, sessionOwnerKey: key, sessionModelScope: null }, ctx);
      const windows = plan.tiles.filter(tile => tile.kind === 'window');
      return windows.length
        ? windows.map(tile => `${owner.owner.label} · ${tile.label}: ${tile.value} · ${tile.resetLine} · ${tile.sourceChips.join(', ')}`)
        : [`${owner.owner.label} · Limits not tracked`];
    });
    const hasUnownedRun = runs.some(run => !run.quotaOwner);
    if (ownerKeys.length !== 1 || hasUnownedRun) return {
      id: `provider:${cli}`, label: runs[0].cliLabel,
      ownerState: ownerKeys.length > 1 || ownerKeys.length > 0 && hasUnownedRun ? 'multiple' as const : 'untracked' as const,
      windows: [],
      message: ownerKeys.length > 1 || ownerKeys.length > 0 && hasUnownedRun ? 'Multiple accounts' : 'Limits not tracked',
      ownerDetails: hasUnownedRun ? [...ownerDetails, 'Unknown owner · Limits not tracked'] : ownerDetails,
    };
    const ownerKey = ownerKeys[0];
    const ownerSnapshot = input.owners.find(snapshot => snapshot.owner.key === ownerKey);
    const scopes = [...new Set(runs.filter(run => run.quotaOwner?.key === ownerKey).map(run => run.modelScope ?? null))];
    if (scopes.length > 1) return {
      id: `provider:${cli}`, label: runs[0].cliLabel,
      ownerState: 'single' as const, windows: [], message: 'Multiple scopes · Usage unknown',
      ownerDetails,
    };
    const ownerPlan = sessionPlan({ ...input, sessionOwnerKey: ownerKey, sessionModelScope: scopes.length === 1 ? scopes[0] : null }, ctx);
    const windows = ownerPlan.tiles.filter(tile => tile.kind === 'window' || tile.kind === 'cooldown' || tile.kind === 'evidence');
    return {
      id: `provider:${cli}`, label: runs[0].cliLabel,
      ownerState: 'single' as const, windows,
      message: windows.some(tile => tile.kind === 'window') ? ''
        : ownerSnapshot?.status === 'no-usage-source' || ownerSnapshot?.status === 'provider-unsupported'
          || ownerSnapshot?.status === 'unsupported-auth' || ownerSnapshot?.status === 'unsupported-config'
          ? 'Limits not tracked' : 'Usage unknown',
      ownerDetails,
    };
  });
  return {
    ...(session.indicator && { indicator: session.indicator }),
    ...(refreshNotice !== undefined && { refreshNotice }),
    planTiles: session.tiles,
    laneTiles,
    inspectorRuns,
    providerLimits,
    ...(input.laneRuns.length > 0 && {
      subtotal: subtotalTile(input.laneRuns, laneTiles.length),
    }),
    lanesCount: input.laneRuns.length,
  };
}

/**
 * "Refresh failed — showing last observed data", with the newest host
 * observation among the held owners when there is one. Absent when the pull
 * succeeded or nothing is held (the empty placeholder has no owners). The
 * window states keep their own age-based classification.
 */
function refreshFailedNotice(
  input: StatsLimitViewModelInput,
): string | undefined {
  if (input.refreshFailed !== true || input.owners.length === 0) {
    return undefined;
  }
  const observedAt = newestObservation(input.owners);
  return observedAt === undefined
    ? 'Refresh failed — showing last observed data'
    : `Refresh failed — showing last observed data (observed ${formatLocalAbsolute(observedAt, input.now, input.time)})`;
}

function newestObservation(
  owners: StatsLimitViewModelInput['owners'],
): number | undefined {
  let newest: number | undefined;
  for (const owner of owners) {
    const instants = [
      ...owner.windows.map(windowObservedAt),
      ...owner.ownerEvidence.map((evidence) => evidence.observedAt),
    ];
    for (const instant of instants) {
      if (Number.isFinite(instant) && (newest === undefined || instant > newest)) {
        newest = instant;
      }
    }
  }
  return newest;
}
