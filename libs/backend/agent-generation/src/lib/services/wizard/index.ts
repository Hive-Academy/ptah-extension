/**
 * Wizard Child Services - Barrel Exports
 *
 * Services exported:
 * - WizardWebviewLifecycleService: Webview panel creation and lifecycle management
 * - AgenticAnalysisService: Claude Agent SDK-powered workspace analysis
 * - MultiPhaseAnalysisService: Multi-phase workspace analysis orchestrator
 * - ProjectAnalysisZodSchema: Shared Zod schema for analysis validation
 * - normalizeAgentOutput: LLM output to DeepProjectAnalysis normalization
 */

// Barrel exports for wizard child services
export { WizardWebviewLifecycleService } from './webview-lifecycle.service';
export { AgenticAnalysisService } from './agentic-analysis.service';
export { MultiPhaseAnalysisService } from './multi-phase-analysis.service';

// Shared analysis schema and normalization (TASK_2025_145)
export {
  ProjectAnalysisZodSchema,
  normalizeAgentOutput,
  resolveProjectType,
} from './analysis-schema';
export type { ProjectAnalysisZodOutput } from './analysis-schema';

// Type exports
export type {
  CustomMessageHandler,
  WizardPanelInitialData,
} from './webview-lifecycle.service';
