/**
 * CliWorkspaceProvider — IWorkspaceProvider implementation for CLI.
 *
 * Manages workspace folders (CWD or --workspace arg) and configuration
 * stored in a JSON config file at {globalStoragePath}/config.json.
 *
 * Workspace folder defaults to process.cwd() if not provided via CLI args.
 *
 * File-based settings routing: Keys in FILE_BASED_SETTINGS_KEYS are
 * transparently routed to PtahFileSettingsManager (~/.ptah/settings.json)
 * instead of the per-app config.json file. This matches the pattern used
 * by ElectronWorkspaceProvider (TASK_2025_247).
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type {
  IWorkspaceProvider,
  IWorkspaceLifecycleProvider,
} from '@ptah-extension/platform-core';
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

export class CliWorkspaceProvider
  implements IWorkspaceProvider, IWorkspaceLifecycleProvider
{
  public readonly onDidChangeConfiguration: IEvent<ConfigurationChangeEvent>;
  public readonly onDidChangeWorkspaceFolders: IEvent<void>;

  private readonly fireConfigChange: (data: ConfigurationChangeEvent) => void;
  private readonly fireFoldersChange: (data: void) => void;

  private readonly fileSettings: PtahFileSettingsManager;

  private folders: string[] = [];
  private activeFolder: string | undefined;
  private config: Record<string, Record<string, unknown>> = {};
  private readonly configFilePath: string;

  constructor(globalStoragePath: string, workspacePath?: string) {
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

    // Resolve workspace path: use provided path, fall back to CWD
    const resolvedWorkspace = workspacePath
      ? path.resolve(workspacePath)
      : process.cwd();
    this.folders = [resolvedWorkspace];
    this.activeFolder = resolvedWorkspace;
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
   * Update a configuration value.
   * Fires onDidChangeConfiguration event.
   *
   * File-based keys route to PtahFileSettingsManager.
   */
  async setConfiguration(
    section: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    // Route file-based settings to PtahFileSettingsManager
    if (section === 'ptah' && FILE_BASED_SETTINGS_KEYS.has(key)) {
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
    if (!this.config[section]) {
      this.config[section] = {};
    }
    this.config[section][key] = value;
    await this.persistConfig();
    const configFullKey = `${section}.${key}`;
    this.fireConfigChange({
      affectsConfiguration: (s: string) =>
        configFullKey === s ||
        configFullKey.startsWith(s + '.') ||
        s.startsWith(configFullKey + '.'),
    });
  }

  /**
   * Set workspace folders programmatically.
   * Fires onDidChangeWorkspaceFolders event.
   */
  setWorkspaceFolders(folders: string[]): void {
    // Only resolve relative paths — absolute inputs are preserved verbatim so
    // POSIX fixtures like `/root` round-trip correctly on Windows. On Windows
    // `path.resolve('/root')` would prepend the current drive letter and
    // silently mangle an already-absolute POSIX path. The Electron impl
    // stores the seed verbatim too; this aligns both impls.
    this.folders = folders.map((f) =>
      path.isAbsolute(f) ? f : path.resolve(f),
    );
    // Update activeFolder if the current active is no longer in the list
    if (
      this.activeFolder &&
      !this.folders.some(
        (f) => path.resolve(f) === path.resolve(this.activeFolder!), // eslint-disable-line @typescript-eslint/no-non-null-assertion
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
   * TASK_2026_104 Sub-batch B5a
   */
  addFolder(folderPath: string): void {
    const resolved = path.resolve(folderPath);
    const alreadyExists = this.folders.some(
      (existing) => path.resolve(existing) === resolved,
    );
    if (alreadyExists) {
      return;
    }
    this.folders.push(resolved);
    if (this.folders.length === 1) {
      this.activeFolder = resolved;
    }
    this.fireFoldersChange(undefined as unknown as void);
  }

  /**
   * Remove a folder from the workspace.
   * If the removed folder was the active folder, promotes the first remaining
   * folder (or undefined if none remain).
   * Fires onDidChangeWorkspaceFolders event if the folder was actually removed.
   *
   * TASK_2026_104 Sub-batch B5a
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
    if (this.activeFolder && path.resolve(this.activeFolder) === resolved) {
      this.activeFolder = this.folders[0] ?? undefined;
    }
    this.fireFoldersChange(undefined as unknown as void);
  }

  /**
   * Set the active (primary) workspace folder.
   * The path must already exist in the folders array; no-ops for unknown paths.
   * Fires onDidChangeWorkspaceFolders event on success.
   *
   * TASK_2026_104 Sub-batch B5a
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
   * TASK_2026_104 Sub-batch B5a
   */
  getActiveFolder(): string | undefined {
    return this.activeFolder;
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
