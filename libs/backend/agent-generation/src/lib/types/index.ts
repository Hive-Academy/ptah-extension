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
  CodeConventions as CoreCodeConventions,
  LlmCustomization,
  GeneratedAgent,
  GenerationOptions,
  GenerationSummary,
  ValidationResult,
  ValidationIssue,
} from './core.types';

// Deep analysis types for MCP-powered setup wizard
export type {
  DeepProjectAnalysis,
  ArchitecturePattern,
  ArchitecturePatternName,
  KeyFileLocations,
  LanguageStats,
  DiagnosticSummary,
  CodeConventions,
  NamingConventions,
  NamingConvention,
  TestCoverageEstimate,
  AgentRecommendation,
  AgentCategory,
} from './analysis.types';

// Multi-phase analysis types (TASK_2025_154)
export type {
  MultiPhaseId,
  PhaseResult,
  MultiPhaseManifest,
  MultiPhaseAnalysisOptions,
} from './multi-phase.types';
export { PHASE_CONFIGS } from './multi-phase.types';

// Re-export commonly used types from workspace-intelligence for convenience
// This prevents consumers from having to import from multiple libraries
export type {
  ProjectType,
  Framework,
  MonorepoType,
  IndexedFile,
  FileType,
} from '@ptah-extension/workspace-intelligence';

// Re-export quality assessment types for DeepProjectAnalysis consumers (TASK_2025_141)
// These types are used by the optional quality fields in DeepProjectAnalysis
export type {
  QualityAssessment,
  QualityGap,
  PrescriptiveGuidance,
} from '@ptah-extension/shared';
