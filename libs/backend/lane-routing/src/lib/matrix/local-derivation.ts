import {
  LANE_DEFAULT_MODEL,
  type LaneOutcomeSummary,
  type OutcomeTaskKind,
} from '@ptah-extension/shared';
import {
  MINIMUM_SAMPLE_COUNT,
  OUTCOME_WINDOW_MS,
  SCORE_MAX,
  SCORE_MIN,
} from '../routing-constants';
import { isStale } from './seed-matrix';
import {
  CAPABILITY_MATRIX_VERSION,
  FAMILY_PROFILE_MODEL,
  type CapabilityMatrix,
  type MatrixCell,
  type MatrixProfile,
  type ValueMatrixCell,
} from './matrix.types';

/**
 * Local matrix cells from outcome summaries (Requirement 6.6, part A constants).
 *
 * Pure: the same summaries and `nowMs` always produce the same matrix. The
 * store supplies the summaries; this module does not read the outcome port.
 *
 * A cell is derived only when at least one Requirement 9.1 rate has
 * `MINIMUM_SAMPLE_COUNT` verified runs in the 90-day window. `r` is the
 * delivered rate when only that rate qualifies, the review pass rate when
 * only that one does, otherwise the mean of the two. The score is
 * `round(100 * r)` (half away from zero). `asOf` is the newest contributing
 * record. `sampleCount` is how many unique runs contributed to the rate or
 * rates that qualified.
 *
 * Runs stored under `LANE_DEFAULT_MODEL` or `auto` land on the family
 * profile (`*`), which is the key lookup uses for those models (Req 11.3).
 */

/** Model id that selects a model automatically (Requirement 11.3). */
export const AUTOMATIC_MATRIX_MODEL = 'auto';

interface RateBucket {
  readonly family: string;
  readonly model: string;
  readonly taskKind: OutcomeTaskKind;
  delivered: number;
  noDeliverable: number;
  failed: number;
  approved: number;
  rejected: number;
  delivery: LaneOutcomeSummary[];
  review: LaneOutcomeSummary[];
}

/**
 * One profile per family and model that reached the sample count. Profiles
 * are sorted by family, then by model, with `*` before other models.
 */
export function deriveLocalMatrix(
  summaries: readonly LaneOutcomeSummary[],
  nowMs: number,
): CapabilityMatrix {
  assertFiniteNow(nowMs);
  const sinceMs = nowMs - OUTCOME_WINDOW_MS;
  const buckets = new Map<string, RateBucket>();
  for (const summary of dedupeByRun(summaries)) {
    const bucket = bucketFor(summary, sinceMs, buckets);
    if (bucket === undefined) continue;
    countSummary(bucket, summary);
  }
  return {
    version: CAPABILITY_MATRIX_VERSION,
    profiles: profilesFrom(buckets, nowMs),
  };
}

function assertFiniteNow(nowMs: number): void {
  if (!Number.isFinite(nowMs)) {
    throw new Error('nowMs must be a finite epoch millisecond');
  }
}

/**
 * One row per `runId`. Equal `endedAt` breaks the tie on a key that ignores
 * input order, so a shuffled list cannot change the kept row.
 */
function dedupeByRun(
  summaries: readonly LaneOutcomeSummary[],
): LaneOutcomeSummary[] {
  const byId = new Map<string, LaneOutcomeSummary>();
  for (const summary of summaries) {
    const current = byId.get(summary.runId);
    if (current === undefined || preferSummary(summary, current)) {
      byId.set(summary.runId, summary);
    }
  }
  return [...byId.values()];
}

function preferSummary(
  candidate: LaneOutcomeSummary,
  current: LaneOutcomeSummary,
): boolean {
  const candidateOk = Number.isFinite(candidate.endedAt);
  const currentOk = Number.isFinite(current.endedAt);
  if (candidateOk !== currentOk) return candidateOk;
  if (candidate.endedAt !== current.endedAt) {
    return candidate.endedAt > current.endedAt;
  }
  return tieKey(candidate) > tieKey(current);
}

