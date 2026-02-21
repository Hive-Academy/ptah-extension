/**
 * RPC Type Definitions
 *
 * Type-safe parameter and response types for all RPC methods.
 * Used by both frontend (caller) and backend (handler) for compile-time type safety.
 *
 * TASK_2025_051: SDK-only migration - proper type definitions
 */

import type { SessionId } from './branded.types';
import type { PermissionLevel } from './model-autopilot.types';
import type {
  ChatSessionSummary,
  FlatStreamEventUnion,
} from './execution-node.types';
// TASK_2025_109: SubagentResumeParams/Result removed - now uses context injection
import type {
  SubagentQueryParams,
  SubagentQueryResult,
} from './subagent-registry.types';
import type {
  ProjectAnalysisResult,
  AgentRecommendation,
  SavedAnalysisMetadata,
} from './setup-wizard.types';
import type {
  ProjectIntelligence,
  QualityHistoryEntry,
} from './quality-assessment.types';

// ============================================================
// Chat RPC Types
// ============================================================

export interface ChatStartParams {
  /** Initial prompt to send (optional) */
  prompt?: string;
  /**
   * Tab ID for frontend correlation (REQUIRED for new conversations)
   * Backend uses this to route streaming events back to the correct tab.
   * This replaces the previous placeholder sessionId pattern.
   */
  tabId: string;
  /** User-provided session name (optional) */
  name?: string;
  /** Workspace path for context */
  workspacePath?: string;
  /** Additional options */
  options?: {
    model?: string;
    systemPrompt?: string;
    files?: string[];
    /**
     * System prompt preset selection.
     * - 'claude_code': Default preset with minimal customization
     * - 'enhanced': AI-generated project-specific guidance (requires enhanced prompts generated)
     *
     * If not specified, defaults to 'enhanced' if enhanced prompts are available,
     * otherwise falls back to 'claude_code'.
     */
    preset?: 'claude_code' | 'enhanced';
  };
}

/** Response from chat:start RPC method */
export interface ChatStartResult {
  success: boolean;
  sessionId?: SessionId;
  error?: string;
}

export interface ChatContinueParams {
  /** Message content to send */
  prompt: string;
  /** Session ID to continue (REQUIRED - must be real SDK UUID for resume) */
  sessionId: SessionId;
  /**
   * Tab ID for frontend correlation (REQUIRED)
   * Backend uses this to route streaming events back to the correct tab.
   */
  tabId: string;
  /** User-provided session name (optional - for late naming) */
  name?: string;
  /** Workspace path (needed for session resumption if session is not active) */
  workspacePath?: string;
  /** Model to use (if different from current session model) */
  model?: string;
  /** File paths to include with the message */
  files?: string[];
}

/** Response from chat:continue RPC method */
export interface ChatContinueResult {
  success: boolean;
  sessionId?: SessionId;
  error?: string;
}

/** Parameters for chat:abort RPC method */
export interface ChatAbortParams {
  /** Session ID to abort */
  sessionId: SessionId;
}

/** Response from chat:abort RPC method */
export interface ChatAbortResult {
  success: boolean;
  error?: string;
}

/** Parameters for chat:resume RPC method */
export interface ChatResumeParams {
  /** Session ID to resume */
  sessionId: SessionId;
  /**
   * Tab ID for frontend correlation (REQUIRED)
   * Backend uses this to route streaming events back to the correct tab.
   * TASK_2025_092: Added for consistent event routing.
   */
  tabId: string;
  /** Workspace path (needed for session context) */
  workspacePath?: string;
  /** Model to use (if different from session's original model) */
  model?: string;
}

/** Response from chat:resume RPC method */
export interface ChatResumeResult {
  success: boolean;
  sessionId?: SessionId;
  /**
   * Complete history messages (for session resume/replay)
   * TASK_2025_092: Returns complete messages directly instead of streaming events
   * @deprecated Use `events` instead - messages only contain text, not tool calls
   */
  messages?: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }[];
  /**
   * Full streaming events for session history replay
   * TASK_2025_092 FIX: Includes tool_start, tool_result, thinking, agent_start events
   * Frontend processes these through StreamingHandler to build ExecutionNode tree
   */
  events?: FlatStreamEventUnion[];
  /**
   * Aggregated usage stats from session history
   * Extracted from JSONL message.usage fields for old session cost display
   */
  stats?: {
    totalCost: number;
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheCreation: number;
    };
    messageCount: number;
    model?: string;
  } | null;
  /**
   * Resumable subagents for this session (TASK_2025_103 FIX)
   * Frontend uses this to mark agent nodes as resumable when loading from history.
   * Populated from SubagentRegistryService.getResumableBySession().
   */
  resumableSubagents?: import('./subagent-registry.types').SubagentRecord[];
  error?: string;
}

// ============================================================
// Session RPC Types
// ============================================================

