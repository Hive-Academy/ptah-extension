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
export { WizardWebviewLifecycleService } from './webview-lifecycle.service';
export { AgenticAnalysisService } from './agentic-analysis.service';
export { MultiPhaseAnalysisService } from './multi-phase-analysis.service';
export {
  ProjectAnalysisZodSchema,
  normalizeAgentOutput,
  resolveProjectType,
} from './analysis-schema';
export type { ProjectAnalysisZodOutput } from './analysis-schema';
export type {
  CustomMessageHandler,
  WizardPanelInitialData,
} from './webview-lifecycle.service';
