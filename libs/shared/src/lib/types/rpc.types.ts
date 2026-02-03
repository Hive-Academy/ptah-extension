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
import type { AgentRecommendation } from './setup-wizard.types';

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
  scope: 'builtin' | 'project' | 'user' | 'mcp';
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
  authMethod: 'oauth' | 'apiKey' | 'openrouter' | 'auto';
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
  authMethod: 'oauth' | 'apiKey' | 'openrouter' | 'auto';
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
  /** Whether the model supports tool use (required for Claude Code) */
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
// Prompt Harness RPC Types (TASK_2025_135)
// ============================================================

/** Power-up category for UI grouping */
export type PromptHarnessPowerUpCategory =
  | 'investigation'
  | 'code-quality'
  | 'workflow'
  | 'mcp'
  | 'custom';

/**
 * Power-up information for frontend display
 * Maps to PowerUpDefinition from agent-sdk but excludes content for list operations
 */
export interface PowerUpInfo {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Brief description */
  description: string;
  /** Category for UI grouping */
  category: PromptHarnessPowerUpCategory;
  /** Whether this requires premium tier */
  isPremium: boolean;
  /** Semantic version */
  version: string;
  /** Estimated token count */
  tokenCount: number;
  /** Whether currently available (based on premium status) */
  isAvailable: boolean;
  /** IDs of conflicting power-ups */
  conflictsWith?: string[];
}

/**
 * Power-up enable/disable state
 */
export interface PowerUpStateInfo {
  /** Power-up ID this state applies to */
  powerUpId: string;
  /** Whether enabled */
  enabled: boolean;
  /** User-overridden priority (optional) */
  priority?: number;
  /** Timestamp of last modification */
  lastModified: number;
}

/**
 * User-created custom prompt section
 */
export interface UserPromptSectionInfo {
  /** Unique identifier */
  id: string;
  /** User-provided name */
  name: string;
  /** The prompt content (markdown) */
  content: string;
  /** Whether enabled */
  enabled: boolean;
  /** Priority for ordering (lower = earlier) */
  priority: number;
  /** Created timestamp (ms since epoch) */
  createdAt: number;
  /** Last modified timestamp (ms since epoch) */
  updatedAt: number;
}

/** Parameters for promptHarness:getConfig RPC method */
export type PromptHarnessGetConfigParams = Record<string, never>;

/** Response from promptHarness:getConfig RPC method */
export interface PromptHarnessGetConfigResponse {
  /** Map of power-up ID to state (as array of [id, state] for JSON serialization) */
  powerUpStates: Array<[string, PowerUpStateInfo]>;
  /** User's custom sections */
  customSections: UserPromptSectionInfo[];
  /** Whether user has premium features */
  isPremium: boolean;
  /** All available power-ups with availability status */
  availablePowerUps: PowerUpInfo[];
}

/** Parameters for promptHarness:saveConfig RPC method */
export interface PromptHarnessSaveConfigParams {
  /** Power-up states to save (as array of [id, state] for JSON serialization) */
  powerUpStates?: Array<[string, PowerUpStateInfo]>;
  /** Custom sections to save */
  customSections?: UserPromptSectionInfo[];
}

