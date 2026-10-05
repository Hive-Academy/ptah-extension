/**
 * Lane tiles of the stats grid (TASK_2026_596, Component 15; design §3.3
 * with A1 and A2). One tile per CLI + role; quota state is evaluated per
 * recorded owner + model-scope subgroup and never copied from the first run.
 * Lane usage stays in these tiles and their subtotal, never in the session
 * totals (Req 8.5).
 */
import {
  applicableLimits,
  classifyLaneState,
  formatLocalAbsolute,
  formatSourceChips,
  ownerDisplayLabel,
  ownerRelation,
  PLAN_LIMIT_SOURCE_LABELS,
  windowModelScope,
  type AgentStatus,
  type LaneLimitState,
  type LaneStateReason,
  type LaneStateResult,
  type OwnerLimitEvidence,
  type PlanLimitOwnerSnapshot,
  type PlanWindowBlockingState,
  type QuotaOwnerIdentityKind,
  type QuotaOwnerRef,
} from '@ptah-extension/shared';
import {
  activeCooldown,
  cooldownLine,
  evidenceLine,
  evidenceSources,
  windowChip,
  windowDetail,
  type SessionPlan,
} from './plan-limit-tiles';
import {
  LANE_CAPTION,
  LANES_SUBTOTAL_TILE_ID,
  type LaneFaceChipModel,
  type LaneOwnerStatus,
  type LanePlanTileChip,
  type LaneRunRowModel,
  type LaneSubgroupModel,
  type LaneSubtotalTileModel,
  type LaneUsageTileModel,
  type PlanWindowDetailModel,
  type StatsChip,
  type StatsLimitContext as Ctx,
  type StatsLimitLaneRun,
  type StatsLimitNote,
} from './stats-limit-view-model.types';

// ------------------------------------------------------------------ lanes

export function groupLaneRuns(
  runs: readonly StatsLimitLaneRun[],
): StatsLimitLaneRun[][] {
  const groups = new Map<string, StatsLimitLaneRun[]>();
  for (const run of runs) {
    const id = laneTileId(run);
    const group = groups.get(id);
    if (group) group.push(run);
    else groups.set(id, [run]);
  }
  return [...groups.values()];
}

function laneTileId(run: StatsLimitLaneRun): string {
  return `lane:${run.cli}:${run.role || 'none'}`;
}

const IDENTITY_KINDS: ReadonlySet<QuotaOwnerIdentityKind> = new Set([
  'account',
  'credential',
  'cli-store',
  'unknown',
]);

/** A recorded owner usable for comparison; malformed reads as absent. */
function recordedOwner(run: StatsLimitLaneRun): QuotaOwnerRef | undefined {
  const owner: unknown = run.quotaOwner;
  if (typeof owner !== 'object' || owner === null) return undefined;
  const ref = owner as Partial<Record<keyof QuotaOwnerRef, unknown>>;
  return typeof ref.key === 'string' &&
    ref.key.length > 0 &&
    typeof ref.providerId === 'string' &&
    typeof ref.label === 'string' &&
    IDENTITY_KINDS.has(ref.identityKind as QuotaOwnerIdentityKind)
    ? (owner as QuotaOwnerRef)
    : undefined;
}

function normalisedScope(run: StatsLimitLaneRun): string | null {
  return run.modelScope?.trim().toLowerCase() || null;
}

