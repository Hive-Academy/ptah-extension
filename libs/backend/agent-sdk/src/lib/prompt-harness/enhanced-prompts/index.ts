/**
 * Enhanced Prompts Module
 *
 * TASK_2025_137: Intelligent Prompt Generation System
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
  EnhancedPromptsStatus,
  RegeneratePromptsRequest,
  RegeneratePromptsResponse,
  DEFAULT_ENHANCED_PROMPTS_CONFIG,
  createInitialEnhancedPromptsState,
} from './enhanced-prompts.types';

// Service
export { EnhancedPromptsService } from './enhanced-prompts.service';
