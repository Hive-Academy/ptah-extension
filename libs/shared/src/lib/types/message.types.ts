/* eslint-disable @typescript-eslint/no-empty-interface */
/* eslint-disable @typescript-eslint/no-empty-object-type */
/**
 * Strict Message Type System - Eliminates all 'any' types
 * Based on architectural analysis lines 504-538
 * Implements discriminated unions for type-safe message handling
 */

import { z } from 'zod';
import {
  SessionId,
  MessageId,
  CorrelationId,
  SessionIdSchema,
  MessageIdSchema,
  CorrelationIdSchema,
} from './branded.types';
import { CommandTemplate } from './command-builder.types';
import { WebviewConfiguration } from './webview-ui.types';
import {
  ClaudeAgentStartEvent,
  ClaudeAgentActivityEvent,
  ClaudeAgentCompleteEvent,
  SessionUIData,
} from './claude-domain.types';
import type {
  ContentBlock,
  TextContentBlock,
  ThinkingContentBlock,
  ToolUseContentBlock,
  ToolResultContentBlock,
} from './content-block.types';
import type { PermissionRequest, PermissionResponse } from './permission.types';

// Re-export for convenience
export { CorrelationId };

// Re-export ContentBlock types from foundation layer
export type {
  ContentBlock,
  TextContentBlock,
  ThinkingContentBlock,
  ToolUseContentBlock,
  ToolResultContentBlock,
};

/**
 * Strict Message Types - Literal string union for type-safe message handling
 * Defines all valid message types across the extension
 */
export type StrictMessageType =
  // Chat messages
  | 'chat:sendMessage'
  | 'chat:messageChunk'
  | 'chat:sessionStart'
  | 'chat:sessionEnd'
  | 'chat:newSession'
  | 'chat:switchSession'
  | 'chat:getHistory'
  | 'chat:messageAdded'
  | 'chat:messageComplete'
  | 'chat:sessionCreated'
  | 'chat:sessionSwitched'
  | 'chat:sessionUpdated'
  | 'chat:tokenUsageUpdated'
  | 'chat:historyLoaded'
  | 'chat:renameSession'
  | 'chat:deleteSession'
  | 'chat:bulkDeleteSessions'
  | 'chat:sessionRenamed'
  | 'chat:sessionDeleted'
  | 'chat:getSessionStats'
  | 'chat:requestSessions'
  | 'chat:sessionsUpdated'
  | 'chat:stopStream'
  | 'chat:streamStopped'
  | 'chat:agentStarted'
  | 'chat:agentActivity'
  | 'chat:agentCompleted'
  | 'chat:thinking'
  | 'chat:toolStart'
  | 'chat:toolProgress'
  | 'chat:toolResult'
  | 'chat:toolError'
  | 'chat:sessionInit'
  | 'chat:healthUpdate'
  | 'chat:cliError'
  // Permission messages
  | 'permission:request'
  | 'permission:response'
  // Provider messages
  | 'providers:getAvailable'
  | 'providers:getCurrent'
  | 'providers:switch'
  | 'providers:getHealth'
  | 'providers:getAllHealth'
  | 'providers:setDefault'
  | 'providers:enableFallback'
  | 'providers:setAutoSwitch'
  | 'providers:selectModel'
  | 'providers:currentChanged'
  | 'providers:healthChanged'
  | 'providers:error'
  | 'providers:availableUpdated'
  | 'providers:modelChanged'
  // Context messages
  | 'context:updateFiles'
  | 'context:getFiles'
  | 'context:includeFile'
  | 'context:excludeFile'
  | 'context:searchFiles'
  | 'context:getAllFiles'
  | 'context:getFileSuggestions'
  | 'context:searchImages'
  // Command messages
  | 'commands:getTemplates'
  | 'commands:executeCommand'
  | 'commands:selectFile'
  | 'commands:saveTemplate'
  // Analytics messages
  | 'analytics:trackEvent'
  | 'analytics:getData'
  // Config messages
  | 'config:get'
  | 'config:set'
  | 'config:update'
  | 'config:refresh'
  // State messages
  | 'state:save'
  | 'state:load'
  | 'state:clear'
  | 'state:saved'
  | 'state:loaded'
  // View messages
  | 'view:changed'
  | 'view:routeChanged'
  | 'view:generic'
  // System messages
  | 'error'
  | 'initialData'
  | 'webview-ready'
  | 'ready'
  | 'requestInitialData'
  | 'themeChanged'
  | 'navigate'
  | 'refresh'
  | 'switchView'
  | 'workspaceChanged'
  // Setup Wizard Messages
  | 'setup-wizard:scan-progress'
  // Agent Permission Messages (TASK_2025_162: Copilot SDK)
  | 'agent-monitor:permission-request'
  | 'agent-monitor:permission-response'
  | 'agent-monitor:user-input-request'
  | 'agent-monitor:user-input-response'
  | string; // Allow extensibility for custom message types

/**
 * MESSAGE_TYPES - Runtime constants for type-safe message handling
 *
 * Use these constants instead of string literals when calling postMessage()
 * or publish() to ensure consistency and enable ESLint enforcement.
 *
 * @example
 * // Instead of:
 * postMessage({ type: 'navigate', payload: {...} });
 *
 * // Use:
 * postMessage({ type: MESSAGE_TYPES.NAVIGATE, payload: {...} });
 */
