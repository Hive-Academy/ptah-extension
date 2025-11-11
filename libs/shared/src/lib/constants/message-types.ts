/**
 * Message Type Constants - Single Source of Truth
 *
 * **CRITICAL**: All message type strings MUST be defined here.
 * Never use string literals for message types anywhere in the codebase.
 *
 * Import these constants in:
 * - Backend: SessionManager, WebviewMessageBridge, message handlers
 * - Frontend: ChatService, VSCodeService, all subscriptions
 * - Shared: MessagePayloadMap, StrictMessageType
 *
 * This prevents event naming mismatches that cause silent failures.
 */

/**
 * Chat message types
 */
export const CHAT_MESSAGE_TYPES = {
  // Request/Action types (frontend → backend)
  SEND_MESSAGE: 'chat:sendMessage',
  NEW_SESSION: 'chat:newSession',
  SWITCH_SESSION: 'chat:switchSession',
  GET_HISTORY: 'chat:getHistory',
  RENAME_SESSION: 'chat:renameSession',
  DELETE_SESSION: 'chat:deleteSession',
  BULK_DELETE_SESSIONS: 'chat:bulkDeleteSessions',
  GET_SESSION_STATS: 'chat:getSessionStats',
  REQUEST_SESSIONS: 'chat:requestSessions',
  STOP_STREAM: 'chat:stopStream',

  // Event types (backend → frontend)
  MESSAGE_CHUNK: 'chat:messageChunk',
  MESSAGE_ADDED: 'chat:messageAdded',
  MESSAGE_COMPLETE: 'chat:messageComplete',
  SESSION_START: 'chat:sessionStart',
  SESSION_END: 'chat:sessionEnd',
  SESSION_CREATED: 'chat:sessionCreated',
  SESSION_SWITCHED: 'chat:sessionSwitched',
  SESSION_UPDATED: 'chat:sessionUpdated',
  SESSION_DELETED: 'chat:sessionDeleted',
  SESSION_RENAMED: 'chat:sessionRenamed',
  SESSIONS_UPDATED: 'chat:sessionsUpdated',
  TOKEN_USAGE_UPDATED: 'chat:tokenUsageUpdated',
  HISTORY_LOADED: 'chat:historyLoaded',
  STREAM_STOPPED: 'chat:streamStopped',
  PERMISSION_REQUEST: 'chat:permissionRequest',
  PERMISSION_RESPONSE: 'chat:permissionResponse',
  ERROR: 'chat:error',
} as const;

/**
 * Provider message types
 */
export const PROVIDER_MESSAGE_TYPES = {
  // Request/Action types
  GET_AVAILABLE: 'providers:getAvailable',
  GET_CURRENT: 'providers:getCurrent',
  SWITCH: 'providers:switch',
  GET_HEALTH: 'providers:getHealth',
  GET_ALL_HEALTH: 'providers:getAllHealth',
  SET_DEFAULT: 'providers:setDefault',
  ENABLE_FALLBACK: 'providers:enableFallback',
  SET_AUTO_SWITCH: 'providers:setAutoSwitch',

  // Event types
  CURRENT_CHANGED: 'providers:currentChanged',
  HEALTH_CHANGED: 'providers:healthChanged',
  ERROR: 'providers:error',
  AVAILABLE_UPDATED: 'providers:availableUpdated',
} as const;

/**
 * Context message types
 */
export const CONTEXT_MESSAGE_TYPES = {
  UPDATE_FILES: 'context:updateFiles',
  GET_FILES: 'context:getFiles',
  INCLUDE_FILE: 'context:includeFile',
  EXCLUDE_FILE: 'context:excludeFile',
  SEARCH_FILES: 'context:searchFiles',
  GET_ALL_FILES: 'context:getAllFiles',
  GET_FILE_SUGGESTIONS: 'context:getFileSuggestions',
  SEARCH_IMAGES: 'context:searchImages',
} as const;

/**
 * Command message types
 */
export const COMMAND_MESSAGE_TYPES = {
  GET_TEMPLATES: 'commands:getTemplates',
  EXECUTE_COMMAND: 'commands:executeCommand',
  SELECT_FILE: 'commands:selectFile',
  SAVE_TEMPLATE: 'commands:saveTemplate',
} as const;

/**
 * Analytics message types
 */
export const ANALYTICS_MESSAGE_TYPES = {
  TRACK_EVENT: 'analytics:trackEvent',
  GET_DATA: 'analytics:getData',
} as const;

/**
 * Configuration message types
 */
export const CONFIG_MESSAGE_TYPES = {
  GET: 'config:get',
  SET: 'config:set',
  UPDATE: 'config:update',
  REFRESH: 'config:refresh',
} as const;

/**
 * State message types
 */
export const STATE_MESSAGE_TYPES = {
  SAVE: 'state:save',
  LOAD: 'state:load',
  CLEAR: 'state:clear',
  SAVED: 'state:saved',
  LOADED: 'state:loaded',
} as const;

/**
 * View message types
 */
