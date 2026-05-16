/**
 * Prompt Designer Module
 *
 * This module provides:
 * - PromptDesignerAgent: Main agent that generates project-specific guidance
 * - PromptCacheService: Smart caching with file-based invalidation
 * - Types for input/output contracts
 * - Generation prompts and response parsing utilities
 */

// Main agent
export { PromptDesignerAgent } from './prompt-designer-agent';

// Cache service (Batch 3)
export { PromptCacheService } from './prompt-cache.service';
export type { PromptCacheConfig } from './prompt-cache.service';
export { DEFAULT_CACHE_CONFIG } from './prompt-cache.service';

// Types
export type {
  PromptDesignerInput,
  PromptDesignerOutput,
  PromptDesignerConfig,
  PromptDesignerResponse,
  PromptGenerationProgress,
  PromptGenerationStatus,
  CachedPromptDesign,
} from './prompt-designer.types';

export {
  PromptDesignerResponseSchema,
  DEFAULT_PROMPT_DESIGNER_CONFIG,
} from './prompt-designer.types';

// Prompts (for testing and extension)
export {
  PROMPT_DESIGNER_SYSTEM_PROMPT,
  buildGenerationUserPrompt,
  buildFallbackGuidance,
} from './generation-prompts';

// Response parsing (for testing)
export {
  parseStructuredResponse,
  parseTextResponse,
  validateOutput,
  formatAsPromptSection,
  truncateToTokenBudget,
} from './response-parser';

// Cache invalidation utilities (Batch 3)
export {
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
} from './cache-invalidation';

export type {
  InvalidationReason,
  InvalidationEvent,
  CacheKeyComponents,
} from './cache-invalidation';
