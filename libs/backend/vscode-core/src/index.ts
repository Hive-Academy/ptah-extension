// Main library exports

// Dependency Injection - TOKENS only (registration now centralized in app)
export { TOKENS } from './di/tokens';

// NOTE: DIContainer and registration moved to apps/ptah-extension-vscode/src/di/container.ts
// This library now only exports services and TOKENS, not DI setup
// DO NOT export tokens directly - only export via TOKENS namespace

// Core Infrastructure (TASK_CORE_001)
export { Logger } from './logging';
export type { LogLevel, LogContext, LogEntry } from './logging';

export { ErrorHandler } from './error-handling';
export type {
  ErrorContext,
  ErrorAction,
  ErrorBoundaryResult,
} from './error-handling';

export { ConfigManager } from './config';
export type {
  ConfigurationChangeEvent,
  ConfigWatcher,
  ConfigurationSchema,
  ConfigUpdateOptions,
} from './config';

// Validation (TASK_CORE_001)
export {
  MessageValidatorService,
  ValidationError,
  MessageValidationError,
  PtahError,
} from './validation';

// Messaging
export { EventBus } from './messaging/event-bus';
export type {
  TypedEvent,
  RequestEvent,
  ResponseEvent,
} from './messaging/event-bus';

// API Wrappers
export {
  CommandManager,
  WebviewManager,
  OutputManager,
  StatusBarManager,
  FileSystemManager,
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
  FileSystemErrorPayload,
} from './api-wrappers';