export const VIEW_MESSAGE_TYPES = {
  CHANGED: 'view:changed',
  ROUTE_CHANGED: 'view:routeChanged',
  GENERIC: 'view:generic',
} as const;

/**
 * System message types
 */
export const SYSTEM_MESSAGE_TYPES = {
  READY: 'ready',
  WEBVIEW_READY: 'webview-ready',
  REQUEST_INITIAL_DATA: 'requestInitialData',
  INITIAL_DATA: 'initialData',
  THEME_CHANGED: 'themeChanged',
  NAVIGATE: 'navigate',
  ERROR: 'error',
  REFRESH: 'refresh',

  // Legacy (for compatibility)
  SWITCH_VIEW: 'switchView',
  WORKSPACE_CHANGED: 'workspaceChanged',
} as const;

/**
 * Chat response message types
 */
export const CHAT_RESPONSE_TYPES = {
  SEND_MESSAGE: 'chat:sendMessage:response',
  NEW_SESSION: 'chat:newSession:response',
  SWITCH_SESSION: 'chat:switchSession:response',
  GET_HISTORY: 'chat:getHistory:response',
  RENAME_SESSION: 'chat:renameSession:response',
  DELETE_SESSION: 'chat:deleteSession:response',
  BULK_DELETE_SESSIONS: 'chat:bulkDeleteSessions:response',
  GET_SESSION_STATS: 'chat:getSessionStats:response',
  REQUEST_SESSIONS: 'chat:requestSessions:response',
  STOP_STREAM: 'chat:stopStream:response',
} as const;

/**
 * Provider response message types
 */
export const PROVIDER_RESPONSE_TYPES = {
  GET_AVAILABLE: 'providers:getAvailable:response',
  GET_CURRENT: 'providers:getCurrent:response',
  SWITCH: 'providers:switch:response',
  GET_HEALTH: 'providers:getHealth:response',
  GET_ALL_HEALTH: 'providers:getAllHealth:response',
  SET_DEFAULT: 'providers:setDefault:response',
  ENABLE_FALLBACK: 'providers:enableFallback:response',
  SET_AUTO_SWITCH: 'providers:setAutoSwitch:response',
} as const;

/**
 * Context response message types
 */
export const CONTEXT_RESPONSE_TYPES = {
  GET_FILES: 'context:getFiles:response',
  INCLUDE_FILE: 'context:includeFile:response',
  EXCLUDE_FILE: 'context:excludeFile:response',
  SEARCH_FILES: 'context:searchFiles:response',
  GET_ALL_FILES: 'context:getAllFiles:response',
  GET_FILE_SUGGESTIONS: 'context:getFileSuggestions:response',
  SEARCH_IMAGES: 'context:searchImages:response',
} as const;

/**
 * Command response message types
 */
export const COMMAND_RESPONSE_TYPES = {
  GET_TEMPLATES: 'commands:getTemplates:response',
  EXECUTE_COMMAND: 'commands:executeCommand:response',
  SELECT_FILE: 'commands:selectFile:response',
  SAVE_TEMPLATE: 'commands:saveTemplate:response',
} as const;

/**
 * Configuration response message types
 */
export const CONFIG_RESPONSE_TYPES = {
  GET: 'config:get:response',
  SET: 'config:set:response',
  UPDATE: 'config:update:response',
  REFRESH: 'config:refresh:response',
} as const;

/**
 * State response message types
 */
export const STATE_RESPONSE_TYPES = {
  SAVE: 'state:save:response',
  LOAD: 'state:load:response',
  CLEAR: 'state:clear:response',
} as const;

/**
 * All message types combined for easy access
 */
export const MESSAGE_TYPES = {
  ...CHAT_MESSAGE_TYPES,
  ...CHAT_RESPONSE_TYPES,
  ...PROVIDER_MESSAGE_TYPES,
  ...PROVIDER_RESPONSE_TYPES,
  ...CONTEXT_MESSAGE_TYPES,
  ...CONTEXT_RESPONSE_TYPES,
  ...COMMAND_MESSAGE_TYPES,
  ...COMMAND_RESPONSE_TYPES,
  ...ANALYTICS_MESSAGE_TYPES,
  ...CONFIG_MESSAGE_TYPES,
  ...CONFIG_RESPONSE_TYPES,
  ...STATE_MESSAGE_TYPES,
  ...STATE_RESPONSE_TYPES,
  ...VIEW_MESSAGE_TYPES,
  ...SYSTEM_MESSAGE_TYPES,
} as const;

/**
 * Type-safe message type (derives from constants)
 */
export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

/**
 * Helper to validate if a string is a valid message type
 */
export function isValidMessageType(type: string): type is MessageType {
  return Object.values(MESSAGE_TYPES).includes(type as MessageType);
}

/**
 * Response message types (auto-generated pattern)
 */
export const RESPONSE_SUFFIX = ':response' as const;

/**
 * Helper to create response type from request type
 */
export function toResponseType<T extends string>(
  requestType: T
): `${T}:response` {
  return `${requestType}:response` as `${T}:response`;
}
