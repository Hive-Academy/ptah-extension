/**
 * Setup & Enhanced Prompts RPC Type Definitions
 *
 * Types for setup-status:*, setup-wizard:*, wizard:*, enhancedPrompts:*
 */

import type {
  ProjectAnalysisResult,
  AgentRecommendation,
} from '../setup-wizard.types';
import type {
  NewProjectType,
  QuestionGroup,
  DiscoveryAnswers,
  MasterPlan,
} from '../new-project.types';

// ============================================================
// Setup Status RPC Types
// ============================================================

/** Parameters for setup-status:get-status RPC method */
export type SetupStatusGetParams = Record<string, never>;

/** Response from setup-status:get-status RPC method */
export interface SetupStatusGetResponse {
  isConfigured: boolean;
  agentCount: number;
  ruleCount: number;
  lastUpdated: string | null;
  hasClaudeConfig: boolean;
}

/** Parameters for setup-wizard:launch RPC method */
export type SetupWizardLaunchParams = Record<string, never>;

/** Response from setup-wizard:launch RPC method */
export interface SetupWizardLaunchResponse {
  success: boolean;
}

/** Parameters for wizard:deep-analyze RPC method */
export interface WizardDeepAnalyzeParams {
  /** Optional model override from frontend (e.g., 'claude-sonnet-4-20250514') */
  model?: string;
}

/**
 * Multi-phase analysis response from wizard:deep-analyze RPC method.
 *
 * TASK_2025_154: When multi-phase pipeline is used, the handler returns
 * the manifest + phase file contents (markdown) instead of a JSON blob.
 */
export interface MultiPhaseAnalysisResponse {
  /** Discriminator: always true for multi-phase responses */
  isMultiPhase: true;
  /** Manifest with phase statuses */
  manifest: {
    slug: string;
    analyzedAt: string;
    model: string;
    totalDurationMs: number;
    phases: Record<
      string,
      { status: string; file: string; durationMs: number; error?: string }
    >;
  };
  /** Phase file contents (markdown) keyed by phase ID */
  phaseContents: Record<string, string>;
  /** Analysis directory path for downstream consumers (generation, enhanced prompts) */
  analysisDir: string;
}

/**
 * Type guard for MultiPhaseAnalysisResponse.
 * Use this to discriminate between multi-phase and legacy responses.
 */
export function isMultiPhaseResponse(
  value: unknown,
): value is MultiPhaseAnalysisResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'isMultiPhase' in value &&
    (value as MultiPhaseAnalysisResponse).isMultiPhase === true
  );
}

/**
 * Response from wizard:deep-analyze RPC method
 * Always returns MultiPhaseAnalysisResponse (premium + MCP required).
 */
export type WizardDeepAnalyzeResponse = MultiPhaseAnalysisResponse;

/** Parameters for wizard:recommend-agents RPC method */
export type WizardRecommendAgentsParams = unknown; // DeepProjectAnalysis input

/**
 * Response from wizard:recommend-agents RPC method
 *
 * TASK_2025_111: Agent recommendations based on project analysis
 * Returns array of AgentRecommendation (from setup-wizard.types.ts)
 */
export type WizardRecommendAgentsResponse = AgentRecommendation[];

/** Parameters for wizard:cancel-analysis RPC method */
export type WizardCancelAnalysisParams = Record<string, never>;

/**
 * Response from wizard:cancel-analysis RPC method
 *
 * TASK_2025_145 SERIOUS-6: Cancellation RPC for agentic analysis
 */
export interface WizardCancelAnalysisResponse {
  /** Whether cancellation was triggered (false if no analysis was running) */
  cancelled: boolean;
}

// ============================================================
// Wizard Generation RPC Types (TASK_2025_148)
// ============================================================

/** Parameters for wizard:submit-selection RPC method */
export interface WizardSubmitSelectionParams {
  /** Array of agent IDs to generate (from AgentRecommendation.agentId) */
  selectedAgentIds: string[];
  /** Minimum relevance threshold for agent selection (0-100). Default: 50 */
  threshold?: number;
  /** Variable overrides for template rendering */
  variableOverrides?: Record<string, string>;
  /** Pre-computed analysis from wizard Step 1 — used as single source of truth for generation */
  analysisData?: ProjectAnalysisResult;
  /** Optional model override from frontend (e.g., 'claude-sonnet-4-20250514') */
  model?: string;
  /** Multi-phase analysis directory path (alternative to analysisData for v2 pipeline) */
  analysisDir?: string;
}

