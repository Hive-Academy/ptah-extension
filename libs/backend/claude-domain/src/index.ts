/**
 * Claude Domain - Claude CLI integration library
 * Exports all public APIs for use by extension and ai-providers-core
 */

// Detector
export { ClaudeCliDetector } from './detector/claude-cli-detector';
export type { ClaudeInstallation } from './detector/claude-cli-detector';
export { ClaudeCliPathResolver } from './detector/claude-cli-path-resolver';
export type { ResolvedClaudeCliPath } from './detector/claude-cli-path-resolver';

// Session Management
export { SessionManager } from './session/session-manager';
export type {
  SessionUIData,
  ClaudeSessionInfo,
  CreateSessionOptions,
  AddMessageOptions,
  SessionStatistics,
  BulkDeleteResult,
  IStorageService,
} from './session/session-manager';
export { SessionProxy } from './session/session-proxy';

// Command Execution
export { CommandService } from './commands/command.service';
export type {
  CommandExecutionResult,
  CodeReviewRequest,
  TestGenerationRequest,
  FileContextOperation,
  OptimizationSuggestion,
  IContextService,
  IClaudeCliLauncher,
} from './commands/command.service';

// Chat Orchestration
export { ChatOrchestrationService } from './chat/chat-orchestration.service';
export type {
  SendMessageRequest,
  SendMessageResult,
  CreateSessionRequest,
  SessionCreationResult,
  SwitchSessionRequest,
  SessionOperationResult,
  GetHistoryRequest,
  HistoryResult,
  SessionStatsResult,
  PermissionResponseRequest,
  PermissionResponseResult,
  StopStreamRequest,
  StopStreamResult,
  IClaudeCliService,
} from './chat/chat-orchestration.service';

// Provider Orchestration
export { ProviderOrchestrationService } from './provider/provider-orchestration.service';
export type {
  ProviderData,
  GetAvailableProvidersRequest,
  GetAvailableProvidersResult,
  GetCurrentProviderRequest,
  GetCurrentProviderResult,
  SwitchProviderRequest,
  SwitchProviderResult,
  GetProviderHealthRequest,
  GetProviderHealthResult,
  GetAllProviderHealthRequest,
  GetAllProviderHealthResult,
  SetDefaultProviderRequest,
  SetDefaultProviderResult,
  EnableFallbackRequest,
  EnableFallbackResult,
  SetAutoSwitchRequest,
  SetAutoSwitchResult,
  ProviderEventCallback,
} from './provider/provider-orchestration.service';

// Analytics Orchestration
export { AnalyticsOrchestrationService } from './analytics/analytics-orchestration.service';
export type {
  IAnalyticsDataCollector,
  AnalyticsData,
  TrackEventRequest,
  TrackEventResult,
  GetAnalyticsDataRequest,
  GetAnalyticsDataResult,
} from './analytics/analytics-orchestration.service';

// Config Orchestration
export { ConfigOrchestrationService } from './config/config-orchestration.service';
export type {
  IConfigurationProvider,
  WorkspaceConfiguration,
  GetConfigRequest,
  GetConfigResult,
  SetConfigRequest,
  SetConfigResult,
  UpdateConfigRequest,
  UpdateConfigResult,
  RefreshConfigRequest,
  RefreshConfigResult,
} from './config/config-orchestration.service';

// Message Handler Service (Router)
export { MessageHandlerService } from './messaging/message-handler.service';
export type {
  IContextOrchestrationService,
  TypedEvent,
} from './messaging/message-handler.service';

// CLI Launcher & Process Management
export { ClaudeCliService } from './cli/claude-cli.service';
export { ClaudeCliLauncher } from './cli/claude-cli-launcher';
export type { LauncherDependencies } from './cli/claude-cli-launcher';
export { ProcessManager } from './cli/process-manager';
export type { ProcessMetadata } from './cli/process-manager';
export { MCPRegistrationService } from './cli/mcp-registration.service';

// JSONL Parsing
export { JSONLStreamParser } from './cli/jsonl-stream-parser';
export type {
  JSONLParserCallbacks,
  JSONLMessage,
  JSONLSystemMessage,
  JSONLAssistantMessage,
  JSONLToolMessage,
  JSONLPermissionMessage,
  ParsedEvent,
} from './cli/jsonl-stream-parser';

// Permissions
export { PermissionService } from './permissions/permission-service';
export type { PermissionServiceConfig } from './permissions/permission-service';
export {
  InMemoryPermissionRulesStore,
  type IPermissionRulesStore,
} from './permissions/permission-rules.store';

// Events
export { ClaudeDomainEventPublisher } from './events/claude-domain.events';
export type {
  ClaudeContentChunkEvent,
  ClaudeThinkingEventPayload,
  ClaudeToolEventPayload,
  ClaudePermissionRequestEvent,
  ClaudePermissionResponseEvent,
  ClaudeSessionInitEvent,
  ClaudeSessionEndEvent,
  ClaudeHealthUpdateEvent,
  ClaudeErrorEvent,
  IEventBus as ClaudeIEventBus, // Export interface for external use
} from './events/claude-domain.events';

// NOTE: DI registration is now centralized in apps/ptah-extension-vscode/src/di/container.ts
// No longer exporting register functions from libraries
