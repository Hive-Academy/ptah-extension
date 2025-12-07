/**
 * RPC Type Definitions
 *
 * Type-safe parameter and response types for all RPC methods.
 * Used by both frontend (caller) and backend (handler) for compile-time type safety.
 *
 * TASK_2025_051: SDK-only migration - proper type definitions
 */

import type { SessionId } from './branded.types';
import type { ClaudeModel } from './claude-domain.types';
import type { PermissionLevel, ModelInfo } from './model-autopilot.types';

// ============================================================
// Chat RPC Types
// ============================================================

/** Parameters for chat:start RPC method */
export interface ChatStartParams {
  /** Initial prompt to send (optional) */
  prompt?: string;
  /** Session ID for the chat */
  sessionId: SessionId;
  /** Workspace path for context */
  workspacePath?: string;
  /** Additional options */
  options?: {
    model?: string;
    systemPrompt?: string;
  };
}

/** Response from chat:start RPC method */
export interface ChatStartResult {
  success: boolean;
  sessionId?: SessionId;
  error?: string;
}

/** Parameters for chat:continue RPC method */
export interface ChatContinueParams {
  /** Message content to send */
  prompt: string;
  /** Session ID to continue */
  sessionId: SessionId;
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
  /** Model to switch to */
  model: ClaudeModel;
}

/** Response from config:model-switch RPC method */
export interface ConfigModelSwitchResult {
  model: ClaudeModel;
}

/** Response from config:model-get RPC method */
export interface ConfigModelGetResult {
  model: ClaudeModel;
}

/** Parameters for config:autopilot-toggle RPC method */
export interface ConfigAutopilotToggleParams {
  /** Whether autopilot is enabled */
  enabled: boolean;
  /** Permission level for autopilot */
  permissionLevel: PermissionLevel;
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

/** Response from config:models-list RPC method */
export interface ConfigModelsListResult {
  models: (ModelInfo & { isSelected: boolean })[];
}
