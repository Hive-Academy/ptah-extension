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
  WebviewPanelConfig,
  OutputChannelConfig,
  WriteOptions,
  StatusBarItemConfig,
  StatusBarItemUpdate,
  FileOperationType,
  FileOperationOptions,
  FileWatcherConfig,
} from './api-wrappers';
// TODO: Phase 2 - Restore event payload types when RPC is implemented
// CommandExecutedPayload, CommandErrorPayload,
// WebviewMessagePayload, WebviewCreatedPayload, WebviewDisposedPayload,
// OutputMessagePayload, OutputChannelCreatedPayload, OutputChannelErrorPayload,
// StatusBarItemCreatedPayload, StatusBarItemUpdatedPayload, StatusBarItemClickedPayload, StatusBarItemErrorPayload,
// FileOperationPayload, FileWatcherEventPayload, FileSystemErrorPayload