export const MESSAGE_TYPES = {
  // ---- Chat Messages ----
  CHAT_SEND_MESSAGE: 'chat:sendMessage',
  CHAT_MESSAGE_CHUNK: 'chat:messageChunk',
  CHAT_SESSION_START: 'chat:sessionStart',
  CHAT_SESSION_END: 'chat:sessionEnd',
  CHAT_NEW_SESSION: 'chat:newSession',
  CHAT_SWITCH_SESSION: 'chat:switchSession',
  CHAT_GET_HISTORY: 'chat:getHistory',
  CHAT_MESSAGE_ADDED: 'chat:messageAdded',
  CHAT_MESSAGE_COMPLETE: 'chat:messageComplete',
  CHAT_SESSION_CREATED: 'chat:sessionCreated',
  CHAT_SESSION_SWITCHED: 'chat:sessionSwitched',
  CHAT_SESSION_UPDATED: 'chat:sessionUpdated',
  CHAT_TOKEN_USAGE_UPDATED: 'chat:tokenUsageUpdated',
  CHAT_HISTORY_LOADED: 'chat:historyLoaded',
  CHAT_RENAME_SESSION: 'chat:renameSession',
  CHAT_DELETE_SESSION: 'chat:deleteSession',
  CHAT_BULK_DELETE_SESSIONS: 'chat:bulkDeleteSessions',
  CHAT_SESSION_RENAMED: 'chat:sessionRenamed',
  CHAT_SESSION_DELETED: 'chat:sessionDeleted',
  CHAT_GET_SESSION_STATS: 'chat:getSessionStats',
  CHAT_REQUEST_SESSIONS: 'chat:requestSessions',
  CHAT_SESSIONS_UPDATED: 'chat:sessionsUpdated',
  CHAT_STOP_STREAM: 'chat:stopStream',
  CHAT_STREAM_STOPPED: 'chat:streamStopped',
  CHAT_AGENT_STARTED: 'chat:agentStarted',
  CHAT_AGENT_ACTIVITY: 'chat:agentActivity',
  CHAT_AGENT_COMPLETED: 'chat:agentCompleted',
  CHAT_THINKING: 'chat:thinking',
  CHAT_TOOL_START: 'chat:toolStart',
  CHAT_TOOL_PROGRESS: 'chat:toolProgress',
  CHAT_TOOL_RESULT: 'chat:toolResult',
  CHAT_TOOL_ERROR: 'chat:toolError',
  CHAT_SESSION_INIT: 'chat:sessionInit',
  CHAT_HEALTH_UPDATE: 'chat:healthUpdate',
  CHAT_CLI_ERROR: 'chat:cliError',
  CHAT_RESTORE_INPUT: 'chat:restore-input',

  // ---- Permission Messages ----
  // TWO SEPARATE SYSTEMS - SDK and MCP - DO NOT CONFUSE!
  //
  // SYSTEM 1: Claude Agent SDK Permissions (Primary, always active)
  // - Triggered when SDK calls Write, Edit, Bash tools via canUseTool callback
  // - Flow: SdkPermissionHandler → 'permission:request' → UI → 'chat:permission-response'
  // - Handler: SdkPermissionHandler.handleResponse()
  //
  // SYSTEM 2: Code Execution MCP Permissions (Premium only, separate)
  // - Triggered by Ptah MCP Server's approval_prompt tool
  // - Flow: PermissionPromptService → 'permission:request' → UI → 'permission:response'
  // - Handler: PermissionPromptService.resolveRequest()
  //
  // Both use same request type but DIFFERENT response types!

  // Shared request type (both SDK and MCP send this to frontend)
  PERMISSION_REQUEST: 'permission:request',

  // SDK-specific response (frontend → backend for SDK permissions)
  SDK_PERMISSION_RESPONSE: 'chat:permission-response',

  // MCP-specific response (frontend → backend for MCP permissions)
  MCP_PERMISSION_RESPONSE: 'permission:response',

  // ---- Provider Messages ----
  PROVIDERS_GET_AVAILABLE: 'providers:getAvailable',
  PROVIDERS_GET_CURRENT: 'providers:getCurrent',
  PROVIDERS_SWITCH: 'providers:switch',
  PROVIDERS_GET_HEALTH: 'providers:getHealth',
  PROVIDERS_GET_ALL_HEALTH: 'providers:getAllHealth',
  PROVIDERS_SET_DEFAULT: 'providers:setDefault',
  PROVIDERS_ENABLE_FALLBACK: 'providers:enableFallback',
  PROVIDERS_SET_AUTO_SWITCH: 'providers:setAutoSwitch',
  PROVIDERS_SELECT_MODEL: 'providers:selectModel',
  PROVIDERS_CURRENT_CHANGED: 'providers:currentChanged',
  PROVIDERS_HEALTH_CHANGED: 'providers:healthChanged',
  PROVIDERS_ERROR: 'providers:error',
  PROVIDERS_AVAILABLE_UPDATED: 'providers:availableUpdated',
  PROVIDERS_MODEL_CHANGED: 'providers:modelChanged',

  // ---- Context Messages ----
  CONTEXT_UPDATE_FILES: 'context:updateFiles',
  CONTEXT_GET_FILES: 'context:getFiles',
  CONTEXT_INCLUDE_FILE: 'context:includeFile',
  CONTEXT_EXCLUDE_FILE: 'context:excludeFile',
  CONTEXT_SEARCH_FILES: 'context:searchFiles',
  CONTEXT_GET_ALL_FILES: 'context:getAllFiles',
  CONTEXT_GET_FILE_SUGGESTIONS: 'context:getFileSuggestions',
  CONTEXT_SEARCH_IMAGES: 'context:searchImages',

  // ---- Command Messages ----
  COMMANDS_GET_TEMPLATES: 'commands:getTemplates',
  COMMANDS_EXECUTE_COMMAND: 'commands:executeCommand',
  COMMANDS_SELECT_FILE: 'commands:selectFile',
  COMMANDS_SAVE_TEMPLATE: 'commands:saveTemplate',

  // ---- Analytics Messages ----
  ANALYTICS_TRACK_EVENT: 'analytics:trackEvent',
  ANALYTICS_GET_DATA: 'analytics:getData',

  // ---- Config Messages ----
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  CONFIG_UPDATE: 'config:update',
  CONFIG_REFRESH: 'config:refresh',

  // ---- State Messages ----
  STATE_SAVE: 'state:save',
  STATE_LOAD: 'state:load',
  STATE_CLEAR: 'state:clear',
  STATE_SAVED: 'state:saved',
  STATE_LOADED: 'state:loaded',

  // ---- View Messages ----
  VIEW_CHANGED: 'view:changed',
  VIEW_ROUTE_CHANGED: 'view:routeChanged',
  VIEW_GENERIC: 'view:generic',

  // ---- System Messages ----
  ERROR: 'error',
  INITIAL_DATA: 'initialData',
  WEBVIEW_READY: 'webview-ready',
  READY: 'ready',
  REQUEST_INITIAL_DATA: 'requestInitialData',
  THEME_CHANGED: 'themeChanged',
  NAVIGATE: 'navigate',
  REFRESH: 'refresh',
  SWITCH_VIEW: 'switchView',
  WORKSPACE_CHANGED: 'workspaceChanged',

  // ---- RPC Messages ----
  // Frontend → Backend: Request/call an RPC method
  RPC_REQUEST: 'rpc:request',
  RPC_CALL: 'rpc:call',
  // Backend → Frontend: RPC method response
  RPC_RESPONSE: 'rpc:response',

  // ---- SDK Integration Messages ----
  // These are used by the Agent SDK streaming layer
  CHAT_CHUNK: 'chat:chunk',
  CHAT_COMPLETE: 'chat:complete',
  CHAT_ERROR: 'chat:error',
  SESSION_ID_RESOLVED: 'session:id-resolved',
  SESSION_STATS: 'session:stats',
  // TASK_2025_098: SESSION_COMPACTING removed - compaction now flows through CHAT_CHUNK
  AGENT_SUMMARY_CHUNK: 'agent:summary-chunk',
  SDK_ERROR: 'sdk:error',

  // ---- Setup Wizard Messages ----
  SETUP_WIZARD_OPEN_AGENTS_FOLDER: 'setup-wizard:open-agents-folder',
  SETUP_WIZARD_COMPLETE: 'setup-wizard:complete',
  SETUP_WIZARD_SCAN_PROGRESS: 'setup-wizard:scan-progress',
  SETUP_WIZARD_ANALYSIS_STREAM: 'setup-wizard:analysis-stream',

  // ---- AskUserQuestion Messages ----
  // Used by SDK's AskUserQuestion tool to prompt user with clarifying questions
  // Similar to permission system but expects answers instead of approve/deny
  ASK_USER_QUESTION_REQUEST: 'ask-user-question:request',
  ASK_USER_QUESTION_RESPONSE: 'ask-user-question:response',

  // ---- Permission Auto-Resolve Messages ----
  // Sent when "Always Allow" auto-resolves sibling pending requests for the same tool
  PERMISSION_AUTO_RESOLVED: 'permission:auto-resolved',

  // ---- Permission Session Cleanup Messages ----
  // Sent when a session is aborted to notify frontend to remove stale permission/question cards
  PERMISSION_SESSION_CLEANUP: 'permission:session-cleanup',

  // ---- Plan Mode Messages ----
  // Sent when agent enters/exits plan mode via EnterPlanMode/ExitPlanMode tools
  PLAN_MODE_CHANGED: 'session:plan-mode-changed',

  // ---- Agent Monitor Messages ----
  // Real-time agent process monitoring for the sidebar panel
  AGENT_MONITOR_SPAWNED: 'agent-monitor:spawned',
  AGENT_MONITOR_OUTPUT: 'agent-monitor:output',
  AGENT_MONITOR_EXITED: 'agent-monitor:exited',

  // ---- Agent Permission Messages (TASK_2025_162: Copilot SDK) ----
  // CLI agent tool permission routing (Copilot SDK permission hooks)
  AGENT_MONITOR_PERMISSION_REQUEST: 'agent-monitor:permission-request',
  AGENT_MONITOR_PERMISSION_RESPONSE: 'agent-monitor:permission-response',
  // CLI agent user input routing (Copilot SDK onUserInputRequest)
  AGENT_MONITOR_USER_INPUT_REQUEST: 'agent-monitor:user-input-request',
  AGENT_MONITOR_USER_INPUT_RESPONSE: 'agent-monitor:user-input-response',
} as const;

