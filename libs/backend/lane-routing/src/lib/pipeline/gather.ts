import type { CliDetectionResult } from '@ptah-extension/shared';
import { SUBAGENT_LANE_ID } from '@ptah-extension/shared';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import type {
  LaneModelEntry,
  LaneModelListing,
} from '../lane-model-listing.port';
import type { RouteCandidateSource } from '../route-candidate-source.port';
import {
  MATRIX_INVALID_PREFIX,
  NO_OUTCOME_HISTORY_REASON,
  OUTCOMES_UNAVAILABLE_REASON,
  type CapabilityMatrixSnapshot,
  type MatrixLoadInput,
  type MatrixOutcomeQuery,
} from '../matrix/capability-matrix.store';
import { NEUTRAL_SCORE } from '../routing-constants';
import { FAMILY_PROFILE_MODEL } from '../matrix/matrix.types';
import {
  laneCandidateId,
  toLaneCandidate,
  type LaneCandidate,
} from '../ranking/candidate.types';
import type { FallbackModel, ListedModel } from '../ranking/score';
import {
  emptyRotationState,
  ROTATION_UNAVAILABLE_REASON,
  type RotationLoad,
  type RotationState,
} from '../ranking/rotation.store';
import { MISSING_INPUTS, type MissingInput } from '../reasons/compile-reasons';
import type { LaneLimitState } from '@ptah-extension/shared';

/**
 * Gather (data-flow step 4). One deadline races each model list on its
 * own; a late or failed row stays eligible as `lane-default` and the
 * reason names `models unknown`. Other missing inputs are recorded and
 * do not reject the call (Requirements 4.5, 11.2, 11.5).
 */

export interface LaneModelFacts {
  readonly models: readonly ListedModel[];
  readonly configuredModel?: FallbackModel;
}

export interface GatheredCall {
  readonly lanes: readonly LaneCandidate[];
  readonly roles: readonly string[];
  readonly matrix: CapabilityMatrixSnapshot;
  readonly rotation: RotationState;
  readonly rotationUnavailable: boolean;
  readonly models: ReadonlyMap<string, LaneModelFacts>;
  readonly missing: readonly MissingInput[];
  /** Store phrases that are not already one of the missing-input lines. */
  readonly detailReasons: readonly string[];
}

export interface RouteMatrix {
  load(input: MatrixLoadInput): Promise<CapabilityMatrixSnapshot>;
}

export interface RouteRotation {
  load(): RotationLoad;
  save(state: RotationState): Promise<{ readonly persisted: boolean }>;
}

export async function gatherRouteCall(input: {
  readonly source: RouteCandidateSource;
  readonly listing: LaneModelListing | undefined;
  readonly matrix: RouteMatrix;
  readonly rotation: RouteRotation;
  readonly logger: LaneRoutingLogger;
  readonly nowMs: number;
  readonly listingBudgetMs: number;
}): Promise<GatheredCall> {
  const rows = await readRows(input.source, input.logger);
  const [limits, roles, listed, matrix, rotation] = await Promise.all([
    readLimits(input.source, rows.rows, input.logger),
    readRoles(input.source, input.logger),
    listModels(input.listing, rows.rows, input.listingBudgetMs, input.logger),
    loadMatrix(input.matrix, rows.rows, input.nowMs, input.logger),
    loadRotation(input.rotation, input.logger),
  ]);
  const lanes = rows.rows.map((row) => toLaneCandidate(row, limits.map));
  const matrixNotes = classifyMatrixReasons(matrix.reasons);
  const missing = orderedMissing([
    ...(rows.failed ? (['agent-list'] as const) : []),
    ...(limits.failed ? (['limits'] as const) : []),
    ...(roles.failed ? (['roles'] as const) : []),
    ...(listed.failed ? (['model-lists'] as const) : []),
    ...matrixNotes.missing,
    ...(rotation.reason !== null ? (['rotation-store'] as const) : []),
  ]);
  return {
    lanes,
    roles: roles.roles,
    matrix,
    rotation: rotation.state,
    rotationUnavailable: rotation.reason !== null,
    models: listed.byLaneId,
    missing,
    detailReasons: matrixNotes.extra,
  };
}