/** Response from promptHarness:saveConfig RPC method */
export interface PromptHarnessSaveConfigResponse {
  /** Whether save was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/** Prompt layer type for assembled prompt breakdown */
export type PromptLayerType = 'base' | 'project' | 'agent' | 'user' | 'premium';

/**
 * Individual layer in an assembled prompt
 */
export interface PromptLayerInfo {
  /** Layer name for display */
  name: string;
  /** Layer type for styling */
  type: PromptLayerType;
  /** Content of this layer */
  content: string;
  /** Token count for this layer */
  tokenCount: number;
  /** Source attribution (power-up ID or 'custom') */
  source?: string;
}

/** Warning severity level */
export type PromptWarningSeverity = 'info' | 'warning' | 'error';

/** Warning type for prompt assembly issues */
export type PromptWarningType = 'token_budget' | 'conflict' | 'deprecated';

/**
 * Warning from prompt assembly process
 */
export interface PromptWarningInfo {
  /** Warning type */
  type: PromptWarningType;
  /** Human-readable message */
  message: string;
  /** Severity level */
  severity: PromptWarningSeverity;
}

/** Parameters for promptHarness:getPreview RPC method */
export type PromptHarnessGetPreviewParams = Record<string, never>;

/** Response from promptHarness:getPreview RPC method */
export interface PromptHarnessGetPreviewResponse {
  /** The complete assembled prompt text */
  text: string;
  /** Total estimated token count */
  totalTokens: number;
  /** Breakdown by layer for preview UI */
  layers: PromptLayerInfo[];
  /** Warnings (token budget, conflicts) */
  warnings: PromptWarningInfo[];
}

/** Parameters for promptHarness:exportConfig RPC method */
export type PromptHarnessExportConfigParams = Record<string, never>;

/** Response from promptHarness:exportConfig RPC method */
export interface PromptHarnessExportConfigResponse {
  /** JSON string representation of the configuration */
  json: string;
}

/** Parameters for promptHarness:importConfig RPC method */
export interface PromptHarnessImportConfigParams {
  /** JSON string to import */
  json: string;
}

/** Response from promptHarness:importConfig RPC method */
export interface PromptHarnessImportConfigResponse {
  /** Whether import was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

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
export type WizardDeepAnalyzeParams = Record<string, never>;

/**
 * Response from wizard:deep-analyze RPC method
 *
 * TASK_2025_111: Deep project analysis result
 * Returns the full DeepProjectAnalysis from agent-generation.
 * Using 'unknown' here to avoid coupling shared types to agent-generation.
 * Frontend components should type-cast based on their needs.
 */
export type WizardDeepAnalyzeResponse = unknown;

/** Parameters for wizard:recommend-agents RPC method */
export type WizardRecommendAgentsParams = unknown; // DeepProjectAnalysis input

/**
 * Response from wizard:recommend-agents RPC method
 *
 * TASK_2025_111: Agent recommendations based on project analysis
 * Returns array of AgentRecommendation (from setup-wizard.types.ts)
 */
export type WizardRecommendAgentsResponse = AgentRecommendation[];

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
// LLM Provider RPC Types
// ============================================================

/** LLM Provider names */
export type LlmProviderName =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'vscode';

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

/** Parameters for llm:getProviderStatus RPC method */
export type LlmGetProviderStatusParams = Record<string, never>;

/** Parameters for llm:listVsCodeModels RPC method */
export type LlmListVsCodeModelsParams = Record<string, never>;

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
    result: unknown;
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
  'llm:validateApiKeyFormat': {
    params: LlmValidateApiKeyFormatParams;
    result: LlmValidateApiKeyFormatResponse;
  };
  'llm:listVsCodeModels': {
    params: LlmListVsCodeModelsParams;
    result: unknown[];
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

  // ---- Prompt Harness Methods (TASK_2025_135) ----
  'promptHarness:getConfig': {
    params: PromptHarnessGetConfigParams;
    result: PromptHarnessGetConfigResponse;
  };
  'promptHarness:saveConfig': {
    params: PromptHarnessSaveConfigParams;
    result: PromptHarnessSaveConfigResponse;
  };
  'promptHarness:getPreview': {
    params: PromptHarnessGetPreviewParams;
    result: PromptHarnessGetPreviewResponse;
  };
  'promptHarness:exportConfig': {
    params: PromptHarnessExportConfigParams;
    result: PromptHarnessExportConfigResponse;
  };
  'promptHarness:importConfig': {
    params: PromptHarnessImportConfigParams;
    result: PromptHarnessImportConfigResponse;
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
  'llm:validateApiKeyFormat',
  'llm:listVsCodeModels',

  // Provider Model Methods (TASK_2025_091 Phase 2, generalized TASK_2025_132)
  'provider:listModels',
  'provider:setModelTier',
  'provider:getModelTiers',
  'provider:clearModelTier',

  // Subagent Methods (TASK_2025_103)
  // TASK_2025_109: chat:subagent-resume removed - now uses context injection
  'chat:subagent-query',

  // Prompt Harness Methods (TASK_2025_135)
  'promptHarness:getConfig',
  'promptHarness:saveConfig',
  'promptHarness:getPreview',
  'promptHarness:exportConfig',
  'promptHarness:importConfig',
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
