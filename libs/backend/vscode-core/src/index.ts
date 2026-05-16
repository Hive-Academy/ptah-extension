// Main library exports

// Dependency Injection - TOKENS and registration function.
// TOKENS exported directly from tokens.ts (not via di/index.ts); di/index.ts
// only exports the registration function (pattern consistency with other libs).
export { TOKENS } from './di/tokens';
export { registerVsCodeCoreServices } from './di';

// Platform-agnostic registration helper for non-VS-Code hosts
export { registerVsCodeCorePlatformAgnostic } from './di/register-platform-agnostic';
export type { PlatformAgnosticRegistrationOptions } from './di/register-platform-agnostic';

// NOTE: DIContainer lives in apps/ptah-extension-vscode/src/di/container.ts.
// This library exports services, TOKENS, and registration function.
// DO NOT export tokens directly - only export via TOKENS namespace.

// Core Infrastructure
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
  IFileSettingsStore,
  ConfigWatcher,
  ConfigurationSchema,
  ConfigUpdateOptions,
} from './config';

// Validation
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

// NOTE: RpcMethodRegistrationService lives in the app layer to break the
// circular dependency between vscode-core and agent-sdk.
export { RpcHandler, RpcUserError, ALLOWED_METHOD_PREFIXES } from './messaging';
export type {
  RpcMessage,
  RpcResponse,
  RpcMethodHandler,
  RpcLicenseValidationResult,
} from './messaging';

// RPC Registration Verification
export {
  verifyRpcRegistration,
  assertRpcRegistration,
} from './messaging/rpc-verification';
export type { RpcVerificationResult } from './messaging/rpc-verification';

// Subagent Registry (subagent resumption)
export { SubagentRegistryService } from './services/subagent-registry.service';
export type { SubagentRegistration } from './services/subagent-registry.service';

// Webview Message Handler (shared message handling for all webviews)
export { WebviewMessageHandlerService } from './services/webview-message-handler.service';
export type {
  CustomMessageHandler,
  WebviewMessageHandlerConfig,
  WebviewMessage,
} from './services/webview-message-handler.service';

// Auth Secrets Service
export { AuthSecretsService } from './services/auth-secrets.service';
export type {
  IAuthSecretsService,
  AuthCredentialType,
} from './services/auth-secrets.service';

// License Service
export { LicenseService, isPremiumTier } from './services/license.service';
export type {
  LicenseStatus,
  LicenseEvents,
  LicenseTierValue,
} from './services/license.service';

// Feature Gate Service
export { FeatureGateService } from './services/feature-gate.service';
export type { Feature, ProOnlyFeature } from './services/feature-gate.service';

// Sentry Error Monitoring Service
export { SentryService } from './services/sentry.service';
export type {
  SentryInitOptions,
  SentryErrorContext,
} from './services/sentry.service';

// Git Info Service
export { GitInfoService } from './services/git-info.service';

// Workspace Context Manager + Workspace-Aware State Storage so the shared
// WorkspaceRpcHandlers can be served by all hosts.
export { WorkspaceContextManager } from './services/workspace-context-manager';
export { WorkspaceAwareStateStorage } from './services/workspace-aware-state-storage';
export type { StateStorageFactory } from './services/workspace-aware-state-storage';

// License Reactivity — reactive premium subsystem bring-up / tear-down
export {
  bindLicenseReactivity,
  bringUpPremiumSubsystems,
  tearDownPremiumSubsystems,
} from './services/license-reactivity';
export type {
  LicenseReactivityOptions,
  PremiumSubsystemsDeps,
} from './services/license-reactivity';

// Platform Abstraction Interfaces are defined in @ptah-extension/rpc-handlers
// (import directly from there) — NOT re-exported here to avoid the circular
// dependency: vscode-core -> rpc-handlers -> vscode-core.
