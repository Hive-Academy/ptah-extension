/**
 * Setup & Enhanced Prompts RPC Type Definitions
 *
 * Types for setup-status:*, setup-wizard:*, wizard:*, enhancedPrompts:*
 */

import type { ProjectAnalysisResult, AgentRecommendation } from '../wizard';
import type { HarnessTargetId } from '../harness-sync.types';
import type { GenerationAgentOutcome } from '../wizard/phase';
import type {
  AgentModelPreview,
  FileDecisionEntry,
  FileOutcome,
  GenerationRivalStatus,
  GenerationTargetChoice,
  GenerationTargetInfo,
  LibraryPassStatus,
  LocalFileState,
  PackFileOutcome,
} from './rpc-setup-decisions.types';

export type SetupGenerationWorkflow =
  'setup-agent-generation' | 'setup-project-prompt';

export interface SetupGenerationTabBinding {
  tabId: string;
  workflow: SetupGenerationWorkflow;
  workspacePath: string;
}

export interface SetupGenerationRunBinding extends SetupGenerationTabBinding {
  runId: string;
}

export type GenerationContextSource =
  | { kind: 'verified-analysis'; analysisRunId: string; analysisDir: string }
  | {
      kind: 'workspace-discovery';
      reason:
        'missing' | 'stale' | 'not-latest' | 'unreadable' | 'lookup-failed';
    };

export type SetupGenerationRunLifecycle =
  | 'starting'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'timed-out';

export type SetupGenerationTerminalStatus = Extract<
  SetupGenerationRunLifecycle,
  'completed' | 'cancelled' | 'failed' | 'timed-out'
>;

export interface SetupGenerationAccepted {
  runId: string;
  source: GenerationContextSource;
  status: 'starting';
  effectiveProvider: string;
  effectiveModel: string;
}

export type SetupGenerationRejection =
  | { reason: 'blocked'; ownerTabId?: string }
  | {
      reason:
        | 'invalid-binding'
        | 'workspace-mismatch'
        | 'foreign-directory'
        | 'preview-required'
        | 'not-running';
    };

export interface SetupGenerationResultFacts {
  finalizationFailed?: boolean;
  committedState?: 'committed' | 'unchanged' | 'unknown';
  interrupted?: boolean;
  status: SetupGenerationTerminalStatus;
  success: boolean;
  source: GenerationContextSource;
  effectiveProvider: string;
  effectiveModel: string;
  enhancedPromptsUsed?: boolean;
  agentOutcomes?: Array<
    Omit<GenerationAgentOutcome, 'status' | 'filePath'> & {
      status: GenerationAgentOutcome['status'] | 'skipped' | 'rejected';
      fileName?: string;
    }
  >;
  counts?: {
    total: number;
    written: number;
    unchanged: number;
    failed: number;
    skipped: number;
    rejected: number;
    /** Existing files kept as the user's (by choice or because unreadable). */
    kept?: number;
    /** Replace chosen, but the file changed after the preview, so it was kept. */
    changedSincePreview?: number;
  };
  rejectedSections?: number;
  tailoredSections?: number;
  propagation?: {
    consent: 'granted' | 'not-granted';
    status: 'completed' | 'unavailable' | 'failed' | 'not-attempted';
    targets?: HarnessTargetId[];
  };
  /** Root the agents were written to. Absent on results from older hosts. */
  target?: GenerationTargetInfo;
  /** Whether the Library was refreshed after this run. */
  libraryPass?: LibraryPassStatus;
  /**
   * Agents written by this run whose Library copy carries the user's edits and
   * is now diverged from the new source. Never lists a kept agent.
   */
  libraryDiverged?: string[];
}

export interface SetupGenerationRunState {
  committedState?: 'committed' | 'unchanged' | 'unknown';
  interrupted?: boolean;
  binding: SetupGenerationRunBinding;
  status: SetupGenerationRunLifecycle;
  source: GenerationContextSource;
  effectiveProvider: string;
  effectiveModel: string;
  result?: SetupGenerationResultFacts;
}

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
  /** Continue an unfinished version-4 analysis run. */
  resume?: boolean;
}

