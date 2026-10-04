/**
 * Plan-limit lane state and owner relation (TASK_2026_596, Decisions 1 and
 * 3; design §2.2; Req 4.5, Req 5).
 *
 * Decides which windows and evidence of an owner apply to one model scope,
 * how two quota owners relate, and which of the four mutually exclusive
 * limit states a lane is in. Pure and clock-free: `now` comes in the context.
 */
import type {
  OwnerLimitEvidence,
  PlanLimitCooldown,
  PlanLimitOwnerSnapshot,
  PlanLimitWindow,
  PlanWindowKey,
  QuotaOwnerRef,
} from '../../types/plan-limit.types';
import type { ProviderAccountUsageStatus } from '../../types/rpc/rpc-providers.types';
import {
  activeEstimatedExhaustion,
  activeWindowExhaustion,
  classifyOwnerEvidence,
  classifyWindow,
  isActiveLimitEvidence,
  type PlanLimitStateContext,
  type PlanWindowState,
} from './window-state';

const WEEKLY_MODEL_PREFIX = 'weekly_model:';

/** How two quota owners relate. Only `same` allows sharing evidence. */
export type OwnerRelation = 'same' | 'different' | 'unknown';

/**
 * Relation of two quota owners (Decision 3, design A1):
 *
 * - `same` only when both identity kinds are known, the kinds are equal and
 *   the keys are equal.
 * - `different` when both are known and the providers differ, or the kinds
 *   are equal and the keys differ.
 * - `unknown` otherwise: either side missing, either kind `unknown` (even
 *   with equal keys), or two known kinds that differ for one provider.
 */
export function ownerRelation(
  a: QuotaOwnerRef | null | undefined,
  b: QuotaOwnerRef | null | undefined,
): OwnerRelation {
  if (!a || !b) return 'unknown';
  if (a.identityKind === 'unknown' || b.identityKind === 'unknown') {
    return 'unknown';
  }
  if (a.providerId !== b.providerId) return 'different';
  if (a.identityKind !== b.identityKind) return 'unknown';
  return a.key === b.key ? 'same' : 'different';
}

