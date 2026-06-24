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
  type SkillSynthesisDIToken,
} from './lib/di/tokens';
export { registerSkillSynthesisServices } from './lib/di/register';
export {
  migrateSkillMdFiles,
  type MigrationResult,
} from './lib/skill-md-migration';
export {
  SkillSynthesizerService,
  type SynthesizedSkill,
  type ClusterMemberInput,
} from './lib/skill-synthesizer.service';
export { SkillSuggestionStore } from './lib/skill-suggestion.store';
export {
  SkillClusteringService,
  type SkillCandidateCluster,
} from './lib/skill-clustering.service';
export { SkillClusterDedupService } from './lib/skill-cluster-dedup.service';
export { SkillJudgeService } from './lib/skill-judge.service';
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
  MIN_INVOCATIONS_TO_ENHANCE,
  ENHANCE_COOLDOWN_MS,
  type EnhanceResult,
  type EnhanceOptions,
  type EnhanceSkipReason,
  type RevertEnhancementResult,
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
export { SkillSynthesisDiagnosticsService } from './lib/diagnostics.service';
export type {
  SkillSynthesisEvent,
  SkillSynthesisEventKind,
  SkillIneligibleReason,
  EligibilityHistogram,
  SkillCandidateStatusCounts,
  SkillSynthesisDiagnosticsSnapshot,
} from './lib/diagnostics.types';

export { JUDGE_DEFAULT_MODEL_ID } from './lib/types';
export type {
  SkillId,
  CandidateId,
  SkillStatus,
  SkillResidency,
  SkillCandidateRow,
  SkillInvocationRow,
  SkillSynthesisSettings,
  NewCandidateInput,
  RegisterCandidateResult,
  SkillSuggestionRow,
  SkillSuggestionStatus,
  NewSuggestionInput,
} from './lib/types';