/**
 * Type for MESSAGE_TYPES values
 */
export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

/**
 * Message Payloads - Strict typing for each message type
 */
export interface ChatSendMessagePayload {
  readonly content: string;
  readonly files?: readonly string[];
  readonly correlationId?: CorrelationId;
  readonly metadata?: Readonly<{
    model?: string;
    temperature?: number;
  }>;
}

export interface ChatMessageChunkPayload {
  readonly sessionId: SessionId;
  readonly messageId: MessageId;
  readonly contentBlocks: readonly ContentBlock[];
  readonly isComplete: boolean;
  readonly streaming: boolean;
}

export interface ChatSessionStartPayload {
  readonly sessionId: SessionId;
  readonly workspaceId?: string;
}

/**
 * CLI session end payload
 * NOTE: Replaces previous webview session end payload structure
 */
export interface ChatSessionEndPayload {
  readonly sessionId: SessionId;
  readonly reason?: string;
  readonly timestamp: number;
}

export interface ChatNewSessionPayload {
  readonly name?: string;
  readonly workspaceId?: string;
}

export interface ChatSwitchSessionPayload {
  readonly sessionId: SessionId;
}

export interface ChatGetHistoryPayload {
  readonly sessionId: SessionId;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ChatMessageAddedPayload {
  readonly message: StrictChatMessage;
}

export interface ChatMessageCompletePayload {
  readonly message: StrictChatMessage;
}

export interface ChatSessionCreatedPayload {
  readonly session: StrictChatSession;
}

export interface ChatSessionSwitchedPayload {
  readonly session: StrictChatSession;
}

export interface ChatSessionUpdatedPayload {
  readonly session: StrictChatSession;
}

export interface ChatTokenUsageUpdatedPayload {
  readonly sessionId: SessionId;
  readonly tokenUsage: {
    readonly input: number;
    readonly output: number;
    readonly total: number;
    readonly percentage: number;
    readonly maxTokens: number;
  };
}

export interface ChatHistoryLoadedPayload {
  readonly messages: readonly StrictChatMessage[];
}

export interface ContextUpdatePayload {
  readonly includedFiles: readonly string[];
  readonly excludedFiles: readonly string[];
  readonly tokenEstimate: number;
}

export interface AnalyticsEventPayload {
  readonly event: string;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
}

export interface ViewChangedPayload {
  readonly view: string;
  readonly timestamp?: number;
}

export interface ViewRouteChangedPayload {
  readonly route: string;
  readonly previousRoute?: string;
}

export interface ViewGenericPayload {
  readonly data: unknown;
}

export interface ContextGetFilesPayload {
  // No payload needed for get files request
}

export interface ContextIncludeFilePayload {
  readonly filePath: string;
}

export interface ContextExcludeFilePayload {
  readonly filePath: string;
}

export interface ContextSearchFilesPayload {
  readonly query: string;
  readonly includeImages?: boolean;
  readonly maxResults?: number;
  readonly fileTypes?: readonly string[];
}

export interface ContextGetAllFilesPayload {
  readonly includeImages?: boolean;
  readonly offset?: number;
  readonly limit?: number;
}

export interface ContextGetFileSuggestionsPayload {
  readonly query: string;
  readonly limit?: number;
}

export interface ContextSearchImagesPayload {
  readonly query: string;
}

export interface CommandsGetTemplatesPayload {
  // No payload needed for get templates request
}

/**
 * Agent Event Payloads - For agent lifecycle tracking
 * Used for chat:agentStarted, chat:agentActivity, chat:agentCompleted message types
 */
export interface ChatAgentStartedPayload {
  readonly sessionId: SessionId;
  readonly agent: ClaudeAgentStartEvent;
}

export interface ChatAgentActivityPayload {
  readonly sessionId: SessionId;
  readonly agent: ClaudeAgentActivityEvent;
}

export interface ChatAgentCompletedPayload {
  readonly sessionId: SessionId;
  readonly agent: ClaudeAgentCompleteEvent;
}

export interface CommandsExecuteCommandPayload {
  readonly templateId: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface CommandsSelectFilePayload {
  readonly multiple?: boolean;
}

export interface CommandsSaveTemplatePayload {
  readonly template: CommandTemplate;
}

export interface AnalyticsGetDataPayload {
  readonly timestamp?: number;
}

export interface ConfigGetPayload {
  readonly timestamp: number;
}

export interface ConfigUpdatePayload {
  readonly updates: Partial<WebviewConfiguration>;
}

export interface ConfigRefreshPayload {
  readonly timestamp: number;
}

export interface StateSavePayload {
  readonly state: unknown;
}

export interface StateLoadPayload {
  // No payload needed for load state request
}

export interface StateClearPayload {
  // No payload needed for clear state request
}

export interface ChatRenameSessionPayload {
  readonly sessionId: SessionId;
  readonly newName: string;
}

export interface ChatDeleteSessionPayload {
  readonly sessionId: SessionId;
}

export interface ChatBulkDeleteSessionsPayload {
  readonly sessionIds: readonly SessionId[];
}

export interface ChatSessionRenamedPayload {
  readonly sessionId: SessionId;
  readonly newName: string;
}

export interface ChatSessionDeletedPayload {
  readonly sessionId: SessionId;
}

export interface ChatGetSessionStatsPayload {
  // No payload needed for get session stats request
}

export interface ChatStopStreamPayload {
  readonly sessionId: SessionId | null;
  readonly messageId: MessageId | null;
  readonly timestamp: number;
}

/**
 * Thinking event payload (Claude's reasoning process)
 */
export interface ChatThinkingPayload {
  readonly sessionId: SessionId;
  readonly content: string;
  readonly timestamp: number;
}

/**
 * Tool execution start payload
 */
export interface ChatToolStartPayload {
  readonly sessionId: SessionId;
  readonly toolCallId: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly timestamp: number;
}

/**
 * Tool execution progress payload
 */
export interface ChatToolProgressPayload {
  readonly sessionId: SessionId;
  readonly toolCallId: string;
  readonly message: string;
  readonly timestamp: number;
}

/**
 * Tool execution result payload
 */
export interface ChatToolResultPayload {
  readonly sessionId: SessionId;
  readonly toolCallId: string;
  readonly output: unknown;
  readonly duration: number;
  readonly timestamp: number;
}

/**
 * Tool execution error payload
 */
export interface ChatToolErrorPayload {
  readonly sessionId: SessionId;
  readonly toolCallId: string;
  readonly error: string;
  readonly timestamp: number;
}

/**
 * CLI session initialization payload
 */
export interface ChatSessionInitPayload {
  readonly sessionId: SessionId;
  readonly claudeSessionId: string;
  readonly model?: string;
  readonly timestamp: number;
}

/**
 * CLI health update payload
 */
export interface ChatHealthUpdatePayload {
  readonly available: boolean;
  readonly version?: string;
  readonly responseTime?: number;
  readonly error?: string;
  readonly timestamp: number;
}

/**
 * CLI error payload
 */
export interface ChatCliErrorPayload {
  readonly sessionId?: SessionId;
  readonly error: string;
  readonly context?: Record<string, unknown>;
  readonly timestamp: number;
}

export interface ChatStreamStoppedPayload {
  readonly sessionId: SessionId | null;
  readonly messageId: MessageId | null;
  readonly timestamp: number;
  readonly success: boolean;
}

export interface ChatRequestSessionsPayload {
  // No payload needed for request sessions
}

export interface ChatSessionsUpdatedPayload {
  readonly sessions: readonly SessionUIData[];
}

/**
 * Provider Management Message Payloads
 */
export interface ProvidersGetAvailablePayload {
  // No payload needed for get available providers request
}

export interface ProvidersGetCurrentPayload {
  // No payload needed for get current provider request
}

export interface ProvidersSwitchPayload {
  readonly providerId: string; // ProviderId
  readonly reason?: 'user-request' | 'auto-fallback' | 'error-recovery';
}

export interface ProvidersGetHealthPayload {
  readonly providerId?: string; // ProviderId - optional, if not provided, get current provider health
}

export interface ProvidersGetAllHealthPayload {
  // No payload needed for get all providers health request
}

export interface ProvidersSetDefaultPayload {
  readonly providerId: string; // ProviderId
}

export interface ProvidersEnableFallbackPayload {
  readonly enabled: boolean;
}

export interface ProvidersSetAutoSwitchPayload {
  readonly enabled: boolean;
}

export interface ProvidersSelectModelPayload {
  readonly modelId: string;
  readonly providerId?: string; // Optional - use current provider if omitted
}

export interface ProvidersCurrentChangedPayload {
  readonly from: string | null; // ProviderId | null
  readonly to: string; // ProviderId
  readonly reason: 'user-request' | 'auto-fallback' | 'error-recovery';
  readonly timestamp: number;
}

export interface ProvidersModelChangedPayload {
  readonly modelId: string;
  readonly providerId: string;
  readonly timestamp: number;
}

export interface ProvidersHealthChangedPayload {
  readonly providerId: string; // ProviderId
  readonly health: {
    readonly status:
      | 'available'
      | 'unavailable'
      | 'error'
      | 'initializing'
      | 'disabled';
    readonly lastCheck: number;
    readonly errorMessage?: string;
    readonly responseTime?: number;
    readonly uptime?: number;
  };
}

export interface ProvidersErrorPayload {
  readonly providerId: string; // ProviderId
  readonly error: {
    readonly type: string;
    readonly message: string;
    readonly recoverable: boolean;
    readonly suggestedAction: string;
    readonly context?: Readonly<Record<string, unknown>>;
  };
  readonly timestamp: number;
}

export interface ProvidersAvailableUpdatedPayload {
  readonly availableProviders: readonly {
    readonly id: string; // ProviderId
    readonly name: string;
    readonly status:
      | 'available'
      | 'unavailable'
      | 'error'
      | 'initializing'
      | 'disabled';
  }[];
}

/**
 * Generic error payload for error messages
 */
export interface ErrorPayload {
  readonly code?: string;
  readonly message: string;
  readonly source?: string;
  readonly data?: unknown;
  readonly timestamp?: number;
}

/**
 * Theme changed payload
 */
export interface ThemeChangedPayload {
  readonly theme: 'light' | 'dark' | 'high-contrast';
}

/**
 * Provider information for initial data
 * Subset of ProviderInfo for webview initialization
 */
export interface InitialDataProviderInfo {
  readonly id: string;
  readonly name: string;
  readonly status:
    | 'available'
    | 'unavailable'
    | 'error'
    | 'initializing'
    | 'disabled';
  readonly capabilities: Readonly<{
    streaming: boolean;
    fileAttachments: boolean;
    contextManagement: boolean;
    sessionPersistence: boolean;
    multiTurn: boolean;
    codeGeneration: boolean;
    imageAnalysis: boolean;
    functionCalling: boolean;
  }>;
}

/**
 * Provider health for initial data
 */
export interface InitialDataProviderHealth {
  readonly status:
    | 'available'
    | 'unavailable'
    | 'error'
    | 'initializing'
    | 'disabled';
  readonly lastCheck: number;
  readonly errorMessage?: string;
  readonly responseTime?: number;
  readonly uptime?: number;
}

/**
 * Context information for initial data
 */
export interface InitialDataContextInfo {
  readonly includedFiles: readonly string[];
  readonly excludedFiles: readonly string[];
  readonly tokenEstimate: number;
  readonly optimizations?: readonly {
    readonly type: 'exclude_pattern' | 'include_only' | 'summarize';
    readonly description: string;
    readonly estimatedSavings: number;
    readonly autoApplicable: boolean;
    readonly files?: readonly string[];
  }[];
}

/**
 * Workspace information for initial data
 */
export interface InitialDataWorkspaceInfo {
  readonly name: string;
  readonly path: string;
  readonly projectType: string;
}

/**
 * Initial data payload for webview initialization
 * Sent by AngularWebviewProvider on webview load
 *
 * CRITICAL: This must match the structure sent in angular-webview.provider.ts sendInitialData()
 */
export interface InitialDataPayload {
  readonly success: boolean;
  readonly data: {
    readonly sessions: readonly StrictChatSession[];
    readonly currentSession: StrictChatSession | null;
    // Provider state (added for type safety)
    readonly providers: {
      readonly current: InitialDataProviderInfo | null;
      readonly available: readonly InitialDataProviderInfo[];
      readonly health: Readonly<Record<string, InitialDataProviderHealth>>;
    };
  };
  readonly config: {
    readonly context: InitialDataContextInfo;
    readonly workspaceInfo: InitialDataWorkspaceInfo | null;
    readonly theme: number; // vscode.ColorThemeKind enum
    readonly isVSCode: boolean;
    readonly extensionVersion: string;
  };
  readonly timestamp: number;
}

/**
 * Type mapping for message payloads - eliminates 'any' types
 */
export interface MessagePayloadMap {
  'chat:sendMessage': ChatSendMessagePayload;
  'chat:messageChunk': ChatMessageChunkPayload;
  'chat:sessionStart': ChatSessionStartPayload;
  'chat:sessionEnd': ChatSessionEndPayload;
  'chat:newSession': ChatNewSessionPayload;
  'chat:switchSession': ChatSwitchSessionPayload;
  'chat:getHistory': ChatGetHistoryPayload;
  'chat:messageAdded': ChatMessageAddedPayload;
  'chat:messageComplete': ChatMessageCompletePayload;
  'chat:sessionCreated': ChatSessionCreatedPayload;
  'chat:sessionSwitched': ChatSessionSwitchedPayload;
  'chat:sessionUpdated': ChatSessionUpdatedPayload;
  'chat:tokenUsageUpdated': ChatTokenUsageUpdatedPayload;
  'chat:historyLoaded': ChatHistoryLoadedPayload;
  'chat:renameSession': ChatRenameSessionPayload;
  'chat:deleteSession': ChatDeleteSessionPayload;
  'chat:bulkDeleteSessions': ChatBulkDeleteSessionsPayload;
  'chat:sessionRenamed': ChatSessionRenamedPayload;
  'chat:sessionDeleted': ChatSessionDeletedPayload;
  'chat:getSessionStats': ChatGetSessionStatsPayload;
  'chat:requestSessions': ChatRequestSessionsPayload;
  'chat:sessionsUpdated': ChatSessionsUpdatedPayload;
  'chat:stopStream': ChatStopStreamPayload;
  'chat:streamStopped': ChatStreamStoppedPayload;
  'chat:agentStarted': ChatAgentStartedPayload;
  'chat:agentActivity': ChatAgentActivityPayload;
  'chat:agentCompleted': ChatAgentCompletedPayload;
  'chat:thinking': ChatThinkingPayload;
  'chat:toolStart': ChatToolStartPayload;
  'chat:toolProgress': ChatToolProgressPayload;
  'chat:toolResult': ChatToolResultPayload;
  'chat:toolError': ChatToolErrorPayload;
  'chat:sessionInit': ChatSessionInitPayload;
  'chat:healthUpdate': ChatHealthUpdatePayload;
  'chat:cliError': ChatCliErrorPayload;
  'permission:request': PermissionRequest;
  'permission:response': PermissionResponse;
  'providers:getAvailable': ProvidersGetAvailablePayload;
  'providers:getCurrent': ProvidersGetCurrentPayload;
  'providers:switch': ProvidersSwitchPayload;
  'providers:getHealth': ProvidersGetHealthPayload;
  'providers:getAllHealth': ProvidersGetAllHealthPayload;
  'providers:setDefault': ProvidersSetDefaultPayload;
  'providers:enableFallback': ProvidersEnableFallbackPayload;
  'providers:setAutoSwitch': ProvidersSetAutoSwitchPayload;
  'providers:selectModel': ProvidersSelectModelPayload;
  'providers:currentChanged': ProvidersCurrentChangedPayload;
  'providers:healthChanged': ProvidersHealthChangedPayload;
  'providers:error': ProvidersErrorPayload;
  'providers:availableUpdated': ProvidersAvailableUpdatedPayload;
  'providers:modelChanged': ProvidersModelChangedPayload;
  'context:updateFiles': ContextUpdatePayload;
  'context:getFiles': ContextGetFilesPayload;
  'context:includeFile': ContextIncludeFilePayload;
  'context:excludeFile': ContextExcludeFilePayload;
  'context:searchFiles': ContextSearchFilesPayload;
  'context:getAllFiles': ContextGetAllFilesPayload;
  'context:getFileSuggestions': ContextGetFileSuggestionsPayload;
  'context:searchImages': ContextSearchImagesPayload;
  'commands:getTemplates': CommandsGetTemplatesPayload;
  'commands:executeCommand': CommandsExecuteCommandPayload;
  'commands:selectFile': CommandsSelectFilePayload;
  'commands:saveTemplate': CommandsSaveTemplatePayload;
  'analytics:trackEvent': AnalyticsEventPayload;
  'analytics:getData': AnalyticsGetDataPayload;
  'config:get': ConfigGetPayload;
  'config:set': ConfigUpdatePayload;
  'config:update': ConfigUpdatePayload;
  'config:refresh': ConfigRefreshPayload;
  'state:save': StateSavePayload;
  'state:load': StateLoadPayload;
  'state:clear': StateClearPayload;
  'state:saved': ContextGetFilesPayload;
  'state:loaded': InitialDataPayload;
  'view:changed': ViewChangedPayload;
  'view:routeChanged': ViewRouteChangedPayload;
  'view:generic': ViewGenericPayload;
  error: ErrorPayload;
  initialData: InitialDataPayload;
  'webview-ready': ContextGetFilesPayload; // Empty payload
  ready: ViewChangedPayload; // System ready with view
  requestInitialData: ContextGetFilesPayload; // Empty payload
  themeChanged: ThemeChangedPayload;
  navigate: ViewRouteChangedPayload;
  refresh: ViewChangedPayload; // Refresh payload for hot-reload
  switchView: ViewChangedPayload;
  workspaceChanged: InitialDataPayload;