/** Parameters for session:list RPC method */
export interface SessionListParams {
  /** Workspace path to list sessions for */
  workspacePath: string;
  /** Maximum number of sessions to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/** Response from session:list RPC method */
export interface SessionListResult {
  sessions: ChatSessionSummary[];
  total: number;
  hasMore: boolean;
}

/** Parameters for session:load RPC method */
export interface SessionLoadParams {
  /** Session ID to load */
  sessionId: SessionId;
}

/**
 * Response from session:load RPC method
 *
 * NOTE: This is metadata-only validation. Actual conversation messages
 * are loaded via chat:resume, which triggers SDK to replay history.
 * The empty messages array is intentional - see TASK_2025_088.
 */
export interface SessionLoadResult {
  sessionId: SessionId;
  /** Always empty - messages come from chat:resume RPC call */
  messages: [];
  /** Always empty - SDK handles all session data */
  agentSessions: [];
}

/** Parameters for session:delete RPC method (TASK_2025_086) */
export interface SessionDeleteParams {
  /** Session ID to delete */
  sessionId: SessionId;
}

/** Response from session:delete RPC method */
export interface SessionDeleteResult {
  success: boolean;
  error?: string;
}

/** Parameters for session:validate RPC method */
export interface SessionValidateParams {
  /** Session ID to validate */
  sessionId: SessionId;
  /** Workspace path to find the sessions directory */
  workspacePath: string;
}

/** Response from session:validate RPC method */
export interface SessionValidateResult {
  /** Whether the session file exists on disk */
  exists: boolean;
  /** Full path to the session file (if it exists) */
  filePath?: string;
}

// ============================================================
// Context RPC Types
// ============================================================

/** Parameters for context:getAllFiles RPC method */
export interface ContextGetAllFilesParams {
  /** Whether to include image files */
  includeImages?: boolean;
  /** Maximum number of files to return */
  limit?: number;
}

/** Parameters for context:getFileSuggestions RPC method */
export interface ContextGetFileSuggestionsParams {
  /** Search query for file suggestions */
  query?: string;
  /** Maximum number of suggestions to return */
  limit?: number;
}

/** File info returned by context:getAllFiles */
export interface ContextFileInfo {
  uri: string;
  /** Actual file system path for attachment processing (e.g., D:\path\file.ts or /path/file.ts) */
  fsPath: string;
  relativePath: string;
  fileName: string;
  fileType: string;
  size: number;
  lastModified: number;
  isDirectory: boolean;
}

/** Response from context:getAllFiles RPC method */
export interface ContextGetAllFilesResult {
  files?: ContextFileInfo[];
}

/** Response from context:getFileSuggestions RPC method */
export interface ContextGetFileSuggestionsResult {
  files?: ContextFileInfo[];
}

// ============================================================
// Autocomplete RPC Types
// ============================================================

/** Parameters for autocomplete:agents RPC method */
export interface AutocompleteAgentsParams {
  /** Search query for agents */
  query?: string;
  /** Maximum number of results */
  maxResults?: number;
}

/** Parameters for autocomplete:commands RPC method */
export interface AutocompleteCommandsParams {
  /** Search query for commands */
  query?: string;
  /** Maximum number of results */
  maxResults?: number;
}

/** Agent info returned by autocomplete:agents */
export interface AutocompleteAgentInfo {
  name: string;
  description: string;
  scope: 'project' | 'user' | 'builtin';
}

/** Response from autocomplete:agents RPC method */
export interface AutocompleteAgentsResult {
  agents?: AutocompleteAgentInfo[];
}

/** Command info returned by autocomplete:commands */
export interface AutocompleteCommandInfo {
  name: string;
  description: string;
  scope: 'builtin' | 'project' | 'user' | 'mcp' | 'plugin';
  argumentHint?: string;
}

/** Response from autocomplete:commands RPC method */
export interface AutocompleteCommandsResult {
  commands?: AutocompleteCommandInfo[];
}

// ============================================================
// File RPC Types
// ============================================================

/** Parameters for file:open RPC method */
export interface FileOpenParams {
  /** File path to open */
  path: string;
  /** Optional line number to navigate to */
  line?: number;
}

/** Response from file:open RPC method */
export interface FileOpenResult {
  success: boolean;
  error?: string;
  isDirectory?: boolean;
}

// ============================================================
// Config RPC Types
// ============================================================

/** Parameters for config:model-switch RPC method */
export interface ConfigModelSwitchParams {
  /** Model API name to switch to (e.g., 'claude-sonnet-4-20250514') */
  model: string;
  /** Active session ID for live SDK sync (optional) */
  sessionId?: SessionId | null;
}

/** Response from config:model-switch RPC method */
export interface ConfigModelSwitchResult {
  model: string;
}

/** Response from config:model-get RPC method */
export interface ConfigModelGetResult {
  model: string;
}

/** Parameters for config:autopilot-toggle RPC method */
export interface ConfigAutopilotToggleParams {
  /** Whether autopilot is enabled */
  enabled: boolean;
  /** Permission level for autopilot */
  permissionLevel: PermissionLevel;
  /** Active session ID for live SDK sync (optional) */
  sessionId?: SessionId | null;
}

/** Response from config:autopilot-toggle RPC method */
export interface ConfigAutopilotToggleResult {
  enabled: boolean;
  permissionLevel: PermissionLevel;
}

/** Response from config:autopilot-get RPC method */
export interface ConfigAutopilotGetResult {
  enabled: boolean;
  permissionLevel: PermissionLevel;
}

/** Model information from SDK for config:models-list response */
export interface SdkModelInfo {
  id: string; // Full API name (e.g., 'claude-sonnet-4-20250514')
  name: string; // Display name (e.g., 'Claude Sonnet 4')
  description: string; // Model description
  apiName: string; // Same as id (for compatibility)
  isSelected: boolean; // Whether this model is currently selected
  isRecommended?: boolean; // Whether this model is recommended
  providerModelId: string | null; // Actual provider model (e.g., 'openai/gpt-5.1-codex-max' when using OpenRouter tier overrides)
}

/** Response from config:models-list RPC method */
export interface ConfigModelsListResult {
  models: SdkModelInfo[];
}

// ============================================================
// Authentication RPC Types (TASK_2025_057)
// ============================================================

/** Supported authentication methods */
export type AuthMethod = 'oauth' | 'apiKey' | 'openrouter' | 'auto';

/** Parameters for auth:getHealth RPC method */
export type AuthGetHealthParams = Record<string, never>;

/** Response from auth:getHealth RPC method */
export interface AuthGetHealthResponse {
  success: boolean;
  health: {
    status: string;
    lastCheck: number;
    errorMessage?: string;
    responseTime?: number;
    uptime?: number;
  };
}

/** Parameters for auth:saveSettings RPC method */
export interface AuthSaveSettingsParams {
  authMethod: AuthMethod;
  claudeOAuthToken?: string;
  anthropicApiKey?: string;
  /** Provider API key - used for OpenRouter, Moonshot, Z.AI, etc. */
  openrouterApiKey?: string;
  /** Selected Anthropic-compatible provider ID (TASK_2025_129 Batch 3) */
  anthropicProviderId?: string;
}

/** Response from auth:saveSettings RPC method */
export interface AuthSaveSettingsResponse {
  success: boolean;
  error?: string;
}

/** Parameters for auth:testConnection RPC method */
export type AuthTestConnectionParams = Record<string, never>;

/** Response from auth:testConnection RPC method */
export interface AuthTestConnectionResponse {
  success: boolean;
  health: {
    status: string;
    lastCheck: number;
    errorMessage?: string;
    responseTime?: number;
    uptime?: number;
  };
  errorMessage?: string;
}

// ============================================================
// Auth Status RPC Types (TASK_2025_076)
// ============================================================

/** Parameters for auth:getAuthStatus RPC method */
export interface AuthGetAuthStatusParams {
  /** Optional provider ID to check key status for (defaults to persisted config value) */
  providerId?: string;
}

/**
 * Anthropic-compatible provider info for UI display (TASK_2025_129 Batch 3)
 *
 * NOTE: This interface mirrors `AnthropicProvider` from `@ptah-extension/agent-sdk`
 * (libs/backend/agent-sdk/src/lib/helpers/anthropic-provider-registry.ts) minus the
 * `baseUrl` field (which is backend-only). Any changes to the shared fields in
 * AnthropicProvider must be reflected here, and vice versa.
 * The `shared` library cannot import from `agent-sdk` due to dependency direction constraints.
 */
export interface AnthropicProviderInfo {
  /** Provider identifier */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** URL to obtain API keys */
  helpUrl: string;
  /** Expected key prefix (empty if none) */
  keyPrefix: string;
  /** Placeholder text for key input */
  keyPlaceholder: string;
  /** Masked key display text */
  maskedKeyDisplay: string;
  /** Whether this provider supports dynamic model listing via API (TASK_2025_132) */
  hasDynamicModels?: boolean;
}

/**
 * Response from auth:getAuthStatus RPC method
 *
 * SECURITY: This response NEVER contains actual credential values.
 * Only boolean flags indicating whether credentials are configured.
 */
export interface AuthGetAuthStatusResponse {
  /** Whether OAuth token is configured in SecretStorage */
  hasOAuthToken: boolean;
  /** Whether API key is configured in SecretStorage */
  hasApiKey: boolean;
  /** Whether provider API key is configured in SecretStorage */
  hasOpenRouterKey: boolean;
  /** Current auth method preference */
  authMethod: AuthMethod;
  /** Currently selected Anthropic-compatible provider ID (TASK_2025_129 Batch 3) */
  anthropicProviderId: string;
  /** Available Anthropic-compatible providers (TASK_2025_129 Batch 3) */
  availableProviders: AnthropicProviderInfo[];
}

// ============================================================
// Provider Model RPC Types (TASK_2025_091 Phase 2, generalized TASK_2025_132)
// ============================================================

/** Model tier for provider model mapping */
export type ProviderModelTier = 'sonnet' | 'opus' | 'haiku';

/** Provider model information */
export interface ProviderModelInfo {
  /** Model ID (e.g., "anthropic/claude-3.5-sonnet", "kimi-k2") */
  id: string;
  /** Display name (e.g., "Claude 3.5 Sonnet") */
  name: string;
  /** Model description */
  description: string;
  /** Maximum context length in tokens */
  contextLength: number;
  /** Whether the model supports tool use (required for AI agents) */
  supportsToolUse: boolean;
  /** Cost per input token in USD (from provider API, e.g. OpenRouter) */
  inputCostPerToken?: number;
  /** Cost per output token in USD (from provider API) */
  outputCostPerToken?: number;
  /** Cost per cache read token in USD (from provider API) */
  cacheReadCostPerToken?: number;
  /** Cost per cache creation/write token in USD (from provider API) */
  cacheCreationCostPerToken?: number;
}

/** Parameters for provider:listModels RPC method */
export interface ProviderListModelsParams {
  /** Filter to only show models supporting tool use */
  toolUseOnly?: boolean;
  /** Provider ID to list models for (defaults to active provider) */
  providerId?: string;
}

/** Response from provider:listModels RPC method */
export interface ProviderListModelsResult {
  /** Available models */
  models: ProviderModelInfo[];
  /** Total count before filtering */
  totalCount: number;
  /** Whether the model list is static (no Refresh needed) */
  isStatic?: boolean;
  /** Error message when models couldn't be loaded (e.g., auth failure) */
  error?: string;
}

/** Parameters for provider:setModelTier RPC method */
export interface ProviderSetModelTierParams {
  /** Which tier to set (sonnet, opus, haiku) */
  tier: ProviderModelTier;
  /** Model ID to use for this tier (e.g., "openai/gpt-5.1-codex-max") */
  modelId: string;
  /** Provider ID (defaults to active provider) */
  providerId?: string;
}

/** Response from provider:setModelTier RPC method */
export interface ProviderSetModelTierResult {
  success: boolean;
  error?: string;
}

/** Parameters for provider:getModelTiers RPC method */
export interface ProviderGetModelTiersParams {
  /** Provider ID (defaults to active provider) */
  providerId?: string;
}

/** Response from provider:getModelTiers RPC method */
export interface ProviderGetModelTiersResult {
  /** Model ID mapped to Sonnet tier (null if using default) */
  sonnet: string | null;
  /** Model ID mapped to Opus tier (null if using default) */
  opus: string | null;
  /** Model ID mapped to Haiku tier (null if using default) */
  haiku: string | null;
}

/** Parameters for provider:clearModelTier RPC method */
export interface ProviderClearModelTierParams {
  /** Which tier to clear (reset to default) */
  tier: ProviderModelTier;
  /** Provider ID (defaults to active provider) */
  providerId?: string;
}

/** Response from provider:clearModelTier RPC method */
export interface ProviderClearModelTierResult {
  success: boolean;
  error?: string;
}

// Backward-compatible type aliases (deprecated - use Provider* variants)
/** @deprecated Use ProviderModelTier instead */
export type OpenRouterModelTier = ProviderModelTier;
/** @deprecated Use ProviderModelInfo instead */
export type OpenRouterModelInfo = ProviderModelInfo;
/** @deprecated Use ProviderListModelsParams instead */
export type OpenRouterListModelsParams = ProviderListModelsParams;
/** @deprecated Use ProviderListModelsResult instead */
export type OpenRouterListModelsResult = ProviderListModelsResult;
/** @deprecated Use ProviderSetModelTierParams instead */
export type OpenRouterSetModelTierParams = ProviderSetModelTierParams;
/** @deprecated Use ProviderSetModelTierResult instead */
export type OpenRouterSetModelTierResult = ProviderSetModelTierResult;
/** @deprecated Use ProviderGetModelTiersParams instead */
export type OpenRouterGetModelTiersParams = ProviderGetModelTiersParams;
/** @deprecated Use ProviderGetModelTiersResult instead */
export type OpenRouterGetModelTiersResult = ProviderGetModelTiersResult;
/** @deprecated Use ProviderClearModelTierParams instead */
export type OpenRouterClearModelTierParams = ProviderClearModelTierParams;
/** @deprecated Use ProviderClearModelTierResult instead */
export type OpenRouterClearModelTierResult = ProviderClearModelTierResult;

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
  value: unknown
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
// License RPC Types
// ============================================================

/** Parameters for license:getStatus RPC method */
export type LicenseGetStatusParams = Record<string, never>;

/**
 * License tier values for RPC communication
 *
 * TASK_2025_128: Freemium model conversion
 * - 'community': FREE forever - always valid, no license required
 * - 'pro': Active Pro subscription ($5/month)
 * - 'trial_pro': Pro plan during 14-day trial
 * - 'expired': Revoked or payment failed only (NOT for unlicensed users)
 */
export type LicenseTier = 'community' | 'pro' | 'trial_pro' | 'expired';

/**
 * Response from license:getStatus RPC method
 *
 * TASK_2025_121: Updated for two-tier paid model with trial support
 * TASK_2025_126: Added 'reason' field for context-aware welcome messaging
 * TASK_2025_128: Freemium model - renamed isBasic to isCommunity
 */
export interface LicenseGetStatusResponse {
  /** Whether the license is valid (Community = always true) */
  valid: boolean;
  /** License tier (community, pro, trial_pro, or expired) */
  tier: LicenseTier;
  /** Whether the user has premium features enabled (Pro tier) */
  isPremium: boolean;
  /** Whether the user has Community tier (convenience flag) */
  isCommunity: boolean;
  /** Days remaining before subscription expires (null if not applicable) */
  daysRemaining: number | null;
  /** Whether user is currently in trial period */
  trialActive: boolean;
  /** Days remaining in trial period (null if not in trial) */
  trialDaysRemaining: number | null;
  /** Plan details (if has valid license) */
  plan?: {
    name: string;
    description: string;
    features: string[];
  };
  /** Reason for invalid license (for context-aware welcome messaging) */
  reason?: 'expired' | 'trial_ended' | 'no_license';
  /** User profile data (TASK_2025_129) - only present for licensed users */
  user?: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
}

/** Parameters for license:setKey RPC method */
export interface LicenseSetKeyParams {
  licenseKey: string;
}

/** Response from license:setKey RPC method */
export interface LicenseSetKeyResponse {
  success: boolean;
  tier?: string;
  plan?: { name: string };
  error?: string;
}

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
  /** Multi-phase analysis directory path (e.g., '.claude/analysis/my-project'). When provided, the backend reads all phase markdown files for richer context. */
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
// Command RPC Types (TASK_2025_126)
// ============================================================

/**
 * Parameters for command:execute RPC method
 *
 * TASK_2025_126: Allows webview to execute VS Code commands
 * TASK_2025_129 Batch 3: Extended to allow specific whitelisted commands
 * SECURITY: Only ptah.* prefix commands and specific whitelisted commands are allowed
 * (enforced by handler)
 */
export interface CommandExecuteParams {
  /** VS Code command ID to execute (must match whitelist: ptah.* prefix or exact match) */
  command: string;
  /** Optional arguments for the command */
  args?: unknown[];
}

/**
 * Response from command:execute RPC method
 */
export interface CommandExecuteResponse {
  /** Whether command executed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

// ============================================================
// LLM Provider RPC Types (SDK-only migration: vscode-lm only)
// ============================================================

/** LLM Provider names (SDK-only migration: only vscode-lm remains) */
export type LlmProviderName = 'vscode-lm';

/** LLM Provider capability flags */
export type LlmProviderCapability = 'text-chat' | 'structured-output';

/** Response from llm:getProviderStatus RPC method */
export interface LlmProviderStatusResponse {
  providers: Array<{
    provider: LlmProviderName;
    displayName: string;
    isConfigured: boolean;
    defaultModel: string;
    capabilities: LlmProviderCapability[];
  }>;
  defaultProvider: LlmProviderName;
}

/** Parameters for llm:setDefaultProvider RPC method */
export interface SetDefaultProviderRequest {
  provider: LlmProviderName;
}

/** Response from llm:setDefaultProvider RPC method */
export interface SetDefaultProviderResponse {
  success: boolean;
  error?: string;
}

/** Parameters for llm:setApiKey RPC method */
export interface LlmSetApiKeyParams {
  provider: LlmProviderName;
  apiKey: string;
}

/** Response from llm:setApiKey RPC method */
export interface LlmSetApiKeyResponse {
  success: boolean;
  error?: string;
}

/** Parameters for llm:removeApiKey RPC method */
export type LlmRemoveApiKeyParams = LlmProviderName;

/** Response from llm:removeApiKey RPC method */
export type LlmRemoveApiKeyResponse = LlmSetApiKeyResponse;

/** Parameters for llm:getDefaultProvider RPC method */
export type LlmGetDefaultProviderParams = Record<string, never>;

/** Response from llm:getDefaultProvider RPC method */
export type LlmGetDefaultProviderResponse = LlmProviderName;

/** Parameters for llm:validateApiKeyFormat RPC method */
export interface LlmValidateApiKeyFormatParams {
  provider: LlmProviderName;
  apiKey: string;
}

/** Response from llm:validateApiKeyFormat RPC method */
export interface LlmValidateApiKeyFormatResponse {
  isValid: boolean;
  errorMessage?: string;
}

/** Parameters for llm:setDefaultModel RPC method */
export interface LlmSetDefaultModelParams {
  provider: LlmProviderName;
  model: string;
}

/** Response from llm:setDefaultModel RPC method */
export interface LlmSetDefaultModelResponse {
  success: boolean;
  error?: string;
}

/** Parameters for llm:getProviderStatus RPC method */
export type LlmGetProviderStatusParams = Record<string, never>;

/** Parameters for llm:listVsCodeModels RPC method */
export type LlmListVsCodeModelsParams = Record<string, never>;

/** Parameters for llm:listProviderModels RPC method */
export interface LlmListProviderModelsParams {
  provider: LlmProviderName;
}

/** Response from llm:listProviderModels RPC method */
export interface LlmListProviderModelsResponse {
  models: Array<{ id: string; displayName: string }>;
  error?: string;
}

// ============================================================
// Quality Dashboard RPC Types (TASK_2025_144)
// ============================================================

/** Parameters for quality:getAssessment RPC method */
export interface QualityGetAssessmentParams {
  /** Force fresh analysis (bypass cache) */
  forceRefresh?: boolean;
}

/** Response from quality:getAssessment RPC method */
export interface QualityGetAssessmentResult {
  /** Full project intelligence data */
  intelligence: ProjectIntelligence;
  /** Whether result came from cache */
  fromCache: boolean;
}

/** Parameters for quality:getHistory RPC method */
export interface QualityGetHistoryParams {
  /** Maximum number of history entries to return (default: 30) */
  limit?: number;
}

/** Response from quality:getHistory RPC method */
export interface QualityGetHistoryResult {
  /** Historical assessment entries (newest first) */
  entries: QualityHistoryEntry[];
}

/** Parameters for quality:export RPC method */
export interface QualityExportParams {
  /** Export format */
  format: 'markdown' | 'json' | 'csv';
}

/** Response from quality:export RPC method */
export interface QualityExportResult {
  /** Exported content as string */
  content: string;
  /** Suggested filename */
  filename: string;
  /** MIME type */
  mimeType: string;
  /** Whether the file was saved to disk via VS Code save dialog */
  saved?: boolean;
  /** File path where the report was saved (if saved) */
  filePath?: string;
}

// ============================================================
// Plugin Configuration RPC Types (TASK_2025_153)
// ============================================================

/** Plugin metadata for UI display */
export interface PluginInfo {
  /** Unique plugin identifier (directory name, e.g., 'hive-academy-core') */
  id: string;
  /** Human-readable plugin name */
  name: string;
  /** Plugin description */
  description: string;
  /** Plugin category for grouping in UI */
  category: 'core-tools' | 'backend-tools' | 'frontend-tools';
  /** Number of skills in this plugin */
  skillCount: number;
  /** Number of commands in this plugin */
  commandCount: number;
  /** Whether this plugin is recommended as default */
  isDefault: boolean;
  /** Search keywords for filtering */
  keywords: string[];
}

/** Per-workspace plugin configuration state */
export interface PluginConfigState {
  /** Array of enabled plugin IDs */
  enabledPluginIds: string[];
  /** ISO timestamp of last configuration change */
  lastUpdated?: string;
}

// ============================================================
// RPC Method Registry (Compile-Time Enforcement)
// ============================================================

/**
 * RPC Method Registry
 *
 * This is the SINGLE SOURCE OF TRUTH for all valid RPC methods.
 * Both frontend and backend MUST use this registry to ensure:
 * 1. Frontend can only call methods that exist
 * 2. Backend must register handlers for all methods
 * 3. Compile-time type checking for params and results
 *
 * If you add a new RPC method:
 * 1. Add its params/result types above
 * 2. Add an entry to this registry
 * 3. Register the handler in RpcMethodRegistrationService
 *
 * If a method is not in this registry, it CANNOT be called from frontend.
 */
export interface RpcMethodRegistry {
  // ---- Chat Methods ----
  'chat:start': { params: ChatStartParams; result: ChatStartResult };
  'chat:continue': { params: ChatContinueParams; result: ChatContinueResult };
  'chat:resume': { params: ChatResumeParams; result: ChatResumeResult };
  'chat:abort': { params: ChatAbortParams; result: ChatAbortResult };

