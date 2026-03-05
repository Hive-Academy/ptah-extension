// Main library exports

// Dependency Injection - TOKENS and registration function (TASK_2025_071)
// TASK_2025_071 Batch 6: TOKENS exported directly from tokens.ts (not via di/index.ts)
// di/index.ts only exports registration function (pattern consistency with other libraries)
export { TOKENS } from './di/tokens';
export { registerVsCodeCoreServices } from './di';

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
  IWebviewHtmlGenerator,
  WebviewHtmlOptions,
} from './api-wrappers';

// NOTE: RpcMethodRegistrationService moved to app layer (TASK_2025_051)
// to break circular dependency between vscode-core and agent-sdk
// TASK_2025_092: SdkRpcHandlers deleted (dead code - permission emitter moved to SdkPermissionHandler)
// TASK_2025_124: RpcLicenseValidationResult added for license middleware testing
export { RpcHandler } from './messaging';
export type {
  RpcMessage,
  RpcResponse,
  RpcMethodHandler,
  RpcLicenseValidationResult,
} from './messaging';

// RPC Registration Verification (TASK_2025_074)
export {
  verifyRpcRegistration,
  assertRpcRegistration,
} from './messaging/rpc-verification';
export type { RpcVerificationResult } from './messaging/rpc-verification';

// RPC handlers (TASK_2025_073 Batch 5)
export { LlmRpcHandlers } from './rpc/llm-rpc-handlers';
export type {
  LlmProviderName,
  LlmProviderStatus,
  SetApiKeyRequest,
  SetApiKeyResponse,
  VsCodeModelInfo,
} from './rpc/llm-rpc-handlers';

// Agent Session Watcher (real-time summary streaming)
export { AgentSessionWatcherService } from './services/agent-session-watcher.service';
export type {
  AgentSummaryChunk,
  AgentStartEvent,
} from './services/agent-session-watcher.service';

// Subagent Registry (TASK_2025_103: subagent resumption)
export { SubagentRegistryService } from './services/subagent-registry.service';
export type { SubagentRegistration } from './services/subagent-registry.service';

// Webview Message Handler (shared message handling for all webviews)
export { WebviewMessageHandlerService } from './services/webview-message-handler.service';
export type {
  CustomMessageHandler,
  WebviewMessageHandlerConfig,
} from './services/webview-message-handler.service';

// Auth Secrets Service (TASK_2025_076)
export { AuthSecretsService } from './services/auth-secrets.service';
export type {
  IAuthSecretsService,
  AuthCredentialType,
} from './services/auth-secrets.service';

// License Service (TASK_2025_075, TASK_2025_121)
export { LicenseService, isPremiumTier } from './services/license.service';
export type {
  LicenseStatus,
  LicenseEvents,
  LicenseTierValue,
} from './services/license.service';

// Feature Gate Service (TASK_2025_121)
export { FeatureGateService } from './services/feature-gate.service';
export type { Feature, ProOnlyFeature } from './services/feature-gate.service';
