/**
 * VscodeWorkspaceProvider — IWorkspaceProvider implementation using VS Code APIs.
 *
 * TASK_2025_247 Batch 3, Task 3.1: File-based settings routing.
 * Keys in FILE_BASED_SETTINGS_KEYS are transparently routed to
 * PtahFileSettingsManager (~/.ptah/settings.json) instead of VS Code config.
 * This keeps trademarked terms out of package.json contributes.configuration.
 */

import * as vscode from 'vscode';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  IEvent,
  ConfigurationChangeEvent,
} from '@ptah-extension/platform-core';
import {
  createEvent,
  PtahFileSettingsManager,
  FILE_BASED_SETTINGS_DEFAULTS,
  isFileBasedSettingKey,
} from '@ptah-extension/platform-core';

export class VscodeWorkspaceProvider implements IWorkspaceProvider {
  public readonly onDidChangeConfiguration: IEvent<ConfigurationChangeEvent>;
  public readonly onDidChangeWorkspaceFolders: IEvent<void>;

  /**
   * File-based settings manager for keys that cannot live in package.json.
   * Exposed as public readonly so settings-migration.ts (Batch 4) can access it.
   */
  public readonly fileSettings: PtahFileSettingsManager;

  private readonly fireConfigChange: (data: ConfigurationChangeEvent) => void;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.fileSettings = new PtahFileSettingsManager(
      FILE_BASED_SETTINGS_DEFAULTS,
    );

    const [configEvent, fireConfig] = createEvent<ConfigurationChangeEvent>();
    this.onDidChangeConfiguration = configEvent;
    this.fireConfigChange = fireConfig;

    const [folderEvent, fireFolders] = createEvent<void>();
    this.onDidChangeWorkspaceFolders = folderEvent;

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        fireConfig({
          affectsConfiguration: (section: string) =>
            e.affectsConfiguration(section),
        });
      }),
    );

    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        fireFolders(undefined as unknown as void);
      }),
    );
  }

  getWorkspaceFolders(): string[] {
    return vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
  }

  getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  getConfiguration<T>(
    section: string,
    key: string,
    defaultValue?: T,
  ): T | undefined {
    // Route file-based settings to PtahFileSettingsManager
    if (section === 'ptah' && isFileBasedSettingKey(key)) {
      return this.fileSettings.get<T>(key, defaultValue);
    }
    const config = vscode.workspace.getConfiguration(section);
    return config.get<T>(key, defaultValue as T);
  }

  /**
   * Update a configuration value.
   * Not part of IWorkspaceProvider interface — available at runtime for
   * RPC handlers that need to write settings (e.g., webSearch:setConfig).
   *
   * TASK_2025_235: Added for web search settings write-back.
   * TASK_2025_247: File-based keys route to PtahFileSettingsManager and
   * fire a synthetic config change event so watchers still work.
   */
  async setConfiguration(
    section: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    // Route file-based settings to PtahFileSettingsManager
    if (section === 'ptah' && isFileBasedSettingKey(key)) {
      await this.fileSettings.set(key, value);
      // Fire a synthetic config change event so watchers are notified.
      // Implements VS Code's prefix-matching semantics: ptah.agentOrchestration
      // matches ptah.agentOrchestration.copilotModel.
      const fullKey = `${section}.${key}`;
      this.fireConfigChange({
        affectsConfiguration: (s: string) =>
          fullKey === s ||
          fullKey.startsWith(s + '.') ||
          s.startsWith(fullKey + '.'),
      });
      return;
    }
    const config = vscode.workspace.getConfiguration(section);
    await config.update(key, value, vscode.ConfigurationTarget.Global);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