async function readRows(
  source: RouteCandidateSource,
  logger: LaneRoutingLogger,
): Promise<{
  readonly rows: readonly CliDetectionResult[];
  readonly failed: boolean;
}> {
  try {
    const rows = await source.rows();
    return { rows, failed: false };
  } catch (error: unknown) {
    logger.warn('[lane-routing] agent list failed', logFacts(error));
    return { rows: [], failed: true };
  }
}

async function readLimits(
  source: RouteCandidateSource,
  rows: readonly CliDetectionResult[],
  logger: LaneRoutingLogger,
): Promise<{
  readonly map: ReadonlyMap<string, LaneLimitState> | null;
  readonly failed: boolean;
}> {
  try {
    const map = await source.limits(rows);
    return { map, failed: map === null };
  } catch (error: unknown) {
    logger.warn('[lane-routing] lane limits failed', logFacts(error));
    return { map: null, failed: true };
  }
}

async function readRoles(
  source: RouteCandidateSource,
  logger: LaneRoutingLogger,
): Promise<{ readonly roles: readonly string[]; readonly failed: boolean }> {
  try {
    const roles = await source.roles();
    return { roles, failed: false };
  } catch (error: unknown) {
    logger.warn('[lane-routing] role list failed', logFacts(error));
    return { roles: [], failed: true };
  }
}

async function listModels(
  listing: LaneModelListing | undefined,
  rows: readonly CliDetectionResult[],
  budgetMs: number,
  logger: LaneRoutingLogger,
): Promise<{
  readonly byLaneId: ReadonlyMap<string, LaneModelFacts>;
  readonly failed: boolean;
}> {
  if (rows.length === 0) {
    return { byLaneId: new Map(), failed: false };
  }
  if (listing === undefined) {
    logger.warn('[lane-routing] model listing is not registered');
    return { byLaneId: emptyFacts(rows), failed: true };
  }
  const pairs = await Promise.all(
    rows.map(async (row) => {
      const models = await listOne(listing, row, budgetMs, logger);
      return [laneCandidateId(row), models] as const;
    }),
  );
  const byLaneId = new Map<string, LaneModelFacts>();
  let failed = false;
  for (const [id, models] of pairs) {
    if (models === null) {
      failed = true;
      byLaneId.set(id, { models: [] });
      continue;
    }
    if (models.length === 0) failed = true;
    byLaneId.set(id, factsFrom(models));
  }
  return { byLaneId, failed };
}

/**
 * Race one row against the listing budget. The listing promise is always
 * observed, so a row that loses the race cannot surface later as an
 * unhandled rejection. A slow row does not delay any other row.
 */
