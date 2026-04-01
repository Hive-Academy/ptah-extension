/**
 * ConfigManager Service - Type-safe configuration management
 * Based on TASK_CORE_001 implementation plan
 * Extracted from apps/ptah-extension-vscode/src/config/ptah-config.service.ts
 *
 * Features:
 * - Dependency injection via TSyringe
 * - Type-safe configuration access
 * - Zod schema validation support
 * - Workspace and global scopes
 * - Configuration watchers
 *
 * Note: EventBus integration removed to avoid MessagePayloadMap dependency.
 * Configuration change notifications are handled through VS Code's configuration change events.
 */

import { injectable } from 'tsyringe';
import * as vscode from 'vscode';
import { z } from 'zod';
import type { ConfigWatcher, ConfigUpdateOptions } from './types';

/**
 * Configuration change event payload
 */
export interface ConfigurationChangeEvent {
  readonly key: string;
  readonly previousValue: unknown;
  readonly newValue: unknown;
  readonly scope: vscode.ConfigurationTarget;
}

/**
 * Minimal interface for file-based settings storage.
 * Decouples ConfigManager (vscode-core) from PtahFileSettingsManager (platform-core).
 */
export interface IFileSettingsStore {
  get<T>(key: string, defaultValue?: T): T | undefined;
  set(key: string, value: unknown): Promise<void>;
}

/**
 * ConfigManager service for type-safe configuration management
 * Manages VS Code extension settings with validation and change notifications
 *
 * TASK_2025_247: File-based settings routing.
 * Keys in fileBasedKeys are routed to the IFileSettingsStore (~/.ptah/settings.json)
 * instead of VS Code's workspace configuration. Call setFileSettingsStore() after
 * construction to enable routing.
 */
@injectable()
export class ConfigManager {
  private readonly configNamespace = 'ptah';
  private readonly watchers: Map<string, ConfigWatcher> = new Map();
  private readonly configListener: vscode.Disposable;

  /** File-based settings routing (set via setFileSettingsStore) */
  private fileStore: IFileSettingsStore | null = null;
  private fileBasedKeys: Set<string> | null = null;

