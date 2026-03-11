/**
 * Preferences Storage Service
 *
 * Manages user preferences using VS Code's workspaceState.
 * Unlike ConfigManager (which requires package.json registration),
 * workspaceState provides simple key-value storage without manifest declarations.
 *
 * Use this for settings that:
 * - Are managed through custom UI (webview settings page)
 * - Don't need to appear in VS Code Settings
 * - Should persist per-workspace
 *
 * TASK: Migrate model and autopilot settings from ConfigManager to workspaceState
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { Logger } from '../logging';
import { TOKENS } from '../di/tokens';

/**
 * Preference keys for type-safe access
 */
export type PreferenceKey =
  | 'model.selected'
  | 'autopilot.enabled'
  | 'autopilot.permissionLevel';

/**
 * Default values for preferences
 */
const PREFERENCE_DEFAULTS: Record<PreferenceKey, unknown> = {
  'model.selected': 'claude-sonnet-4-5-20250929',
  'autopilot.enabled': false,
  'autopilot.permissionLevel': 'ask',
};

/**
 * Interface for preferences storage
 */
export interface IPreferencesStorageService {
  /**
   * Get preference value from workspaceState
   * @param key - Preference key
   * @returns Preference value or undefined if not set
   */
  get<T>(key: PreferenceKey): T | undefined;

  /**
   * Get preference value with default fallback
   * @param key - Preference key
   * @param defaultValue - Default value if not set
   * @returns Preference value or default
   */
  getWithDefault<T>(key: PreferenceKey, defaultValue: T): T;

  /**
   * Set preference value in workspaceState
   * @param key - Preference key
   * @param value - Value to store
   */
  set<T>(key: PreferenceKey, value: T): Promise<void>;

  /**
   * Delete preference from workspaceState
   * @param key - Preference key to delete
   */
  delete(key: PreferenceKey): Promise<void>;

  /**
   * Check if preference exists
   * @param key - Preference key to check
   * @returns True if preference is set
   */
  has(key: PreferenceKey): boolean;
}

/**
 * Preferences Storage Service Implementation
 *
 * Uses VS Code's workspaceState for per-workspace preference storage.
 * Keys are stored with prefix: `ptah.preferences.{key}`
 *
 * This is the single source of truth for user preferences,
 * managed through the webview settings page.
 */
@injectable()
export class PreferencesStorageService implements IPreferencesStorageService {
  private readonly PREFIX = 'ptah.preferences';

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {
    this.logger.debug(
      '[PreferencesStorageService] Service initialized with workspaceState'
    );
  }

  /**
   * Get the full storage key with prefix
   */
  private getStorageKey(key: PreferenceKey): string {
    return `${this.PREFIX}.${key}`;
  }

  /**
   * Get preference value from workspaceState
   */
  get<T>(key: PreferenceKey): T | undefined {
    const storageKey = this.getStorageKey(key);
    const value = this.context.workspaceState.get<T>(storageKey);

    this.logger.debug('[PreferencesStorageService.get]', {
      key,
      hasValue: value !== undefined,
    });

    return value;
  }

  /**
   * Get preference value with default fallback
   */
  getWithDefault<T>(key: PreferenceKey, defaultValue: T): T {
    const value = this.get<T>(key);
    return value !== undefined ? value : defaultValue;
  }

  /**
   * Get preference value using built-in defaults
   */
  getWithBuiltinDefault<T>(key: PreferenceKey): T {
    const value = this.get<T>(key);
    return value !== undefined ? value : (PREFERENCE_DEFAULTS[key] as T);
  }

  /**
   * Set preference value in workspaceState
   */
  async set<T>(key: PreferenceKey, value: T): Promise<void> {
    const storageKey = this.getStorageKey(key);

    await this.context.workspaceState.update(storageKey, value);

    this.logger.info('[PreferencesStorageService.set] Preference updated', {
      key,
      // Don't log actual values for privacy
    });
  }

  /**
   * Delete preference from workspaceState
   */
  async delete(key: PreferenceKey): Promise<void> {
    const storageKey = this.getStorageKey(key);

    await this.context.workspaceState.update(storageKey, undefined);

    this.logger.info('[PreferencesStorageService.delete] Preference deleted', {
      key,
    });
  }

  /**
   * Check if preference exists
   */
  has(key: PreferenceKey): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Get all preferences as an object
   * Useful for debugging or bulk operations
   */
  getAll(): Record<PreferenceKey, unknown> {
    const keys: PreferenceKey[] = [
      'model.selected',
      'autopilot.enabled',
      'autopilot.permissionLevel',
    ];

    const result: Record<string, unknown> = {};
    for (const key of keys) {
      result[key] = this.getWithBuiltinDefault(key);
    }

    return result as Record<PreferenceKey, unknown>;
  }
}
