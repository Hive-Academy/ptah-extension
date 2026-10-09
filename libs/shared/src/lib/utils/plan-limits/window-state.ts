/**
 * Plan-limit window state (TASK_2026_596, Decision 1; design §2.1).
 *
 * Classifies one plan window, and one piece of owner-level limit evidence,
 * against an injected clock. Pure: nothing here reads the system clock, so
 * every state is reproducible under test and the webview can re-evaluate the
 * same snapshot as time passes without a new push.
 */
import type {
  OwnerLimitEvidence,
  PlanLimitUsed,
  PlanLimitWindow,
} from '../../types/plan-limit.types';
import type { ProviderAccountUsageStatus } from '../../types/rpc/rpc-providers.types';

/**
 * State of one window, design §2.1. `classifyWindow` returns the first that
 * matches, in this order.
 */
export type PlanWindowState =
  | 'limit-reached'
  | 'reset-usage-unknown'
  | 'usage-unknown'
  | 'estimate-only'
  | 'aged'
  | 'not-confirmed'
  | 'near-limit'
  | 'ok';

/** The clock and thresholds a classification is evaluated against. */
export interface PlanLimitStateContext {
  /** Evaluation instant, epoch ms UTC. */
  readonly now: number;
  /** Percent used at or above which a fresh window is "near limit" (P3). */
  readonly nearLimitPercent: number;
  /** Values observed longer ago than this are aged (P9). */
  readonly freshnessMs: number;
  /** Provider status of the owner snapshot the window belongs to. */
  readonly status: ProviderAccountUsageStatus;
}

/** Whether a piece of limit evidence still holds at `now`. */
export type OwnerEvidenceState = 'active' | 'expired';

/**
 * The reset that invalidated a window's last observation, kept apart from
 * the next reset (design §2.1 rule 2).
 */
export interface PlanWindowResetPassage {
  /** The reset that came after the last observation. */
  readonly passedAt: number;
  /** The next reset, when one is known and still ahead. */
  readonly nextResetAt?: number;
  /** The observation that the passed reset invalidated. */
  readonly lastObservedAt: number;
}

/**
 * Evidence holds until its reset; evidence with no reset holds until a newer
 * record clears it (the ledger's job, Decision 4), so it is always active
 * here.
 */
export function classifyOwnerEvidence(
  evidence: OwnerLimitEvidence,
  now: number,
): OwnerEvidenceState {
  return evidence.resetsAt === undefined || evidence.resetsAt > now
    ? 'active'
    : 'expired';
}

/**
 * The single "does this evidence count as a limit" test shared by the window
 * state, the lane state and every surface: active and not `estimated`.
 */
export function isActiveLimitEvidence(
  evidence: OwnerLimitEvidence,
  now: number,
): boolean {
  return (
    evidence.source !== 'estimated' &&
    classifyOwnerEvidence(evidence, now) === 'active'
  );
}

/**
 * The instant the window's used value was observed: the per-field instant
 * when the source recorded one, otherwise the window's observation instant.
 */
export function windowObservedAt(window: PlanLimitWindow): number {
  return window.usedObservedAt ?? window.observedAt;
}

/**
 * Percent used, or `undefined` when the value is unknown or cannot be turned
 * into a percent (non-finite, or an amount with no positive limit). Never 0
 * for an unknown value.
 */
export function usedPercent(
  used: PlanLimitUsed | undefined,
): number | undefined {
  if (used === undefined) return undefined;
  if (used.kind === 'percent') {
    return Number.isFinite(used.percent) ? used.percent : undefined;
  }
  if (!Number.isFinite(used.amount) || !Number.isFinite(used.limit)) {
    return undefined;
  }
  return used.limit > 0 ? (used.amount / used.limit) * 100 : undefined;
}

/**
 * The window's exhaustion, with its effective reset: the exhaustion's own
 * reset, else the window's reset when that reset comes after the exhaustion
 * was observed (an older window reset cannot clear a newer limit hit).
 */
function windowExhaustion(
  window: PlanLimitWindow,
): OwnerLimitEvidence | undefined {
  const exhaustion = window.exhaustion;
  if (exhaustion === undefined || exhaustion.resetsAt !== undefined) {
    return exhaustion;
  }
  const windowReset = window.resetsAt;
  return windowReset !== undefined && windowReset > exhaustion.observedAt
    ? { ...exhaustion, resetsAt: windowReset, resetSource: window.resetSource }
    : exhaustion;
}

