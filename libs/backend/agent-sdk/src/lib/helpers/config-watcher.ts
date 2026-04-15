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
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  ISecretStorage,
  IDisposable,
} from '@ptah-extension/platform-core';

export type ReinitCallback = () => Promise<void>;

/**
 * Manages configuration watchers for automatic re-initialization
 */
@injectable()
export class ConfigWatcher {
  private watchers: IDisposable[] = [];
  private secretsDisposable?: IDisposable;
  private isReinitializing = false;

  constructor(
    @inject(TOKENS.LOGGER) private logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private config: ConfigManager,
    @inject(PLATFORM_TOKENS.SECRET_STORAGE)
    private secretStorage: ISecretStorage,
  ) {}

  /**
   * Register config watchers for auth-related settings
   * Watches authMethod in ConfigManager and credentials in SecretStorage
   */
  registerWatchers(reinitCallback: ReinitCallback): void {
    // Clear existing watchers
    this.dispose();

    // Watch auth-related config keys (non-sensitive settings)
    // TASK_2025_129 Batch 3: Added anthropicProviderId for multi-provider support
    const watchKeys = ['authMethod', 'anthropicProviderId'];

    for (const key of watchKeys) {
      const watcher = this.config.watch(key, async () => {
        await this.handleConfigChange(key, reinitCallback);
      });

      this.watchers.push(watcher);
    }

    // Watch SecretStorage for credential changes
    this.secretsDisposable = this.secretStorage.onDidChange((event) => {
      if (
        event.key === 'ptah.auth.anthropicApiKey' ||
        event.key === 'ptah.auth.openrouterApiKey' // TASK_2025_091: OpenRouter key
      ) {
        this.logger.info('[ConfigWatcher] Secret changed', { key: event.key });
        // Use the same callback as config changes
        void this.handleConfigChange(event.key, reinitCallback);
      }
    });

    this.logger.debug(
      `[ConfigWatcher] Registered ${watchKeys.length} config watchers + 1 secrets watcher`,
    );
  }

  /**
   * Handle configuration or secret change with re-init logic
   */
  private async handleConfigChange(
    key: string,
    reinitCallback: ReinitCallback,
  ): Promise<void> {
    // Prevent concurrent re-initialization
    if (this.isReinitializing) {
      this.logger.debug(
        `[ConfigWatcher] Skipping re-init for ${key} - already in progress`,
      );
      return;
    }

    try {
      this.isReinitializing = true;
      this.logger.info(
        `[ConfigWatcher] Configuration changed (${key}), re-initializing...`,
      );
      await reinitCallback();
      this.logger.info(
        '[ConfigWatcher] Re-initialization complete after config change',
      );
    } catch (error) {
      this.logger.error(
        '[ConfigWatcher] Re-initialization failed',
        error instanceof Error ? error : new Error(String(error)),
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
