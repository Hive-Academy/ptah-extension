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

// DI tokens
export * from './lib/di';

// Type system
export * from './lib/types';

// Service interfaces
export * from './lib/interfaces';

// Error classes
export * from './lib/errors';

// Content processing utilities
export * from './lib/utils/content-processor';

// Orchestration patterns
export * from './lib/patterns';

// Services
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

// Analysis storage service (Persistent Analysis History)
export { AnalysisStorageService } from './lib/services/analysis-storage.service';

// Orchestrator types (exported for RPC handler consumption)
export type { OrchestratorGenerationOptions } from './lib/services/orchestrator.service';

// Multi-CLI Agent Transforms
export { MultiCliAgentWriterService } from './lib/services/cli-agent-transforms';
export type { ICliAgentTransformer } from './lib/services/cli-agent-transforms';

// Wizard child services and shared analysis schema
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

// ============================================================
// Enhanced Prompts System
// AI-powered, project-specific prompt generation (moved from agent-sdk).
// PTAH_CORE_SYSTEM_PROMPT stays in agent-sdk (used by InternalQueryService).
// ============================================================

// Prompt Designer Agent — pure prompt builder + result parser
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

// Prompt Cache Service — smart caching with file-based invalidation
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

// Enhanced Prompts Service — orchestrates the Enhanced Prompts feature
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