function tieKey(summary: LaneOutcomeSummary): string {
  return JSON.stringify([
    summary.verdict,
    summary.finalReview,
    summary.taskKind,
    summary.family,
    summary.model,
  ]);
}

function bucketFor(
  summary: LaneOutcomeSummary,
  sinceMs: number,
  buckets: Map<string, RateBucket>,
): RateBucket | undefined {
  if (summary.taskKind === null) return undefined;
  if (!Number.isFinite(summary.endedAt) || summary.endedAt < sinceMs) {
    return undefined;
  }
  if (isBlank(summary.family) || isBlank(summary.model)) return undefined;
  const model = matrixModelKey(summary.model);
  const taskKind = summary.taskKind;
  const key = JSON.stringify([summary.family, model, taskKind]);
  const existing = buckets.get(key);
  if (existing !== undefined) return existing;
  const created: RateBucket = {
    family: summary.family,
    model,
    taskKind,
    delivered: 0,
    noDeliverable: 0,
    failed: 0,
    approved: 0,
    rejected: 0,
    delivery: [],
    review: [],
  };
  buckets.set(key, created);
  return created;
}

function matrixModelKey(model: string): string {
  if (model === LANE_DEFAULT_MODEL || model === AUTOMATIC_MATRIX_MODEL) {
    return FAMILY_PROFILE_MODEL;
  }
  return model;
}

function isBlank(value: string): boolean {
  return !/\S/.test(value);
}

function countSummary(bucket: RateBucket, summary: LaneOutcomeSummary): void {
  switch (summary.verdict) {
    case 'delivered':
      bucket.delivered += 1;
      bucket.delivery.push(summary);
      break;
    case 'no-deliverable':
      bucket.noDeliverable += 1;
      bucket.delivery.push(summary);
      break;
    case 'failed':
      bucket.failed += 1;
      bucket.delivery.push(summary);
      break;
    case 'unverified':
      break;
    default: {
      const unexpected: never = summary.verdict;
      throw new Error(`unexpected verdict ${String(unexpected)}`);
    }
  }
  switch (summary.finalReview) {
    case 'approved':
      bucket.approved += 1;
      bucket.review.push(summary);
      break;
    case 'rejected':
      bucket.rejected += 1;
      bucket.review.push(summary);
      break;
    case null:
      break;
    default: {
      const unexpected: never = summary.finalReview;
      throw new Error(`unexpected final review ${String(unexpected)}`);
    }
  }
}

function profilesFrom(
  buckets: Map<string, RateBucket>,
  nowMs: number,
): MatrixProfile[] {
  const drafts = new Map<
    string,
    {
      family: string;
      model: string;
      cells: Record<OutcomeTaskKind, MatrixCell>;
    }
  >();
  for (const bucket of buckets.values()) {
    const cell = cellFrom(bucket, nowMs);
    if (cell === undefined) continue;
    const key = JSON.stringify([bucket.family, bucket.model]);
    const draft = drafts.get(key) ?? {
      family: bucket.family,
      model: bucket.model,
      cells: unknownCells(),
    };
    draft.cells[bucket.taskKind] = cell;
    drafts.set(key, draft);
  }
  return [...drafts.values()].sort(compareProfiles).map((draft) => ({
    family: draft.family,
    model: draft.model,
    cells: draft.cells,
  }));
}

function unknownCells(): Record<OutcomeTaskKind, MatrixCell> {
  return {
    plan: { kind: 'unknown' },
    implement: { kind: 'unknown' },
    review: { kind: 'unknown' },
    research: { kind: 'unknown' },
    tests: { kind: 'unknown' },
    docs: { kind: 'unknown' },
  };
}

function cellFrom(
  bucket: RateBucket,
  nowMs: number,
): ValueMatrixCell | undefined {
  const deliveryTotal = bucket.delivered + bucket.noDeliverable + bucket.failed;
  const reviewTotal = bucket.approved + bucket.rejected;
  const deliveryReady = deliveryTotal >= MINIMUM_SAMPLE_COUNT;
  const reviewReady = reviewTotal >= MINIMUM_SAMPLE_COUNT;
  if (!deliveryReady && !reviewReady) return undefined;

  const scored = scoreBucket(
    bucket,
    deliveryTotal,
    reviewTotal,
    deliveryReady,
    reviewReady,
  );
  if (scored === undefined) return undefined;
  const newest = newestContributing(scored.contributing);
  const asOf = new Date(newest.endedAt).toISOString();
  return {
    kind: 'value',
    score: scored.score,
    source: 'local',
    asOf,
    stale: isStale(asOf, nowMs),
    sampleCount: scored.contributing.length,
  };
}

