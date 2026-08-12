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

/**
 * Cross-library DI token for agent-sdk's SessionActivityRegistry.
 * Matches SDK_TOKENS.SDK_SESSION_ACTIVITY_REGISTRY =
 * Symbol.for('SdkSessionActivityRegistry').
 *
 * Declared here rather than imported for the same reason as
 * INTERNAL_QUERY_SERVICE_TOKEN above, and injected `{isOptional: true}` so a
 * CLI or e2e host that never registers the SDK still resolves
 * `ForegroundActivityTracker`.
 */
export const SESSION_ACTIVITY_REGISTRY_TOKEN = Symbol.for(
  'SdkSessionActivityRegistry',
);

/**
 * Cross-library DI token for the provider auth resolver.
 * Matches SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER =
 * Symbol.for('SdkProviderAuthResolver').
 *
 * The port is declared in `agent-sdk` and implemented in `auth-providers`,
 * two libs away; referenced by symbol here for the same reason as
 * INTERNAL_QUERY_SERVICE_TOKEN, and injected `{isOptional: true}` so a CLI or
 * e2e host that registers neither still resolves `LaneResolverService` — with
 * every lane riding the active provider, which is the pre-lane behaviour.
 *
 * A typo here does NOT fail loudly: the optional injection resolves `null` and
 * every lane silently ignores its configured provider. `di/register.spec.ts`
 * pins the symbol for that reason.
 */
export const PROVIDER_AUTH_RESOLVER_TOKEN = Symbol.for(
  'SdkProviderAuthResolver',
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
  /** SkillSynthesizerService — LLM-driven candidate body synthesis. */
  SKILL_SYNTHESIZER_SERVICE: Symbol.for('PtahSkillSynthesizerService'),
  /** SkillSuggestionStore — SQLite persistence for cluster-level suggestions. */
  SKILL_SUGGESTION_STORE: Symbol.for('PtahSkillSuggestionStore'),
  /** SkillClusteringService — groups candidates for cluster suggestions. */
  SKILL_CLUSTERING_SERVICE: Symbol.for('PtahSkillClusteringService'),
  /** SpecHarvesterService — reconciles .ptah/specs verdicts into telemetry. */
  SPEC_HARVESTER_SERVICE: Symbol.for('PtahSpecHarvesterService'),
  /** SubagentMetricsExtractor — transcript → per-invocation metrics + task_id. */
  SUBAGENT_METRICS_EXTRACTOR: Symbol.for('PtahSubagentMetricsExtractor'),
  /** SkillScorecardService — composes subagent metric aggregates + verdicts. */
  SKILL_SCORECARD_SERVICE: Symbol.for('PtahSkillScorecardService'),
  /** SkillQueueStore — durable synthesis queue: enqueue, CAS claim, reap. */
  SKILL_QUEUE_STORE: Symbol.for('PtahSkillSynthesisQueueStore'),
  /** SkillBudgetStore — per-UTC-day token/cost ledger behind the drain gate. */
  SKILL_BUDGET_STORE: Symbol.for('PtahSkillSynthesisBudgetStore'),
  /** SkillDrainService — gated, round-robin drain of the synthesis queue. */
  SKILL_DRAIN_SERVICE: Symbol.for('PtahSkillSynthesisDrainService'),
  /** ForegroundActivityTracker — ms since the last chat turn, for the backoff gate. */
  FOREGROUND_ACTIVITY_TRACKER: Symbol.for('PtahSkillForegroundActivityTracker'),
  /** LaneResolverService — lane id → {auth snapshot, model} via the shared auth chain. */
  LANE_RESOLVER_SERVICE: Symbol.for('PtahSkillLaneResolverService'),
  /** SessionVerdictStore — the archaeologist's structured per-session verdict (`0034`). */
  SESSION_VERDICT_STORE: Symbol.for('PtahSkillSessionVerdictStore'),
} as const;

export type SkillSynthesisDIToken = keyof typeof SKILL_SYNTHESIS_TOKENS;
