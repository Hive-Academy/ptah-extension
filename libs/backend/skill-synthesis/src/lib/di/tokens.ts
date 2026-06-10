/**
 * DI Token Registry — Skill Synthesis Tokens.
 *
 * Convention mirrors `libs/backend/agent-sdk/src/lib/di/tokens.ts`:
 *  - Always `Symbol.for('Name')` (globally interned).
 *  - Each description globally unique across all token files.
 *  - Frozen `as const` so consumers narrow on the symbol values.
 */

/**
 * Cross-library DI token for InternalQueryService.
 * Matches SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE = Symbol.for('SdkInternalQueryService').
 *
 * Defined here instead of importing from `@ptah-extension/agent-sdk` to
 * avoid a circular dependency (skill-synthesis → agent-sdk → skill-synthesis).
 */
export const INTERNAL_QUERY_SERVICE_TOKEN = Symbol.for(
  'SdkInternalQueryService',
);

/**
 * Cross-library DI token for agent-generation's UserLayerMirrorService.
 * Matches AGENT_GENERATION_TOKENS.USER_LAYER_MIRROR_SERVICE =
 * Symbol.for('PtahUserLayerMirrorService').
 *
 * Referenced via Symbol.for() instead of importing the agent-generation
 * barrel as a value — the barrel transitively pulls in workspace-intelligence
 * tree-sitter (import.meta) code that breaks the CommonJS Jest transform.
 */
export const USER_LAYER_MIRROR_SERVICE_TOKEN = Symbol.for(
  'PtahUserLayerMirrorService',
);

export const SKILL_SYNTHESIS_TOKENS = {
  /** SkillSynthesisService — top-level orchestrator (analyzes sessions). */
  SKILL_SYNTHESIS_SERVICE: Symbol.for('PtahSkillSynthesisService'),
  /** SkillPromotionService — applies the 3-success threshold + dedup + cap. */
  SKILL_PROMOTION_SERVICE: Symbol.for('PtahSkillPromotionService'),
  /** SkillInvocationTracker — records per-session invocations (success/fail). */
  SKILL_INVOCATION_TRACKER: Symbol.for('PtahSkillInvocationTracker'),
  /** SkillCandidateStore — SQLite persistence layer for candidates + vec rows. */
  SKILL_CANDIDATE_STORE: Symbol.for('PtahSkillCandidateStore'),
  /** SkillClusterDedupService — cluster-centroid dedup for promoted skills. */
  SKILL_CLUSTER_DEDUP_SERVICE: Symbol.for('PtahSkillClusterDedupService'),
  /** SkillJudgeService — LLM-as-judge gate during promotion. */
  SKILL_JUDGE_SERVICE: Symbol.for('PtahSkillJudgeService'),
  /** SkillCuratorService — Hermes-style periodic skill curation daemon. */
  SKILL_CURATOR_SERVICE: Symbol.for('PtahSkillCuratorService'),
  /** SkillTriggerService — idle + boot-scan triggers for analyzeSession. */
  SKILL_TRIGGER_SERVICE: Symbol.for('PtahSkillTriggerService'),
  /** SkillSynthesisDiagnosticsService — read-only diagnostics snapshot. */
  SKILL_DIAGNOSTICS_SERVICE: Symbol.for('PtahSkillSynthesisDiagnosticsService'),
  /** SkillInvocationRecorder — capture-path telemetry for skill invocations. */
  SKILL_INVOCATION_RECORDER: Symbol.for('PtahSkillInvocationRecorder'),
  /** SkillRegistryStore — SQLite catalog of cloned skills/agents/commands. */
  SKILL_REGISTRY_STORE: Symbol.for('PtahSkillRegistryStore'),
  /** SkillRegistryCatalogService — sidecar→skill_registry enrichment sync. */
  SKILL_REGISTRY_CATALOG_SERVICE: Symbol.for('PtahSkillRegistryCatalogService'),
  /** SkillEnhancerService — judge-gated auto-enhancement of cloned skills. */
  SKILL_ENHANCER_SERVICE: Symbol.for('PtahSkillEnhancerService'),
} as const;

export type SkillSynthesisDIToken = keyof typeof SKILL_SYNTHESIS_TOKENS;
