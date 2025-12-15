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

/** Session summary for list response (RPC-specific format) */
export interface RpcSessionSummary {
  id: SessionId;
  name: string;
  lastActivityAt: number;
  createdAt: number;
  messageCount: number;
  branch: string | null;
  isUserSession: boolean;
}

/** Response from session:list RPC method */
export interface SessionListResult {
  sessions: RpcSessionSummary[];
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
