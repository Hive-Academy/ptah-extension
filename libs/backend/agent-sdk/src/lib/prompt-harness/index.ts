/**
 * Prompt Harness Module (TASK_2025_135, TASK_2025_137)
 *
 * Layered prompt assembly system with user-configurable "power-ups"
 * and intelligent prompt generation.
 *
 * Module Structure:
 * - types.ts: Type definitions for the prompt harness system
 * - power-up-registry.ts: Static registry of available power-ups
 * - user-prompt-store.ts: Storage layer for user preferences
 * - prompt-harness.service.ts: Assembly service
 * - ptah-core-prompt.ts: Ptah's base system prompt (TASK_2025_137 Batch 1)
 * - prompt-designer/: Intelligent prompt generation (TASK_2025_137 Batch 2)
 *   - prompt-designer-agent.ts: Main agent for generating project-specific guidance
 *   - prompt-designer.types.ts: Input/output type definitions
 *   - generation-prompts.ts: Prompt templates for LLM generation
 *   - response-parser.ts: Response parsing and validation
 */

// Type exports
export type {
  PowerUpCategory,
  PromptLayerType,
  PromptWarningType,
  PromptWarningSeverity,
  PowerUpDefinition,
  PowerUpState,
  UserPromptSection,
  PromptHarnessConfig,
  PromptLayer,
  PromptWarning,
  AssembledPrompt,
} from './types';

// Registry exports
export {
  POWER_UP_DEFINITIONS,
  getPowerUp,
  getPowerUpsByCategory,
  getFreePowerUps,
  getPremiumPowerUps,
  getPowerUpCategories,
  calculateTotalTokens,
} from './power-up-registry';

// Storage layer (Batch 2)
export { UserPromptStore } from './user-prompt-store';

// Assembly service (Batch 3)
export { PromptHarnessService } from './prompt-harness.service';

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
  FRAMEWORK_PROMPT_ADDITIONS,
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
