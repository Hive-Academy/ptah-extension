/**
 * Candidate score (part A §4, Requirement 7 scale).
 *
 * Pure: no clock, no I/O, no randomness. The matrix argument is the
 * capability-matrix snapshot's `resolve` (Requirement 11.3): `lane-default`
 * and `auto` read the family profile.
 *
 * Per lane row the model is chosen first. A listed model is used only when
 * its own cell beats the family-level cell by more than B
 * (`score - family > CLOSENESS_BAND`). Otherwise the configured model
 * (Ptah CLI `selectedModel`, or a subagent tier the caller already chose)
 * is used. Otherwise the model is `lane-default`.
 */
import {
  LANE_DEFAULT_MODEL,
  OUTCOME_TASK_KINDS,
  type OutcomeTaskKind,
} from '@ptah-extension/shared';
import { PROVENANCE } from '../contracts/route-decide-result.schema';
import {
  CLOSENESS_BAND,
  NEUTRAL_SCORE,
  SCORE_MAX,
  SCORE_MIN,
} from '../routing-constants';
import { AUTOMATIC_MATRIX_MODEL } from '../matrix/local-derivation';
import type { MatrixCell } from '../matrix/matrix.types';
import type { RoutingCandidate } from './candidate.types';

export type ModelProvenance = (typeof PROVENANCE)[number];

/** Provenance a live or shipped listing can carry. `lane-default` is not listed. */
export type ListedProvenance = Exclude<ModelProvenance, 'lane-default'>;

/** One listed model. `auto` entries select a model by themselves (Req 11.3). */
export interface ListedModel {
  readonly id: string;
  readonly provenance: ListedProvenance;
  readonly auto?: boolean;
}

/**
 * Model used when no listed model clears the band over the family cell.
 * `configured` is a Ptah CLI `selectedModel`. `tier` is a subagent tier
 * the caller chose from the phase kind (data-flow step 5).
 */
export interface FallbackModel {
  readonly id: string;
  readonly provenance: 'configured' | 'tier';
}

/** What `CapabilityMatrixSnapshot.resolve` returns, minus store bookkeeping. */
export interface ScoreCell {
  readonly score: number;
  readonly cell: MatrixCell;
  readonly profileModel: string;
  readonly noProfile: boolean;
}

/**
 * Matrix lookup for one routing call. `resolve(family, lane-default | auto)`
 * must return the family profile, matching `profileModelFor` in
 * `capability-matrix.store.ts`.
 */
export interface ScoreMatrix {
  resolve(family: string, model: string, taskKind: OutcomeTaskKind): ScoreCell;
}

export interface ScoreInput {
  readonly candidate: RoutingCandidate;
  /** Caller order. Empty when the row has no list. */
  readonly models?: readonly ListedModel[];
  readonly configuredModel?: FallbackModel;
}

export interface CandidateScore {
  readonly candidate: RoutingCandidate;
  readonly model: string;
  readonly provenance: ModelProvenance;
  readonly score: number;
  readonly cell: MatrixCell;
  readonly profileModel: string;
  readonly noProfile: boolean;
}

interface ChosenModel {
  readonly model: string;
  readonly provenance: ModelProvenance;
  readonly resolved: ScoreCell;
}

export function score(
  input: ScoreInput,
  taskKind: OutcomeTaskKind,
  matrix: ScoreMatrix,
): CandidateScore {
  assertTaskKind(taskKind);
  const family = input.candidate.family;
  const baseline = readCell(matrix, family, LANE_DEFAULT_MODEL, taskKind);
  const chosen =
    promotedModel(
      input.models ?? [],
      family,
      taskKind,
      matrix,
      baseline.score,
    ) ?? fallbackModel(input, family, taskKind, matrix, baseline);
  return {
    candidate: input.candidate,
    model: chosen.model,
    provenance: chosen.provenance,
    score: chosen.resolved.score,
    cell: chosen.resolved.cell,
    profileModel: chosen.resolved.profileModel,
    noProfile: chosen.resolved.noProfile,
  };
}

function promotedModel(
  models: readonly ListedModel[],
  family: string,
  taskKind: OutcomeTaskKind,
  matrix: ScoreMatrix,
  baseline: number,
): ChosenModel | null {
  let best: ChosenModel | null = null;
  for (const listed of models) {
    if (!isPromotable(listed)) continue;
    const resolved = readCell(matrix, family, listed.id, taskKind);
    if (resolved.profileModel !== listed.id) continue;
    if (resolved.score - baseline <= CLOSENESS_BAND) continue;
    if (best !== null && resolved.score <= best.resolved.score) continue;
    best = {
      model: listed.id,
      provenance: listed.provenance,
      resolved,
    };
  }
  return best;
}

function fallbackModel(
  input: ScoreInput,
  family: string,
  taskKind: OutcomeTaskKind,
  matrix: ScoreMatrix,
  baseline: ScoreCell,
): ChosenModel {
  const configured = input.configuredModel;
  if (configured !== undefined && isOwnModelId(configured.id)) {
    return {
      model: configured.id,
      provenance: configured.provenance,
      resolved: readCell(matrix, family, configured.id, taskKind),
    };
  }
  return {
    model: LANE_DEFAULT_MODEL,
    provenance: 'lane-default',
    resolved: baseline,
  };
}

function isPromotable(listed: ListedModel): boolean {
  if (listed.auto === true) return false;
  return isOwnModelId(listed.id);
}

/** A model id that can have a profile of its own. */
function isOwnModelId(id: string): boolean {
  return (
    id.length > 0 && id !== LANE_DEFAULT_MODEL && id !== AUTOMATIC_MATRIX_MODEL
  );
}

function readCell(
  matrix: ScoreMatrix,
  family: string,
  model: string,
  taskKind: OutcomeTaskKind,
): ScoreCell {
  const resolved = matrix.resolve(family, model, taskKind);
  assertCell(resolved, family, model, taskKind);
  return resolved;
}

function assertCell(
  resolved: ScoreCell,
  family: string,
  model: string,
  taskKind: OutcomeTaskKind,
): void {
  const value = resolved.score;
  if (!Number.isInteger(value) || value < SCORE_MIN || value > SCORE_MAX) {
    throw new Error(
      `matrix score for ${family}/${model}/${taskKind} must be an integer from ${SCORE_MIN} to ${SCORE_MAX}`,
    );
  }
  if (resolved.cell.kind === 'value') {
    if (resolved.cell.score !== value || resolved.noProfile) {
      throw new Error(
        `matrix value for ${family}/${model}/${taskKind} disagrees with its score`,
      );
    }
    return;
  }
  if (value !== NEUTRAL_SCORE || !resolved.noProfile) {
    throw new Error(
      `unknown matrix cell for ${family}/${model}/${taskKind} must score ${NEUTRAL_SCORE}`,
    );
  }
}

function assertTaskKind(taskKind: OutcomeTaskKind): void {
  for (const kind of OUTCOME_TASK_KINDS) {
    if (kind === taskKind) return;
  }
  throw new Error('taskKind must be an OutcomeTaskKind');
}
