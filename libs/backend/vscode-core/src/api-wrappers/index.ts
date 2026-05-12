/**
 * API Wrappers Module Exports
 * Provides centralized access to all VS Code API wrapper components
 */
import type * as vscode from 'vscode';
import type { WorkspaceInfo } from '@ptah-extension/shared';

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

/**
 * Interface for webview HTML content generation
 * Allows libraries to inject HTML generator without depending on app layer
 */

/**
 * Options for generating webview HTML content
 */
export interface WebviewHtmlOptions {
  /** Optional workspace context */
  workspaceInfo?: Record<string, unknown>;
  /** Optional initial view to navigate to (e.g., 'chat', 'setup-wizard') */
  initialView?: string;
}

export interface IWebviewHtmlGenerator {
  /**
   * Generate HTML content for Angular webview
   * @param webview - VS Code webview instance
   * @param options - Optional configuration including workspace info and initial view
   * @returns HTML content string
   */
  generateAngularWebviewContent(
    webview: vscode.Webview,
    options?: WebviewHtmlOptions | Record<string, unknown>,
  ): string;

  /**
   * Build workspace info object for webview
   * @returns Workspace info or null if no workspace
   */
  buildWorkspaceInfo(): WorkspaceInfo | null;
}
