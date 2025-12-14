// Main library exports

// Dependency Injection - TOKENS and registration function (TASK_2025_071)
export { TOKENS, registerVsCodeCoreServices } from './di';

// NOTE: DIContainer moved to apps/ptah-extension-vscode/src/di/container.ts
// This library exports services, TOKENS, and registration function
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

// NOTE: RpcMethodRegistrationService moved to app layer (TASK_2025_051)
// to break circular dependency between vscode-core and agent-sdk
export { RpcHandler, SdkRpcHandlers } from './messaging';
export type { RpcMessage, RpcResponse, RpcMethodHandler } from './messaging';

// Agent Session Watcher (real-time summary streaming)
export { AgentSessionWatcherService } from './services/agent-session-watcher.service';
export type { AgentSummaryChunk } from './services/agent-session-watcher.service';
