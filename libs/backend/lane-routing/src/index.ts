/**
 * @ptah-extension/lane-routing — host-neutral decision-model lane routing.
 *
 * May import only `@ptah-extension/shared` and `@ptah-extension/platform-core`.
 */
export { LANE_ROUTING_TOKENS, type LaneRoutingDIToken } from './lib/di/tokens';
export type {
  LaneRoutingLogMeta,
  LaneRoutingLogger,
} from './lib/lane-routing-logger';
export {
  CLOSENESS_BAND,
  CONFIDENCE_THRESHOLD,
  DECISION_REQUEST_TIMEOUT_MS,
  DECISION_RETURN_MARGIN_MS,
  EXCLUDED_LIMIT_STATE,
  GATHER_BUDGET_MS,
  INSIDE_BAND_LIMIT_ORDER,
  MAX_DECISION_REQUESTS,
  MIN_OPTIONS_PER_PHASE,
  MINIMUM_SAMPLE_COUNT,
  MODEL_LISTING_BUDGET_MS,
  NEUTRAL_SCORE,
  OPTIONS_PER_PHASE_CAP,
  OUTCOME_WINDOW_DAYS,
  OUTCOME_WINDOW_MS,
  OVERALL_CALL_BUDGET_MS,
  PREFERRED_RANK_MIN_RANKED,
  PREFERRED_RANK_UNRANKED,
  PROVIDER_OPTION_LIMIT,
  QUESTIONS_PER_REQUEST,
  REQUEST_SIZE_LIMIT_BYTES,
  ROTATION_KEY_SEPARATOR,
  ROTATION_MAX_KEYS,
  ROTATION_STORAGE_KEY,
  SCORE_MAX,
  SCORE_MIN,
  SEED_LABEL_SCORE,
  STALENESS_AGE_DAYS,
  STALENESS_AGE_MS,
  TIE_BREAK_EXECUTOR_KIND_ORDER,
  TIE_BREAK_STEPS,
  type DecisionOptionProvider,
  type InsideBandLimitState,
  type SeedLabel,
  type TieBreakExecutorKind,
  type TieBreakStep,
} from './lib/routing-constants';
export {
  DecisionModelConfig,
  type DecisionModelConfigSeams,
  type SystemOneTarget,
} from './lib/decision-model/decision-model.config';
export {
  DECISION_MODEL_CONFIG_KEY,
  DECISION_MODEL_CONFIG_SECTION,
  DECISION_MODEL_JEV_SECRET_KEY,
  DECISION_MODEL_PROBE_TIMEOUT_MS,
  DECISION_MODEL_RECHECK_WINDOW_MS,
  DECISION_MODEL_UNSUPPORTED_STORAGE_KEY,
  DecisionModelSelectionSchema,
  DecisionModelUnsupportedMarkSchema,
  JEV_BASE_URL,
  SYSTEM_ONE_CONTROL_PATH,
  type DecisionModelKind,
  type DecisionModelLocality,
  type DecisionModelProbeOutcome,
  type DecisionModelProbeResult,
  type DecisionModelSelection,
  type DecisionModelSelectionInput,
  type DecisionModelState,
  type DecisionModelStatusDto,
  type DecisionModelUnsupportedMark,
} from './lib/decision-model/decision-model.types';
export type {
  StructuredDecisionCompleter,
  StructuredDecisionRequest,
} from './lib/decision-model/structured-decision.port';
export type {
  CapabilityMatrix,
  MatrixCell,
  MatrixCellSource,
  MatrixProfile,
} from './lib/matrix/matrix.types';
export {
  CapabilityMatrixStore,
  capabilityMatrixUserPath,
  capabilityMatrixViewPath,
  EMPTY_CAPABILITY_MATRIX_TEXT,
  MATRIX_INVALID_PREFIX,
  NO_OUTCOME_HISTORY_REASON,
  OUTCOMES_UNAVAILABLE_REASON,
  type CapabilityMatrixSnapshot,
  type CapabilityMatrixStoreDependencies,
  type CapabilityMatrixView,
  type MatrixLoadInput,
  type MatrixOutcomeQuery,
  type MatrixViewCell,
  type MatrixViewProfile,
  type MatrixViewUnknown,
  type MatrixViewValue,
  type ResolvedMatrixCell,
} from './lib/matrix/capability-matrix.store';
export {
  AUTOMATIC_MATRIX_MODEL,
  deriveLocalMatrix,
} from './lib/matrix/local-derivation';
export {
  score,
  type CandidateScore,
  type FallbackModel,
  type ListedModel,
  type ListedProvenance,
  type ModelProvenance,
  type ScoreCell,
  type ScoreInput,
  type ScoreMatrix,
} from './lib/ranking/score';
export {
  spread,
  type RankedCandidate,
  type SpreadInput,
  type SpreadPreferences,
  type SpreadResult,
} from './lib/ranking/spread';
export {
  ROTATION_DOCUMENT_VERSION,
  ROTATION_UNAVAILABLE_REASON,
  RotationStore,
  emptyRotationState,
  lastCandidateId,
  rotationKey,
  withPick,
  type RotationLoad,
  type RotationPick,
  type RotationState,
  type RotationWrite,
} from './lib/ranking/rotation.store';
export { registerLaneRoutingServices } from './lib/di/register';
export {
  RouteDecideService,
  type RouteDecideDependencies,
  type RouteDecideSeams,
} from './lib/route-decide.service';
export {
  DEPTHS,
  PHASE_KINDS,
  RouteDecideArgsSchema,
  type RouteDecideArgs,
} from './lib/contracts/route-decide-args.schema';
export {
  EXCLUSION_RULES,
  FALLBACK_CAUSES,
  GateResultSchema,
  PreflightResultSchema,
  PROVENANCE,
  RouteDecideResultSchema,
  type ChosenEntry,
  type GateResult,
  type PreflightResult,
  type RouteDecideResult,
  type UnavailableEntry,
} from './lib/contracts/route-decide-result.schema';
export type {
  LaneModelEntry,
  LaneModelListing,
} from './lib/lane-model-listing.port';
export type { RouteCandidateSource } from './lib/route-candidate-source.port';
export {
  CAPABILITY_MATRIX_VERSION,
  FAMILY_PROFILE_MODEL,
  MATRIX_CELL_SOURCES,
  type MatrixCells,
  type MatrixProfileKey,
  type UnknownMatrixCell,
  type ValueMatrixCell,
} from './lib/matrix/matrix.types';
