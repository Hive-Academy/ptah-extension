/**
 * ElectronWorkspaceProvider — IWorkspaceProvider implementation for Electron.
 *
 * Manages workspace folders (opened directories) and configuration
 * stored in a JSON config file at {globalStoragePath}/config.json.
 *
 * Workspace folders are set programmatically when the user opens a folder
 * via the Electron dialog or command line arguments.
 *
 * TASK_2025_208 Batch 1, Task 1.2: Added workspace lifecycle methods
 * (addFolder, removeFolder, setActiveFolder, getActiveFolder) so the
 * RPC handler can use typed calls instead of duck-typing.
 *
 * TASK_2025_247 Batch 3, Task 3.2: File-based settings routing.
 * Keys in FILE_BASED_SETTINGS_KEYS are transparently routed to
 * PtahFileSettingsManager (~/.ptah/settings.json) instead of the
 * per-app config.json file. This keeps trademarked terms out of
 * package.json contributes.configuration.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  IEvent,
  ConfigurationChangeEvent,
} from '@ptah-extension/platform-core';
import {
  createEvent,
  PtahFileSettingsManager,
  FILE_BASED_SETTINGS_KEYS,
  FILE_BASED_SETTINGS_DEFAULTS,
} from '@ptah-extension/platform-core';

export class ElectronWorkspaceProvider implements IWorkspaceProvider {
  public readonly onDidChangeConfiguration: IEvent<ConfigurationChangeEvent>;
  public readonly onDidChangeWorkspaceFolders: IEvent<void>;

  private readonly fireConfigChange: (data: ConfigurationChangeEvent) => void;
  private readonly fireFoldersChange: (data: void) => void;

  private readonly fileSettings: PtahFileSettingsManager;

  private folders: string[] = [];
  private activeFolder: string | undefined;
  private config: Record<string, Record<string, unknown>> = {};
  private readonly configFilePath: string;

  constructor(globalStoragePath: string, initialFolders?: string[]) {
    this.fileSettings = new PtahFileSettingsManager(
      FILE_BASED_SETTINGS_DEFAULTS,
    );

    const [configEvent, fireConfig] = createEvent<ConfigurationChangeEvent>();
    this.onDidChangeConfiguration = configEvent;
    this.fireConfigChange = fireConfig;

    const [folderEvent, fireFolders] = createEvent<void>();
    this.onDidChangeWorkspaceFolders = folderEvent;
    this.fireFoldersChange = fireFolders;

    this.configFilePath = path.join(globalStoragePath, 'config.json');
    this.loadConfigSync();

    if (initialFolders && initialFolders.length > 0) {
      this.folders = [...initialFolders];
      this.activeFolder = this.folders[0];
    }
  }

  getWorkspaceFolders(): string[] {
    return [...this.folders];
  }

  /**
   * Get the primary workspace root path.
   * Returns the active folder if set, otherwise falls back to the first folder.
   */
  getWorkspaceRoot(): string | undefined {
    return this.activeFolder ?? this.folders[0];
  }

  getConfiguration<T>(
    section: string,
    key: string,
    defaultValue?: T,
  ): T | undefined {
    // Route file-based settings to PtahFileSettingsManager
    if (section === 'ptah' && FILE_BASED_SETTINGS_KEYS.has(key)) {
      return this.fileSettings.get<T>(key, defaultValue);
    }
    const sectionConfig = this.config[section];
    if (!sectionConfig) return defaultValue;
    const value = sectionConfig[key];
    return value !== undefined ? (value as T) : defaultValue;
  }

  /**
   * Set workspace folders (called when user opens folder via Electron dialog).
   * Fires onDidChangeWorkspaceFolders event.
   */
  setWorkspaceFolders(folders: string[]): void {
    this.folders = [...folders];
    // Update activeFolder if the current active is no longer in the list
    if (
      this.activeFolder &&
      !this.folders.some(
        (f) => path.resolve(f) === path.resolve(this.activeFolder!),
      )
    ) {
      this.activeFolder = this.folders[0];
    }
    this.fireFoldersChange(undefined as unknown as void);
  }

  /**
   * Add a folder to the workspace. Deduplicates by resolved path.
   * Fires onDidChangeWorkspaceFolders event if the folder was actually added.
   *
   * TASK_2025_208 Batch 1, Task 1.2
   */
  addFolder(folderPath: string): void {
    const resolved = path.resolve(folderPath);

    // Deduplicate: check if already present (by resolved path)
    const alreadyExists = this.folders.some(
      (existing) => path.resolve(existing) === resolved,
    );
    if (alreadyExists) {
      return;
    }

    this.folders.push(resolved);

    // If this is the first folder, make it active by default
    if (this.folders.length === 1) {
      this.activeFolder = resolved;
    }

    this.fireFoldersChange(undefined as unknown as void);
  }

  /**
   * Remove a folder from the workspace.
   * If the removed folder was the active folder, updates activeFolder
   * to the first remaining folder (or undefined if none remain).
   * Fires onDidChangeWorkspaceFolders event if the folder was actually removed.
   *
   * TASK_2025_208 Batch 1, Task 1.2
   */
  removeFolder(folderPath: string): void {
    const resolved = path.resolve(folderPath);
    const index = this.folders.findIndex(
      (existing) => path.resolve(existing) === resolved,
    );

    if (index === -1) {
      return;
    }

    this.folders.splice(index, 1);

    // Update activeFolder if the removed folder was active
    if (this.activeFolder && path.resolve(this.activeFolder) === resolved) {
      this.activeFolder = this.folders[0] ?? undefined;
    }

    this.fireFoldersChange(undefined as unknown as void);
  }

  /**
   * Set the active (primary) workspace folder.
   * The path must already exist in the folders array.
   * Fires onDidChangeWorkspaceFolders event on success.
   *
   * TASK_2025_208 Batch 1, Task 1.2
   */
  setActiveFolder(folderPath: string): void {
    const resolved = path.resolve(folderPath);
    const exists = this.folders.some(
      (existing) => path.resolve(existing) === resolved,
    );

    if (!exists) {
      return;
    }

    this.activeFolder = resolved;
    this.fireFoldersChange(undefined as unknown as void);
  }

  /**
   * Get the currently active workspace folder.
   *
   * TASK_2025_208 Batch 1, Task 1.2
   */
  getActiveFolder(): string | undefined {
    return this.activeFolder;
  }

  /**
   * Update a configuration value.
   * Fires onDidChangeConfiguration event.
   *
   * TASK_2025_247: File-based keys route to PtahFileSettingsManager.
   */
  async setConfiguration(
    section: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    // Route file-based settings to PtahFileSettingsManager
    if (section === 'ptah' && FILE_BASED_SETTINGS_KEYS.has(key)) {
      await this.fileSettings.set(key, value);
      this.fireConfigChange({
        affectsConfiguration: (s: string) =>
          s === section || s === `${section}.${key}`,
      });
      return;
    }
    if (!this.config[section]) {
      this.config[section] = {};
    }
    this.config[section][key] = value;
    await this.persistConfig();
    this.fireConfigChange({
      affectsConfiguration: (s: string) =>
        s === section || s === `${section}.${key}`,
    });
  }

  private loadConfigSync(): void {
    try {
      const raw = fs.readFileSync(this.configFilePath, 'utf-8');
      this.config = JSON.parse(raw);
    } catch {
      // Config file doesn't exist on first launch — start with empty config
      this.config = {};
    }
  }

  private async persistConfig(): Promise<void> {
    const dir = path.dirname(this.configFilePath);
    await fsPromises.mkdir(dir, { recursive: true });
    await fsPromises.writeFile(
      this.configFilePath,
      JSON.stringify(this.config, null, 2),
      'utf-8',
    );
  }
}