  constructor() {
    // Setup configuration change listener
    this.configListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(this.configNamespace)) {
        this.handleConfigurationChange(event);
      }
    });
  }

  /**
   * Configure file-based settings routing.
   * Keys in the provided Set are routed to the IFileSettingsStore
   * (~/.ptah/settings.json) instead of VS Code workspace configuration.
   *
   * Call this after construction once both ConfigManager and the file
   * settings store are available in the DI container.
   */
  setFileSettingsStore(keys: Set<string>, store: IFileSettingsStore): void {
    this.fileBasedKeys = keys;
    this.fileStore = store;
  }

  /**
   * Check if a key should be routed to file-based storage.
   */
  private isFileBased(key: string): boolean {
    return !!(
      this.fileBasedKeys &&
      this.fileStore &&
      this.fileBasedKeys.has(key)
    );
  }

  /**
   * Get configuration value with type safety
   * Returns undefined if key doesn't exist
   *
   * @param key - Configuration key (dot-notation)
   * @returns Configuration value or undefined
   */
  get<T>(key: string): T | undefined {
    if (this.isFileBased(key)) {
      return this.fileStore!.get<T>(key);
    }
    const config = vscode.workspace.getConfiguration(this.configNamespace);
    return config.get<T>(key);
  }

  /**
   * Get configuration value with default fallback
   * Always returns a value (either from config or default)
   *
   * @param key - Configuration key (dot-notation)
   * @param defaultValue - Default value if key doesn't exist
   * @returns Configuration value or default
   */
  getWithDefault<T>(key: string, defaultValue: T): T {
    if (this.isFileBased(key)) {
      return this.fileStore!.get<T>(key, defaultValue) ?? defaultValue;
    }
    const config = vscode.workspace.getConfiguration(this.configNamespace);
    return config.get<T>(key, defaultValue);
  }

  /**
   * Get configuration value with Zod schema validation
   * Validates the value against schema and returns typed result
   *
   * @param key - Configuration key (dot-notation)
   * @param schema - Zod schema for validation
   * @returns Validated configuration value
   * @throws Error if validation fails
   */
  getTyped<T>(key: string, schema: z.ZodSchema<T>): T {
    const config = vscode.workspace.getConfiguration(this.configNamespace);
    const value = config.get(key);

    try {
      return schema.parse(value);
    } catch (error) {
      throw new Error(
        `Configuration validation failed for key "${key}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Get configuration value with schema and default
   * Validates against schema, falls back to default on validation failure
   *
   * @param key - Configuration key (dot-notation)
   * @param schema - Zod schema for validation
   * @param defaultValue - Default value on validation failure
   * @returns Validated configuration value or default
   */
  getTypedWithDefault<T>(
    key: string,
    schema: z.ZodSchema<T>,
    defaultValue: T,
  ): T {
    try {
      return this.getTyped(key, schema);
    } catch {
      return defaultValue;
    }
  }

  /**
   * Set configuration value
   * Updates the configuration and notifies watchers
   *
   * @param key - Configuration key (dot-notation)
   * @param value - Value to set
   * @param options - Update options (target scope, validation)
   */
  async set<T>(
    key: string,
    value: T,
    options?: ConfigUpdateOptions,
  ): Promise<void> {
    // Route file-based settings to PtahFileSettingsManager (~/.ptah/settings.json)
    if (this.isFileBased(key)) {
      await this.fileStore!.set(key, value);
      // Manually notify watchers since VS Code won't fire a change event
      const watcher = this.watchers.get(key);
      if (watcher) {
        watcher.callback(value);
      }
      return;
    }

    const target = options?.target || vscode.ConfigurationTarget.Workspace;
    const config = vscode.workspace.getConfiguration(this.configNamespace);

    // Update configuration
    await config.update(key, value, target);

    // Note: Configuration change notifications are automatically handled
    // by VS Code's configuration change events and our watchers
  }

  /**
   * Set configuration value with schema validation
   * Validates value against schema before updating
   *
   * @param key - Configuration key (dot-notation)
   * @param value - Value to set
   * @param schema - Zod schema for validation
   * @param options - Update options
   * @throws Error if validation fails
   */
  async setTyped<T>(
    key: string,
    value: T,
    schema: z.ZodSchema<T>,
    options?: ConfigUpdateOptions,
  ): Promise<void> {
    // Validate value
    const validatedValue = schema.parse(value);

    // Set configuration
    await this.set(key, validatedValue, options);
  }

  /**
   * Watch configuration key for changes
   * Registers a callback that's called when the configuration changes
   *
   * @param key - Configuration key to watch
   * @param callback - Callback function
   * @returns Disposable to stop watching
   */
  watch(key: string, callback: (value: unknown) => void): vscode.Disposable {
    // Create watcher
    const disposable = new vscode.Disposable(() => {
      this.watchers.delete(key);
    });

    const watcher: ConfigWatcher = {
      key,
      callback,
      disposable,
    };

    this.watchers.set(key, watcher);

    // Call callback immediately with current value
    const currentValue = this.get(key);
    callback(currentValue);

    return disposable;
  }

  /**
   * Watch configuration key with type validation
   * Registers a typed callback that's called when the configuration changes
   *
   * @param key - Configuration key to watch
   * @param schema - Zod schema for validation
   * @param callback - Typed callback function
   * @returns Disposable to stop watching
   */
  watchTyped<T>(
    key: string,
    schema: z.ZodSchema<T>,
    callback: (value: T) => void,
  ): vscode.Disposable {
    return this.watch(key, (value) => {
      try {
        const validatedValue = schema.parse(value);
        callback(validatedValue);
      } catch (error) {
        // Log validation error but don't throw
        console.error(`Config validation failed for ${key}:`, error);
      }
    });
  }

  /**
   * Check if configuration key exists
   *
   * @param key - Configuration key to check
   * @returns True if key exists
   */
  has(key: string): boolean {
    const config = vscode.workspace.getConfiguration(this.configNamespace);
    return config.has(key);
  }

  /**
   * Get entire configuration section as object
   *
   * @param section - Optional section name (defaults to root)
   * @returns Configuration object
   */
  getSection<T = Record<string, unknown>>(section?: string): T {
    const key = section
      ? `${this.configNamespace}.${section}`
      : this.configNamespace;
    const config = vscode.workspace.getConfiguration(key);
    return config as unknown as T;
  }

  /**
   * Inspect configuration to see all values across scopes
   * Useful for debugging configuration issues
   *
   * @param key - Configuration key
   * @returns Inspection result with values from all scopes
   */
  inspect<T>(key: string):
    | {
        readonly key: string;
        readonly defaultValue?: T;
        readonly globalValue?: T;
        readonly workspaceValue?: T;
        readonly workspaceFolderValue?: T;
      }
    | undefined {
    const config = vscode.workspace.getConfiguration(this.configNamespace);
    return config.inspect<T>(key);
  }

  /**
   * Dispose resources
   * Cleans up watchers and event listeners
   */
  dispose(): void {
    // Dispose all watchers
    for (const watcher of this.watchers.values()) {
      watcher.disposable.dispose();
    }
    this.watchers.clear();

    // Dispose configuration listener
    this.configListener.dispose();
  }

  /**
   * Handle VS Code configuration change events
   * Notifies watchers and publishes events via EventBus
   *
   * @param event - VS Code configuration change event
   */
  private handleConfigurationChange(
    event: vscode.ConfigurationChangeEvent,
  ): void {
    // Notify watchers for affected keys
    for (const [key, watcher] of this.watchers.entries()) {
      const fullKey = `${this.configNamespace}.${key}`;
      if (event.affectsConfiguration(fullKey)) {
        const newValue = this.get(key);
        watcher.callback(newValue);
      }
    }
  }
}
