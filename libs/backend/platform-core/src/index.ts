// Types
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

// Interfaces
export type { IFileSystemProvider } from './interfaces/file-system-provider.interface';
export type { IStateStorage } from './interfaces/state-storage.interface';
export type { ISecretStorage } from './interfaces/secret-storage.interface';
export type { IWorkspaceProvider } from './interfaces/workspace-provider.interface';
export type { IUserInteraction } from './interfaces/user-interaction.interface';
export type { IOutputChannel } from './interfaces/output-channel.interface';
export type { ICommandRegistry } from './interfaces/command-registry.interface';
export type { IEditorProvider } from './interfaces/editor-provider.interface';
export type { ITokenCounter } from './interfaces/token-counter.interface';
export type { IDiagnosticsProvider } from './interfaces/diagnostics-provider.interface';

// Platform abstractions (moved from @ptah-extension/rpc-handlers in C8)
export type {
  IPlatformCommands,
  IPlatformAuthProvider,
  ISaveDialogProvider,
  IModelDiscovery,
} from './interfaces/platform-abstractions.interface';

// DI Tokens
export { PLATFORM_TOKENS } from './di';

// Utilities
export { createEvent } from './utils/event-emitter';

// File-Based Settings (TASK_2025_247)
export { PtahFileSettingsManager } from './file-settings-manager';
export type { FileSettingsDefaults } from './file-settings-manager';
export {
  FILE_BASED_SETTINGS_KEYS,
  FILE_BASED_SETTINGS_DEFAULTS,
} from './file-settings-keys';

// Content Download (TASK_2025_248)
export { ContentDownloadService } from './content-download.service';
export type {
  ContentDownloadResult,
  ContentProgressCallback,
} from './content-download.service';

// Agent Pack Download (TASK_2025_257)
export { AgentPackDownloadService } from './agent-pack-download.service';
export type {
  AgentPackInfo,
  AgentPackEntry,
  AgentPackDownloadResult,
} from './agent-pack-download.service';