export function laneTile(
  runs: readonly StatsLimitLaneRun[],
  owners: readonly PlanLimitOwnerSnapshot[],
  session: SessionPlan,
  ctx: Ctx,
): LaneUsageTileModel {
  const first = runs[0];
  const subgroups = groupSubgroups(runs).map((group) =>
    laneSubgroup(group, owners, session, ctx),
  );
  const tokens = runs.map(runTokens);
  const costs = runs.map(runCost);
  const knownTokens = tokens.filter(isNumber);
  const knownCosts = costs.filter(isNumber);
  const unknownTokens = runs.length - knownTokens.length;
  const unknownCosts = runs.length - knownCosts.length;
  const cost =
    knownCosts.length === 0
      ? 'cost unknown'
      : `cost ${formatCost(sum(knownCosts))}${unknownCosts > 0 ? ` (+${unknownCosts} unknown)` : ''}`;
  const states = subgroups.map((group) => group.state);
  return {
    id: laneTileId(first),
    label: first.role ? `${first.cliLabel} · ${first.role}` : first.cliLabel,
    caption: LANE_CAPTION,
    tokensText:
      knownTokens.length === 0
        ? 'unknown tokens'
        : `${formatTokenCount(sum(knownTokens))} tokens`,
    ...(knownTokens.length > 0 &&
      unknownTokens > 0 && { tokensUnknownText: `+${unknownTokens} unknown` }),
    costLine: runs.length > 1 ? `${cost} · ${runs.length} runs` : cost,
    runChip: laneRunChip(runs),
    limitChips: laneFaceChips(subgroups, runs.length),
    tone: states.includes('at-limit')
      ? 'error'
      : states.includes('near-limit')
        ? 'warning'
        : 'neutral',
    runCount: runs.length,
    subgroups: subgroups.map((group) => group.model),
  };
}

function groupSubgroups(
  runs: readonly StatsLimitLaneRun[],
): StatsLimitLaneRun[][] {
  const groups = new Map<string, StatsLimitLaneRun[]>();
  for (const run of runs) {
    const key = subgroupKey(run);
    const group = groups.get(key);
    if (group) group.push(run);
    else groups.set(key, [run]);
  }
  return [...groups.values()];
}

function subgroupKey(run: StatsLimitLaneRun): string {
  return `${recordedOwner(run)?.key ?? '?'}|${normalisedScope(run) ?? ''}`;
}

interface EvaluatedSubgroup {
  readonly state: LaneLimitState;
  /** The face chip: the state chip, or the last-known chip (see below). */
  readonly chip: StatsChip;
  readonly faceSources: readonly string[];
  readonly runs: readonly StatsLimitLaneRun[];
  readonly model: LaneSubgroupModel;
}

const LANE_STATE_CHIPS: Readonly<Record<LaneLimitState, StatsChip>> = {
  'at-limit': { tone: 'error', glyph: '■', text: 'At limit' },
  'near-limit': { tone: 'warning', glyph: '▲', text: 'Near limit' },
  'confirmed-room': { tone: 'success', glyph: '✓', text: 'Room' },
  unknown: { tone: 'neutral', glyph: '?', text: 'Limit unknown' },
};