  // Response event types (MessageHandlerService appends :response suffix)
  // These allow EventBus to emit response events that WebviewMessageBridge forwards to webview
  'chat:sendMessage:response': MessageResponse;
  'chat:newSession:response': MessageResponse;
  'chat:switchSession:response': MessageResponse;
  'chat:getHistory:response': MessageResponse;
  'chat:renameSession:response': MessageResponse;
  'chat:deleteSession:response': MessageResponse;
  'chat:bulkDeleteSessions:response': MessageResponse;
  'chat:getSessionStats:response': MessageResponse;
  'chat:requestSessions:response': MessageResponse;
  'chat:stopStream:response': MessageResponse;
  'chat:agentStarted:response': MessageResponse<ChatAgentStartedPayload>;
  'chat:agentActivity:response': MessageResponse<ChatAgentActivityPayload>;
  'chat:agentCompleted:response': MessageResponse<ChatAgentCompletedPayload>;
  'providers:getAvailable:response': MessageResponse;
  'providers:getCurrent:response': MessageResponse;
  'providers:switch:response': MessageResponse;
  'providers:getHealth:response': MessageResponse;
  'providers:getAllHealth:response': MessageResponse;
  'providers:setDefault:response': MessageResponse;
  'providers:enableFallback:response': MessageResponse;
  'providers:setAutoSwitch:response': MessageResponse;
  'context:getFiles:response': MessageResponse;
  'context:includeFile:response': MessageResponse;
  'context:excludeFile:response': MessageResponse;
  'context:searchFiles:response': MessageResponse;
  'context:getAllFiles:response': MessageResponse;
  'context:getFileSuggestions:response': MessageResponse;
  'context:searchImages:response': MessageResponse;
  'commands:getTemplates:response': MessageResponse;
  'commands:executeCommand:response': MessageResponse;
  'commands:selectFile:response': MessageResponse;
  'commands:saveTemplate:response': MessageResponse;
  'analytics:getData:response': MessageResponse;
  'config:get:response': MessageResponse;
  'config:set:response': MessageResponse;
  'config:update:response': MessageResponse;
  'config:refresh:response': MessageResponse;
  'state:save:response': MessageResponse;
  'state:load:response': MessageResponse;
  'state:clear:response': MessageResponse;
}

/**
 * Generic Message Interface with Strict Typing
 */
export interface StrictMessage<
  T extends keyof MessagePayloadMap = keyof MessagePayloadMap
> {
  readonly id: CorrelationId;
  readonly type: T;
  readonly payload: MessagePayloadMap[T];
  readonly metadata: MessageMetadata;
}

/**
 * Message Metadata with structured information
 */
export interface MessageMetadata {
  readonly timestamp: number;
  readonly source: 'extension' | 'webview';
  readonly sessionId?: SessionId;
  readonly version: string;
}

/**
 * Request-Response Message Types
 */
export interface MessageRequest<
  T extends keyof MessagePayloadMap = keyof MessagePayloadMap
> {
  readonly id: CorrelationId;
  readonly type: T;
  readonly payload: MessagePayloadMap[T];
  readonly metadata: MessageMetadata;
  readonly timeout?: number;
}

export interface MessageResponse<T = unknown> {
  readonly requestId: CorrelationId;
  readonly success: boolean;
  readonly data?: T;
  readonly error?: MessageError;
  readonly metadata: MessageMetadata;
}

/**
 * Structured Error Information
 */
export interface MessageError {
  readonly code: string;
  readonly message: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly stack?: string;
}

/**
 * Strict Chat Message (replaces loose ChatMessage from common.types.ts)
 */
export interface StrictChatMessage {
  readonly id: MessageId;
  readonly sessionId: SessionId;
  readonly type: 'user' | 'assistant' | 'system';
  readonly contentBlocks: readonly ContentBlock[];
  readonly timestamp: number;
  readonly streaming?: boolean;
  readonly files?: readonly string[];
  readonly isError?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
  // For assistant messages
  readonly isComplete?: boolean;
  // For system messages
  readonly level?: 'info' | 'warning' | 'error';

