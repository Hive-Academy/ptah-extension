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

// Re-export for convenience
export { CorrelationId };

/**
 * Strict Message Types - replaces generic 'string' with exact literals
 */
export type StrictMessageType =
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
  | 'chat:historyLoaded'
  | 'chat:error'
  | 'chat:sessionsUpdated'
  | 'chat:requestSessions'
  | 'chat:renameSession'
  | 'chat:deleteSession'
  | 'chat:bulkDeleteSessions'
  | 'chat:sessionRenamed'
  | 'chat:sessionDeleted'
  | 'chat:getSessionStats'
  | 'chat:stopStream'
  | 'chat:streamStopped'
  | 'chat:permissionRequest'
  | 'chat:permissionResponse'
  | 'chat:sessionsUpdated'
  | 'providers:getAvailable'
  | 'providers:getCurrent'
  | 'providers:switch'
  | 'providers:getHealth'
  | 'providers:getAllHealth'
  | 'providers:setDefault'
  | 'providers:enableFallback'
  | 'providers:setAutoSwitch'
  | 'providers:currentChanged'
  | 'providers:healthChanged'
  | 'providers:error'
  | 'providers:availableUpdated'
  | 'context:updateFiles'
  | 'context:getFiles'
  | 'context:includeFile'
  | 'context:excludeFile'
  | 'context:searchFiles'
  | 'context:getAllFiles'
  | 'context:getFileSuggestions'
  | 'context:searchImages'
  | 'commands:getTemplates'
  | 'commands:executeCommand'
  | 'commands:selectFile'
  | 'commands:saveTemplate'
  | 'analytics:trackEvent'
  | 'analytics:getData'
  | 'config:get'
  | 'config:set'
  | 'config:update'
  | 'config:refresh'
  | 'state:save'
  | 'state:load'
  | 'state:clear'
  | 'view:changed'
  | 'view:routeChanged'
  | 'view:generic'
  // System message types
  | 'ready'
  | 'webview-ready'
  | 'requestInitialData'
  | 'initialData'
  | 'themeChanged'
  | 'navigate'
  | 'state:saved'
  | 'state:loaded'
  | 'error'
  | 'refresh' // Refresh signal for hot-reload
  // Legacy message types for compatibility
  | 'switchView'
  | 'workspaceChanged';

// System message types are now included in StrictMessageType above

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

export interface ChatSessionEndPayload {
  readonly sessionId: SessionId;
  readonly duration: number;
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
 * Initial data payload for webview initialization
 */
export interface InitialDataPayload {
  readonly config?: unknown;
  readonly state?: unknown;
  readonly workspace?: unknown;
  readonly theme?: 'light' | 'dark';
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
  readonly content: string;
  readonly timestamp: number;
  readonly streaming?: boolean;
  readonly files?: readonly string[];
  readonly isError?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
  // For assistant messages
  readonly isComplete?: boolean;
  // For system messages
  readonly level?: 'info' | 'warning' | 'error';
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

export const StrictChatMessageSchema = z.object({
  id: MessageIdSchema,
  sessionId: SessionIdSchema,
  type: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.number().positive(),
  streaming: z.boolean().optional(),
  files: z.array(z.string()).optional(),
  isError: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
  // For assistant messages
  isComplete: z.boolean().optional(),
  // For system messages
  level: z.enum(['info', 'warning', 'error']).optional(),
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