/** All valid status values for a v4 multi-phase analysis step. */
export type MultiPhaseAnalysisPhaseStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/** Digest of the bounded workspace metadata used to qualify analysis freshness. */
export interface WorkspaceFingerprint {
  algorithm: 'sha256-v1';
  digest: string;
  capturedAt: string;
}

/** Freshness status for the current workspace analysis. */
export interface AnalysisStatus {
  state: 'fresh' | 'stale' | 'missing';
  reason:
    | 'ok'
    | 'no-analysis'
    | 'legacy-v3'
    | 'incomplete'
    | 'expired'
    | 'workspace-changed'
    | 'output-mismatch'
    | 'unreadable';
  /** Workspace-relative analysis directory with `/` separators, or null when absent. */
  analysisDir: string | null;
  checkedAt: string;
  analyzedAt: string | null;
}

export type WizardAnalysisStatusParams = Record<string, never>;
export type WizardAnalysisStatusResponse = AnalysisStatus;

export interface PhaseResultV4 {
  status: MultiPhaseAnalysisPhaseStatus;
  file: string;
  durationMs: number;
  attempt: number;
  /** Real SDK session ID for this attempt; null until an SDK message supplies it. */
  sessionId: string | null;
  input: {
    workspaceSha256: string;
    promptSha256: string;
    priorPhaseSha256: string | null;
    model: string;
  } | null;
  verification: {
    status: 'pending' | 'verified' | 'failed';
    outputSha256: string | null;
    checkedAt: string | null;
  };
  error?: string;
}

export interface MultiPhaseManifestV4 {
  version: 4;
  runId: string;
  slug: string;
  analyzedAt: string;
  updatedAt: string;
  lifecycle: 'running' | 'paused' | 'completed' | 'failed';
  model: string;
  totalDurationMs: number;
  workspaceFingerprint: WorkspaceFingerprint;
  phases: Record<string, PhaseResultV4>;
}

/**
 * Multi-phase analysis response from wizard:deep-analyze RPC method.
 *
 * When the multi-phase pipeline is used, the handler returns the manifest
 * + phase file contents (markdown) instead of a JSON blob.
 */