  // NEW: Missing fields for full message lifecycle (TASK_2025_008 - Batch 2)
  readonly cost?: number; // Message cost in USD
  readonly tokens?: {
    // Token breakdown
    readonly input: number;
    readonly output: number;
    readonly cacheHit?: number;
  };
  readonly duration?: number; // Processing time in ms
}

/**
 * MCP Server Information
 * Used in SessionCapabilities to track connected MCP servers
 */
export interface MCPServerInfo {
  readonly name: string;
  readonly status: 'connected' | 'disabled' | 'failed';
  readonly tools?: readonly string[];
}

/**
 * Session Capabilities
 * Tracks AI agent capabilities available in a session
 */
export interface SessionCapabilities {
  readonly cwd: string;
  readonly model: string;
  readonly tools: readonly string[];
  readonly agents: readonly string[];
  readonly slash_commands: readonly string[];
  readonly mcp_servers: readonly MCPServerInfo[];
  readonly claude_code_version: string;
}

/**
 * Strict Chat Session (replaces loose ChatSession from common.types.ts)
 */
export interface StrictChatSession {
  readonly id: SessionId;
  readonly name: string;
  readonly workspaceId?: string;
  readonly messages: readonly StrictChatMessage[];
  readonly createdAt: number;
  readonly lastActiveAt: number;
  readonly updatedAt: number; // Alias for lastActiveAt for UI compatibility
  readonly messageCount: number; // Derived field for UI
  readonly tokenUsage: Readonly<{
    input: number;
    output: number;
    total: number;
    percentage: number;
    maxTokens?: number;
  }>;