/**
 * The window's exhaustion when it still counts as a limit at `now`; expired
 * or estimated exhaustion returns `undefined`.
 */
export function activeWindowExhaustion(
  window: PlanLimitWindow,
  now: number,
): OwnerLimitEvidence | undefined {
  const exhaustion = windowExhaustion(window);
  return exhaustion !== undefined && isActiveLimitEvidence(exhaustion, now)
    ? exhaustion
    : undefined;
}

/**
 * The window's exhaustion when it is still active at `now` but `estimated`.
 * It never makes a window "Limit reached", yet it is not room either.
 */
export function activeEstimatedExhaustion(
  window: PlanLimitWindow,
  now: number,
): OwnerLimitEvidence | undefined {
  const exhaustion = windowExhaustion(window);
  return exhaustion !== undefined &&
    exhaustion.source === 'estimated' &&
    classifyOwnerEvidence(exhaustion, now) === 'active'
    ? exhaustion
    : undefined;
}

/**
 * Design §2.1 rule 2: the reset that invalidated the last observation.
 *
 * (a) The reported reset has passed and the observation predates it: that
 *     reset passed, and the next one is unknown.
 * (b) The window's last reset is known and the observation predates it: the
 *     last reset passed, and the next one is the reported reset when it is
 *     still ahead.
 *
 * Returns `undefined` when the observation belongs to the current window.
 */
export function resetPassage(
  window: PlanLimitWindow,
  now: number,
): PlanWindowResetPassage | undefined {
  const lastObservedAt = windowObservedAt(window);
  const { resetsAt, lastResetAt } = window;
  if (resetsAt !== undefined && resetsAt <= now && lastObservedAt < resetsAt) {
    return { passedAt: resetsAt, lastObservedAt };
  }
  if (lastResetAt !== undefined && lastObservedAt < lastResetAt) {
    return resetsAt !== undefined && resetsAt > now
      ? { passedAt: lastResetAt, nextResetAt: resetsAt, lastObservedAt }
      : { passedAt: lastResetAt, lastObservedAt };
  }
  return undefined;
}

/**
 * Classify one window. First match wins (Decision 1, design §2.1):
 *
 * 1. `limit-reached` — active non-estimated exhaustion; beats stale and aged.
 *    Expired exhaustion falls through.
 * 2. `reset-usage-unknown` — a reset came after the last observation
 *    (`resetPassage`); checked before age and stale.
 * 3. `usage-unknown` — no used value (never shown as 0).
 * 4. `estimate-only` — the used value is `estimated`.
 * 5. `aged` — observed longer ago than `freshnessMs`, or the provider status
 *    is `stale`.
 * 6. `not-confirmed` — the last reset is unknown, so freshness cannot be
 *    established.
 * 7. `near-limit` — at or above `nearLimitPercent`; otherwise `ok`.
 */
export function classifyWindow(
  window: PlanLimitWindow,
  ctx: PlanLimitStateContext,
): PlanWindowState {
  if (activeWindowExhaustion(window, ctx.now) !== undefined) {
    return 'limit-reached';
  }
  if (resetPassage(window, ctx.now) !== undefined) return 'reset-usage-unknown';

  const percent = usedPercent(window.used);
  if (percent === undefined) return 'usage-unknown';
  if (window.usedSource === 'estimated') return 'estimate-only';

  const age = ctx.now - windowObservedAt(window);
  if (ctx.status === 'stale' || !(age <= ctx.freshnessMs)) return 'aged';
  // A fresh authoritative response reports the usage for its current window.
  // Some APIs (notably Claude's /usage response) expose only the *next*
  // reset, so requiring a historical reset timestamp incorrectly makes every
  // fresh provider reading "not confirmed".
  if (
    window.lastResetAt === undefined &&
    !(
      window.resetSource === 'provider-api' &&
      window.resetsAt !== undefined &&
      window.resetsAt > ctx.now
    )
  ) {
    return 'not-confirmed';
  }
  return percent >= ctx.nearLimitPercent ? 'near-limit' : 'ok';
}
