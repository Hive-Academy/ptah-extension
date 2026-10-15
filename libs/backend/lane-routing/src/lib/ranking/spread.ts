/**
 * Spread rule (Requirements 7.1-7.6).
 *
 * Pure: no clock, no I/O, no randomness. Rotation state is passed in and
 * returned. `RotationStore` is the only writer.
 *
 * The band is every eligible candidate with `top - score <= B`. `at-limit`
 * is not eligible. Among the band, lanes keep the best limit class present
 * (`confirmed-room`, then `unknown`, then `near-limit`). A subagent has no
 * limit state; it joins that best class and does not create a better one.
 * The class is ordered by T. The pick is the first member after K's last
 * id, cyclically. The ranking is that cycle, then everyone else by score
 * descending, limit class, then T.
 */
import type { OutcomeTaskKind } from '@ptah-extension/shared';
import {
  CLOSENESS_BAND,
  EXCLUDED_LIMIT_STATE,
  INSIDE_BAND_LIMIT_ORDER,
  PREFERRED_RANK_MIN_RANKED,
  SCORE_MAX,
  SCORE_MIN,
  TIE_BREAK_EXECUTOR_KIND_ORDER,
} from '../routing-constants';
import type { LaneCandidate, RoutingCandidate } from './candidate.types';
import {
  lastCandidateId,
  rotationKey,
  withPick,
  type RotationState,
} from './rotation.store';

export interface RankedCandidate {
  readonly candidate: RoutingCandidate;
  /** Integer on the routing score scale. Higher is better. */
  readonly score: number;
}

export interface SpreadPreferences {
  /** Candidate ids, caller order. Listed ids come before unlisted ids. */
  readonly prefer?: readonly string[];
}

export interface SpreadInput {
  readonly phaseId: string;
  readonly taskKind: OutcomeTaskKind;
  readonly candidates: readonly RankedCandidate[];
  readonly preferences?: SpreadPreferences;
  readonly rotation: RotationState;
}

export interface SpreadResult {
  readonly key: string;
  readonly pick: RankedCandidate | null;
  readonly ranking: readonly RankedCandidate[];
  readonly rotation: RotationState;
  /** True when the pick is not the first member of the T-ordered pool. */
  readonly rotationChangedChoice: boolean;
  /**
   * True when `prefer` or `preferredRank` changed the pick relative to
   * executor kind and candidate id alone.
   */
  readonly preferenceChangedChoice: boolean;
}

type Compare = (left: RankedCandidate, right: RankedCandidate) => number;

export function spread(input: SpreadInput): SpreadResult {
  const key = rotationKey(input.phaseId, input.taskKind);
  assertCandidates(input.candidates);
  const prefer = preferIndex(input.preferences?.prefer ?? []);
  const eligible = input.candidates.filter((entry) =>
    isEligible(entry.candidate),
  );
  if (eligible.length === 0) {
    return {
      key,
      pick: null,
      ranking: [],
      rotation: input.rotation,
      rotationChangedChoice: false,
      preferenceChangedChoice: false,
    };
  }

  const top = topScore(eligible);
  const band = eligible.filter((entry) => top - entry.score <= CLOSENESS_BAND);
  const bestLane = bestLaneRank(band);
  const pool = band.filter(
    (entry) => poolRank(entry, bestLane) === (bestLane ?? 0),
  );
  const byPreference: Compare = (left, right) =>
    compareTieBreak(left, right, prefer);
  const natural = [...pool].sort(byPreference);
  const bare = [...pool].sort(compareBare);
  const lastId = lastCandidateId(input.rotation, key);
  const pick = successor(natural, lastId, input.candidates, byPreference);
  const barePick = successor(bare, lastId, input.candidates, compareBare);
  const start = natural.findIndex(
    (entry) => entry.candidate.id === pick.candidate.id,
  );
  const rotated =
    start <= 0
      ? natural
      : [...natural.slice(start), ...natural.slice(0, start)];
  const placed = new Set(rotated.map((entry) => entry.candidate.id));
  const others = eligible
    .filter((entry) => !placed.has(entry.candidate.id))
    .sort((left, right) => compareRest(left, right, prefer, bestLane));
  const first = natural[0];
  return {
    key,
    pick,
    ranking: [...rotated, ...others],
    rotation: withPick(input.rotation, key, pick.candidate.id),
    rotationChangedChoice:
      first !== undefined && pick.candidate.id !== first.candidate.id,
    preferenceChangedChoice: pick.candidate.id !== barePick.candidate.id,
  };
}

function successor(
  pool: readonly RankedCandidate[],
  lastId: string | null,
  everyone: readonly RankedCandidate[],
  compare: Compare,
): RankedCandidate {
  const first = pool[0];
  if (first === undefined) {
    throw new Error('rotation pool must not be empty');
  }
  if (lastId === null || pool.length === 1) return first;
  const index = pool.findIndex((entry) => entry.candidate.id === lastId);
  if (index >= 0) {
    return pool[(index + 1) % pool.length] ?? first;
  }
  const departed = everyone.find((entry) => entry.candidate.id === lastId);
  if (departed !== undefined) {
    for (const entry of pool) {
      if (compare(departed, entry) < 0) return entry;
    }
    return first;
  }
  // Only the id was stored, and this call no longer carries that candidate.
  for (const entry of pool) {
    if (compareOrdinal(entry.candidate.id, lastId) > 0) return entry;
  }
  return first;
}

