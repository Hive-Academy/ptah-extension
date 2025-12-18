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
import type { ChatSessionSummary } from './execution-node.types';

// ============================================================
// Chat RPC Types
// ============================================================

export interface ChatStartParams {
  /** Initial prompt to send (optional) */
  prompt?: string;
  /** Session ID for the chat */
  sessionId: SessionId;
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
  /** Session ID to continue */
  sessionId: SessionId;
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

/** Response from session:load RPC method */
export interface SessionLoadResult {
  sessionId: SessionId;
  messages: unknown[]; // StoredSessionMessage[] - keeping unknown to avoid circular deps
  agentSessions: unknown[];
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
  authMethod: 'oauth' | 'apiKey' | 'auto';
  claudeOAuthToken?: string;
  anthropicApiKey?: string;
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
  /** Current auth method preference */
  authMethod: 'oauth' | 'apiKey' | 'auto';
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

/** License tier (matches LicenseService backend) */
export type LicenseTier = 'free' | 'early_adopter';

/** Response from license:getStatus RPC method */
export interface LicenseGetStatusResponse {
  /** Whether the license is valid */
  valid: boolean;
  /** License tier (free or early_adopter) */
  tier: LicenseTier;
  /** Whether the user has premium features enabled */
  isPremium: boolean;
  /** Days remaining before expiration (null if not applicable) */
  daysRemaining: number | null;
  /** Plan details (if premium) */
  plan?: {
    name: string;
    description: string;
  };
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

  // LLM Provider Methods
  'llm:getProviderStatus',
  'llm:setApiKey',
  'llm:removeApiKey',
  'llm:getDefaultProvider',
  'llm:validateApiKeyFormat',
  'llm:listVsCodeModels',
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
