/**
 * Session plan tiles of the stats grid (TASK_2026_596, Component 15; design
 * §3.2): the session owner's applicable windows, its status, owner-level
 * evidence and active cooldown, plus the collapsed indicator. The window,
 * evidence and cooldown formatters here are also used for a lane's full
 * detail. Every state comes from the shared engine.
 */
import {
  activeWindowExhaustion,
  applicableLimits,
  classifyLaneState,
  classifyOwnerEvidence,
  formatLocalAbsolute,
  formatLocalWithRelative,
  formatRelative,
  formatSourceChips,
  formatUsed,
  isActiveLimitEvidence,
  ownerDisplayLabel,
  PLAN_LIMIT_SOURCE_LABELS,
  resetPassage,
  usedPercent,
  windowObservedAt,
  type ApplicableLimits,
  type ClassifiedWindow,
  type LaneStateResult,
  type OwnerLimitEvidence,
  type PlanLimitCooldown,
  type PlanLimitOwnerSnapshot,
  type PlanWindowKey,
  type PlanWindowState,
  type QuotaOwnerRef,
} from '@ptah-extension/shared';
import type {
  PlanLimitTileModel,
  PlanWindowDetailModel,
  StatsChip,
  StatsLimitContext as Ctx,
  StatsLimitIndicator,
  StatsLimitViewModelInput,
  StatsTileTone,
} from './stats-limit-view-model.types';

// ----------------------------------------------------------- session plan

export interface SessionPlan {
  readonly owner?: QuotaOwnerRef;
  readonly tiles: readonly PlanLimitTileModel[];
  readonly indicator?: StatsLimitIndicator;
  /** Windows a plan tile renders (A2), keyed by window key. */
  readonly renderedWindows: ReadonlyMap<PlanWindowKey, ClassifiedWindow>;
  readonly renderedEvidence: ReadonlySet<OwnerLimitEvidence>;
}

export function sessionPlan(
  input: StatsLimitViewModelInput,
  ctx: Ctx,
): SessionPlan {
  const empty = {
    renderedWindows: new Map<PlanWindowKey, ClassifiedWindow>(),
    renderedEvidence: new Set<OwnerLimitEvidence>(),
  };
  if (input.sessionOwnerKey === null) {
    return {
      ...empty,
      tiles: [
        unavailableTile('plan-status:none', 'Usage', 'owner not resolved', [
          "This session's account is not resolved yet; no other account's limits are shown.",
        ]),
      ],
    };
  }
  const snapshot = input.owners.find(
    (entry) => entry.owner.key === input.sessionOwnerKey,
  );
  if (!snapshot) {
    return {
      ...empty,
      tiles: [
        unavailableTile(
          `plan-status:${input.sessionOwnerKey}`,
          'Usage',
          'no usage data',
          ["No usage data is available for this session's account."],
        ),
      ],
    };
  }
  const limits = applicableLimits(snapshot, input.sessionModelScope);
  const result = classifyLaneState(limits, ctx.lane);
  // The suffixed owner label ("Claude account · a1b2") so two owners of one
  // provider are told apart in the tile captions.
  const caption = `${ownerDisplayLabel(snapshot.owner)} plan limit`;
  const tiles: PlanLimitTileModel[] = [
    ...statusTiles(snapshot, result.windows.length, caption, ctx),
    ...result.windows.map((entry) => windowTile(snapshot, entry, caption, ctx)),
    ...limits.ownerEvidence.map((evidence) =>
      evidenceTile(snapshot.owner, evidence, caption, ctx),
    ),
  ];
  const cooldown = activeCooldown(limits, ctx.now);
  if (cooldown)
    tiles.push(cooldownTile(snapshot.owner, cooldown, caption, ctx));
  const indicator = indicatorFor(result, ctx);
  return {
    owner: snapshot.owner,
    tiles,
    ...(indicator && { indicator }),
    renderedWindows: new Map(
      result.windows.map((entry) => [entry.window.key, entry]),
    ),
    renderedEvidence: new Set(limits.ownerEvidence),
  };
}