export interface MultiPhaseAnalysisResponse {
  /** Discriminator: always true for multi-phase responses */
  isMultiPhase: true;
  /** Manifest with phase statuses */
  manifest:
    | {
        version: 3;
        runId: string;
        slug: string;
        analyzedAt: string;
        updatedAt: string;
        lifecycle: 'running' | 'paused' | 'completed' | 'failed';
        model: string;
        totalDurationMs: number;
        phases: Record<
          string,
          {
            status: MultiPhaseAnalysisPhaseStatus;
            file: string;
            durationMs: number;
            error?: string;
          }
        >;
      }
    | MultiPhaseManifestV4;
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
 * Always returns MultiPhaseAnalysisResponse (MCP server required).
 */
export type WizardDeepAnalyzeResponse = MultiPhaseAnalysisResponse;

/** Parameters for wizard:recommend-agents RPC method */
export type WizardRecommendAgentsParams = unknown; // DeepProjectAnalysis input

/** Explicit static catalog request; legacy analysis input remains supported. */
export interface WizardRecommendAgentsCatalogParams {
  mode: 'workspace-catalog';
  tabBinding?: SetupGenerationTabBinding & {
    workflow: 'setup-agent-generation';
  };
}

/**
 * Response from wizard:recommend-agents RPC method
 *
 * Agent recommendations based on project analysis.
 * Returns array of AgentRecommendation (from setup-wizard.types.ts).
 */
export type WizardRecommendAgentsResponse = AgentRecommendation[];

/** Parameters for wizard:cancel-analysis RPC method */
export type WizardCancelAnalysisParams = Record<string, never>;

/**
 * Response from wizard:cancel-analysis RPC method
 *
 * Cancellation RPC for agentic analysis.
 */
export interface WizardCancelAnalysisResponse {
  /** Whether cancellation was triggered (false if no analysis was running) */
  cancelled: boolean;
}

/** Parameters for wizard:submit-selection RPC method */
export interface WizardSubmitSelectionParams {
  tabBinding?: SetupGenerationTabBinding;
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
  /** Continue a persisted generation run instead of starting a new run. */
  resume?: boolean;
  /**
   * Token from `wizard:preview-generation`. Required by the server for any
   * replace decision; a submit without one only creates missing files.
   */
  previewToken?: string;
  /** Keep/replace per agent id for files that already exist. Absent = keep. */
  fileDecisions?: Record<string, FileDecisionEntry>;
  /** Root to write to. Absent = the harness root. */
  target?: GenerationTargetChoice;
}

/** Parameters for the read-only resumable-run discovery RPC method. */
export type WizardGetResumableRunParams = Record<string, never>;

/** A checkpoint agent record returned to the UI for generation recovery. */
export interface ResumableGenerationAgent {
  agentId: string;
  filePath: string;
  status: 'pending' | 'running' | FileOutcome;
  rejectedSections: number;
  tailoredSections: number;
  error?: string;
}

/** Read-only DTO for a persisted generation checkpoint. */
export interface ResumableGenerationRun {
  runId: string;
  /** `null` when the checkpoint carries no analysis directory. */
  analysisDirectory: string | null;
  outputDirectory: string;
  lifecycle: 'running' | 'paused' | 'completed' | 'timed-out' | 'failed';
  selectedAgentIds: string[];
  agents: ResumableGenerationAgent[];
}

/** Response from resumable analysis/generation discovery. */
export interface WizardGetResumableRunResponse {
  analysis: MultiPhaseAnalysisResponse | null;
  generation: ResumableGenerationRun | null;
}

/** Response from wizard:submit-selection RPC method */
export interface WizardSubmitSelectionResponse {
  /** Whether the selection was accepted and generation started */
  success: boolean;
  accepted?: SetupGenerationAccepted;
  rejection?: SetupGenerationRejection;
  /** Error message if selection failed */
  error?: string;
}

/** Parameters for wizard:preview-generation RPC method */
export interface WizardPreviewGenerationParams {
  /** Agent ids the user is about to generate (same rule as submit-selection). */
  selectedAgentIds: string[];
  /** Tab and workspace requesting this pre-run preview. */
  tabBinding?: SetupGenerationTabBinding;
  /** Root to compare against. Absent = the harness root. */
  target?: GenerationTargetChoice;
}

/**
 * How sure the preview is that, after generation, a file holds the generated
 * content.
 *
 * - `definite`: after generation the file holds the generated content, either
 *   because generation writes it or because it already holds that content and
 *   is left as is; a failed write is reported by the generation result.
 * - `conditional`: written only if {@link GenerationPreviewFile.condition}
 *   holds after generation.
 */
export type GenerationPreviewCertainty = 'definite' | 'conditional';

/** One file a generation run is expected to write for one agent. */
export interface GenerationPreviewFile {
  /** Workspace-relative POSIX path. */
  relPath: string;
  /** `claude` for the source file, otherwise the rival CLI it is synced to. */
  target: HarnessTargetId;
  certainty: GenerationPreviewCertainty;
  /** Present exactly when `certainty` is `conditional`. */
  condition?: string;
  /** Something already exists at this path and will be replaced. */
  willOverwrite: boolean;
  /** What is at the path now. Set for the `claude` target only. */
  localState?: LocalFileState;
  /**
   * Opaque baseline revision of the local file. Set for the `claude` target
   * only; echo it with a replace decision.
   */
  revision?: string;
}

/** Every file the preview expects for one selected agent. */
export interface GenerationPreviewAgent {
  agentId: string;
  files: GenerationPreviewFile[];
  /** The model line the generated agent will carry, and its origin. */
  agentModel?: AgentModelPreview;
  /** The agent's Library copy carries user edits (Electron only). */
  libraryCopyEdited?: boolean;
  /** The local file still matches what the setup wizard last wrote. */
  unchangedSinceWizardWrite?: boolean;
}

/**
 * Response from wizard:preview-generation RPC method. Read-only: building it
 * writes nothing and records no consent.
 */
export interface WizardPreviewGenerationResponse {
  /** One entry per selected agent, in request order. */
  agents: GenerationPreviewAgent[];
  /**
   * Set when the rival CLI paths could not be worked out. `agents` then lists
   * the Claude paths only and promises nothing about other CLIs.
   */
  warning?: string;
  /** Opaque token binding a later submit's replace decisions to this preview. */
  previewToken?: string;
  /** Roots compared and the one that applies. */
  target?: GenerationTargetInfo;
  /** Why rival CLI files are or are not listed. */
  rivalStatus?: GenerationRivalStatus;
}

/** Parameters for wizard:cancel RPC method */
export interface WizardCancelParams {
  tabBinding?: SetupGenerationRunBinding;
  /** Whether to save progress for later resume */
  saveProgress?: boolean;
}

/** Response from wizard:cancel RPC method */
export interface WizardCancelResponse {
  /** Whether cancellation was performed */
  cancelled: boolean;
  rejection?: SetupGenerationRejection;
  /** Session ID of cancelled session */
  sessionId?: string;
  /** Whether progress was saved */
  progressSaved?: boolean;
}

/** Parameters for wizard:retry-item RPC method */
export interface WizardRetryItemParams {
  tabBinding?: SetupGenerationRunBinding;
  /** ID of the generation item to retry */
  itemId: string;
}

/** Response from wizard:retry-item RPC method */
export interface WizardRetryItemResponse {
  /** Whether retry was initiated */
  success: boolean;
  accepted?: SetupGenerationAccepted;
  rejection?: SetupGenerationRejection;
  /** Error message if retry failed */
  error?: string;
}

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
  tabBinding?: SetupGenerationTabBinding;
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
  accepted?: SetupGenerationAccepted;
  rejection?: SetupGenerationRejection;
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
  tabBinding?: SetupGenerationTabBinding;
  model?: string;
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
  accepted?: SetupGenerationAccepted;
  rejection?: SetupGenerationRejection;
  /** Error message if failed */
  error?: string;
  /** Updated status (on success) */
  status?: EnhancedPromptsGetStatusResponse;
}

