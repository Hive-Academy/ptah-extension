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
// The catalog's source and filter unions are the wire contract in
// `@ptah-extension/shared` (`rpc-decision-model-catalog.types.ts`).
export {
  DecisionModelCatalog,
  type DecisionModelCatalogResult,
} from './lib/decision-model/decision-model.catalog';
export { keyTransportAllowed } from './lib/decision-model/decision-endpoint.url';
export {
  DecisionModelKeys,
  type DecisionKeySlot,
} from './lib/decision-model/decision-model.keys';
export {
  DecisionModelSelectionSchema,
  type DecisionModelKind,
  type DecisionModelLocality,
  type DecisionModelSelection,
  type DecisionModelSelectionInput,
  type DecisionModelState,
  type DecisionModelStatusDto,
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
export { BUILTIN_SUBAGENT_ROLES } from './lib/pipeline/phase-plan';
export { HostRoutingSetting } from './lib/scope/host-routing-setting';
export { PreflightReuseCache } from './lib/scope/preflight-reuse-cache';
export {
  ScopeCheckService,
  buildPreflightScopeSummary,
  type ScopeAssessment,
  type ScopeConversation,
} from './lib/scope/scope-check.service';