function statusTiles(
  snapshot: PlanLimitOwnerSnapshot,
  windowCount: number,
  caption: string,
  ctx: Ctx,
): PlanLimitTileModel[] {
  const id = `plan-status:${snapshot.owner.key}`;
  if (snapshot.status === 'stale') {
    const since =
      snapshot.staleSince === undefined
        ? undefined
        : formatLocalAbsolute(snapshot.staleSince, ctx.now, ctx.time);
    return [
      {
        id,
        kind: 'status',
        label: 'Usage',
        caption,
        value: 'Stale',
        resetLine: since
          ? `cached data · refresh failed ${since}`
          : 'cached data · refresh failed',
        chip: { tone: 'neutral', glyph: '◷', text: 'Stale' },
        tone: 'neutral',
        sourceChips: [],
        detailLines: [
          `Showing cached account data; refresh failed${since ? ` at ${since}` : ''}.`,
          'Each window keeps its own Aged state; an active live limit is still shown.',
        ],
      },
    ];
  }
  if (snapshot.status === 'no-usage-source') {
    return [
      {
        id,
        kind: 'status',
        label: 'Usage',
        caption,
        value: 'No usage source',
        resetLine: 'plan usage is not reported',
        tone: 'neutral',
        sourceChips: [],
        detailLines: [
          `${ownerDisplayLabel(snapshot.owner)} does not report plan usage, so no percentage is shown.`,
        ],
      },
    ];
  }
  if (snapshot.status === 'available' || windowCount > 0) return [];
  const reason =
    snapshot.unavailableReason === 'no-open-session'
      ? 'no open session'
      : snapshot.status;
  return [
    {
      ...unavailableTile(id, 'Usage', reason, [
        `Plan usage could not be read (${reason}).`,
      ]),
      caption,
    },
  ];
}

function unavailableTile(
  id: string,
  label: string,
  resetLine: string,
  detailLines: readonly string[],
): PlanLimitTileModel {
  return {
    id,
    kind: 'status',
    label,
    caption: 'plan limit',
    value: 'Unavailable',
    resetLine,
    tone: 'neutral',
    sourceChips: [],
    detailLines,
  };
}

function windowTile(
  snapshot: PlanLimitOwnerSnapshot,
  entry: ClassifiedWindow,
  caption: string,
  ctx: Ctx,
): PlanLimitTileModel {
  const detail = windowDetail(entry, snapshot, ctx);
  const chip = detail.chip;
  return {
    id: `plan:${snapshot.owner.key}:${entry.window.key}`,
    kind: 'window',
    label: entry.window.label,
    caption,
    value: detail.usedText,
    resetLine: windowResetLine(entry, ctx),
    ...(chip && { chip }),
    tone: windowTone(entry.state),
    sourceChips: detail.sourceChips,
    window: detail,
    detailLines: [],
  };
}

function evidenceTile(
  owner: QuotaOwnerRef,
  evidence: OwnerLimitEvidence,
  caption: string,
  ctx: Ctx,
): PlanLimitTileModel {
  const scope = evidence.modelScope?.trim().toLowerCase();
  const active = isActiveLimitEvidence(evidence, ctx.now);
  const expired = classifyOwnerEvidence(evidence, ctx.now) === 'expired';
  const chip: StatsChip = active
    ? { tone: 'error', glyph: '■', text: 'At limit' }
    : expired
      ? { tone: 'neutral', glyph: '↻', text: 'Expired' }
      : { tone: 'neutral', glyph: '~', text: 'Estimate only' };
  const resetLine = `window unknown · ${evidenceReset(evidence, expired, ctx)}`;
  return {
    id: `plan-evidence:${owner.key}${scope ? `:${scope}` : ''}`,
    kind: 'evidence',
    label: scope ? `Limit hit · ${scope}` : 'Limit hit',
    caption,
    value: active
      ? 'At limit'
      : expired
        ? 'Limit hit · expired'
        : 'Limit hit · estimate',
    resetLine,
    chip,
    tone: active ? 'error' : 'neutral',
    sourceChips: evidenceSources(evidence),
    detailLines: [evidenceLine(evidence, ctx)],
  };
}

function cooldownTile(
  owner: QuotaOwnerRef,
  cooldown: PlanLimitCooldown,
  caption: string,
  ctx: Ctx,
): PlanLimitTileModel {
  return {
    id: `plan-cooldown:${owner.key}`,
    kind: 'cooldown',
    label: 'Cooldown',
    caption,
    value: `until ${formatLocalAbsolute(cooldown.until, ctx.now, ctx.time)}`,
    resetLine: 'retry delay, not a plan reset',
    chip: { tone: 'info', text: 'Cooldown' },
    tone: 'info',
    sourceChips: [],
    detailLines: [cooldownLine(cooldown, ctx)],
  };
}

