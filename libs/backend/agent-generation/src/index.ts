/**
 * @module @ptah-extension/agent-generation
 *
 * Core infrastructure for intelligent project-adaptive agent generation.
 *
 * This library provides utilities, patterns, and type definitions for:
 * - Content processing and transformation
 * - Orchestration pattern execution
 * - Agent prompt generation
 * - Type system for templates, generation, and validation
 *
 * @see README.md for development status and extraction tasks
 */
export * from './lib/di';
export * from './lib/types';
export * from './lib/interfaces';
export * from './lib/errors';
export * from './lib/utils/content-processor';
export * from './lib/patterns';
export { TemplateStorageService } from './lib/services/template-storage.service';
export { ContentGenerationService } from './lib/services/content-generation.service';
export { OutputValidationService } from './lib/services/output-validation.service';
export { AgentFileWriterService } from './lib/services/file-writer.service';
export { AgentSelectionService } from './lib/services/agent-selection.service';
export { AgentRecommendationService } from './lib/services/agent-recommendation.service';
export {
  SetupStatusService,
  type SetupStatus,
} from './lib/services/setup-status.service';
export { AnalysisStorageService } from './lib/services/analysis-storage.service';
export type { OrchestratorGenerationOptions } from './lib/services/orchestrator.service';
export { MultiCliAgentWriterService } from './lib/services/cli-agent-transforms';
export type { ICliAgentTransformer } from './lib/services/cli-agent-transforms';
export {
  WizardWebviewLifecycleService,
  AgenticAnalysisService,
  MultiPhaseAnalysisService,
  ProjectAnalysisZodSchema,
  normalizeAgentOutput,
  resolveProjectType,
  type CustomMessageHandler,
  type WizardPanelInitialData,
  type ProjectAnalysisZodOutput,
} from './lib/services/wizard';
export {
  PromptDesignerAgent,
  PROMPT_DESIGNER_SYSTEM_PROMPT,
  buildGenerationUserPrompt,
  buildFallbackGuidance,
  parseStructuredResponse,
  parseTextResponse,
  validateOutput,
  formatAsPromptSection,
  truncateToTokenBudget,
  PromptDesignerResponseSchema,
  DEFAULT_PROMPT_DESIGNER_CONFIG,
} from './lib/services/prompt-designer';
export type {
  PromptDesignerInput,
  PromptDesignerOutput,
  PromptDesignerConfig,
  PromptDesignerResponse,
  PromptGenerationProgress,
  PromptGenerationStatus,
  CachedPromptDesign,
} from './lib/services/prompt-designer';
export {
  PromptCacheService,
  DEFAULT_CACHE_CONFIG,
  INVALIDATION_TRIGGER_FILES,
  INVALIDATION_IGNORE_PATTERNS,
  CACHE_CONFIG_VERSION,
  DEFAULT_CACHE_TTL_MS,
  computeHash,
  generateCacheKey,
  extractDependencyInfo,
  isInvalidationTrigger,
  getInvalidationReason,
  isCacheExpired,
  createInvalidationEvent,
} from './lib/services/prompt-designer';
export type {
  PromptCacheConfig,
  InvalidationReason,
  InvalidationEvent,
  CacheKeyComponents,
} from './lib/services/prompt-designer';
export {
  EnhancedPromptsService,
  DEFAULT_ENHANCED_PROMPTS_CONFIG,
  createInitialEnhancedPromptsState,
} from './lib/services/enhanced-prompts';
export type {
  EnhancedPromptsState,
  EnhancedPromptsStatus,
  EnhancedPromptsConfig,
  EnhancedPromptsWizardResult,
  EnhancedPromptsSummary,
  EnhancedPromptsSdkConfig,
  DetectedStack,
  RegeneratePromptsRequest,
  RegeneratePromptsResponse,
  IMultiPhaseAnalysisReader,
} from './lib/services/enhanced-prompts';
export { UserLayerMirrorService } from './lib/services/user-layer/user-layer-mirror.service';
export type {
  UserLayerRoots,
  MirrorSources,
  MirrorResult,
  CloneEntry,
  ReconcileResult,
  DivergedClone,
  RebaseCloneArgs,
  RebaseResult,
  KeepCloneArgs,
  KeepResult,
  WriteEnhancedSkillArgs,
  WriteEnhancedResult,
  RevertCloneArgs,
  RevertResult,
  HistoryEntry,
} from './lib/services/user-layer/user-layer-mirror.service';
export type {
  OriginSidecar,
  OriginKind,
} from './lib/services/user-layer/origin-sidecar.types';