function normaliseScope(scope: string | null | undefined): string | undefined {
  const trimmed = scope?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

/**
 * The model scope a window is limited to: its declared scope, else the scope
 * carried by a `weekly_model:<scope>` key. `undefined` covers every model.
 */
export function windowModelScope(window: {
  readonly key: PlanWindowKey;
  readonly modelScope?: string;
}): string | undefined {
  const declared = normaliseScope(window.modelScope);
  if (declared !== undefined) return declared;
  return window.key.startsWith(WEEKLY_MODEL_PREFIX)
    ? normaliseScope(window.key.slice(WEEKLY_MODEL_PREFIX.length))
    : undefined;
}

function appliesToScope(
  limitScope: string | undefined,
  modelScope: string | undefined,
): boolean {
  return limitScope === undefined || limitScope === modelScope;
}

/**
 * The windows of `owner` that apply to `modelScope` (Req 4.5). An unscoped
 * window applies to every model; a model-scoped window (`weekly_model:opus`)
 * applies only to the same scope, so an Opus-only exhaustion never touches a
 * Sonnet lane. A `null` scope matches unscoped windows only.
 */
export function applicableWindows(
  owner: Pick<PlanLimitOwnerSnapshot, 'windows'>,
  modelScope: string | null | undefined,
): readonly PlanLimitWindow[] {
  const scope = normaliseScope(modelScope);
  return owner.windows.filter((window) =>
    appliesToScope(windowModelScope(window), scope),
  );
}

/** Owner-level evidence that applies to `modelScope`, by the same rule. */
export function applicableOwnerEvidence(
  owner: Pick<PlanLimitOwnerSnapshot, 'ownerEvidence'>,
  modelScope: string | null | undefined,
): readonly OwnerLimitEvidence[] {
  const scope = normaliseScope(modelScope);
  return owner.ownerEvidence.filter((evidence) =>
    appliesToScope(normaliseScope(evidence.modelScope), scope),
  );
}

/** Everything of one owner that bears on a lane running `modelScope`. */
export interface ApplicableLimits {
  readonly status: ProviderAccountUsageStatus;
  readonly windowSetEstablished: boolean;
  readonly windows: readonly PlanLimitWindow[];
  readonly ownerEvidence: readonly OwnerLimitEvidence[];
  readonly cooldown?: PlanLimitCooldown;
}

/**
 * Narrow an owner snapshot to one model scope. The snapshot must be the
 * lane's own owner; evidence is never borrowed from another owner.
 */
export function applicableLimits(
  owner: PlanLimitOwnerSnapshot,
  modelScope: string | null | undefined,
): ApplicableLimits {
  return {
    status: owner.status,
    windowSetEstablished: owner.windowSetEstablished,
    windows: applicableWindows(owner, modelScope),
    ownerEvidence: applicableOwnerEvidence(owner, modelScope),
    cooldown: owner.cooldown,
  };
}

/** Lane state, design §2.2: mutually exclusive, evaluated in this order. */
export type LaneLimitState =
  'at-limit' | 'near-limit' | 'confirmed-room' | 'unknown';

/** Why the limit lookup for a lane produced no snapshot. */
export type LaneLookupFailure = 'timed-out' | 'failed';

/** Window states that keep a lane from confirmed room. */
export type PlanWindowBlockingState = Exclude<
  PlanWindowState,
  'ok' | 'near-limit' | 'limit-reached'
>;

/** One reason behind a lane state; formatted by the caller's surface. */
export type LaneStateReason =
  | { readonly kind: 'owner-limit'; readonly evidence: OwnerLimitEvidence }
  | {
      readonly kind: 'window-limit';
      readonly window: PlanLimitWindow;
      readonly evidence: OwnerLimitEvidence;
    }
  | { readonly kind: 'window-near-limit'; readonly window: PlanLimitWindow }
  | { readonly kind: 'lookup-failed'; readonly failure: LaneLookupFailure }
  | { readonly kind: 'no-snapshot' }
  | { readonly kind: 'no-usage-source' }
  | {
      readonly kind: 'status';
      readonly status: Exclude<
        ProviderAccountUsageStatus,
        'available' | 'stale' | 'no-usage-source'
      >;
    }
  | { readonly kind: 'stale' }
  | { readonly kind: 'no-windows' }
  | { readonly kind: 'window-set-not-established' }
  | { readonly kind: 'cooldown-active'; readonly cooldown: PlanLimitCooldown }
  | { readonly kind: 'estimated-limit'; readonly evidence: OwnerLimitEvidence }
  | {
      readonly kind: 'window-state';
      readonly window: PlanLimitWindow;
      readonly state: PlanWindowBlockingState;
    };

/** A window together with its state at evaluation time. */
export interface ClassifiedWindow {
  readonly window: PlanLimitWindow;
  readonly state: PlanWindowState;
}

export interface LaneStateResult {
  readonly state: LaneLimitState;
  /**
   * What put the lane in this state: the limit hits for `at-limit`, the near
   * windows for `near-limit`, every blocking reason for `unknown`, nothing for
   * `confirmed-room`.
   */
  readonly reasons: readonly LaneStateReason[];
  /** Every applicable window with its state, in snapshot order. */
  readonly windows: readonly ClassifiedWindow[];
}

/** Lane context: the window context plus a failed lookup, if any. */
export interface LaneStateContext extends Omit<
  PlanLimitStateContext,
  'status'
> {
  readonly lookupFailure?: LaneLookupFailure;
}

function windowBlockingReason(
  entry: ClassifiedWindow,
): LaneStateReason | undefined {
  const { window, state } = entry;
  switch (state) {
    case 'ok':
    case 'near-limit':
    case 'limit-reached':
      return undefined;
    default:
      return { kind: 'window-state', window, state };
  }
}

function statusReason(
  status: ProviderAccountUsageStatus,
): LaneStateReason | undefined {
  switch (status) {
    case 'available':
      return undefined;
    case 'stale':
      return { kind: 'stale' };
    case 'no-usage-source':
      return { kind: 'no-usage-source' };
    default:
      return { kind: 'status', status };
  }
}

function unknownReasons(
  limits: ApplicableLimits,
  windows: readonly ClassifiedWindow[],
  ctx: LaneStateContext,
): LaneStateReason[] {
  const reasons: LaneStateReason[] = [];
  const push = (reason: LaneStateReason | undefined): void => {
    if (reason !== undefined) reasons.push(reason);
  };

  if (ctx.lookupFailure !== undefined) {
    push({ kind: 'lookup-failed', failure: ctx.lookupFailure });
  }
  push(statusReason(limits.status));
  if (windows.length === 0) push({ kind: 'no-windows' });
  else if (!limits.windowSetEstablished) {
    push({ kind: 'window-set-not-established' });
  }
  if (limits.cooldown !== undefined && limits.cooldown.until > ctx.now) {
    push({ kind: 'cooldown-active', cooldown: limits.cooldown });
  }
  for (const evidence of limits.ownerEvidence) {
    if (
      evidence.source === 'estimated' &&
      classifyOwnerEvidence(evidence, ctx.now) === 'active'
    ) {
      push({ kind: 'estimated-limit', evidence });
    }
  }
  for (const entry of windows) {
    const estimated = activeEstimatedExhaustion(entry.window, ctx.now);
    if (estimated !== undefined) {
      push({ kind: 'estimated-limit', evidence: estimated });
    }
    push(windowBlockingReason(entry));
  }
  return reasons;
}

/**
 * Classify a lane (design §2.2, Req 5). First match wins:
 *
 * 1. `at-limit` — active non-estimated owner-level evidence, or any
 *    applicable window "Limit reached".
 * 2. `near-limit` — any applicable window "Near limit". A partial event can
 *    establish this; it can never establish room.
 * 3. `confirmed-room` — the lookup succeeded, status `available`, the window
 *    set is established by a full-table read and non-empty, every applicable
 *    window is `ok`, no active cooldown and no active estimated limit.
 * 4. `unknown` — everything else, always with at least one reason.
 *
 * `limits` is `undefined` when there is no snapshot for the lane's own owner;
 * the lane is then unknown and borrows nothing.
 */
export function classifyLaneState(
  limits: ApplicableLimits | undefined,
  ctx: LaneStateContext,
): LaneStateResult {
  if (limits === undefined) {
    const reasons: LaneStateReason[] =
      ctx.lookupFailure !== undefined
        ? [{ kind: 'lookup-failed', failure: ctx.lookupFailure }]
        : [{ kind: 'no-snapshot' }];
    return { state: 'unknown', reasons, windows: [] };
  }

  const windowCtx: PlanLimitStateContext = { ...ctx, status: limits.status };
  const windows: ClassifiedWindow[] = limits.windows.map((window) => ({
    window,
    state: classifyWindow(window, windowCtx),
  }));

  const limitReasons: LaneStateReason[] = [];
  for (const evidence of limits.ownerEvidence) {
    if (isActiveLimitEvidence(evidence, ctx.now)) {
      limitReasons.push({ kind: 'owner-limit', evidence });
    }
  }
  for (const { window, state } of windows) {
    const evidence =
      state === 'limit-reached'
        ? activeWindowExhaustion(window, ctx.now)
        : undefined;
    if (evidence !== undefined) {
      limitReasons.push({ kind: 'window-limit', window, evidence });
    }
  }
  if (limitReasons.length > 0) {
    return { state: 'at-limit', reasons: limitReasons, windows };
  }

  const nearReasons: LaneStateReason[] = windows
    .filter((entry) => entry.state === 'near-limit')
    .map((entry) => ({ kind: 'window-near-limit', window: entry.window }));
  if (nearReasons.length > 0) {
    return { state: 'near-limit', reasons: nearReasons, windows };
  }

  const reasons = unknownReasons(limits, windows, ctx);
  return reasons.length === 0
    ? { state: 'confirmed-room', reasons, windows }
    : { state: 'unknown', reasons, windows };
}

/** Lanes grouped for the "Alternatives by limit state" section (design §5). */
export interface LaneAlternatives<T> {
  readonly confirmedRoom: readonly T[];
  readonly nearLimit: readonly T[];
  readonly unknown: readonly T[];
  readonly atLimit: readonly T[];
}

/**
 * Group rows into the four alternatives lists, keeping input order inside
 * each group. Near-limit and unknown rows never land in confirmed room.
 */
export function groupAlternatives<T extends { readonly state: LaneLimitState }>(
  rows: readonly T[],
): LaneAlternatives<T> {
  const confirmedRoom: T[] = [];
  const nearLimit: T[] = [];
  const unknown: T[] = [];
  const atLimit: T[] = [];
  for (const row of rows) {
    switch (row.state) {
      case 'confirmed-room':
        confirmedRoom.push(row);
        break;
      case 'near-limit':
        nearLimit.push(row);
        break;
      case 'at-limit':
        atLimit.push(row);
        break;
      default:
        unknown.push(row);
    }
  }
  return { confirmedRoom, nearLimit, unknown, atLimit };
}
