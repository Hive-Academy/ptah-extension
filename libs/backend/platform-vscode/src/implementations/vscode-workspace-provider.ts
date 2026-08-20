/**
 * VscodeWorkspaceProvider — IWorkspaceProvider implementation using VS Code APIs.
 *
 * File-based settings routing: keys in FILE_BASED_SETTINGS_KEYS are
 * transparently routed to PtahFileSettingsManager (~/.ptah/settings.json)
 * instead of VS Code config. This keeps trademarked terms out of
 * package.json contributes.configuration.
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

/** Settle time after saving settings.json before VS Code accepts an update. */
const SETTINGS_SAVE_MS = 200;

export class VscodeWorkspaceProvider implements IWorkspaceProvider {
  public readonly onDidChangeConfiguration: IEvent<ConfigurationChangeEvent>;
  public readonly onDidChangeWorkspaceFolders: IEvent<void>;

  /**
   * File-based settings manager for keys that cannot live in package.json.
   * Exposed as public readonly so settings-migration.ts can access it.
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
   * File-based keys route to PtahFileSettingsManager and
   * fire a synthetic config change event so watchers still work.
   */
  async setConfiguration(
    section: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    if (section === 'ptah' && isFileBasedSettingKey(key)) {
      await this.fileSettings.set(key, value);
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
    try {
      await config.update(key, value, vscode.ConfigurationTarget.Global);
    } catch (error: unknown) {
      if (!this.isDirtySettingsFailure(error)) throw error;
      await this.saveDirtySettingsDocument();
      await new Promise((resolve) => setTimeout(resolve, SETTINGS_SAVE_MS));
      await config.update(key, value, vscode.ConfigurationTarget.Global);
    }
  }

  /**
   * VS Code refuses `config.update()` while the user's settings.json has
   * unsaved edits open in an editor. The thrown error is not always specific,
   * so a dirty settings document is treated as corroborating evidence.
   */
  private isDirtySettingsFailure(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('unsaved changes')) return true;
    return vscode.workspace.textDocuments.some(
      (doc) =>
        doc.isDirty &&
        doc.uri.scheme === 'vscode-userdata' &&
        doc.uri.path.endsWith('settings.json'),
    );
  }

  /**
   * Save the user settings document so the retry can succeed. Only that
   * document — saving everything would commit unrelated edits on the user's
   * behalf. Falls back to the active editor when the document is not in
   * `textDocuments` under the scheme we expect.
   */
  private async saveDirtySettingsDocument(): Promise<void> {
    const settingsDoc = vscode.workspace.textDocuments.find(
      (doc) =>
        doc.isDirty &&
        doc.uri.path.endsWith('settings.json') &&
        (doc.uri.scheme === 'vscode-userdata' || doc.uri.scheme === 'file'),
    );
    if (settingsDoc) {
      await settingsDoc.save();
      return;
    }
    const activeEditor = vscode.window.activeTextEditor;
    if (
      activeEditor?.document.isDirty &&
      activeEditor.document.uri.path.endsWith('settings.json')
    ) {
      await activeEditor.document.save();
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
