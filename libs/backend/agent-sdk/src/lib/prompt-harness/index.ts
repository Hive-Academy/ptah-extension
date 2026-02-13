/**
 * Enhanced Prompts Module (TASK_2025_137)
 *
 * Intelligent prompt generation system that analyzes workspaces and
 * generates project-specific guidance for Claude.
 *
 * Module Structure:
 * - ptah-core-prompt.ts: Ptah's base system prompt (Batch 1)
 * - prompt-designer/: AI-powered prompt generation (Batch 2-3)
 *   - prompt-designer-agent.ts: Main agent for generating guidance
 *   - prompt-designer.types.ts: Input/output type definitions
 *   - generation-prompts.ts: Prompt templates for LLM generation
 *   - response-parser.ts: Response parsing and validation
 *   - prompt-cache.service.ts: Smart caching with invalidation (Batch 3)
 *   - cache-invalidation.ts: File-based invalidation triggers
 */

// Core prompt (TASK_2025_137 Batch 1)
export {
  PTAH_CORE_SYSTEM_PROMPT,
  PTAH_CORE_SYSTEM_PROMPT_TOKENS,
} from './ptah-core-prompt';

// Prompt Designer Agent (TASK_2025_137 Batch 2)
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

// Prompt Cache Service (TASK_2025_137 Batch 3)
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

// Enhanced Prompts Service (TASK_2025_137 Batch 4)
export {
  DetectedStack,
  EnhancedPromptsState,
  EnhancedPromptsConfig,
  EnhancedPromptsWizardResult,
  EnhancedPromptsStatus,
  RegeneratePromptsRequest,
  RegeneratePromptsResponse,
  DEFAULT_ENHANCED_PROMPTS_CONFIG,
  createInitialEnhancedPromptsState,
  EnhancedPromptsService,
} from './enhanced-prompts';

export type { EnhancedPromptsSdkConfig } from './enhanced-prompts';
