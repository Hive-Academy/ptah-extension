/**
 * DI tokens for `@ptah-extension/lane-routing`.
 *
 * `Symbol.for('LaneRouting…')` follows the prefix style in
 * `libs/backend/platform-core/src/di/tokens.ts`. Each description is globally
 * unique. Optional ports are implemented outside this library and injected
 * with `{ isOptional: true }`.
 */
export const LANE_ROUTING_TOKENS = {
  /** Lib-owned route service. */
  ROUTE_DECIDE_SERVICE: Symbol.for('LaneRoutingRouteDecideService'),
  /** Lib-owned decision-model configuration. */
  DECISION_MODEL_CONFIG: Symbol.for('LaneRoutingDecisionModelConfig'),
  /** Lib-owned decision-model catalog (picker listing only). */
  DECISION_MODEL_CATALOG: Symbol.for('LaneRoutingDecisionModelCatalog'),
  /** Optional port. Implemented outside this library. */
  LANE_MODEL_LISTING: Symbol.for('LaneRoutingLaneModelListing'),
  /** Optional port. Implemented outside this library. */
  STRUCTURED_DECISION: Symbol.for('LaneRoutingStructuredDecision'),
  /**
   * Optional port. Composition roots alias the lane-outcomes reader onto
   * this token with `useToken`.
   */
  LANE_OUTCOME_READER: Symbol.for('LaneRoutingLaneOutcomeReader'),
  /** Lib-owned capability matrix store. */
  CAPABILITY_MATRIX_STORE: Symbol.for('LaneRoutingCapabilityMatrixStore'),
  /** Lib-owned rotation store. */
  ROTATION_STORE: Symbol.for('LaneRoutingRotationStore'),
  /**
   * Lib-owned failure classifier. The outcomes library aliases its own
   * token onto this one.
   */
  FAILURE_CLASSIFIER: Symbol.for('LaneRoutingFailureClassifier'),
  /** Lib-owned task-kind classifier. */
  TASK_KIND_CLASSIFIER: Symbol.for('LaneRoutingTaskKindClassifier'),
  /** Lib-owned scope assessor for host routing. */
  SCOPE_CHECK_SERVICE: Symbol.for('LaneRoutingScopeCheckService'),
  /** Lib-owned per-session pre-flight reuse cache. */
  PREFLIGHT_REUSE_CACHE: Symbol.for('LaneRoutingPreflightReuseCache'),
  /** Lib-owned effective host routing setting. */
  HOST_ROUTING_SETTING: Symbol.for('LaneRoutingHostRoutingSetting'),
  /** Lib-owned structural logger (`LaneRoutingLogger`). */
  LOGGER: Symbol.for('LaneRoutingLogger'),
} as const;

export type LaneRoutingDIToken =
  (typeof LANE_ROUTING_TOKENS)[keyof typeof LANE_ROUTING_TOKENS];
