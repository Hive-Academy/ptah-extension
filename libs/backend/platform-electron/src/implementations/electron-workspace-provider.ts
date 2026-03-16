/**
 * ElectronWorkspaceProvider — IWorkspaceProvider implementation for Electron.
 *
 * Manages workspace folders (opened directories) and configuration
 * stored in a JSON config file at {globalStoragePath}/config.json.
 *
 * Workspace folders are set programmatically when the user opens a folder
 * via the Electron dialog or command line arguments.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  IEvent,
  ConfigurationChangeEvent,
} from '@ptah-extension/platform-core';
import { createEvent } from '@ptah-extension/platform-core';

export class ElectronWorkspaceProvider implements IWorkspaceProvider {
  public readonly onDidChangeConfiguration: IEvent<ConfigurationChangeEvent>;
  public readonly onDidChangeWorkspaceFolders: IEvent<void>;

  private readonly fireConfigChange: (data: ConfigurationChangeEvent) => void;
  private readonly fireFoldersChange: (data: void) => void;

  private folders: string[] = [];
  private config: Record<string, Record<string, unknown>> = {};
  private readonly configFilePath: string;

  constructor(globalStoragePath: string, initialFolders?: string[]) {
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
    }
  }

  getWorkspaceFolders(): string[] {
    return [...this.folders];
  }

  getWorkspaceRoot(): string | undefined {
    return this.folders[0];
  }

  getConfiguration<T>(
    section: string,
    key: string,
    defaultValue?: T
  ): T | undefined {
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
    this.fireFoldersChange(undefined as unknown as void);
  }

  /**
   * Update a configuration value.
   * Fires onDidChangeConfiguration event.
   */
  async setConfiguration(
    section: string,
    key: string,
    value: unknown
  ): Promise<void> {
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
      'utf-8'
    );
  }
}
