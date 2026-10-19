/** Public skill library API. */
export {
  resolveSkillsRoot,
  SKILLS_ROOT_KEY,
  SKILLS_ROOT_SECTION,
} from './lib/skills-root';
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
  LANE_QUOTA_RETRY_MS,
  TRANSPORT_LANE_FAILURE_KINDS,
  isTransportLaneFailure,
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
  PROVIDER_QUOTA_ERROR_NAME,
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
  LANE_TOOL_USE_DEFAULT_MAX_TURNS,
  timeoutBackoffMs,
  SKILL_SYNTHESIS_QUERY_LANE,
  skillQueryLane,
  type LaneRunRequest,
  type LaneRun,
  type LaneRunResult,
  type LaneDegradedReason,
} from './lib/lanes/lane-runner.service';
export {
  USER_ACTION_QUERY_LANE,
  type QueryOrigin,
} from './lib/internal-query.interface';
export { registerSkillSynthesisServices } from './lib/di/register';
export {
  migrateSkillMdFiles,
  SKILL_MD_MIGRATION_VERSION,
  SKILL_MD_MIGRATION_RESCAN_INTERVAL_MS,
  type MigrationResult,
  type SkillMdMigrationMarkerState,
  type SkillMdMigrationMarkerStore,
} from './lib/skill-md-migration';
export { SkillMdMigrationStateStore } from './lib/skill-md-migration-state.store';
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
  ForegroundActivityTracker,
  type ForegroundActivityPayload,
  type ForegroundActivitySource,
} from './lib/queue/foreground-activity.tracker';
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



export type {
  SkillSynthesisSettings,
} from './lib/types';
