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
} from './claude-domain.types';
import {
  CHAT_MESSAGE_TYPES,
  CHAT_RESPONSE_TYPES,
  PROVIDER_MESSAGE_TYPES,
  PROVIDER_RESPONSE_TYPES,
  CONTEXT_MESSAGE_TYPES,
  CONTEXT_RESPONSE_TYPES,
  COMMAND_MESSAGE_TYPES,
  COMMAND_RESPONSE_TYPES,
  ANALYTICS_MESSAGE_TYPES,
  ANALYTICS_RESPONSE_TYPES,
  CONFIG_MESSAGE_TYPES,
  CONFIG_RESPONSE_TYPES,
  STATE_MESSAGE_TYPES,
  STATE_RESPONSE_TYPES,
  VIEW_MESSAGE_TYPES,
  SYSTEM_MESSAGE_TYPES,
} from '../constants/message-types';

// Re-export for convenience
export { CorrelationId };

/**
 * ContentBlock Discriminated Union - Structured Message Content
 * Replaces flat string content with typed blocks for text, tool use, and thinking
 */

/**
 * TextContentBlock - Plain text content from assistant or user
 */
export interface TextContentBlock {
  readonly type: 'text';
  readonly text: string;
  readonly index?: number;
}

/**
 * ToolUseContentBlock - Tool execution request from assistant
 */
export interface ToolUseContentBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly index?: number;
}

/**
 * ThinkingContentBlock - Claude's reasoning process (extended thinking)
 */
export interface ThinkingContentBlock {
  readonly type: 'thinking';
  readonly thinking: string;
  readonly index?: number;
}

/**
 * ContentBlock - Discriminated union of all content block types
 * Enables type-safe pattern matching with TypeScript discriminated unions
 */
export type ContentBlock =
  | TextContentBlock
  | ToolUseContentBlock
  | ThinkingContentBlock;

/**
 * Strict Message Types - derives from MESSAGE_TYPES constants
 * This ensures automatic sync between constants and types (single source of truth)
 *
 * By importing each category separately and creating a union, we maintain proper type narrowing
 */
export type StrictMessageType =
  | (typeof CHAT_MESSAGE_TYPES)[keyof typeof CHAT_MESSAGE_TYPES]
  | (typeof CHAT_RESPONSE_TYPES)[keyof typeof CHAT_RESPONSE_TYPES]
  | (typeof PROVIDER_MESSAGE_TYPES)[keyof typeof PROVIDER_MESSAGE_TYPES]
  | (typeof PROVIDER_RESPONSE_TYPES)[keyof typeof PROVIDER_RESPONSE_TYPES]
  | (typeof CONTEXT_MESSAGE_TYPES)[keyof typeof CONTEXT_MESSAGE_TYPES]
  | (typeof CONTEXT_RESPONSE_TYPES)[keyof typeof CONTEXT_RESPONSE_TYPES]
  | (typeof COMMAND_MESSAGE_TYPES)[keyof typeof COMMAND_MESSAGE_TYPES]
  | (typeof COMMAND_RESPONSE_TYPES)[keyof typeof COMMAND_RESPONSE_TYPES]
  | (typeof ANALYTICS_MESSAGE_TYPES)[keyof typeof ANALYTICS_MESSAGE_TYPES]
  | (typeof ANALYTICS_RESPONSE_TYPES)[keyof typeof ANALYTICS_RESPONSE_TYPES]
  | (typeof CONFIG_MESSAGE_TYPES)[keyof typeof CONFIG_MESSAGE_TYPES]
  | (typeof CONFIG_RESPONSE_TYPES)[keyof typeof CONFIG_RESPONSE_TYPES]
  | (typeof STATE_MESSAGE_TYPES)[keyof typeof STATE_MESSAGE_TYPES]
  | (typeof STATE_RESPONSE_TYPES)[keyof typeof STATE_RESPONSE_TYPES]
  | (typeof VIEW_MESSAGE_TYPES)[keyof typeof VIEW_MESSAGE_TYPES]
  | (typeof SYSTEM_MESSAGE_TYPES)[keyof typeof SYSTEM_MESSAGE_TYPES]; // System message types are now included in StrictMessageType above

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
  readonly content: string;
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

export interface ChatPermissionRequestPayload {
  readonly id: string;
  readonly tool: string;
  readonly action: string;
  readonly description: string;
  readonly timestamp: number;
  readonly sessionId: string;
}

export interface ChatPermissionResponsePayload {
  readonly requestId: string;
  readonly response: 'allow' | 'always_allow' | 'deny';
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
  readonly sessions: readonly StrictChatSession[];
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

export interface ProvidersCurrentChangedPayload {
  readonly from: string | null; // ProviderId | null
  readonly to: string; // ProviderId
  readonly reason: 'user-request' | 'auto-fallback' | 'error-recovery';
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
  'chat:permissionRequest': ChatPermissionRequestPayload;
  'chat:permissionResponse': ChatPermissionResponsePayload;
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
  'providers:getAvailable': ProvidersGetAvailablePayload;
  'providers:getCurrent': ProvidersGetCurrentPayload;
  'providers:switch': ProvidersSwitchPayload;
  'providers:getHealth': ProvidersGetHealthPayload;
  'providers:getAllHealth': ProvidersGetAllHealthPayload;
  'providers:setDefault': ProvidersSetDefaultPayload;
  'providers:enableFallback': ProvidersEnableFallbackPayload;
  'providers:setAutoSwitch': ProvidersSetAutoSwitchPayload;
  'providers:currentChanged': ProvidersCurrentChangedPayload;
  'providers:healthChanged': ProvidersHealthChangedPayload;
  'providers:error': ProvidersErrorPayload;
  'providers:availableUpdated': ProvidersAvailableUpdatedPayload;
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
 * Tracks Claude Code capabilities available in a session
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
  readonly capabilities?: SessionCapabilities; // Claude Code capabilities
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
        context: z.record(z.unknown()).optional(),
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
    input: z.record(z.unknown()),
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
  metadata: z.record(z.unknown()).optional(),
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
