export type {
  IDisposable,
  IEvent,
  FileStat,
  DirectoryEntry,
  IFileWatcher,
  IProgress,
  ProgressOptions,
  QuickPickItem,
  QuickPickOptions,
  InputBoxOptions,
  IPlatformInfo,
  ConfigurationChangeEvent,
  SecretChangeEvent,
  ICancellationToken,
} from './types/platform.types';

export { FileType, PlatformType } from './types/platform.types';
export type { IFileSystemProvider } from './interfaces/file-system-provider.interface';
export type { IStateStorage } from './interfaces/state-storage.interface';
export type {
  IAsyncStateStorage,
  StateStorageGetOptions,
  StateStorageSequencePage,
  StateStorageSequenceReadOptions,
  StateStorageSequenceWriteChunk,
  StateStorageTruncatedItem,
  StateStorageValueProjection,
} from './interfaces/async-state-storage.interface';
export { isAsyncStateStorage } from './interfaces/async-state-storage.interface';
export type {
  IStateStorageReadiness,
  StateStorageReadinessState,
  StateStorageRecoveryReason,
} from './interfaces/state-storage-readiness.interface';
export { hasStateStorageReadiness } from './interfaces/state-storage-readiness.interface';
export type {
  IStateStorageMaintenance,
  StateStorageArraySplitPlan,
  StateStorageExtractionConflictPolicy,
  StateStorageFieldProjection,
  StateStorageJsonPath,
  StateStorageJsonPathSegment,
  StateStorageMigrationReceipt,
  StateStorageNestedExtractionPlan,
} from './interfaces/state-storage-maintenance.interface';
export { hasStateStorageMaintenance } from './interfaces/state-storage-maintenance.interface';
export {
  StateStorageCursorStaleError,
  StateStorageNotReadyError,
  StateStorageRecoveryRequiredError,
  StateStorageValueTooLargeError,
} from './state-storage-errors';
export type { IWorkspaceScopedStateStorage } from './interfaces/workspace-scoped-state-storage.interface';
export { isWorkspaceScopedStateStorage } from './interfaces/workspace-scoped-state-storage.interface';
export type { ISecretStorage } from './interfaces/secret-storage.interface';
export type { IWorkspaceProvider } from './interfaces/workspace-provider.interface';
export type { IWorkspaceLifecycleProvider } from './interfaces/workspace-lifecycle.interface';
export type { IUserInteraction } from './interfaces/user-interaction.interface';
export type { IOutputChannel } from './interfaces/output-channel.interface';
export type { ICommandRegistry } from './interfaces/command-registry.interface';
export type { IEditorProvider } from './interfaces/editor-provider.interface';
export type {
  IEditorLauncher,
  EditorTarget,
  EditorTargetId,
} from './interfaces/editor-launcher.interface';
export type { ITokenCounter } from './interfaces/token-counter.interface';
export type {
  IDiagnosticsProvider,
  DiagnosticSeverity,
  DiagnosticEntry,
  FileDiagnostics,
  DiagnosticsResult,
  DiagnosticsScope,
} from './interfaces/diagnostics-provider.interface';
export type {
  IMemoryWriter,
  MemoryWriteRequest,
  MemoryWriteResult,
} from './interfaces/memory-writer.interface';
export type {
  IHttpServerProvider,
  IHttpServerHandle,
  HttpServerRequestHandler,
} from './interfaces/http-server-provider.interface';
export type {
  IOAuthCallbackListener,
  OAuthCallbackHandle,
} from './interfaces/oauth-callback-listener.interface';
export type { IMasterKeyProvider } from './interfaces/master-key-provider.interface';
export type {
  IMcpServerStatus,
  McpSessionWiring,
} from './interfaces/mcp-server-status.interface';
export { resolveMcpSessionWiring } from './interfaces/mcp-server-status.interface';
export type { ICallerWorkspaceResolver } from './interfaces/caller-workspace-resolver.interface';
export type { ITracer } from './interfaces/tracer.interface';
export type {
  IProcessSpawner,
  ProcessSpawnRequest,
  SpawnedProcessHandle,
  ProcessExitListener,
  ProcessErrorListener,
} from './interfaces/process-spawner.interface';
export type { ISessionAttachmentGuard } from './interfaces/session-attachment-guard.interface';
export type { IBootReadinessProvider } from './interfaces/boot-readiness.interface';
export type {
  IWorkspaceWatcher,
  WorkspaceChange,
  WorkspaceChangeBatch,
  WorkspaceChangeKind,
  WorkspaceChangeListener,
  WorkspaceWatchOptions,
} from './interfaces/workspace-watcher.interface';
export type {
  IAppUpdater,
  AppUpdateState,
} from './interfaces/app-updater.interface';
export type {
  IPlatformCommands,
  IPlatformAuthProvider,
  ISaveDialogProvider,
  IModelDiscovery,
  IFileDialog,
} from './interfaces/platform-abstractions.interface';
export { PLATFORM_TOKENS } from './di';
export { createEvent } from './utils/event-emitter';
export { isUnsafeWorkspacePath } from './utils/workspace-path-guards';
export type { WorkspacePathSafety } from './utils/workspace-path-guards';
export { isPathWithinRoots } from './utils/path-containment';
export {
  JSON_PATH_WILDCARD,
  jsonUtf8Bytes,
  omitJsonPaths,
  packJsonSequencePage,
  shrinkJsonStringLeaves,
} from './utils/json-budget';
export type {
  JsonSequenceEstimatorBudget,
  JsonSequencePageSource,
  PackedJsonSequencePage,
  PackJsonSequencePageOptions,
  ShrinkJsonStringLeavesOptions,
} from './utils/json-budget';
export { planGlobWatch } from './utils/glob-watch-plan';
export type {
  GlobWatchPlan,
  GlobWatchPlanOptions,
} from './utils/glob-watch-plan';
export {
  EVENT_STORM_BREAKER_DEFAULTS,
  EVENT_STORM_BREAKER_ENV,
  EventStormBreaker,
  readEventStormBreakerOptionsFromEnv,
} from './utils/event-storm-breaker';
export type {
  EventStormBreakerOptions,
  EventStormStats,
  StormExitReason,
  StormPollResult,
  StormRecordResult,
} from './utils/event-storm-breaker';
export {
  WORKSPACE_WATCH_LIMITS,
  WorkspaceChangeCoalescer,
  isExcludedBySegmentRules,
} from './utils/workspace-change-coalescer';
export type {
  CoalescerTimerHandle,
  WorkspaceChangeCoalescerClock,
  WorkspaceChangeCoalescerHooks,
} from './utils/workspace-change-coalescer';
export {
  WORKSPACE_WATCH_HOST_DEFAULTS,
  WorkspaceWatchHostCore,
} from './workspace-watch/workspace-watch-host-core';
export type {
  WorkspaceWatchEngine,
  WorkspaceWatchEngineCallback,
  WorkspaceWatchEngineEvent,
  WorkspaceWatchEngineSubscription,
  WorkspaceWatchHostCoreOptions,
} from './workspace-watch/workspace-watch-host-core';
export type {
  WorkspaceWatchDirectoryEntry,
  WorkspaceWatchListDirectory,
} from './workspace-watch/created-directory-reconciler';
export {
  bootWorkspaceWatchHost,
  toWorkspaceWatchEngine,
  workspaceWatchListDirectoryFor,
} from './workspace-watch/workspace-watch-host-boot';
export type { WorkspaceWatchHostBootOptions } from './workspace-watch/workspace-watch-host-boot';
export {
  WORKSPACE_WATCH_SUPERVISION_DEFAULTS,
  WorkspaceWatchSupervisor,
} from './workspace-watch/workspace-watch-supervisor';
export type {
  WorkspaceWatchHostForker,
  WorkspaceWatchHostProcess,
  WorkspaceWatchSupervision,
  WorkspaceWatchSupervisorOptions,
  WorkspaceWatcherDegradation,
  WorkspaceWatcherDiagnostic,
} from './workspace-watch/workspace-watch-supervisor';
export {
  WORKSPACE_WATCH_ERROR_CODES,
  WORKSPACE_WATCH_NOTICE_CODES,
  WORKSPACE_WATCH_PROTOCOL_LIMITS,
  clipWorkspaceWatchText,
  parseWorkspaceWatchHostInbound,
  parseWorkspaceWatchHostOutbound,
  toWorkspaceWatchBatchMessage,
  toWorkspaceWatchPathKey,
  toWorkspaceWatchSubscribeMessage,
  workspaceWatchHostInboundSchema,
  workspaceWatchHostOutboundSchema,
} from './workspace-watch/workspace-watch-protocol';
export type {
  WorkspaceWatchBatchMessage,
  WorkspaceWatchErrorCode,
  WorkspaceWatchErrorMessage,
  WorkspaceWatchFatalMessage,
  WorkspaceWatchHeartbeatMessage,
  WorkspaceWatchHostInbound,
  WorkspaceWatchHostOutbound,
  WorkspaceWatchNoticeCode,
  WorkspaceWatchNoticeMessage,
  WorkspaceWatchSubscribeMessage,
  WorkspaceWatchSubscribedMessage,
  WorkspaceWatchUnsubscribeMessage,
} from './workspace-watch/workspace-watch-protocol';
export { normalizeWorkspaceRoot } from './utils/normalize-workspace-root';
export {
  createExecutableEditorDefinitions,
  detectEditorTargets,
  EDITOR_DESCRIPTORS,
  editorExecutableCandidates,
  prepareEditorFileLaunch,
  prepareEditorWorkspaceLaunch,
  spawnEditorProcess,
} from './utils/editor-launcher-detection';
export type {
  EditorDetectionDefinition,
  EditorDetectionOptions,
  EditorDescriptor,
  EditorExecutableCandidate,
  EditorFileLaunch,
  EditorWorkspaceLaunch,
} from './utils/editor-launcher-detection';
export { PtahFileSettingsManager } from './file-settings-manager';
export type { FileSettingsDefaults } from './file-settings-manager';
export {
  FILE_BASED_SETTINGS_KEYS,
  FILE_BASED_SETTINGS_DEFAULTS,
  isFileBasedSettingKey,
} from './file-settings-keys';
export { ContentDownloadService } from './content-download.service';
export type {
  ContentDownloadResult,
  ContentProgressCallback,
} from './content-download.service';
export { AgentPackDownloadService } from './agent-pack-download.service';
export type {
  AgentPackInfo,
  AgentPackEntry,
  AgentPackDownloadResult,
} from './agent-pack-download.service';
export { resolveAuthProviderKey } from './settings-auth-key';
