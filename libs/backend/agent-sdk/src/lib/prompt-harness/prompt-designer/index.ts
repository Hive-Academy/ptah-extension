/**
 * Prompt Designer Module
 *
 * TASK_2025_137 Batch 2: Intelligent prompt generation based on workspace analysis.
 *
 * This module provides:
 * - PromptDesignerAgent: Main agent that generates project-specific guidance
 * - Types for input/output contracts
 * - Generation prompts and response parsing utilities
 */

// Main agent
export { PromptDesignerAgent } from './prompt-designer-agent';

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
  FRAMEWORK_PROMPT_ADDITIONS,
} from './generation-prompts';

// Response parsing (for testing)
export {
  parseStructuredResponse,
  parseTextResponse,
  validateOutput,
  formatAsPromptSection,
  truncateToTokenBudget,
} from './response-parser';