  // NEW: Missing fields for IMPLEMENTATION_PLAN compatibility (TASK_2025_008 - Batch 2)
  readonly capabilities?: SessionCapabilities; // AI agent capabilities
  readonly model?: string; // Active model (e.g., "claude-sonnet-4")
  readonly totalCost?: number; // Cumulative cost in USD
  readonly totalTokensInput?: number; // Cumulative input tokens
  readonly totalTokensOutput?: number; // Cumulative output tokens
}

/**
 * Zod Schemas for Runtime Validation
 */
export const StrictMessageTypeSchema = z.enum([
  'chat:sendMessage',
  'chat:messageChunk',
  'chat:sessionStart',
  'chat:sessionEnd',
  'chat:newSession',
  'chat:switchSession',
  'chat:getHistory',
  'chat:messageAdded',
  'chat:messageComplete',
  'chat:sessionCreated',
  'chat:sessionSwitched',
  'chat:historyLoaded',
  'context:updateFiles',
  'analytics:trackEvent',
]);

export const ChatSendMessagePayloadSchema = z
  .object({
    content: z.string().min(1).max(10000),
    files: z.array(z.string()).optional(),
    correlationId: z.string().optional(),
    metadata: z
      .object({
        model: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
      })
      .optional(),
  })
  .strict();

export const ChatMessageChunkPayloadSchema = z
  .object({
    sessionId: SessionIdSchema,
    messageId: MessageIdSchema,
    content: z.string(),
    isComplete: z.boolean(),
    streaming: z.boolean(),
  })
  .strict();

export const MessageMetadataSchema = z
  .object({
    timestamp: z.number().positive(),
    source: z.enum(['extension', 'webview']),
    sessionId: SessionIdSchema.optional(),
    version: z.string(),
  })
  .strict();

export const StrictMessageSchema = <T extends StrictMessageType>(type: T) =>
  z
    .object({
      id: CorrelationIdSchema,
      type: z.literal(type),
      payload: z.unknown(), // Will be refined by specific payload schema
      metadata: MessageMetadataSchema,
    })
    .strict();

export const MessageResponseSchema = z
  .object({
    requestId: CorrelationIdSchema,
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        context: z.record(z.string(), z.unknown()).optional(),
        stack: z.string().optional(),
      })
      .optional(),
    metadata: MessageMetadataSchema,
  })
  .strict();

