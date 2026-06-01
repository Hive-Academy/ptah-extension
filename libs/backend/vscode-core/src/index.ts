export { TOKENS } from './di/tokens';
export { registerVsCodeCoreServices } from './di';
export { registerVsCodeCorePlatformAgnostic } from './di/register-platform-agnostic';
export type { PlatformAgnosticRegistrationOptions } from './di/register-platform-agnostic';
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
export {
  MessageValidatorService,
  ValidationError,
  MessageValidationError,
  PtahError,
} from './validation';
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
export { RpcHandler, RpcUserError, ALLOWED_METHOD_PREFIXES } from './messaging';
export type {
  RpcMessage,
  RpcResponse,
  RpcMethodHandler,
  RpcLicenseValidationResult,
} from './messaging';
export {
  verifyRpcRegistration,
  assertRpcRegistration,
} from './messaging/rpc-verification';
export type { RpcVerificationResult } from './messaging/rpc-verification';
export { SubagentRegistryService } from './services/subagent-registry.service';
export type { SubagentRegistration } from './services/subagent-registry.service';
export { WebviewMessageHandlerService } from './services/webview-message-handler.service';
export type {
  CustomMessageHandler,
  WebviewMessageHandlerConfig,
  WebviewMessage,
} from './services/webview-message-handler.service';
export { AuthSecretsService } from './services/auth-secrets.service';
export type {
  IAuthSecretsService,
  AuthCredentialType,
} from './services/auth-secrets.service';
export { LicenseService, isPremiumTier } from './services/license.service';
export type {
  LicenseStatus,
  LicenseEvents,
  LicenseTierValue,
} from './services/license.service';
export { FeatureGateService } from './services/feature-gate.service';
export type { Feature, ProOnlyFeature } from './services/feature-gate.service';
export { SentryService } from './services/sentry.service';
export type {
  SentryInitOptions,
  SentryErrorContext,
} from './services/sentry.service';
export { SentryTracerAdapter } from './services/sentry-tracer.adapter';
export { NoopTracer } from './services/noop-tracer';
export { GitInfoService } from './services/git-info.service';
export {
  execGit,
  DEFAULT_GIT_TIMEOUT_MS,
  WORKTREE_GIT_TIMEOUT_MS,
} from './utils/exec-git';
export type { ExecGitOptions, ExecGitResult } from './utils/exec-git';
export { WorkspaceContextManager } from './services/workspace-context-manager';
export { WorkspaceAwareStateStorage } from './services/workspace-aware-state-storage';
export type { StateStorageFactory } from './services/workspace-aware-state-storage';
export {
  bindLicenseReactivity,
  bringUpPremiumSubsystems,
  tearDownPremiumSubsystems,
} from './services/license-reactivity';
export type {
  LicenseReactivityOptions,
  PremiumSubsystemsDeps,
} from './services/license-reactivity';
