/**
 * Config Watcher - Handles automatic re-initialization on config changes
 *
 * Responsibilities:
 * - Watch authentication-related config keys
 * - Trigger re-initialization on changes
 * - Prevent concurrent re-initialization
 * - Cleanup watchers on dispose
 */

import { Logger, ConfigManager } from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';

export type ReinitCallback = () => Promise<void>;

/**
 * Manages configuration watchers for automatic re-initialization
 */
export class ConfigWatcher {
  private watchers: vscode.Disposable[] = [];
  private isReinitializing = false;

  constructor(private logger: Logger, private config: ConfigManager) {}

  /**
   * Register config watchers for auth-related settings
   */
  registerWatchers(reinitCallback: ReinitCallback): void {
    // Clear existing watchers
    this.dispose();

    const watchKeys = ['authMethod', 'claudeOAuthToken', 'anthropicApiKey'];

    for (const key of watchKeys) {
      const watcher = this.config.watch(key, async () => {
        // Prevent concurrent re-initialization
        if (this.isReinitializing) {
          this.logger.debug(
            `[ConfigWatcher] Skipping re-init for ${key} - already in progress`
          );
          return;
        }

        try {
          this.isReinitializing = true;
          this.logger.info(
            `[ConfigWatcher] Configuration changed (${key}), re-initializing...`
          );
          await reinitCallback();
          this.logger.info(
            '[ConfigWatcher] Re-initialization complete after config change'
          );
        } catch (error) {
          this.logger.error(
            '[ConfigWatcher] Re-initialization failed',
            error instanceof Error ? error : new Error(String(error))
          );
        } finally {
          this.isReinitializing = false;
        }
      });

      this.watchers.push(watcher);
    }

    this.logger.debug(
      `[ConfigWatcher] Registered ${watchKeys.length} config watchers`
    );
  }

  /**
   * Check if re-initialization is in progress
   */
  isReinitInProgress(): boolean {
    return this.isReinitializing;
  }

  /**
   * Dispose all watchers
   */
  dispose(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
    this.logger.debug('[ConfigWatcher] Disposed all watchers');
  }

  /**
   * Get watcher count
   */
  getWatcherCount(): number {
    return this.watchers.length;
  }
}
