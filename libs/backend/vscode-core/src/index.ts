// Main library exports


// Dependency Injection
export { DIContainer, TOKENS, container } from './di/container';
export type { DependencyContainer } from './di/container';

// Messaging
export { EventBus } from './messaging/event-bus';
export type {
  TypedEvent,
  RequestEvent,
  ResponseEvent
} from './messaging/event-bus';

// API Wrappers
export { 
  CommandManager, 
  WebviewManager, 
  OutputManager, 
  StatusBarManager, 
  FileSystemManager 
} from './api-wrappers';
export type {
  CommandDefinition,
  CommandExecutedPayload,
  CommandErrorPayload,
  WebviewPanelConfig,
  WebviewMessagePayload,
  WebviewCreatedPayload,
  WebviewDisposedPayload,
  OutputChannelConfig,
  WriteOptions,
  OutputMessagePayload,
  OutputChannelCreatedPayload,
  OutputChannelErrorPayload,
  StatusBarItemConfig,
  StatusBarItemUpdate,
  StatusBarItemCreatedPayload,
  StatusBarItemUpdatedPayload,
  StatusBarItemClickedPayload,
  StatusBarItemErrorPayload,
  FileOperationType,
  FileOperationOptions,
  FileWatcherConfig,
  FileOperationPayload,
  FileWatcherEventPayload,
  FileSystemErrorPayload
} from './api-wrappers';
