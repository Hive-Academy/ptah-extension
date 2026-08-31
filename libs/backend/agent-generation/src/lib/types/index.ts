/**
 * Type System Barrel Export
 *
 * Centralized export point for all type definitions in the agent-generation library.
 * Provides a clean import path for consumers:
 * `import { AgentTemplate, GeneratedAgent } from '@ptah-extension/agent-generation';`
 *
 * @module @ptah-extension/agent-generation/types
 */
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
export type {
  MultiPhaseId,
  AnalysisPhaseStatus,
  PhaseResult,
  MultiPhaseManifest,
  MultiPhaseAnalysisOptions,
} from './multi-phase.types';
export { PHASE_CONFIGS, MultiPhaseManifestSchema } from './multi-phase.types';
export type {
  GenerationAgentCheckpoint,
  GenerationCheckpointManifest,
} from './generation-checkpoint.types';
export { GenerationCheckpointManifestSchema } from './generation-checkpoint.types';
export type { EnhancedPromptTraceMetadata } from './enhanced-prompts.types';
export type {
  ProjectType,
  Framework,
  MonorepoType,
  IndexedFile,
  FileType,
} from '@ptah-extension/workspace-intelligence';
export type {
  QualityAssessment,
  QualityGap,
  PrescriptiveGuidance,
  GenerationAgentOutcome,
} from '@ptah-extension/shared';
