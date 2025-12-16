/**
 * Config Watcher - Handles automatic re-initialization on config changes
 *
 * Responsibilities:
 * - Watch authentication-related config keys
 * - Trigger re-initialization on changes
 * - Prevent concurrent re-initialization
 * - Cleanup watchers on dispose
 */

import { injectable, inject } from 'tsyringe';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';

export type ReinitCallback = () => Promise<void>;

/**
 * Manages configuration watchers for automatic re-initialization
 */
@injectable()
export class ConfigWatcher {
  private watchers: vscode.Disposable[] = [];
  private secretsDisposable?: vscode.Disposable;
  private isReinitializing = false;

  constructor(
    @inject(TOKENS.LOGGER) private logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private config: ConfigManager,
    @inject(TOKENS.EXTENSION_CONTEXT)
    private context: vscode.ExtensionContext
  ) {}

  /**
   * Register config watchers for auth-related settings
   * Watches authMethod in ConfigManager and credentials in SecretStorage
   */
  registerWatchers(reinitCallback: ReinitCallback): void {
    // Clear existing watchers
    this.dispose();

    // Watch authMethod in ConfigManager (non-sensitive setting)
    const watchKeys = ['authMethod'];

    for (const key of watchKeys) {
      const watcher = this.config.watch(key, async () => {
        await this.handleConfigChange(key, reinitCallback);
      });

      this.watchers.push(watcher);
    }

    // Watch SecretStorage for credential changes
    this.secretsDisposable = this.context.secrets.onDidChange((event) => {
      if (
        event.key === 'ptah.auth.claudeOAuthToken' ||
        event.key === 'ptah.auth.anthropicApiKey'
      ) {
        this.logger.info('[ConfigWatcher] Secret changed', { key: event.key });
        // Use the same callback as config changes
        void this.handleConfigChange(event.key, reinitCallback);
      }
    });

    this.logger.debug(
      `[ConfigWatcher] Registered ${watchKeys.length} config watchers + 1 secrets watcher`
    );
  }

  /**
   * Handle configuration or secret change with re-init logic
   */
  private async handleConfigChange(
    key: string,
    reinitCallback: ReinitCallback
  ): Promise<void> {
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

    if (this.secretsDisposable) {
      this.secretsDisposable.dispose();
      this.secretsDisposable = undefined;
    }

    this.logger.debug('[ConfigWatcher] Disposed all watchers');
  }

  /**
   * Get watcher count
   */
  getWatcherCount(): number {
    return this.watchers.length;
  }
}
