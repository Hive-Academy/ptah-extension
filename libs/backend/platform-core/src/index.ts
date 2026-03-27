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

// DI Tokens
export { PLATFORM_TOKENS } from './tokens';

// Utilities
export { createEvent } from './utils/event-emitter';
