import { injectable, inject } from 'tsyringe';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  ISecretStorage,
  IDisposable,
} from '@ptah-extension/platform-core';
import { SDK_TOKENS } from '../di/tokens';
import { SdkAdapterEvents } from './sdk-adapter-events.service';

export type ReinitCallback = () => Promise<void>;

@injectable()
export class ConfigWatcher {
  private watchers: IDisposable[] = [];
  private secretsDisposable?: IDisposable;
  private isReinitializing = false;
  private readonly busUnsubscribers: Array<() => void> = [];

  constructor(
    @inject(TOKENS.LOGGER) private logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private config: ConfigManager,
    @inject(PLATFORM_TOKENS.SECRET_STORAGE)
    private secretStorage: ISecretStorage,
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS)
    private events: SdkAdapterEvents,
  ) {
    this.registerWatchersInternal();
    this.busUnsubscribers.push(this.events.onDisposed(() => this.dispose()));
  }

  registerWatchers(reinitCallback: ReinitCallback): void {
    this.disposeWatchers();
    const watchKeys = ['authMethod', 'anthropicProviderId'];

    for (const key of watchKeys) {
      const watcher = this.config.watch(key, async () => {
        await this.handleConfigChange(key, reinitCallback);
      });

      this.watchers.push(watcher);
    }
    this.secretsDisposable = this.secretStorage.onDidChange((event) => {
      if (event.key.startsWith('ptah.auth.')) {
        this.logger.info('[ConfigWatcher] Secret changed', { key: event.key });
        void this.handleConfigChange(event.key, reinitCallback);
      }
    });

    this.logger.debug(
      `[ConfigWatcher] Registered ${watchKeys.length} config watchers + 1 secrets watcher`,
    );
  }

  private registerWatchersInternal(): void {
    this.disposeWatchers();
    const watchKeys = ['authMethod', 'anthropicProviderId'];

    for (const key of watchKeys) {
      const watcher = this.config.watch(key, async () => {
        await this.handleConfigChangeViaBus(key);
      });

      this.watchers.push(watcher);
    }
    this.secretsDisposable = this.secretStorage.onDidChange((event) => {
      if (event.key.startsWith('ptah.auth.')) {
        this.logger.info('[ConfigWatcher] Secret changed', { key: event.key });
        void this.handleConfigChangeViaBus(event.key);
      }
    });

    this.logger.debug(
      `[ConfigWatcher] Registered ${watchKeys.length} config watchers + 1 secrets watcher (bus mode)`,
    );
  }

  private async handleConfigChange(
    key: string,
    reinitCallback: ReinitCallback,
  ): Promise<void> {
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

  private async handleConfigChangeViaBus(key: string): Promise<void> {
    if (this.isReinitializing) {
      this.logger.debug(
        `[ConfigWatcher] Skipping re-init for ${key} - already in progress`,
      );
      return;
    }

    try {
      this.isReinitializing = true;
      this.logger.info(
        `[ConfigWatcher] Configuration changed (${key}), emitting configChanged event...`,
      );
      this.events.emitConfigChanged({ key, timestamp: Date.now() });
    } catch (error) {
      this.logger.error(
        '[ConfigWatcher] Failed to emit configChanged',
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      this.isReinitializing = false;
    }
  }

  isReinitInProgress(): boolean {
    return this.isReinitializing;
  }

  dispose(): void {
    this.disposeWatchers();
  }

  private disposeWatchers(): void {
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

  disposeBusSubscriptions(): void {
    for (const off of this.busUnsubscribers) {
      off();
    }
    this.busUnsubscribers.length = 0;
  }

  getWatcherCount(): number {
    return this.watchers.length;
  }
}
