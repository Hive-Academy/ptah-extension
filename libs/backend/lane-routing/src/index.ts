/**
 * @ptah-extension/lane-routing — host-neutral decision-model lane routing.
 *
 * May import only `@ptah-extension/shared` and `@ptah-extension/platform-core`.
 */
export {
  LANE_ROUTING_TOKENS,
  type LaneRoutingDIToken,
} from './lib/di/tokens';
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
  ROTATION_TASK_KINDS,
  SCORE_MAX,
  SCORE_MIN,
  SEED_LABEL_SCORE,
  STALENESS_AGE_DAYS,
  STALENESS_AGE_MS,
  TIE_BREAK_EXECUTOR_KIND_ORDER,
  TIE_BREAK_STEPS,
  type DecisionOptionProvider,
  type InsideBandLimitState,
  type RotationTaskKind,
  type SeedLabel,
  type TieBreakExecutorKind,
  type TieBreakStep,
} from './lib/routing-constants';