function indicatorFor(
  result: LaneStateResult,
  ctx: Ctx,
): StatsLimitIndicator | undefined {
  if (result.state !== 'at-limit' && result.state !== 'near-limit') {
    return undefined;
  }
  const reason = result.reasons[0];
  const at = (instant: number | undefined) =>
    instant === undefined
      ? 'reset unknown'
      : `resets ${formatLocalAbsolute(instant, ctx.now, ctx.time)}`;
  let text: string;
  if (reason?.kind === 'owner-limit') {
    text = `At limit · window unknown · ${at(reason.evidence.resetsAt)}`;
  } else if (reason?.kind === 'window-limit') {
    text = `At limit · ${reason.window.label} · ${at(reason.evidence.resetsAt)}`;
  } else if (reason?.kind === 'window-near-limit') {
    const used = formatUsed(reason.window.used);
    text = `Near · ${reason.window.label} ${used} · ${at(reason.window.resetsAt)}`;
  } else {
    text = result.state === 'at-limit' ? 'At limit' : 'Near limit';
  }
  return result.state === 'at-limit'
    ? { state: 'at-limit', tone: 'error', text }
    : { state: 'near-limit', tone: 'warning', text };
}

// ---------------------------------------------------------------- windows

export function windowChip(state: PlanWindowState): StatsChip | undefined {
  switch (state) {
    case 'limit-reached':
      return { tone: 'error', glyph: '■', text: 'Limit reached' };
    case 'near-limit':
      return { tone: 'warning', glyph: '▲', text: 'Near limit' };
    case 'aged':
      return { tone: 'neutral', glyph: '◷', text: 'Aged' };
    case 'usage-unknown':
      return { tone: 'neutral', glyph: '?', text: 'Usage unknown' };
    case 'reset-usage-unknown':
      return { tone: 'neutral', glyph: '↻', text: 'Reset · usage unknown' };
    case 'estimate-only':
      return { tone: 'neutral', glyph: '~', text: 'Estimate only' };
    case 'not-confirmed':
      return { tone: 'neutral', glyph: '?', text: 'Not confirmed' };
    case 'ok':
      return undefined;
  }
}

function windowTone(state: PlanWindowState): StatsTileTone {
  if (state === 'limit-reached') return 'error';
  return state === 'near-limit' ? 'warning' : 'neutral';
}

/** The window with its used value dropped when a reset invalidated it. */
function shownWindow(entry: ClassifiedWindow): ClassifiedWindow['window'] {
  return entry.state === 'reset-usage-unknown'
    ? { ...entry.window, used: undefined }
    : entry.window;
}

export function windowDetail(
  entry: ClassifiedWindow,
  snapshot: PlanLimitOwnerSnapshot,
  ctx: Ctx,
): PlanWindowDetailModel {
  const shown = shownWindow(entry);
  const formatted = formatUsed(shown.used);
  const percent = usedPercent(shown.used);
  const chip = windowChip(entry.state);
  const note = windowNote(entry, snapshot, ctx);
  return {
    windowKey: entry.window.key,
    label: entry.window.label,
    state: entry.state,
    ...(chip && { chip }),
    usedText:
      formatted === 'unknown' || shown.used?.kind !== 'percent'
        ? formatted
        : `${formatted} used`,
    ...(percent !== undefined && { percent }),
    resetFacts: windowResetFacts(entry, ctx),
    ...(note && { note }),
    sourceChips: formatSourceChips(shown),
  };
}

function windowNote(
  entry: ClassifiedWindow,
  snapshot: PlanLimitOwnerSnapshot,
  ctx: Ctx,
): string | undefined {
  if (entry.state === 'aged') {
    const observed = formatRelative(windowObservedAt(entry.window), ctx.now);
    return `${snapshot.status === 'stale' ? 'cached, ' : ''}observed ${observed}`;
  }
  return entry.state === 'not-confirmed'
    ? 'last reset unknown: freshness cannot be confirmed'
    : undefined;
}

function withRelative(instant: number, ctx: Ctx): string {
  return formatLocalWithRelative(instant, ctx.now, ctx.time);
}

function plainReset(resetsAt: number | undefined, ctx: Ctx): string {
  if (resetsAt === undefined) return 'reset unknown';
  return resetsAt > ctx.now
    ? `resets ${withRelative(resetsAt, ctx)}`
    : `reset ${withRelative(resetsAt, ctx)} passed`;
}