function laneSubgroup(
  runs: readonly StatsLimitLaneRun[],
  owners: readonly PlanLimitOwnerSnapshot[],
  session: SessionPlan,
  ctx: Ctx,
): EvaluatedSubgroup {
  const first = runs[0];
  const owner = recordedOwner(first);
  const scope = normalisedScope(first);
  const base = {
    key: subgroupKey(first),
    heading: [...new Set(runs.map((run) => run.model || 'unknown model'))].join(
      ' / ',
    ),
    runs: runs.map((run, index) => runRow(run, index, runs.length, ctx)),
  };
  if (!owner || owner.identityKind === 'unknown') {
    const status: LaneOwnerStatus = owner ? 'undetermined' : 'not-recorded';
    return {
      state: 'unknown',
      chip: LANE_STATE_CHIPS.unknown,
      faceSources: [],
      runs,
      model: {
        ...base,
        ownerStatus: status,
        ownerLabel: 'Unknown owner',
        ownerText: owner
          ? "Limit unknown · quota owner cannot be determined; no other account's windows are borrowed"
          : "Limit unknown · owner not recorded; no other account's windows are borrowed",
        state: 'unknown',
        stateChip: LANE_STATE_CHIPS.unknown,
        planTileChips: [],
        windows: [],
        evidenceLines: [],
        notes: [],
      },
    };
  }

  const relation = ownerRelation(session.owner, owner);
  const snapshot = owners.find((entry) => entry.owner.key === owner.key);
  const limits = snapshot ? applicableLimits(snapshot, scope) : undefined;
  const result = classifyLaneState(limits, ctx.lane);
  const same = relation === 'same';
  const unsupported = snapshot?.status === 'unsupported-auth';

  const planTileChips: LanePlanTileChip[] = [];
  const windows: PlanWindowDetailModel[] = [];
  if (snapshot && !unsupported) {
    for (const entry of result.windows) {
      const rendered = same
        ? session.renderedWindows.get(entry.window.key)
        : undefined;
      if (
        rendered &&
        windowModelScope(rendered.window) === windowModelScope(entry.window)
      ) {
        const chip = windowChip(entry.state);
        planTileChips.push({
          planTileId: `plan:${owner.key}:${entry.window.key}`,
          chip: {
            tone: chip?.tone ?? 'success',
            glyph: chip?.glyph ?? '✓',
            text: `${entry.window.label} · ${chip?.text ?? 'OK'}`,
          },
        });
      } else {
        windows.push(windowDetail(entry, snapshot, ctx));
      }
    }
  }
  const shownEvidence = (limits?.ownerEvidence ?? []).filter(
    (evidence) => !(same && session.renderedEvidence.has(evidence)),
  );
  const evidenceLines = shownEvidence.map((evidence) =>
    evidenceLine(evidence, ctx),
  );
  // An unknown lane whose own owner has no current read shows that owner's
  // last-known values on its face, the same decision as the panel note.
  const lastKnown =
    result.state === 'unknown' && showsLastKnownEvidence(snapshot, same)
      ? lastKnownFace(windows, shownEvidence)
      : undefined;
  const chip = lastKnown?.chip ?? LANE_STATE_CHIPS[result.state];
  const cooldown =
    limits && !same ? activeCooldown(limits, ctx.now) : undefined;
  // The suffixed owner label so two owners of one provider are told apart.
  const ownerText =
    relation === 'same'
      ? 'Same account as this session · see plan tiles'
      : relation === 'different'
        ? `Different owner · ${ownerDisplayLabel(owner)}`
        : session.owner
          ? `Unknown owner · cannot be compared with this session's account; showing ${ownerDisplayLabel(owner)} only`
          : `Unknown owner · this session's account is not resolved; showing ${ownerDisplayLabel(owner)} only`;
  return {
    state: result.state,
    chip,
    faceSources: lastKnown?.sources ?? faceSources(result),
    runs,
    model: {
      ...base,
      ownerStatus: relation === 'unknown' ? 'unknown-session-owner' : relation,
      ownerLabel:
        relation === 'same'
          ? 'Same account'
          : relation === 'different'
            ? 'Different owner'
            : 'Unknown owner',
      ownerText,
      state: result.state,
      stateChip: chip,
      planTileChips,
      windows,
      evidenceLines,
      ...(cooldown && { cooldownLine: cooldownLine(cooldown, ctx) }),
      notes: laneNotes(snapshot, result, same, ctx),
    },
  };
}

/** Source chips for the claim a lane face shows. */
function faceSources(result: LaneStateResult): string[] {
  const reason = result.reasons[0];
  switch (result.state) {
    case 'at-limit':
      if (reason?.kind === 'owner-limit')
        return evidenceSources(reason.evidence);
      return reason?.kind === 'window-limit'
        ? [...formatSourceChips(reason.window)]
        : [];
    case 'near-limit':
      return reason?.kind === 'window-near-limit'
        ? [...formatSourceChips(reason.window)]
        : [];
    case 'confirmed-room':
      return [
        ...new Set(
          result.windows.flatMap(({ window }) =>
            window.usedSource
              ? [PLAN_LIMIT_SOURCE_LABELS[window.usedSource]]
              : [],
          ),
        ),
      ];
    case 'unknown':
      return [];
  }
}

