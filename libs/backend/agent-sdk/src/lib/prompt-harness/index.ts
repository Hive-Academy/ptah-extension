/**
 * Prompt Harness Module (TASK_2025_135)
 *
 * Layered prompt assembly system with user-configurable "power-ups".
 * This module provides the foundation for customizing Claude's behavior
 * through toggleable prompt enhancements.
 *
 * Module Structure:
 * - types.ts: Type definitions for the prompt harness system
 * - power-up-registry.ts: Static registry of available power-ups
 * - user-prompt-store.ts: Storage layer for user preferences (Batch 2)
 * - prompt-harness.service.ts: Assembly service (Batch 3)
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

// Future exports (Batch 2, 3):
// export { UserPromptStore } from './user-prompt-store';
// export { PromptHarnessService } from './prompt-harness.service';
