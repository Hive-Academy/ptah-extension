/**
 * Enhanced Prompts Module
 *
 * Intelligent prompt generation system that analyzes workspaces and
 * generates project-specific guidance for Claude.
 *
 * Module Structure:
 * - ptah-core-prompt.ts: Ptah's base system prompt
 * - prompt-designer/: AI-powered prompt generation
 *   - prompt-designer-agent.ts: Main agent for generating guidance
 *   - prompt-designer.types.ts: Input/output type definitions
 *   - generation-prompts.ts: Prompt templates for LLM generation
 *   - response-parser.ts: Response parsing and validation
 *   - prompt-cache.service.ts: Smart caching with invalidation
 *   - cache-invalidation.ts: File-based invalidation triggers
 */

// Core prompt
export {
  PTAH_CORE_SYSTEM_PROMPT,
  PTAH_CORE_SYSTEM_PROMPT_TOKENS,
  PTAH_MCP_MANDATE_PROMPT,
} from './ptah-core-prompt';

// Prompt Designer Agent
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
} from './prompt-designer';

export type {
  PromptDesignerInput,
  PromptDesignerOutput,
  PromptDesignerConfig,
  PromptDesignerResponse,
  PromptGenerationProgress,
  PromptGenerationStatus,
  CachedPromptDesign,
} from './prompt-designer';

// Prompt Cache Service
export {
  PromptCacheService,
  DEFAULT_CACHE_CONFIG,
  // Cache invalidation utilities
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
} from './prompt-designer';

export type {
  PromptCacheConfig,
  InvalidationReason,
  InvalidationEvent,
  CacheKeyComponents,
} from './prompt-designer';

// Enhanced Prompts Service
export {
  DetectedStack,
  EnhancedPromptsState,
  EnhancedPromptsConfig,
  EnhancedPromptsWizardResult,
  EnhancedPromptsSummary,
  EnhancedPromptsStatus,
  RegeneratePromptsRequest,
  RegeneratePromptsResponse,
  DEFAULT_ENHANCED_PROMPTS_CONFIG,
  createInitialEnhancedPromptsState,
  EnhancedPromptsService,
} from './enhanced-prompts';

export type {
  EnhancedPromptsSdkConfig,
  IMultiPhaseAnalysisReader,
} from './enhanced-prompts';