/**
 * Whether a lane's own owner is shown from its last-known evidence: a
 * ledger-only owner (`service-unavailable`, with or without
 * `no-open-session`) of another account. Used by the panel note and the face
 * so the two never disagree; a same-owner status is on the plan tiles.
 */
function showsLastKnownEvidence(
  snapshot: PlanLimitOwnerSnapshot | undefined,
  same: boolean,
): boolean {
  return (
    snapshot !== undefined &&
    !same &&
    snapshot.status === 'service-unavailable'
  );
}

/**
 * The face of a lane shown from last-known evidence: the most-used window
 * with a known value, else the owner's own evidence. The lane state stays
 * `unknown` (no room is confirmed); only the face wording follows the panel.
 * `undefined` when the panel holds no known value, so the face keeps
 * "Limit unknown".
 */
function lastKnownFace(
  windows: readonly PlanWindowDetailModel[],
  evidence: readonly OwnerLimitEvidence[],
): { chip: StatsChip; sources: readonly string[] } | undefined {
  const known = windows.filter((window) => window.percent !== undefined);
  if (known.length > 0) {
    const top = known.reduce(
      (max, window) =>
        (window.percent ?? 0) > (max.percent ?? 0) ? window : max,
      known[0],
    );
    return {
      chip: {
        tone: 'neutral',
        glyph: '◷',
        text: `Last known · ${top.label} ${top.usedText}`,
      },
      sources: top.sourceChips,
    };
  }
  if (evidence.length > 0) {
    return {
      chip: {
        tone: 'neutral',
        glyph: '◷',
        text: 'Last known · limit evidence',
      },
      sources: [...new Set(evidence.flatMap(evidenceSources))],
    };
  }
  return undefined;
}

/**
 * The owner's status as an explanatory note. A ledger-only owner is
 * last-known evidence (`showsLastKnownEvidence`), never a live failure; a
 * same-owner status is on the plan tiles.
 */
function ownerStatusNote(
  snapshot: PlanLimitOwnerSnapshot | undefined,
  same: boolean,
  ctx: Ctx,
): StatsLimitNote | undefined {
  if (!snapshot) {
    return {
      tone: 'neutral',
      text: 'No limit data for this account · treated as unknown, never as room',
    };
  }
  if (showsLastKnownEvidence(snapshot, same)) {
    return {
      tone: 'info',
      text:
        snapshot.unavailableReason === 'no-open-session'
          ? 'No open session for this account · showing its last-known evidence'
          : 'No current read for this account · showing its last-known evidence',
    };
  }
  if (same) return undefined;
  switch (snapshot.status) {
    case 'available':
      return undefined;
    case 'unsupported-auth':
      return {
        tone: 'neutral',
        text: 'Plan usage is not reported for this sign-in method',
      };
    case 'no-usage-source':
      return {
        tone: 'neutral',
        text: `No usage source · ${ownerDisplayLabel(snapshot.owner)} does not report plan usage`,
      };
    case 'stale':
      return {
        tone: 'neutral',
        text:
          snapshot.staleSince === undefined
            ? 'Showing cached account data; refresh failed'
            : `Showing cached account data; refresh failed at ${formatLocalAbsolute(snapshot.staleSince, ctx.now, ctx.time)}`,
      };
    // The failure statuses share one wording; `service-unavailable` is
    // already handled above (`showsLastKnownEvidence` / same-owner) but is
    // listed so the switch stays exhaustive over ProviderAccountUsageStatus.
    case 'unsupported-config':
    case 'provider-unsupported':
    case 'cli-unavailable':
    case 'cli-version-unsupported':
    case 'service-unavailable':
      return {
        tone: 'neutral',
        text: `Usage unavailable · ${snapshot.status}`,
      };
    default: {
      const exhaustive: never = snapshot.status;
      throw new Error(
        `Unhandled provider account usage status: ${exhaustive}`,
      );
    }
  }
}