// Zod schema for MCPServerInfo
export const MCPServerInfoSchema = z.object({
  name: z.string(),
  status: z.enum(['connected', 'disabled', 'failed']),
  tools: z.array(z.string()).optional(),
});

// Zod schema for SessionCapabilities
export const SessionCapabilitiesSchema = z.object({
  cwd: z.string(),
  model: z.string(),
  tools: z.array(z.string()),
  agents: z.array(z.string()),
  slash_commands: z.array(z.string()),
  mcp_servers: z.array(MCPServerInfoSchema),
  claude_code_version: z.string(),
});

/**
 * Zod Schemas for ContentBlock Runtime Validation
 */

/**
 * TextContentBlock Zod schema
 */
export const TextContentBlockSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
    index: z.number().optional(),
  })
  .strict();

/**
 * ToolUseContentBlock Zod schema
 */
export const ToolUseContentBlockSchema = z
  .object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
    index: z.number().optional(),
  })
  .strict();

/**
 * ThinkingContentBlock Zod schema
 */
export const ThinkingContentBlockSchema = z
  .object({
    type: z.literal('thinking'),
    thinking: z.string(),
    index: z.number().optional(),
  })
  .strict();

/**
 * ContentBlock Zod schema - discriminated union
 * Enables runtime validation of structured content blocks
 */