export interface EnhancedPromptsCancelParams {
  tabBinding: SetupGenerationRunBinding;
}

export interface EnhancedPromptsCancelResponse {
  cancelled: boolean;
  outcome?: 'cancelled' | 'already-finalized' | 'not-running' | 'refused';
  rejection?: SetupGenerationRejection;
}

export interface EnhancedPromptsGetRunStateParams {
  tabBinding: SetupGenerationTabBinding;
  runId?: string;
}

export interface EnhancedPromptsGetRunStateResponse {
  run: SetupGenerationRunState | null;
  rejection?: SetupGenerationRejection;
}

export interface WizardGetGenerationRunStateParams {
  tabBinding: SetupGenerationTabBinding;
  runId?: string;
}

export interface WizardGetGenerationRunStateResponse {
  run: SetupGenerationRunState | null;
  rejection?: SetupGenerationRejection;
}

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
  /** Optional explicit workspace path; overrides the backend's detected root. */
  workspacePath?: string;
  /** Token from `wizard:plan-pack-install`; required for any replace. */
  planToken?: string;
  /** Keep/replace per pack file name. Absent = keep. */
  decisions?: Record<string, FileDecisionEntry>;
  /** Root to write to. Absent = the harness root. */
  target?: GenerationTargetChoice;
}

/** Response from wizard:install-pack-agents RPC method */
export interface WizardInstallPackAgentsResult {
  success: boolean;
  agentsDownloaded: number;
  fromCache: boolean;
  error?: string;
  /** Per-file outcome, in plan order. */
  files?: PackFileOutcome[];
  /** Whether the Library was refreshed after the install. */
  libraryPass?: LibraryPassStatus;
}