function isEligible(candidate: RoutingCandidate): boolean {
  return (
    candidate.kind === 'subagent' ||
    candidate.limitState !== EXCLUDED_LIMIT_STATE
  );
}

function topScore(eligible: readonly RankedCandidate[]): number {
  let top = SCORE_MIN;
  for (const entry of eligible) {
    if (entry.score > top) top = entry.score;
  }
  return top;
}

function bestLaneRank(band: readonly RankedCandidate[]): number | null {
  let best: number | null = null;
  for (const entry of band) {
    if (entry.candidate.kind !== 'lane') continue;
    const rank = laneLimitRank(entry.candidate);
    if (best === null || rank < best) best = rank;
  }
  return best;
}

/**
 * Subagents take the best lane class in the band (or the top class when
 * the band has no lane). They do not outrank a confirmed-room lane, and
 * a near-limit lane does not drop them out of the band.
 */
function poolRank(entry: RankedCandidate, bestLane: number | null): number {
  if (entry.candidate.kind === 'subagent') return bestLane ?? 0;
  return laneLimitRank(entry.candidate);
}

function laneLimitRank(candidate: LaneCandidate): number {
  const state = candidate.limitState;
  if (state === EXCLUDED_LIMIT_STATE) {
    throw new Error('at-limit is excluded before the limit order');
  }
  return INSIDE_BAND_LIMIT_ORDER.indexOf(state);
}

function compareRest(
  left: RankedCandidate,
  right: RankedCandidate,
  prefer: ReadonlyMap<string, number>,
  bestLane: number | null,
): number {
  if (left.score !== right.score) return right.score - left.score;
  const byLimit = poolRank(left, bestLane) - poolRank(right, bestLane);
  if (byLimit !== 0) return byLimit;
  return compareTieBreak(left, right, prefer);
}

function compareTieBreak(
  left: RankedCandidate,
  right: RankedCandidate,
  prefer: ReadonlyMap<string, number>,
): number {
  const byPrefer = comparePrefer(left.candidate.id, right.candidate.id, prefer);
  if (byPrefer !== 0) return byPrefer;
  const byRank = compareRank(left.candidate, right.candidate);
  if (byRank !== 0) return byRank;
  const byKind = compareKind(left.candidate.kind, right.candidate.kind);
  if (byKind !== 0) return byKind;
  return compareOrdinal(left.candidate.id, right.candidate.id);
}

function compareBare(left: RankedCandidate, right: RankedCandidate): number {
  const byKind = compareKind(left.candidate.kind, right.candidate.kind);
  if (byKind !== 0) return byKind;
  return compareOrdinal(left.candidate.id, right.candidate.id);
}

function comparePrefer(
  leftId: string,
  rightId: string,
  prefer: ReadonlyMap<string, number>,
): number {
  const left = prefer.get(leftId);
  const right = prefer.get(rightId);
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left - right;
}

function compareRank(left: RoutingCandidate, right: RoutingCandidate): number {
  const leftRank = rankedValue(left);
  const rightRank = rankedValue(right);
  if (leftRank === null && rightRank === null) return 0;
  if (leftRank === null) return 1;
  if (rightRank === null) return -1;
  return leftRank - rightRank;
}

function rankedValue(candidate: RoutingCandidate): number | null {
  if (candidate.kind !== 'lane') return null;
  const rank = candidate.preferredRank;
  if (
    rank === undefined ||
    !Number.isInteger(rank) ||
    rank < PREFERRED_RANK_MIN_RANKED
  ) {
    return null;
  }
  return rank;
}

function compareKind(
  left: RoutingCandidate['kind'],
  right: RoutingCandidate['kind'],
): number {
  return (
    TIE_BREAK_EXECUTOR_KIND_ORDER.indexOf(left) -
    TIE_BREAK_EXECUTOR_KIND_ORDER.indexOf(right)
  );
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function preferIndex(prefer: readonly string[]): ReadonlyMap<string, number> {
  const index = new Map<string, number>();
  prefer.forEach((id, position) => {
    if (!index.has(id)) index.set(id, position);
  });
  return index;
}

function assertCandidates(candidates: readonly RankedCandidate[]): void {
  const seen = new Set<string>();
  for (const entry of candidates) {
    if (seen.has(entry.candidate.id)) {
      throw new Error(`candidate id must be unique: ${entry.candidate.id}`);
    }
    seen.add(entry.candidate.id);
    if (
      !Number.isInteger(entry.score) ||
      entry.score < SCORE_MIN ||
      entry.score > SCORE_MAX
    ) {
      throw new Error(
        `score must be an integer from ${SCORE_MIN} to ${SCORE_MAX}`,
      );
    }
  }
}