/** Response from wizard:submit-selection RPC method */
export interface WizardSubmitSelectionResponse {
  /** Whether the selection was accepted and generation started */
  success: boolean;
  /** Error message if selection failed */
  error?: string;
}

/** Parameters for wizard:cancel RPC method */
export interface WizardCancelParams {
  /** Whether to save progress for later resume */
  saveProgress?: boolean;
}

/** Response from wizard:cancel RPC method */
export interface WizardCancelResponse {
  /** Whether cancellation was performed */
  cancelled: boolean;
  /** Session ID of cancelled session */
  sessionId?: string;
  /** Whether progress was saved */
  progressSaved?: boolean;
}

/** Parameters for wizard:retry-item RPC method */
export interface WizardRetryItemParams {
  /** ID of the generation item to retry */
  itemId: string;
}

/** Response from wizard:retry-item RPC method */
export interface WizardRetryItemResponse {
  /** Whether retry was initiated */
  success: boolean;
  /** Error message if retry failed */
  error?: string;
}

// Multi-Phase Analysis RPC Types removed (TASK_2025_154 wiring):
// wizard:start-multi-phase-analysis and wizard:cancel-multi-phase-analysis
// are now integrated into wizard:deep-analyze and wizard:cancel-analysis.

// ============================================================
// Enhanced Prompts RPC Types (TASK_2025_137)
// ============================================================

/**
 * Detected technology stack from workspace analysis.
 * Used for display in settings (readonly - not for editing).
 */
export interface EnhancedPromptsDetectedStack {
  languages: string[];
  frameworks: string[];
  buildTools: string[];
  testingFrameworks: string[];
  additionalTools: string[];
  projectType: string;
  configFiles: string[];
}

/**
 * Enhanced Prompts configuration options.
 * For wizard customization (advanced users).
 */
export interface EnhancedPromptsConfigOptions {
  includeStyleGuidelines?: boolean;
  includeTerminology?: boolean;
  includeArchitecturePatterns?: boolean;
  includeTestingGuidelines?: boolean;
  maxTokens?: number;
}

/** Parameters for enhancedPrompts:getStatus RPC method */
export interface EnhancedPromptsGetStatusParams {
  /** Workspace path to check status for */
  workspacePath: string;
}

/** Response from enhancedPrompts:getStatus RPC method */
export interface EnhancedPromptsGetStatusResponse {
  /** Whether Enhanced Prompts is enabled for this workspace */
  enabled: boolean;
  /** Whether a prompt has been generated */
  hasGeneratedPrompt: boolean;
  /** ISO timestamp of last generation (null if never generated) */
  generatedAt: string | null;
  /** Detected technology stack (null if never generated) */
  detectedStack: EnhancedPromptsDetectedStack | null;
  /** Whether the cached prompt is still valid */
  cacheValid: boolean;
  /** Reason for cache invalidation (if invalid) */
  invalidationReason?: string;
  /** Error message if status check failed */
  error?: string;
}

/** Parameters for enhancedPrompts:runWizard RPC method */
export interface EnhancedPromptsRunWizardParams {
  /** Workspace path to run wizard for */
  workspacePath: string;
  /** Optional configuration overrides */
  config?: EnhancedPromptsConfigOptions;
  /** Pre-computed analysis from wizard Step 1 (optional; omitted for multi-phase analysis path) */
  analysisData?: ProjectAnalysisResult;
  /** Multi-phase analysis directory path (e.g., '.ptah/analysis/my-project'). When provided, the backend reads all phase markdown files for richer context. */
  analysisDir?: string;
  /** Optional model override from frontend (e.g., 'claude-sonnet-4-20250514') */
  model?: string;
}

/** Summary section for enhanced prompts generation result */
export interface EnhancedPromptsSummarySection {
  /** Section display name (e.g., 'Project Context') */
  name: string;
  /** Approximate word count of the generated section */
  wordCount: number;
  /** Whether this section was successfully generated */
  generated: boolean;
}

/** Summary of generated enhanced prompts (metadata only, no actual content) */
export interface EnhancedPromptsSummary {
  /** Individual guidance sections with metadata */
  sections: EnhancedPromptsSummarySection[];
  /** Total token count across all sections */
  totalTokens: number;
  /** Quality score from code quality assessment (0-100), if available */
  qualityScore?: number;
  /** Whether template-based fallback guidance was used */
  usedFallback: boolean;
}

