/**
 * MessagePayloadMap — strict type mapping from message type → payload interface.
 *
 * Extracted from message.types.ts (TASK_2025_291 Wave C2) — zero behavior change.
 */

import type {
  PermissionRequest,
  PermissionResponse,
} from '../permission.types';

import type {
  ChatAgentActivityPayload,
  ChatAgentCompletedPayload,
  ChatAgentStartedPayload,
  ChatCliErrorPayload,
  ChatHealthUpdatePayload,
  ChatSessionInitPayload,
  ChatThinkingPayload,
  ChatToolErrorPayload,
  ChatToolProgressPayload,
  ChatToolResultPayload,
  ChatToolStartPayload,
} from './agent';
import type {
  AnalyticsEventPayload,
  ChatBulkDeleteSessionsPayload,
  ChatDeleteSessionPayload,
  ChatGetHistoryPayload,
  ChatGetSessionStatsPayload,
  ChatHistoryLoadedPayload,
  ChatMessageAddedPayload,
  ChatMessageChunkPayload,
  ChatMessageCompletePayload,
  ChatNewSessionPayload,
  ChatRenameSessionPayload,
  ChatRequestSessionsPayload,
  ChatSendMessagePayload,
  ChatSessionCreatedPayload,
  ChatSessionDeletedPayload,
  ChatSessionEndPayload,
  ChatSessionRenamedPayload,
  ChatSessionStartPayload,
  ChatSessionSwitchedPayload,
  ChatSessionUpdatedPayload,
  ChatSessionsUpdatedPayload,
  ChatStopStreamPayload,
  ChatStreamStoppedPayload,
  ChatSwitchSessionPayload,
  ChatTokenUsageUpdatedPayload,
  ContextExcludeFilePayload,
  ContextGetAllFilesPayload,
  ContextGetFileSuggestionsPayload,
  ContextGetFilesPayload,
  ContextIncludeFilePayload,
  ContextSearchFilesPayload,
  ContextSearchImagesPayload,
  ContextUpdatePayload,
} from './chat';
import type { MessageResponse } from './envelope';
import type {
  AnalyticsGetDataPayload,
  CommandsExecuteCommandPayload,
  CommandsGetTemplatesPayload,
  CommandsSaveTemplatePayload,
  CommandsSelectFilePayload,
  ConfigGetPayload,
  ConfigRefreshPayload,
  ConfigUpdatePayload,
  ErrorPayload,
  InitialDataPayload,
  ProvidersAvailableUpdatedPayload,
  ProvidersCurrentChangedPayload,
  ProvidersEnableFallbackPayload,
  ProvidersErrorPayload,
  ProvidersGetAllHealthPayload,
  ProvidersGetAvailablePayload,
  ProvidersGetCurrentPayload,
  ProvidersGetHealthPayload,
  ProvidersHealthChangedPayload,
  ProvidersModelChangedPayload,
  ProvidersSelectModelPayload,
  ProvidersSetAutoSwitchPayload,
  ProvidersSetDefaultPayload,
  ProvidersSwitchPayload,
  StateClearPayload,
  StateLoadPayload,
  StateSavePayload,
  ThemeChangedPayload,
  ViewChangedPayload,
  ViewGenericPayload,
  ViewRouteChangedPayload,
} from './system';

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
