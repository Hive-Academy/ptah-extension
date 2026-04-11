/**
 * @module @ptah-extension/agent-generation
 *
 * Core infrastructure for intelligent project-adaptive agent generation.
 *
 * This library provides utilities, patterns, and type definitions for:
 * - Content processing and transformation
 * - Orchestration pattern execution
 * - Agent prompt generation
 * - Type system for templates, generation, and validation
 *
 * @see README.md for development status and extraction tasks
 */

// DI tokens (Task 0.3)
export * from './lib/di';

// Type system (Task 0.2)
export * from './lib/types';

// Service interfaces (Task 0.4)
export * from './lib/interfaces';

// Error classes (Task 0.5)
export * from './lib/errors';

// Content processing utilities (Task -1.2)
export * from './lib/utils/content-processor';

// Orchestration patterns (Task -1.3)
export * from './lib/patterns';

// Services (Batch 1, Batch 3A, Batch 3B)
export { TemplateStorageService } from './lib/services/template-storage.service';
export { ContentGenerationService } from './lib/services/content-generation.service';
export { OutputValidationService } from './lib/services/output-validation.service';
export { AgentFileWriterService } from './lib/services/file-writer.service';
export { AgentSelectionService } from './lib/services/agent-selection.service';
export { AgentRecommendationService } from './lib/services/agent-recommendation.service';
export {
  SetupStatusService,
  type SetupStatus,
} from './lib/services/setup-status.service';

// Analysis storage service (Persistent Analysis History)
export { AnalysisStorageService } from './lib/services/analysis-storage.service';

// Orchestrator types (exported for RPC handler consumption)
export type { OrchestratorGenerationOptions } from './lib/services/orchestrator.service';

// Multi-CLI Agent Transforms (TASK_2025_160)
export { MultiCliAgentWriterService } from './lib/services/cli-agent-transforms';
export type { ICliAgentTransformer } from './lib/services/cli-agent-transforms';

// Wizard child services and shared analysis schema
export {
  WizardWebviewLifecycleService,
  AgenticAnalysisService,
  MultiPhaseAnalysisService,
  ProjectAnalysisZodSchema,
  normalizeAgentOutput,
  resolveProjectType,
  type CustomMessageHandler,
  type WizardPanelInitialData,
  type ProjectAnalysisZodOutput,
} from './lib/services/wizard';

// New Project wizard services
export {
  NewProjectDiscoveryService,
  MasterPlanGenerationService,
  NewProjectStorageService,
} from './lib/services/new-project';
export type { AnswerValidationResult } from './lib/services/new-project/new-project-discovery.service';