function laneNotes(
  snapshot: PlanLimitOwnerSnapshot | undefined,
  result: LaneStateResult,
  same: boolean,
  ctx: Ctx,
): StatsLimitNote[] {
  const statusNote = ownerStatusNote(snapshot, same, ctx);
  const notes: StatsLimitNote[] = statusNote ? [statusNote] : [];
  if (result.state !== 'unknown') return notes;
  const statusShown = snapshot !== undefined && snapshot.status !== 'available';
  for (const reason of result.reasons) {
    const note = reasonNote(reason, statusShown || statusNote !== undefined);
    if (note && !notes.some((entry) => entry.text === note.text)) {
      notes.push(note);
    }
  }
  return notes;
}

const WINDOW_STATE_REASONS: Readonly<Record<PlanWindowBlockingState, string>> =
  {
    'reset-usage-unknown': 'reset passed, usage unknown',
    'usage-unknown': 'usage unknown',
    'estimate-only': 'estimate only',
    aged: 'aged value',
    'not-confirmed': 'last reset unknown',
  };

/**
 * One reason as a note. Exhaustive over `LaneStateReason`; scope and
 * estimate reasons are informational, never warnings.
 */
function reasonNote(
  reason: LaneStateReason,
  statusExplained: boolean,
): StatsLimitNote | undefined {
  switch (reason.kind) {
    case 'owner-limit':
    case 'window-limit':
    case 'window-near-limit':
      // Not unknown-state reasons; the evidence and windows show them.
      return undefined;
    case 'status':
    case 'stale':
    case 'no-usage-source':
      // The owner status note already states these.
      return undefined;
    case 'no-snapshot':
      return statusExplained
        ? undefined
        : { tone: 'neutral', text: 'No limit data for this account' };
    case 'lookup-failed':
      return {
        tone: 'neutral',
        text:
          reason.failure === 'timed-out'
            ? 'Limit lookup timed out'
            : 'Limit lookup failed',
      };
    case 'no-windows':
      return statusExplained
        ? undefined
        : { tone: 'neutral', text: 'No windows reported' };
    case 'window-set-not-established':
      return {
        tone: 'neutral',
        text: 'Window set not established, partial data',
      };
    case 'model-scope-unknown':
      return {
        tone: 'info',
        text: 'Model unknown · model-specific limits are not applied',
      };
    case 'cooldown-active':
      return { tone: 'neutral', text: 'Cooldown active' };
    case 'estimated-limit':
      return {
        tone: 'info',
        text: 'A local estimate suggests a limit · not confirmed',
      };
    case 'window-state':
      return {
        tone: 'neutral',
        text: `${reason.window.label}: ${WINDOW_STATE_REASONS[reason.state]}`,
      };
  }
}

const FACE_ORDER: readonly LaneLimitState[] = [
  'at-limit',
  'near-limit',
  'unknown',
  'confirmed-room',
];

/**
 * The face: one chip per distinct face chip (a state, or a last-known
 * value), in state order, with affected-run wording when there are several.
 */
function laneFaceChips(
  subgroups: readonly EvaluatedSubgroup[],
  total: number,
): LaneFaceChipModel[] {
  const byChip = new Map<
    string,
    {
      state: LaneLimitState;
      chip: StatsChip;
      runs: StatsLimitLaneRun[];
      sources: Set<string>;
    }
  >();
  for (const group of subgroups) {
    const entry = byChip.get(group.chip.text) ?? {
      state: group.state,
      chip: group.chip,
      runs: [],
      sources: new Set<string>(),
    };
    entry.runs.push(...group.runs);
    group.faceSources.forEach((source) => entry.sources.add(source));
    byChip.set(group.chip.text, entry);
  }
  return [...byChip.values()]
    .sort((a, b) => FACE_ORDER.indexOf(a.state) - FACE_ORDER.indexOf(b.state))
    .map((entry) => {
      const models = entry.runs.map((run) => run.model || 'unknown model');
      const text =
        byChip.size > 1
          ? `${entry.chip.text} · ${entry.runs.length} of ${total} runs (${models.join(', ')})`
          : entry.chip.text;
      return {
        chip: { ...entry.chip, text },
        sourceChips: [...entry.sources],
      };
    });
}