  // ---- Session Methods ----
  'session:list': { params: SessionListParams; result: SessionListResult };
  'session:load': { params: SessionLoadParams; result: SessionLoadResult };
  'session:delete': {
    params: SessionDeleteParams;
    result: SessionDeleteResult;
  };
  'session:validate': {
    params: SessionValidateParams;
    result: SessionValidateResult;
  };

  // ---- Context Methods ----
  'context:getAllFiles': {
    params: ContextGetAllFilesParams;
    result: ContextGetAllFilesResult;
  };
  'context:getFileSuggestions': {
    params: ContextGetFileSuggestionsParams;
    result: ContextGetFileSuggestionsResult;
  };

  // ---- Autocomplete Methods ----
  'autocomplete:agents': {
    params: AutocompleteAgentsParams;
    result: AutocompleteAgentsResult;
  };
  'autocomplete:commands': {
    params: AutocompleteCommandsParams;
    result: AutocompleteCommandsResult;
  };

  // ---- File Methods ----
  'file:open': { params: FileOpenParams; result: FileOpenResult };

  // ---- Config Methods ----
  'config:model-switch': {
    params: ConfigModelSwitchParams;
    result: ConfigModelSwitchResult;
  };
  'config:model-get': {
    params: Record<string, never>;
    result: ConfigModelGetResult;
  };
  'config:autopilot-toggle': {
    params: ConfigAutopilotToggleParams;
    result: ConfigAutopilotToggleResult;
  };
  'config:autopilot-get': {
    params: Record<string, never>;
    result: ConfigAutopilotGetResult;
  };
  'config:models-list': {
    params: Record<string, never>;
    result: ConfigModelsListResult;
  };

