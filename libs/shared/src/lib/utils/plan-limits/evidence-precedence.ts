/**
 * Plan-limit evidence precedence (TASK_2026_596, Decision 4).
 *
 * Decides, for one allowance (owner + window key + model scope), whether a
 * newly observed piece of evidence replaces the one currently held. Pure and
 * clock-free: staleness is decided by the caller and passed in.
 */
import type { PlanLimitSource } from '../../types/plan-limit.types';

/** A window at or above this percent used is "near limit". */
export const NEAR_LIMIT_PERCENT = 90;

/** Provider data older than this is stale. */
export const FRESHNESS_MS = 900_000;

/** Deadline for one limit lookup before it reports "timed out". */
export const LIMIT_LOOKUP_DEADLINE_MS = 3_000;

/** The facts about one piece of evidence that precedence depends on. */
export interface PlanLimitEvidenceStamp {
  /** When the evidence was observed, epoch ms UTC. */
  readonly observedAt: number;
  readonly source: PlanLimitSource;
  /** True when the caller judged the data stale (older than `FRESHNESS_MS`). */
  readonly stale?: boolean;
  /** True when the evidence says the allowance is exhausted. */
  readonly exhausted?: boolean;
}

/** Sources that report an exhaustion as it happens, on a live request. */
function isLiveSource(source: PlanLimitSource): boolean {
  return source === 'stream-event' || source === 'error-derived';
}

/**
 * Whether `next` replaces `prev` for the same allowance.
 *
 * Rules, in order:
 * 1. `estimated` evidence never supersedes non-estimated evidence observed
 *    after the window's last reset. When `lastResetAt` is unknown the held
 *    evidence cannot be shown to predate the reset, so it is kept.
 * 2. Stale data never clears an exhaustion reported live (`stream-event` or
 *    `error-derived`) that is at least as new as the stale data.
 * 3. Otherwise newer evidence wins; on an equal instant, non-stale evidence
 *    replaces stale evidence and nothing else changes.
 *
 * With nothing held, any evidence with a finite `observedAt` is taken.
 * Evidence with a non-finite `observedAt` never supersedes anything.
 */
export function supersedes(
  next: PlanLimitEvidenceStamp,
  prev: PlanLimitEvidenceStamp | undefined,
  lastResetAt?: number,
): boolean {
  if (!Number.isFinite(next.observedAt)) return false;
  if (prev === undefined || !Number.isFinite(prev.observedAt)) return true;

  if (next.source === 'estimated' && prev.source !== 'estimated') {
    const prevPredatesReset =
      lastResetAt !== undefined &&
      Number.isFinite(lastResetAt) &&
      prev.observedAt < lastResetAt;
    if (!prevPredatesReset) return false;
  }

  if (
    next.stale === true &&
    next.exhausted !== true &&
    prev.exhausted === true &&
    isLiveSource(prev.source) &&
    prev.observedAt >= next.observedAt
  ) {
    return false;
  }

  if (next.observedAt !== prev.observedAt) {
    return next.observedAt > prev.observedAt;
  }
  return prev.stale === true && next.stale !== true;
}
