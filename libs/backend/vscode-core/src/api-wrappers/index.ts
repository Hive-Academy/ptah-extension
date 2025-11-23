/**
 * API Wrappers Module Exports
 * Provides centralized access to all VS Code API wrapper components
 */

export { CommandManager } from './command-manager';
export type { CommandDefinition } from './command-manager';
// TODO: Phase 2 - Restore CommandExecutedPayload, CommandErrorPayload when RPC is implemented

export { WebviewManager } from './webview-manager';
export type { WebviewPanelConfig } from './webview-manager';
// TODO: Phase 2 - Restore WebviewMessagePayload, WebviewCreatedPayload, WebviewDisposedPayload when RPC is implemented

export { OutputManager } from './output-manager';
export type { OutputChannelConfig, WriteOptions } from './output-manager';
// TODO: Phase 2 - Restore OutputMessagePayload, OutputChannelCreatedPayload, OutputChannelErrorPayload when RPC is implemented

export { StatusBarManager } from './status-bar-manager';
export type {
  StatusBarItemConfig,
  StatusBarItemUpdate,
} from './status-bar-manager';
// TODO: Phase 2 - Restore StatusBarItemCreatedPayload, StatusBarItemUpdatedPayload, StatusBarItemClickedPayload, StatusBarItemErrorPayload when RPC is implemented

export { FileSystemManager } from './file-system-manager';
export type {
  FileOperationType,
  FileOperationOptions,
  FileWatcherConfig,
} from './file-system-manager';
// TODO: Phase 2 - Restore FileOperationPayload, FileWatcherEventPayload, FileSystemErrorPayload when RPC is implemented
