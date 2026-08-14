/**
 * @ptah-extension/skill-synthesis — public API.
 *
 * Records each successful AI session, when a stable trajectory repeats
 * 3 times the corresponding workflow is promoted to a permanent SKILL.md
 * under `~/.ptah/skills/<slug>/`. Cosine-similarity dedup against the
 * active set keeps the library focused; over the residency budget the
 * weakest skills are demoted to dormant (kept on disk, skipped at the
 * junction layer) rather than deleted.
 */
export { SkillCandidateStore } from './lib/skill-candidate.store';
export { SkillMdGenerator } from './lib/skill-md-generator';
export type { SkillMdInput, MaterializedSkill } from './lib/skill-md-generator';
export {
  SkillPromotionService,
  type PromotionDecision,
} from './lib/skill-promotion.service';
export {
  SkillInvocationTracker,
  type RecordInvocationInput,
  type RecordInvocationResult,
} from './lib/skill-invocation-tracker';
export { SkillSynthesisService } from './lib/skill-synthesis.service';
export {
  TrajectoryExtractor,
  type ExtractedTrajectory,
  MIN_TURNS_FOR_TRAJECTORY,
} from './lib/trajectory-extractor';

export {
  SKILL_SYNTHESIS_TOKENS,
  INTERNAL_QUERY_SERVICE_TOKEN,
  USER_LAYER_MIRROR_SERVICE_TOKEN,
  SESSION_ACTIVITY_REGISTRY_TOKEN,
  PROVIDER_AUTH_RESOLVER_TOKEN,
  type SkillSynthesisDIToken,
} from './lib/di/tokens';
export {
  SKILL_LANE_IDS,
  LANE_AUTH_RETRY_MS,
  type SkillLaneId,
  type SkillLaneTier,
  type SkillLaneConfig,
  type LaneAuthOverride,
  type ResolvedSkillLane,
  type SkillLaneFailureKind,
  type SkillLaneFailure,
  type SkillLaneResolution,
} from './lib/lanes/lane.types';
export {
  PROVIDER_AUTH_ERROR_NAME,
  type ILaneAuthResolver,
  type LaneTierScope,
} from './lib/lanes/lane-auth-resolver.port';
export {
  SKILL_LANE_SECTION,
  SKILL_LANE_FIELDS,
  SKILL_LANE_KEYS,
  SKILL_LANE_DEFAULTS,
  SKILL_LANE_PREFIXES,
  maxLaneTimeoutMs,
  readSkillLane,
  readSkillLanes,
  flattenSkillLanes,
  type SkillLaneField,
  type SkillLanesPatch,
} from './lib/lanes/skill-lane-config';
export {
  LaneResolverService,
  resolveLaneModel,
} from './lib/lanes/lane-resolver.service';
export {
  LaneRunnerService,
  LANE_TRUNCATION_MARKER,
  LANE_DEGRADED_RETRY_MS,
  LANE_RETRY_BACKOFF_BASE_MS,
  LANE_MAX_RETRY_BACKOFF_MS,
  LANE_MAX_EXECUTIONS_PER_RUN,
  timeoutBackoffMs,
  type LaneRunRequest,
  type LaneRun,
  type LaneRunResult,
  type LaneDegradedReason,
} from './lib/lanes/lane-runner.service';
export { registerSkillSynthesisServices } from './lib/di/register';
export {
  migrateSkillMdFiles,
  type MigrationResult,
} from './lib/skill-md-migration';
export {
  SkillSynthesizerService,
  SYNTHESIZED_SKILL_JSON_SCHEMA,
  type SynthesizedSkill,
  type ClusterMemberInput,
} from './lib/skill-synthesizer.service';
export { SkillSuggestionStore } from './lib/skill-suggestion.store';
export {
  SkillClusteringService,
  type SkillCandidateCluster,
} from './lib/skill-clustering.service';
export { SkillClusterDedupService } from './lib/skill-cluster-dedup.service';
export {
  SkillJudgeService,
  JUDGE_REASONS,
  JUDGE_VERDICT_JSON_SCHEMA,
  type JudgeDecision,
  type JudgeCriteria,
} from './lib/skill-judge.service';
export {
  CandidateNamerService,
  CANDIDATE_DISPLAY_NAME_MAX_CHARS,
  CANDIDATE_NAMING_JSON_SCHEMA,
  type CandidateNaming,
  type CandidateNamingSource,
} from './lib/naming/candidate-namer.service';
export {
  SkillCuratorService,
  type CuratorReport,
  type AcceptSuggestionResult,
  type DismissSuggestionResult,
} from './lib/skill-curator.service';
export { cosineSimilarity } from './lib/cosine-similarity';
export { SkillTriggerService } from './lib/triggers/skill-trigger.service';
export {
  SKILL_TRIGGER_DEFAULTS,
  SKILL_TRIGGER_KEYS,
  SKILL_TRIGGER_PREFIXES,
  SKILL_TRIGGER_SECTION,
  flattenSkillTriggers,
  readSkillTriggers,
  type PopulatedSkillTriggers,
} from './lib/triggers/skill-trigger-config';
export {
  SkillRegistryStore,
  type SkillRegistryEntry,
  type SkillRegistryRow,
  type SkillRegistryKind,
  type CloneStatus,
} from './lib/skill-registry.store';
export {
  SkillRegistryCatalogService,
  type CatalogSyncResult,
} from './lib/skill-registry-catalog.service';
export {
  SkillEnhancerService,
  ProposalNotFoundError,
  MIN_INVOCATIONS_TO_ENHANCE,
  ENHANCE_COOLDOWN_MS,
  PROPOSAL_TTL_MS,
  MAX_CACHED_PROPOSALS,
  type EnhanceResult,
  type EnhanceOptions,
  type EnhanceSkipReason,
  type RevertEnhancementResult,
  type EnhancementProposal,
  type GenerateProposalResult,
  type ApplyProposalResult,
  type ProposalRejectionCode,
} from './lib/skill-enhancer.service';
export {
  SKILL_REPROPAGATION_TOKEN,
  type SkillRepropagationPort,
  type SkillRepropagationKind,
} from './lib/skill-repropagation.port';
export {
  SPEC_FINDINGS_TOKEN,
  NoOpSpecFindings,
  type SpecFindingsPort,
} from './lib/spec-findings.port';
export {
  SpecHarvesterService,
  type SpecStatus,
  type SpecSummary,
  type HarvestResult,
  type ClearStaleResult,
} from './lib/spec-harvester.service';
export {
  extractSpec,
  parseBatchVerdicts,
  detectStatus,
  normalizeExecutor,
  HARVEST_MARKER_FILE,
  type HarvestedSpec,
  type SpecBatchVerdict,
  type SpecBatchStatus,
} from './lib/spec-extractor';
export { SkillScorecardService } from './lib/skill-scorecard.service';
export {
  SkillQueueStore,
  STALE_CLAIM_REASON,
} from './lib/queue/skill-queue.store';
export {
  SkillBudgetStore,
  utcDayKey,
  UNATTRIBUTED_STAGE,
  type SkillBudgetUsage,
  type SkillBudgetDay,
  type SkillBudgetStage,
  type SkillBudgetStageDay,
  type SkillBudgetRecordOptions,
} from './lib/queue/skill-budget.store';
export {
  SKILL_QUEUE_STAGES,
  SKILL_QUEUE_STATUSES,
  type SkillQueueStage,
  type SkillQueueStatus,
  type SkillQueueSource,
  type SkillQueueRow,
  type EnqueueInput,
  type EnqueueOutcome,
  type EnqueueResult,
  type MarkOptions,
  type MarkUnscoredOptions,
} from './lib/queue/skill-queue.types';
export {
  ForegroundActivityTracker,
  type ForegroundActivityPayload,
  type ForegroundActivitySource,
} from './lib/queue/foreground-activity.tracker';
export {
  SkillDrainService,
  DRAIN_TIER_STAGES,
  SKILL_DRAIN_DEFAULTS,
  SKILL_DRAIN_KEYS,
  SKILL_DRAIN_SECTION,
  MAX_STAGE_TIMEOUT_MS,
  STALE_CLAIM_TTL_SAFETY_FACTOR,
  type DrainTier,
  type DrainOptions,
  type DrainSkipReason,
  type DrainSummary,
  type SkillDrainConfig,
  type SkillStageContext,
  type SkillStageHandler,
  type SkillStageResult,
} from './lib/queue/skill-drain.service';
export {
  EVIDENCE_CLASSES,
  FRICTION_KINDS,
  SESSION_VERDICT_DEGRADED_REASONS,
  SESSION_VERDICT_JSON_SCHEMA,
  isEvidenceClass,
  type EvidenceClass,
  type FrictionKind,
  type FrictionEntry,
  type RoutineDraft,
  type SessionVerdict,
  type SessionVerdictInput,
  type SessionVerdictDraft,
} from './lib/archaeology/session-verdict.types';
export { SessionVerdictStore } from './lib/archaeology/session-verdict.store';
export {
  SessionArchaeologistService,
  ARCHAEOLOGY_DEGRADED_REASONS,
  ARCHAEOLOGY_TAIL_BUDGET_SHARE,
  ARCHAEOLOGY_HEAD_BUDGET_SHARE,
  ARCHAEOLOGY_SERVE_BUDGET_SHARE,
  ARCHAEOLOGY_MAX_REQUESTS_PER_PASS,
  type SessionArchaeologyRequest,
  type SessionArchaeologyResult,
} from './lib/archaeology/session-archaeologist.service';
export { SkillSynthesisDiagnosticsService } from './lib/diagnostics.service';
export type {
  SkillSynthesisEvent,
  SkillSynthesisEventKind,
  SkillIneligibleReason,
  EligibilityHistogram,
  SkillCandidateStatusCounts,
  SkillSynthesisDiagnosticsSnapshot,
} from './lib/diagnostics.types';

export {
  JUDGE_DEFAULT_MODEL_ID,
  JUDGE_STATUSES,
  unjudgedVerdictFields,
} from './lib/types';
export type {
  JudgeStatus,
  JudgeCriterionScores,
  JudgeVerdict,
  JudgeVerdictFields,
  JudgedCandidateRow,
  SkillId,
  CandidateId,
  SkillStatus,
  SkillResidency,
  SkillCandidateRow,
  SkillInvocationRow,
  SubagentRunMetrics,
  ScorecardAggregate,
  GradedInvocationRow,
  SkillSynthesisSettings,
  NewCandidateInput,
  RegisterCandidateResult,
  SkillSuggestionRow,
  SkillSuggestionStatus,
  NewSuggestionInput,
} from './lib/types';
