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

export class CliWorkspaceProvider implements IWorkspaceProvider {
  public readonly onDidChangeConfiguration: IEvent<ConfigurationChangeEvent>;
  public readonly onDidChangeWorkspaceFolders: IEvent<void>;

  private readonly fireConfigChange: (data: ConfigurationChangeEvent) => void;
  private readonly fireFoldersChange: (data: void) => void;

  private readonly fileSettings: PtahFileSettingsManager;

  private folders: string[] = [];
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
  }

  getWorkspaceFolders(): string[] {
    return [...this.folders];
  }

  /**
   * Get the primary workspace root path.
   * For CLI, this is always the first (and typically only) folder.
   */
  getWorkspaceRoot(): string | undefined {
    return this.folders[0];
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
    this.fireFoldersChange(undefined as unknown as void);
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