function windowResetLine(entry: ClassifiedWindow, ctx: Ctx): string {
  const { window, state } = entry;
  if (state === 'limit-reached') {
    const resetsAt = activeWindowExhaustion(window, ctx.now)?.resetsAt;
    return resetsAt === undefined
      ? 'Limit reached · reset unknown'
      : `Limit reached · resets ${withRelative(resetsAt, ctx)}`;
  }
  const passage = resetPassage(window, ctx.now);
  if (state === 'reset-usage-unknown' && passage) {
    const passed = formatLocalAbsolute(passage.passedAt, ctx.now, ctx.time);
    const next =
      passage.nextResetAt === undefined
        ? 'unknown'
        : withRelative(passage.nextResetAt, ctx);
    return `reset ${passed} passed · next ${next}`;
  }
  const base = plainReset(window.resetsAt, ctx);
  if (state === 'aged') {
    return `${base} · observed ${formatRelative(windowObservedAt(window), ctx.now)}`;
  }
  return state === 'not-confirmed' ? `${base} · last reset unknown` : base;
}

function windowResetFacts(entry: ClassifiedWindow, ctx: Ctx): string[] {
  const { window, state } = entry;
  if (state === 'limit-reached') {
    const resetsAt = activeWindowExhaustion(window, ctx.now)?.resetsAt;
    return [
      resetsAt === undefined
        ? 'Limit reached — reset unknown'
        : `Limit reached — resets ${withRelative(resetsAt, ctx)}`,
    ];
  }
  const passage = resetPassage(window, ctx.now);
  if (state === 'reset-usage-unknown' && passage) {
    const observed = formatLocalAbsolute(
      passage.lastObservedAt,
      ctx.now,
      ctx.time,
    );
    return [
      `Reset ${withRelative(passage.passedAt, ctx)} came after the last observation (${observed}): current usage unknown`,
      passage.nextResetAt === undefined
        ? 'Next reset unknown'
        : `Next reset ${withRelative(passage.nextResetAt, ctx)}`,
    ];
  }
  const reset = plainReset(window.resetsAt, ctx);
  return [reset.charAt(0).toUpperCase() + reset.slice(1)];
}

// --------------------------------------------------- evidence and cooldown

function evidenceReset(
  evidence: OwnerLimitEvidence,
  expired: boolean,
  ctx: Ctx,
): string {
  if (evidence.resetsAt === undefined) return 'reset unknown';
  return expired
    ? `reset ${formatLocalAbsolute(evidence.resetsAt, ctx.now, ctx.time)} passed`
    : `resets ${withRelative(evidence.resetsAt, ctx)}`;
}

export function evidenceSources(evidence: OwnerLimitEvidence): string[] {
  const limit = PLAN_LIMIT_SOURCE_LABELS[evidence.source];
  if (
    evidence.resetsAt === undefined ||
    evidence.resetSource === undefined ||
    evidence.resetSource === evidence.source
  ) {
    return [limit];
  }
  return [
    `limit ${limit}`,
    `reset ${PLAN_LIMIT_SOURCE_LABELS[evidence.resetSource]}`,
  ];
}

export function evidenceLine(evidence: OwnerLimitEvidence, ctx: Ctx): string {
  const expired = classifyOwnerEvidence(evidence, ctx.now) === 'expired';
  const hit = formatLocalAbsolute(evidence.observedAt, ctx.now, ctx.time);
  const scope = evidence.modelScope ? ` (${evidence.modelScope} only)` : '';
  const state = isActiveLimitEvidence(evidence, ctx.now)
    ? ''
    : expired
      ? ' · expired'
      : ' · estimate, not confirmed';
  return (
    `Limit hit ${hit}${scope} · window unknown · ` +
    `${evidenceReset(evidence, expired, ctx)}${state} · ` +
    evidenceSources(evidence).join(', ')
  );
}

export function activeCooldown(
  limits: ApplicableLimits,
  now: number,
): PlanLimitCooldown | undefined {
  return limits.cooldown && limits.cooldown.until > now
    ? limits.cooldown
    : undefined;
}

export function cooldownLine(cooldown: PlanLimitCooldown, ctx: Ctx): string {
  return `Cooldown · retrying after ${withRelative(cooldown.until, ctx)} · a retry delay, not a plan reset`;
}
