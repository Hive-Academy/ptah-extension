/**
 * Strict message type literal union across all domains.
 *
 * Extracted from message.types.ts (TASK_2025_291 Wave C2) — zero behavior change.
 */

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
  // Update Messages (TASK_2026_117: Electron auto-update UX)
  | 'update:statusChanged'
  | string; // Allow extensibility for custom message types