  // ---- Auth Methods ----
  'auth:getHealth': {
    params: AuthGetHealthParams;
    result: AuthGetHealthResponse;
  };
  'auth:saveSettings': {
    params: AuthSaveSettingsParams;
    result: AuthSaveSettingsResponse;
  };
  'auth:testConnection': {
    params: AuthTestConnectionParams;
    result: AuthTestConnectionResponse;
  };
  'auth:getAuthStatus': {
    params: AuthGetAuthStatusParams;
    result: AuthGetAuthStatusResponse;
  };

  // ---- Setup Methods ----
  'setup-status:get-status': {
    params: SetupStatusGetParams;
    result: SetupStatusGetResponse;
  };
  'setup-wizard:launch': {
    params: SetupWizardLaunchParams;
    result: SetupWizardLaunchResponse;
  };
  'wizard:deep-analyze': {
    params: WizardDeepAnalyzeParams;
    result: WizardDeepAnalyzeResponse;
  };
  'wizard:recommend-agents': {
    params: WizardRecommendAgentsParams;
    result: WizardRecommendAgentsResponse;
  };
  'wizard:cancel-analysis': {
    params: WizardCancelAnalysisParams;
    result: WizardCancelAnalysisResponse;
  };
  // Wizard Generation Methods (TASK_2025_148)
  'wizard:submit-selection': {
    params: WizardSubmitSelectionParams;
    result: WizardSubmitSelectionResponse;
  };
  'wizard:cancel': {
    params: WizardCancelParams;
    result: WizardCancelResponse;
  };
  'wizard:retry-item': {
    params: WizardRetryItemParams;
    result: WizardRetryItemResponse;
  };
  // Wizard Analysis History Methods (v2 Multi-Phase)
  'wizard:list-analyses': {
    params: Record<string, never>;
    result: { analyses: SavedAnalysisMetadata[] };
  };
  'wizard:load-analysis': {
    params: { filename: string };
    result: MultiPhaseAnalysisResponse;
  };