// ------------------------------------------------------------- run usage

const STATUS_WORDS: Readonly<Record<AgentStatus, string>> = {
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  timeout: 'timed out',
  stopped: 'stopped',
};

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function runState(run: StatsLimitLaneRun): string {
  if (run.restored) return `Restored · ${STATUS_WORDS[run.status]}`;
  if (run.status === 'running') return 'Live · running';
  if (run.failureKind === 'quota') return 'Quota failure';
  return capitalise(STATUS_WORDS[run.status]);
}

function laneRunChip(runs: readonly StatsLimitLaneRun[]): StatsChip {
  const running = runs.filter((run) => run.status === 'running').length;
  if (running > 0) {
    return {
      tone: 'live',
      text:
        runs.length > 1
          ? `Live · ${running} of ${runs.length} running`
          : 'Live · running',
    };
  }
  if (runs.some((run) => run.failureKind === 'quota')) {
    return { tone: 'error', glyph: '■', text: 'Quota failure' };
  }
  const statuses = new Set(runs.map((run) => run.status));
  const word = statuses.size === 1 ? STATUS_WORDS[runs[0].status] : 'finished';
  return runs.every((run) => run.restored)
    ? { tone: 'neutral', text: `Restored · ${word}` }
    : { tone: 'neutral', text: capitalise(word) };
}

function runRow(
  run: StatsLimitLaneRun,
  index: number,
  count: number,
  ctx: Ctx,
): LaneRunRowModel {
  const tokens = runTokens(run);
  const cost = runCost(run);
  return {
    runId: run.runId,
    label: count > 1 ? `Run ${index + 1}` : 'Run',
    model: run.model || 'unknown',
    tokensText: tokens === undefined ? 'unknown' : formatTokenCount(tokens),
    costText: cost === undefined ? 'unknown' : formatCost(cost),
    stateText: runState(run),
    ...(run.restored && {
      startedText: `started ${formatLocalAbsolute(run.startedAt, ctx.now, ctx.time)}`,
    }),
  };
}

function finite(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** Total tokens of a run; unknown when the totals or a needed field are. */
function runTokens(run: StatsLimitLaneRun): number | undefined {
  const totals = run.usageTotals;
  if (totals == null) return undefined;
  const total = finite(totals.totalTokens);
  if (total !== undefined) return total;
  const input = finite(totals.inputTokens);
  const output = finite(totals.outputTokens);
  return input !== undefined && output !== undefined
    ? input + output
    : undefined;
}

/** Cost of a run in USD; unknown when the totals or the cost are. */
function runCost(run: StatsLimitLaneRun): number | undefined {
  return run.usageTotals == null ? undefined : finite(run.usageTotals.costUsd);
}

function isNumber(value: number | undefined): value is number {
  return value !== undefined;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function subtotalTile(
  runs: readonly StatsLimitLaneRun[],
  laneCount: number,
): LaneSubtotalTileModel {
  const tokens = runs.map(runTokens).filter(isNumber);
  const costs = runs.map(runCost).filter(isNumber);
  const unknownCosts = runs.length - costs.length;
  return {
    id: LANES_SUBTOTAL_TILE_ID,
    caption: LANE_CAPTION,
    tokensText: `${formatTokenCount(sum(tokens))} tokens known`,
    summary:
      `${formatCost(sum(costs))} known cost · ${plural(laneCount, 'lane')} · ` +
      `${plural(runs.length, 'run')} · ${unknownCosts} cost unknown`,
  };
}
