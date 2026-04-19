/**
 * IWorkspaceProvider — Platform-agnostic workspace folder and configuration access.
 *
 * Replaces: vscode.workspace.workspaceFolders, vscode.workspace.getConfiguration()
 */

import type { IEvent, ConfigurationChangeEvent } from '../types/platform.types';

export interface IWorkspaceProvider {
  /**
   * Get workspace folder paths.
   * Replaces: vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath)
   *
   * @returns Array of absolute workspace folder paths, empty if no workspace open
   */
  getWorkspaceFolders(): string[];

  /**
   * Get the primary workspace root path.
   * Replaces: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
   *
   * @returns Absolute path or undefined if no workspace open
   */
  getWorkspaceRoot(): string | undefined;

  /**
   * Get a configuration value.
   * Replaces: vscode.workspace.getConfiguration(section).get<T>(key, defaultValue)
   *
   * @param section - Configuration section (e.g., 'ptah')
   * @param key - Configuration key within the section (e.g., 'authMethod')
   * @param defaultValue - Default if not set
   */
  getConfiguration<T>(
    section: string,
    key: string,
    defaultValue?: T,
  ): T | undefined;

  /**
   * Update a configuration value.
   * Replaces: vscode.workspace.getConfiguration(section).update(key, value)
   *
   * File-based keys (listed in FILE_BASED_SETTINGS_KEYS) route to
   * ~/.ptah/settings.json via PtahFileSettingsManager.
   *
   * @param section - Configuration section (e.g., 'ptah')
   * @param key - Configuration key within the section (e.g., 'browser.allowLocalhost')
   * @param value - The value to set
   */
  setConfiguration(section: string, key: string, value: unknown): Promise<void>;

  /**
   * Event fired when configuration changes.
   * Replaces: vscode.workspace.onDidChangeConfiguration
   */
  readonly onDidChangeConfiguration: IEvent<ConfigurationChangeEvent>;

  /**
   * Event fired when workspace folders change.
   * Replaces: vscode.workspace.onDidChangeWorkspaceFolders
   */
  readonly onDidChangeWorkspaceFolders: IEvent<void>;
}