  // ---- License Methods ----
  'license:getStatus': {
    params: LicenseGetStatusParams;
    result: LicenseGetStatusResponse;
  };
  'license:setKey': {
    params: LicenseSetKeyParams;
    result: LicenseSetKeyResponse;
  };

  // ---- Command Methods (TASK_2025_126) ----
  'command:execute': {
    params: CommandExecuteParams;
    result: CommandExecuteResponse;
  };

  // ---- LLM Provider Methods ----
  'llm:getProviderStatus': {
    params: LlmGetProviderStatusParams;
    result: LlmProviderStatusResponse;
  };
  'llm:setApiKey': { params: LlmSetApiKeyParams; result: LlmSetApiKeyResponse };
  'llm:removeApiKey': {
    params: LlmRemoveApiKeyParams;
    result: LlmRemoveApiKeyResponse;
  };
  'llm:getDefaultProvider': {
    params: LlmGetDefaultProviderParams;
    result: LlmGetDefaultProviderResponse;
  };
  'llm:setDefaultProvider': {
    params: SetDefaultProviderRequest;
    result: SetDefaultProviderResponse;
  };
  'llm:validateApiKeyFormat': {
    params: LlmValidateApiKeyFormatParams;
    result: LlmValidateApiKeyFormatResponse;
  };
  'llm:setDefaultModel': {
    params: LlmSetDefaultModelParams;
    result: LlmSetDefaultModelResponse;
  };
  'llm:listVsCodeModels': {
    params: LlmListVsCodeModelsParams;
    result: unknown[];
  };
  'llm:listProviderModels': {
    params: LlmListProviderModelsParams;
    result: LlmListProviderModelsResponse;
  };