async function listOne(
  listing: LaneModelListing,
  row: CliDetectionResult,
  budgetMs: number,
  logger: LaneRoutingLogger,
): Promise<readonly LaneModelEntry[] | null> {
  const signal = AbortSignal.timeout(budgetMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listed = listing.list(row, signal).then(
    (models) => ({ kind: 'ok' as const, models }),
    (error: unknown) => ({ kind: 'error' as const, error }),
  );
  const timeout = new Promise<{ kind: 'timeout' }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), budgetMs);
  });
  let failed = false;
  let models: readonly LaneModelEntry[] | undefined;
  try {
    const winner = await Promise.race([listed, timeout]);
    if (winner.kind === 'ok') {
      models = winner.models;
    } else {
      failed = true;
      if (winner.kind === 'error') {
        logger.warn('[lane-routing] model list failed', {
          cli: row.cli,
          ...logFacts(winner.error),
        });
      }
    }
  } catch (error: unknown) {
    failed = true;
    logger.warn('[lane-routing] model list failed', {
      cli: row.cli,
      ...logFacts(error),
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  if (failed || models === undefined) return null;
  return models;
}

function emptyFacts(
  rows: readonly CliDetectionResult[],
): Map<string, LaneModelFacts> {
  const byLaneId = new Map<string, LaneModelFacts>();
  for (const row of rows) {
    byLaneId.set(laneCandidateId(row), { models: [] });
  }
  return byLaneId;
}

function factsFrom(entries: readonly LaneModelEntry[]): LaneModelFacts {
  const models: ListedModel[] = [];
  let configured: FallbackModel | undefined;
  for (const entry of entries) {
    models.push({
      id: entry.id,
      provenance: entry.provenance,
      ...(entry.auto === true ? { auto: true } : {}),
    });
    if (configured === undefined && entry.provenance === 'configured') {
      configured = { id: entry.id, provenance: 'configured' };
    }
  }
  return configured === undefined
    ? { models }
    : { models, configuredModel: configured };
}

async function loadMatrix(
  matrix: RouteMatrix,
  rows: readonly CliDetectionResult[],
  nowMs: number,
  logger: LaneRoutingLogger,
): Promise<CapabilityMatrixSnapshot> {
  const outcomeQueries: MatrixOutcomeQuery[] = rows.map((row) => ({
    laneId: laneCandidateId(row),
    subagent: false,
  }));
  outcomeQueries.push({ laneId: SUBAGENT_LANE_ID, subagent: true });
  try {
    return await matrix.load({ nowMs, outcomeQueries });
  } catch (error: unknown) {
    logger.warn(
      '[lane-routing] capability matrix could not be loaded',
      logFacts(error),
    );
    return neutralSnapshot();
  }
}

function neutralSnapshot(): CapabilityMatrixSnapshot {
  return {
    reasons: [
      `${MATRIX_INVALID_PREFIX} capability-matrix.json (unreadable)`,
      OUTCOMES_UNAVAILABLE_REASON,
    ],
    resolve: (family, model, taskKind) => ({
      family,
      model,
      profileModel: FAMILY_PROFILE_MODEL,
      taskKind,
      cell: { kind: 'unknown' },
      score: NEUTRAL_SCORE,
      noProfile: true,
    }),
  };
}

async function loadRotation(
  rotation: RouteRotation,
  logger: LaneRoutingLogger,
): Promise<RotationLoad> {
  try {
    return rotation.load();
  } catch (error: unknown) {
    logger.warn(
      '[lane-routing] rotation state could not be read',
      logFacts(error),
    );
    return { state: emptyRotationState(), reason: ROTATION_UNAVAILABLE_REASON };
  }
}

function classifyMatrixReasons(reasons: readonly string[]): {
  readonly missing: readonly MissingInput[];
  readonly extra: readonly string[];
} {
  const missing: MissingInput[] = [];
  const extra: string[] = [];
  for (const reason of reasons) {
    if (reason.startsWith(MATRIX_INVALID_PREFIX)) {
      pushMissing(missing, 'matrix-file');
      extra.push(reason);
      continue;
    }
    if (reason === NO_OUTCOME_HISTORY_REASON) {
      pushMissing(missing, 'outcome-history');
      continue;
    }
    if (reason.length > 0) extra.push(reason);
  }
  return { missing, extra };
}

function pushMissing(list: MissingInput[], item: MissingInput): void {
  if (!list.includes(item)) list.push(item);
}

function orderedMissing(items: readonly MissingInput[]): MissingInput[] {
  return MISSING_INPUTS.filter((item) => items.includes(item));
}

function logFacts(error: unknown): {
  readonly name: string;
  readonly code?: string;
} {
  const name = error instanceof Error ? error.name : 'UnknownError';
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    if (typeof code === 'string') return { name, code };
  }
  return { name };
}
