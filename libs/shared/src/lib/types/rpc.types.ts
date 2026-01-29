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
export type AuthGetAuthStatusParams = Record<string, never>;

/**
 * Anthropic-compatible provider info for UI display (TASK_2025_129 Batch 3)
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
// OpenRouter Model RPC Types (TASK_2025_091 Phase 2)
// ============================================================

/** Model tier for OpenRouter model mapping */
export type OpenRouterModelTier = 'sonnet' | 'opus' | 'haiku';

/** OpenRouter model information */
export interface OpenRouterModelInfo {
  /** Model ID (e.g., "anthropic/claude-3.5-sonnet") */
  id: string;
  /** Display name (e.g., "Claude 3.5 Sonnet") */
  name: string;
  /** Model description */
  description: string;
  /** Maximum context length in tokens */
  contextLength: number;
  /** Whether the model supports tool use (required for Claude Code) */
  supportsToolUse: boolean;
}

/** Parameters for openrouter:listModels RPC method */
export interface OpenRouterListModelsParams {
  /** Filter to only show models supporting tool use */
  toolUseOnly?: boolean;
}

/** Response from openrouter:listModels RPC method */
export interface OpenRouterListModelsResult {
  /** Available models */
  models: OpenRouterModelInfo[];
  /** Total count before filtering */
  totalCount: number;
}

/** Parameters for openrouter:setModelTier RPC method */
export interface OpenRouterSetModelTierParams {
  /** Which tier to set (sonnet, opus, haiku) */
  tier: OpenRouterModelTier;
  /** Model ID to use for this tier (e.g., "openai/gpt-5.1-codex-max") */
  modelId: string;
}

/** Response from openrouter:setModelTier RPC method */
export interface OpenRouterSetModelTierResult {
  success: boolean;
  error?: string;
}

/** Parameters for openrouter:getModelTiers RPC method */
export type OpenRouterGetModelTiersParams = Record<string, never>;

/** Response from openrouter:getModelTiers RPC method */
export interface OpenRouterGetModelTiersResult {
  /** Model ID mapped to Sonnet tier (null if using default) */
  sonnet: string | null;
  /** Model ID mapped to Opus tier (null if using default) */
  opus: string | null;
  /** Model ID mapped to Haiku tier (null if using default) */
  haiku: string | null;
}

/** Parameters for openrouter:clearModelTier RPC method */
export interface OpenRouterClearModelTierParams {
  /** Which tier to clear (reset to default) */
  tier: OpenRouterModelTier;
}

/** Response from openrouter:clearModelTier RPC method */
export interface OpenRouterClearModelTierResult {
  success: boolean;
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

// ============================================================
// Command RPC Types (TASK_2025_126)
// ============================================================

/**
 * Parameters for command:execute RPC method
 *
 * TASK_2025_126: Allows webview to execute VS Code commands
 * SECURITY: Only ptah.* commands are allowed (enforced by handler)
 */
export interface CommandExecuteParams {
  /** VS Code command ID to execute (must start with 'ptah.') */
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

  // ---- License Methods ----
  'license:getStatus': {
    params: LicenseGetStatusParams;
    result: LicenseGetStatusResponse;
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

  // ---- OpenRouter Model Methods (TASK_2025_091 Phase 2) ----
  'openrouter:listModels': {
    params: OpenRouterListModelsParams;
    result: OpenRouterListModelsResult;
  };
  'openrouter:setModelTier': {
    params: OpenRouterSetModelTierParams;
    result: OpenRouterSetModelTierResult;
  };
  'openrouter:getModelTiers': {
    params: OpenRouterGetModelTiersParams;
    result: OpenRouterGetModelTiersResult;
  };
  'openrouter:clearModelTier': {
    params: OpenRouterClearModelTierParams;
    result: OpenRouterClearModelTierResult;
  };

  // ---- Subagent Methods (TASK_2025_103) ----
  // TASK_2025_109: chat:subagent-resume removed - now uses context injection
  'chat:subagent-query': {
    params: SubagentQueryParams;
    result: SubagentQueryResult;
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

  // License Methods
  'license:getStatus',

  // Command Methods (TASK_2025_126)
  'command:execute',

  // LLM Provider Methods
  'llm:getProviderStatus',
  'llm:setApiKey',
  'llm:removeApiKey',
  'llm:getDefaultProvider',
  'llm:validateApiKeyFormat',
  'llm:listVsCodeModels',

  // OpenRouter Model Methods (TASK_2025_091 Phase 2)
  'openrouter:listModels',
  'openrouter:setModelTier',
  'openrouter:getModelTiers',
  'openrouter:clearModelTier',

  // Subagent Methods (TASK_2025_103)
  // TASK_2025_109: chat:subagent-resume removed - now uses context injection
  'chat:subagent-query',
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