  // ---- Provider Model Methods (TASK_2025_091 Phase 2, generalized TASK_2025_132) ----
  'provider:listModels': {
    params: ProviderListModelsParams;
    result: ProviderListModelsResult;
  };
  'provider:setModelTier': {
    params: ProviderSetModelTierParams;
    result: ProviderSetModelTierResult;
  };
  'provider:getModelTiers': {
    params: ProviderGetModelTiersParams;
    result: ProviderGetModelTiersResult;
  };
  'provider:clearModelTier': {
    params: ProviderClearModelTierParams;
    result: ProviderClearModelTierResult;
  };

  // ---- Subagent Methods (TASK_2025_103) ----
  // TASK_2025_109: chat:subagent-resume removed - now uses context injection
  'chat:subagent-query': {
    params: SubagentQueryParams;
    result: SubagentQueryResult;
  };

  // ---- Enhanced Prompts Methods (TASK_2025_137) ----
  'enhancedPrompts:getStatus': {
    params: EnhancedPromptsGetStatusParams;
    result: EnhancedPromptsGetStatusResponse;
  };
  'enhancedPrompts:runWizard': {
    params: EnhancedPromptsRunWizardParams;
    result: EnhancedPromptsRunWizardResponse;
  };
  'enhancedPrompts:setEnabled': {
    params: EnhancedPromptsSetEnabledParams;
    result: EnhancedPromptsSetEnabledResponse;
  };
  'enhancedPrompts:regenerate': {
    params: EnhancedPromptsRegenerateParams;
    result: EnhancedPromptsRegenerateResponse;
  };
  // TASK_2025_149 Batch 5: Settings UI prompt content & download
  'enhancedPrompts:getPromptContent': {
    params: { workspacePath: string };
    result: { content: string | null; error?: string };
  };
  'enhancedPrompts:download': {
    params: { workspacePath: string };
    result: { success: boolean; filePath?: string; error?: string };
  };

