/**
 * Type System Barrel Export
 *
 * Centralized export point for all type definitions in the agent-generation library.
 * Provides a clean import path for consumers:
 * `import { AgentTemplate, GeneratedAgent } from '@ptah-extension/agent-generation';`
 *
 * @module @ptah-extension/agent-generation/types
 */

// Core type system
export type {
  AgentTemplate,
  ApplicabilityRules,
  TemplateVariable,
  LlmSection,
  AgentProjectContext,
  TechStackSummary,
  CodeConventions,
  LlmCustomization,
  GeneratedAgent,
  GenerationOptions,
  GenerationSummary,
  ValidationResult,
  ValidationIssue,
} from './core.types';

// Re-export commonly used types from workspace-intelligence for convenience
// This prevents consumers from having to import from multiple libraries
export type {
  ProjectType,
  Framework,
  MonorepoType,
  IndexedFile,
  FileType,
} from '@ptah-extension/workspace-intelligence';