function scoreBucket(
  bucket: RateBucket,
  deliveryTotal: number,
  reviewTotal: number,
  deliveryReady: boolean,
  reviewReady: boolean,
):
  | {
      readonly score: number;
      readonly contributing: readonly LaneOutcomeSummary[];
    }
  | undefined {
  if (deliveryReady && !reviewReady) {
    const score = roundPercent(bucket.delivered, deliveryTotal);
    if (score === undefined) return undefined;
    return { score, contributing: bucket.delivery };
  }
  if (reviewReady && !deliveryReady) {
    const score = roundPercent(bucket.approved, reviewTotal);
    if (score === undefined) return undefined;
    return { score, contributing: bucket.review };
  }
  const score = roundMean(
    bucket.delivered,
    deliveryTotal,
    bucket.approved,
    reviewTotal,
  );
  if (score === undefined) return undefined;
  return { score, contributing: unionByRun(bucket.delivery, bucket.review) };
}

/**
 * `round(100 * numerator / denominator)`, half away from zero.
 * `floor((200n + d) / (2d))` stays on integers. A product that does not fit
 * a safe integer is not derived.
 */
function roundPercent(
  numerator: number,
  denominator: number,
): number | undefined {
  return floorRatio(200 * numerator + denominator, 2 * denominator);
}

/** `round(100 * ((left/leftDen + right/rightDen) / 2))`. */
function roundMean(
  leftNum: number,
  leftDen: number,
  rightNum: number,
  rightDen: number,
): number | undefined {
  const left = scale(leftNum, rightDen);
  const right = scale(rightNum, leftDen);
  const denom = safeMul(leftDen, rightDen);
  if (left === undefined || right === undefined || denom === undefined) {
    return undefined;
  }
  return floorRatio(left + right + denom, 2 * denom);
}

/** `100 * count * otherDenominator`, or undefined when the product is unsafe. */
function scale(count: number, otherDenominator: number): number | undefined {
  const scaled = safeMul(100, count);
  if (scaled === undefined) return undefined;
  return safeMul(scaled, otherDenominator);
}

function floorRatio(
  numerator: number,
  denominator: number,
): number | undefined {
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    denominator <= 0
  ) {
    return undefined;
  }
  const score = Math.floor(numerator / denominator);
  if (score < SCORE_MIN || score > SCORE_MAX || !Number.isInteger(score)) {
    return undefined;
  }
  return score;
}

function safeMul(left: number, right: number): number | undefined {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    return undefined;
  }
  const product = left * right;
  if (!Number.isSafeInteger(product)) return undefined;
  return product;
}

function unionByRun(
  left: readonly LaneOutcomeSummary[],
  right: readonly LaneOutcomeSummary[],
): LaneOutcomeSummary[] {
  const byId = new Map<string, LaneOutcomeSummary>();
  for (const summary of left) byId.set(summary.runId, summary);
  for (const summary of right) byId.set(summary.runId, summary);
  return [...byId.values()];
}

function newestContributing(
  records: readonly LaneOutcomeSummary[],
): LaneOutcomeSummary {
  let best = records[0];
  if (best === undefined) {
    throw new Error('local derivation has no contributing record');
  }
  for (const record of records) {
    if (preferSummary(record, best)) best = record;
  }
  return best;
}

function compareProfiles(left: MatrixProfile, right: MatrixProfile): number {
  if (left.family < right.family) return -1;
  if (left.family > right.family) return 1;
  if (left.model === right.model) return 0;
  if (left.model === FAMILY_PROFILE_MODEL) return -1;
  if (right.model === FAMILY_PROFILE_MODEL) return 1;
  if (left.model < right.model) return -1;
  return 1;
}
