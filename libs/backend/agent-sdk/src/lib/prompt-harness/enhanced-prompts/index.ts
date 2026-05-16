/**
 * Enhanced Prompts Module
 *
 * This module provides the Enhanced Prompts premium feature which generates
 * project-specific guidance that is appended to Anthropic's built-in
 * claude_code system prompt.
 *
 * Exports:
 * - Types: EnhancedPromptsState, DetectedStack, EnhancedPromptsConfig, etc.
 * - Service: EnhancedPromptsService (orchestrates feature)
 */

// Types
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
} from './enhanced-prompts.types';

// Service
export { EnhancedPromptsService } from './enhanced-prompts.service';
export type {
  EnhancedPromptsSdkConfig,
  IMultiPhaseAnalysisReader,
} from './enhanced-prompts.service';
