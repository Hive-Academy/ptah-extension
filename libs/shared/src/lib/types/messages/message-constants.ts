/**
 * MESSAGE_TYPES runtime constants + derived MessageType.
 */

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
  PERMISSION_REQUEST: 'permission:request',
  SDK_PERMISSION_RESPONSE: 'chat:permission-response',
  MCP_PERMISSION_RESPONSE: 'permission:response',
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
  CONTEXT_UPDATE_FILES: 'context:updateFiles',
  CONTEXT_GET_FILES: 'context:getFiles',
  CONTEXT_INCLUDE_FILE: 'context:includeFile',
  CONTEXT_EXCLUDE_FILE: 'context:excludeFile',
  CONTEXT_SEARCH_FILES: 'context:searchFiles',
  CONTEXT_GET_ALL_FILES: 'context:getAllFiles',
  CONTEXT_GET_FILE_SUGGESTIONS: 'context:getFileSuggestions',
  CONTEXT_SEARCH_IMAGES: 'context:searchImages',
  COMMANDS_GET_TEMPLATES: 'commands:getTemplates',
  COMMANDS_EXECUTE_COMMAND: 'commands:executeCommand',
  COMMANDS_SELECT_FILE: 'commands:selectFile',
  COMMANDS_SAVE_TEMPLATE: 'commands:saveTemplate',
  ANALYTICS_TRACK_EVENT: 'analytics:trackEvent',
  ANALYTICS_GET_DATA: 'analytics:getData',
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  CONFIG_UPDATE: 'config:update',
  CONFIG_REFRESH: 'config:refresh',
  STATE_SAVE: 'state:save',
  STATE_LOAD: 'state:load',
  STATE_CLEAR: 'state:clear',
  STATE_SAVED: 'state:saved',
  STATE_LOADED: 'state:loaded',
  VIEW_CHANGED: 'view:changed',
  VIEW_ROUTE_CHANGED: 'view:routeChanged',
  VIEW_GENERIC: 'view:generic',
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
  RPC_REQUEST: 'rpc:request',
  RPC_CALL: 'rpc:call',
  RPC_RESPONSE: 'rpc:response',
  CHAT_CHUNK: 'chat:chunk',
  CHAT_COMPLETE: 'chat:complete',
  CHAT_ERROR: 'chat:error',
  SESSION_ID_RESOLVED: 'session:id-resolved',
  SESSION_STATS: 'session:stats',
  /** Push notification: session metadata changed (created/updated/deleted/forked). */
  SESSION_METADATA_CHANGED: 'session:metadataChanged',
  AGENT_SUMMARY_CHUNK: 'agent:summary-chunk',
  SDK_ERROR: 'sdk:error',
  /** Backend → Frontend: reload Monaco tab content after a git rewind (Electron only). */
  EDITOR_TAB_CONTENT_REVERTED: 'editor:tabContentReverted',
  SETUP_WIZARD_OPEN_AGENTS_FOLDER: 'setup-wizard:open-agents-folder',
  SETUP_WIZARD_COMPLETE: 'setup-wizard:complete',
  SETUP_WIZARD_SCAN_PROGRESS: 'setup-wizard:scan-progress',
  SETUP_WIZARD_ANALYSIS_STREAM: 'setup-wizard:analysis-stream',
  /** Backend → Frontend: seed a new chat session with a pre-populated user turn (new-project handoff). */
  SETUP_WIZARD_START_NEW_PROJECT_CHAT: 'setup-wizard:start-new-project-chat',
  ASK_USER_QUESTION_REQUEST: 'ask-user-question:request',
  ASK_USER_QUESTION_RESPONSE: 'ask-user-question:response',
  ASK_USER_QUESTION_AUTO_RESOLVED: 'ask-user-question:auto-resolved',
  PERMISSION_AUTO_RESOLVED: 'permission:auto-resolved',
  PERMISSION_SESSION_CLEANUP: 'permission:session-cleanup',
  PLAN_MODE_CHANGED: 'session:plan-mode-changed',
  AGENT_MONITOR_SPAWNED: 'agent-monitor:spawned',
  AGENT_MONITOR_OUTPUT: 'agent-monitor:output',
  AGENT_MONITOR_EXITED: 'agent-monitor:exited',
  AGENT_MONITOR_PERMISSION_REQUEST: 'agent-monitor:permission-request',
  AGENT_MONITOR_PERMISSION_RESPONSE: 'agent-monitor:permission-response',
  AGENT_MONITOR_USER_INPUT_REQUEST: 'agent-monitor:user-input-request',
  AGENT_MONITOR_USER_INPUT_RESPONSE: 'agent-monitor:user-input-response',
  GATEWAY_STATUS_CHANGED: 'gateway:statusChanged',
  /** Backend → Frontend: update lifecycle state changed (Electron only). */
  UPDATE_STATUS_CHANGED: 'update:statusChanged',
  /** Backend → Frontend: workspace indexing progress tick. */
  INDEXING_PROGRESS: 'indexing:progress',
  /** Backend → Frontend: workspace indexing run finished successfully. */
  INDEXING_COMPLETE: 'indexing:complete',
  BATCH: 'batch',
} as const;

/**
 * Type for MESSAGE_TYPES values
 */
export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];
