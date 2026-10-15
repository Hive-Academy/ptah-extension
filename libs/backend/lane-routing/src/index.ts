/**
 * @ptah-extension/lane-routing — host-neutral decision-model lane routing.
 *
 * May import only `@ptah-extension/shared` and `@ptah-extension/platform-core`.
 *
 * Host-facing surface only: tokens, registration, ports, the route service
 * and its schemas, and the decision-model settings DTOs. Ranking, rotation,
 * matrix diagnostics and the failure classifier stay inside the library.
 */
export { LANE_ROUTING_TOKENS, type LaneRoutingDIToken } from './lib/di/tokens';
export type {
  LaneRoutingLogMeta,
  LaneRoutingLogger,
} from './lib/lane-routing-logger';
export {
  DecisionModelConfig,
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
export { registerLaneRoutingServices } from './lib/di/register';
export {
  RouteDecideService,
  type RouteDecideDependencies,
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