export const ContentBlockSchema = z.discriminatedUnion('type', [
  TextContentBlockSchema,
  ToolUseContentBlockSchema,
  ThinkingContentBlockSchema,
]);

export const StrictChatMessageSchema = z.object({
  id: MessageIdSchema,
  sessionId: SessionIdSchema,
  type: z.enum(['user', 'assistant', 'system']),
  contentBlocks: z.array(ContentBlockSchema),
  timestamp: z.number().positive(),
  streaming: z.boolean().optional(),
  files: z.array(z.string()).optional(),
  isError: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // For assistant messages
  isComplete: z.boolean().optional(),
  // For system messages
  level: z.enum(['info', 'warning', 'error']).optional(),
  // NEW: Message lifecycle fields (TASK_2025_008 - Batch 2)
  cost: z.number().nonnegative().optional(),
  tokens: z
    .object({
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
      cacheHit: z.number().nonnegative().optional(),
    })
    .optional(),
  duration: z.number().nonnegative().optional(),
});

export const StrictChatSessionSchema = z
  .object({
    id: SessionIdSchema,
    name: z.string(),
    workspaceId: z.string().optional(),
    messages: z.array(StrictChatMessageSchema),
    createdAt: z.number().positive(),
    lastActiveAt: z.number().positive(),
    updatedAt: z.number().positive(),
    messageCount: z.number().nonnegative(),
    tokenUsage: z
      .object({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        total: z.number().nonnegative(),
        percentage: z.number().nonnegative(),
        maxTokens: z.number().positive().optional(),
      })
      .strict(),
    // NEW: IMPLEMENTATION_PLAN compatibility fields (TASK_2025_008 - Batch 2)
    capabilities: SessionCapabilitiesSchema.optional(),
    model: z.string().optional(),
    totalCost: z.number().nonnegative().optional(),
    totalTokensInput: z.number().nonnegative().optional(),
    totalTokensOutput: z.number().nonnegative().optional(),
  })
  .strict();

/**
 * System Message Payloads - For webview lifecycle messages
 */
export interface SystemReadyPayload {
  // No payload needed - just lifecycle notification
}

export interface SystemWebviewReadyPayload {
  // No payload needed - just lifecycle notification
}

export interface SystemRequestInitialDataPayload {
  // No payload needed - just lifecycle notification
}

/**
 * System Message Payload Map
 */
export interface SystemMessagePayloadMap {
  ready: SystemReadyPayload;
  'webview-ready': SystemWebviewReadyPayload;
  requestInitialData: SystemRequestInitialDataPayload;
}

/**
 * System Message Interface
 */
export interface SystemMessage<
  T extends keyof SystemMessagePayloadMap = keyof SystemMessagePayloadMap
> {
  readonly type: T;
  readonly payload?: SystemMessagePayloadMap[T];
}

/**
 * Regular routable message interface
 */
export interface RoutableMessage<
  T extends keyof MessagePayloadMap = keyof MessagePayloadMap
> {
  readonly type: T;
  readonly payload: MessagePayloadMap[T];
}

/**
 * Union type for all webview messages (system + routable)
 * This eliminates the 'any' type in handleWebviewMessage
 */
export type WebviewMessage =
  | SystemMessage<keyof SystemMessagePayloadMap>
  | RoutableMessage<keyof MessagePayloadMap>;

/**
 * Type guard to check if message is a system message
 */
export function isSystemMessage(
  message: WebviewMessage
): message is SystemMessage {
  return ['ready', 'webview-ready', 'requestInitialData'].includes(
    message.type
  );
}

/**
 * Type guard to check if message is a routable message
 */
export function isRoutableMessage(
  message: WebviewMessage
): message is RoutableMessage {
  return !isSystemMessage(message);
}

/**
 * Helper function to create strict messages with required metadata
 */
export function createStrictMessage<T extends keyof MessagePayloadMap>(
  type: T,
  payload: MessagePayloadMap[T],
  correlationId?: CorrelationId
): StrictMessage<T> {
  return {
    id: (correlationId ?? crypto.randomUUID()) as CorrelationId,
    type,
    payload,
    metadata: {
      timestamp: Date.now(),
      source: 'webview',
      version: '1.0.0',
    },
  };
}