  // ---- Quality Dashboard Methods (TASK_2025_144) ----
  'quality:getAssessment': {
    params: QualityGetAssessmentParams;
    result: QualityGetAssessmentResult;
  };
  'quality:getHistory': {
    params: QualityGetHistoryParams;
    result: QualityGetHistoryResult;
  };
  'quality:export': {
    params: QualityExportParams;
    result: QualityExportResult;
  };

  // ---- Plugin Methods (TASK_2025_153) ----
  'plugins:list-available': {
    params: Record<string, never>;
    result: { plugins: PluginInfo[] };
  };
  'plugins:get-config': {
    params: Record<string, never>;
    result: PluginConfigState;
  };
  'plugins:save-config': {
    params: { enabledPluginIds: string[] };
    result: { success: boolean; error?: string };
  };
}

/**
 * Valid RPC method names (compile-time enforced)
 * Use this type to ensure only valid methods can be called
 */
export type RpcMethodName = keyof RpcMethodRegistry;

/**
 * All RPC method names as a runtime array
 *
 * This array MUST match the keys in RpcMethodRegistry.
 * Used by the backend verification helper to ensure all methods have handlers.
 *
 * CRITICAL: When adding a new method to RpcMethodRegistry, add it here too!
 * TypeScript will NOT catch mismatches automatically (runtime vs compile-time).
 */
export const RPC_METHOD_NAMES: RpcMethodName[] = [
  // Chat Methods
  'chat:start',
  'chat:continue',
  'chat:abort',
  'chat:resume',

  // Session Methods
  'session:list',
  'session:load',
  'session:delete',
  'session:validate',

  // Context Methods
  'context:getAllFiles',
  'context:getFileSuggestions',

  // Autocomplete Methods
  'autocomplete:agents',
  'autocomplete:commands',

  // File Methods
  'file:open',

  // Config Methods
  'config:model-switch',
  'config:model-get',
  'config:autopilot-toggle',
  'config:autopilot-get',
  'config:models-list',

  // Auth Methods
  'auth:getHealth',
  'auth:saveSettings',
  'auth:testConnection',
  'auth:getAuthStatus',

  // Setup Methods
  'setup-status:get-status',
  'setup-wizard:launch',
  'wizard:deep-analyze',
  'wizard:recommend-agents',
  'wizard:cancel-analysis',
  // Wizard Generation Methods (TASK_2025_148)
  'wizard:submit-selection',
  'wizard:cancel',
  'wizard:retry-item',
  // Wizard Analysis History Methods (v2 Multi-Phase)
  'wizard:list-analyses',
  'wizard:load-analysis',

  // License Methods
  'license:getStatus',
  'license:setKey',

  // Command Methods (TASK_2025_126)
  'command:execute',

  // LLM Provider Methods
  'llm:getProviderStatus',
  'llm:setApiKey',
  'llm:removeApiKey',
  'llm:getDefaultProvider',
  'llm:setDefaultProvider',
  'llm:setDefaultModel',
  'llm:validateApiKeyFormat',
  'llm:listVsCodeModels',
  'llm:listProviderModels',

  // Provider Model Methods (TASK_2025_091 Phase 2, generalized TASK_2025_132)
  'provider:listModels',
  'provider:setModelTier',
  'provider:getModelTiers',
  'provider:clearModelTier',

  // Subagent Methods (TASK_2025_103)
  // TASK_2025_109: chat:subagent-resume removed - now uses context injection
  'chat:subagent-query',

  // Enhanced Prompts Methods (TASK_2025_137)
  'enhancedPrompts:getStatus',
  'enhancedPrompts:runWizard',
  'enhancedPrompts:setEnabled',
  'enhancedPrompts:regenerate',
  // TASK_2025_149 Batch 5: Settings UI prompt content & download
  'enhancedPrompts:getPromptContent',
  'enhancedPrompts:download',

  // Quality Dashboard Methods (TASK_2025_144)
  'quality:getAssessment',
  'quality:getHistory',
  'quality:export',

  // Plugin Methods (TASK_2025_153)
  'plugins:list-available',
  'plugins:get-config',
  'plugins:save-config',
] as const;

/**
 * Extract params type for a given RPC method
 * @example RpcMethodParams<'chat:start'> => ChatStartParams
 */
export type RpcMethodParams<T extends RpcMethodName> =
  RpcMethodRegistry[T]['params'];

/**
 * Extract result type for a given RPC method
 * @example RpcMethodResult<'chat:start'> => ChatStartResult
 */
export type RpcMethodResult<T extends RpcMethodName> =
  RpcMethodRegistry[T]['result'];
