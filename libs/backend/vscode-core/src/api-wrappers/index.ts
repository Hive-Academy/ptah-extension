/**
 * API Wrappers Module Exports
 * Provides centralized access to all VS Code API wrapper components
 */

export { CommandManager } from './command-manager';
export type { 
  CommandDefinition,
  CommandExecutedPayload,
  CommandErrorPayload
} from './command-manager';

export { WebviewManager } from './webview-manager';
export type {
  WebviewPanelConfig,
  WebviewMessagePayload,
  WebviewCreatedPayload,
  WebviewDisposedPayload
} from './webview-manager';

export { OutputManager } from './output-manager';
export type {
  OutputChannelConfig,
  WriteOptions,
  OutputMessagePayload,
  OutputChannelCreatedPayload,
  OutputChannelErrorPayload
} from './output-manager';

export { StatusBarManager } from './status-bar-manager';
export type {
  StatusBarItemConfig,
  StatusBarItemUpdate,
  StatusBarItemCreatedPayload,
  StatusBarItemUpdatedPayload,
  StatusBarItemClickedPayload,
  StatusBarItemErrorPayload
} from './status-bar-manager';

export { FileSystemManager } from './file-system-manager';
export type {
  FileOperationType,
  FileOperationOptions,
  FileWatcherConfig,
  FileOperationPayload,
  FileWatcherEventPayload,
  FileSystemErrorPayload
} from './file-system-manager';