/** Response from enhancedPrompts:runWizard RPC method */
export interface EnhancedPromptsRunWizardResponse {
  /** Whether wizard completed successfully */
  success: boolean;
  /** Error message if wizard failed */
  error?: string;
  /** ISO timestamp of generation (on success) */
  generatedAt?: string | null;
  /** Detected stack (on success) */
  detectedStack?: EnhancedPromptsDetectedStack | null;
  /** Summary of what was generated (sections, token counts). Never includes actual prompt content. */
  summary?: EnhancedPromptsSummary | null;
}

/** Parameters for enhancedPrompts:setEnabled RPC method */
export interface EnhancedPromptsSetEnabledParams {
  /** Workspace path */
  workspacePath: string;
  /** Whether to enable or disable */
  enabled: boolean;
}

/** Response from enhancedPrompts:setEnabled RPC method */
export interface EnhancedPromptsSetEnabledResponse {
  /** Whether operation succeeded */
  success: boolean;
  /** New enabled state */
  enabled?: boolean;
  /** Error message if failed */
  error?: string;
}

/** Parameters for enhancedPrompts:regenerate RPC method */
export interface EnhancedPromptsRegenerateParams {
  /** Workspace path */
  workspacePath: string;
  /** Force regeneration even if cache is valid */
  force?: boolean;
  /** Optional configuration overrides */
  config?: EnhancedPromptsConfigOptions;
}

/** Response from enhancedPrompts:regenerate RPC method */
export interface EnhancedPromptsRegenerateResponse {
  /** Whether regeneration succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Updated status (on success) */
  status?: EnhancedPromptsGetStatusResponse;
}

// ============================================================
// Agent Pack Browser RPC Types (TASK_2025_258)
// ============================================================

/** A single agent entry within a pack (frontend-facing DTO) */
export interface AgentPackEntryDto {
  file: string;
  name: string;
  description: string;
  category: string;
}

/** Public info about an agent pack (frontend-facing DTO) */
export interface AgentPackInfoDto {
  name: string;
  version: string;
  description: string;
  agents: AgentPackEntryDto[];
  source: string;
}

/** Parameters for wizard:list-agent-packs RPC method */
export type WizardListAgentPacksParams = Record<string, never>;

/** Response from wizard:list-agent-packs RPC method */
export interface WizardListAgentPacksResult {
  packs: AgentPackInfoDto[];
}

/** Parameters for wizard:install-pack-agents RPC method */
export interface WizardInstallPackAgentsParams {
  source: string;
  agentFiles: string[];
}

/** Response from wizard:install-pack-agents RPC method */
export interface WizardInstallPackAgentsResult {
  success: boolean;
  agentsDownloaded: number;
  fromCache: boolean;
  error?: string;
}

// ============================================================
// New Project Wizard RPC Types
// ============================================================

/** Parameters for wizard:new-project-select-type RPC method */
export interface WizardNewProjectSelectTypeParams {
  projectType: NewProjectType;
}

/** Response from wizard:new-project-select-type RPC method */
export interface WizardNewProjectSelectTypeResult {
  groups: QuestionGroup[];
}

/** Parameters for wizard:new-project-submit-answers RPC method */
export interface WizardNewProjectSubmitAnswersParams {
  projectType: NewProjectType;
  answers: DiscoveryAnswers;
  projectName: string;
  /** When true, delete any existing plan and regenerate from scratch. */
  force?: boolean;
}

/** Response from wizard:new-project-submit-answers RPC method */
export interface WizardNewProjectSubmitAnswersResult {
  success: boolean;
  error?: string;
}

/** Parameters for wizard:new-project-get-plan RPC method */
export type WizardNewProjectGetPlanParams = Record<string, never>;

/** Response from wizard:new-project-get-plan RPC method */
export interface WizardNewProjectGetPlanResult {
  plan: MasterPlan;
}

/** Parameters for wizard:new-project-approve-plan RPC method */
export interface WizardNewProjectApprovePlanParams {
  approved: boolean;
}

/** Response from wizard:new-project-approve-plan RPC method */
export interface WizardNewProjectApprovePlanResult {
  success: boolean;
  planPath: string;
}
