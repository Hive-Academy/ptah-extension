import { Injectable, signal, computed, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';

import { VSCodeService } from './vscode.service';
import { WebviewConfiguration } from '@ptah-extension/shared';

/**
 * Default configuration for webview
 */
const DEFAULT_WEBVIEW_CONFIG: WebviewConfiguration = {
  claude: {
    model: 'claude-3-sonnet-20241022',
    temperature: 0.1,
    maxTokens: 200000,
  },
  streaming: {
    bufferSize: 8192,
    chunkSize: 1024,
    timeoutMs: 30000,
  },
};

/**
 * Configuration change event
 */
export interface WebviewConfigChangeEvent {
  readonly previous: WebviewConfiguration;
  readonly current: WebviewConfiguration;
  readonly affectedSections: readonly string[];
}

/**
 * Webview Configuration Service
 *
 * Manages configuration for the Angular webview by:
 * - Syncing with backend configuration service
 * - Providing reactive configuration updates using Angular 20+ signals
 * - Caching configuration for offline use
 * - Type-safe configuration access
 *
 * MODERNIZED:
 * - Uses inject() instead of constructor injection
 * - Signal-based state management (no BehaviorSubject)
 * - DestroyRef for automatic cleanup
 * - Strict typing (zero `any` types)
 */
@Injectable({ providedIn: 'root' })
export class WebviewConfigService {
  private readonly vscode = inject(VSCodeService);
  private readonly destroyRef = inject(DestroyRef);

  // Private state signals (writable)
  private readonly _config = signal<WebviewConfiguration>(DEFAULT_WEBVIEW_CONFIG);
  private readonly _isLoaded = signal(false);
  private readonly _lastSync = signal<number>(0);
  private readonly _configChanges = signal<WebviewConfigChangeEvent[]>([]);

  // Public readonly signals
  readonly config = this._config.asReadonly();
  readonly isLoaded = this._isLoaded.asReadonly();
  readonly lastSync = this._lastSync.asReadonly();
  readonly configChanges = this._configChanges.asReadonly();

  // Computed configuration sections
  readonly claudeConfig = computed(() => this._config().claude);
  readonly streamingConfig = computed(() => this._config().streaming);

  // Computed last config change
  readonly lastConfigChange = computed(() => {
    const changes = this._configChanges();
    return changes.length > 0 ? changes[changes.length - 1] : null;
  });

  constructor() {
    this.setupConfigurationSync();
    this.waitForConnectionAndInitialize();
  }

  /**
   * Get current configuration (immutable)
   */
  getConfig(): Readonly<WebviewConfiguration> {
    return Object.freeze({ ...this._config() });
  }

  /**
   * Get specific configuration section
   */
  getSection<K extends keyof WebviewConfiguration>(section: K): WebviewConfiguration[K] {
    return { ...this._config()[section] };
  }

  /**
   * Get specific configuration value with type safety
   */
  getValue<K extends keyof WebviewConfiguration, T extends keyof WebviewConfiguration[K]>(
    section: K,
    key: T,
  ): WebviewConfiguration[K][T] {
    return this._config()[section][key];
  }

  /**
   * Request configuration update from backend
   */
  async requestConfigUpdate<
    K extends keyof WebviewConfiguration,
    T extends keyof WebviewConfiguration[K],
  >(section: K, key: T, value: WebviewConfiguration[K][T]): Promise<void> {
    try {
      await this.vscode.postStrictMessage('config:update', {
        updates: { [section]: { [key]: value } } as Partial<WebviewConfiguration>,
      });
    } catch (error) {
      console.error('Failed to request configuration update:', error);
      throw new Error(
        `Configuration update failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Refresh configuration from backend
   */
  async refreshConfiguration(): Promise<void> {
    try {
      await this.vscode.postStrictMessage('config:refresh', {
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Failed to refresh configuration:', error);
      throw new Error(
        `Configuration refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Reset configuration to defaults
   */
  resetToDefaults(): void {
    const previous = { ...this._config() };
    this._config.set(DEFAULT_WEBVIEW_CONFIG);

    this.notifyConfigurationChange(previous, DEFAULT_WEBVIEW_CONFIG);
  }

  /**
   * Validate configuration
   */
  validateConfiguration(config?: WebviewConfiguration): { isValid: boolean; errors: string[] } {
    const configToValidate = config || this._config();
    const errors: string[] = [];

    // Validate Claude configuration
    if (configToValidate.claude.temperature < 0 || configToValidate.claude.temperature > 1) {
      errors.push('Claude temperature must be between 0 and 1');
    }

    if (configToValidate.claude.maxTokens <= 0) {
      errors.push('Claude maxTokens must be positive');
    }

    // Validate streaming configuration
    if (configToValidate.streaming.bufferSize <= 0) {
      errors.push('Streaming bufferSize must be positive');
    }

    if (configToValidate.streaming.chunkSize <= 0) {
      errors.push('Streaming chunkSize must be positive');
    }

    if (configToValidate.streaming.chunkSize > configToValidate.streaming.bufferSize) {
      errors.push('Streaming chunkSize cannot be larger than bufferSize');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Wait for VS Code connection and then initialize configuration
   */
  private waitForConnectionAndInitialize(): void {
    // Wait for VS Code service to be connected before initializing
    toObservable(this.vscode.isConnected)
      .pipe(
        filter((isConnected) => isConnected),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        console.log('WebviewConfigService: VS Code connected, initializing configuration...');
        this.initializeConfiguration();
      });

    // If already connected, initialize immediately
    if (this.vscode.isConnected()) {
      console.log(
        'WebviewConfigService: VS Code already connected, initializing configuration...',
      );
      this.initializeConfiguration();
    }
  }

  /**
   * Initialize configuration on service startup
   */
  private async initializeConfiguration(): Promise<void> {
    try {
      console.log('WebviewConfigService: Requesting initial configuration...');
      // Request initial configuration from backend
      await this.vscode.postStrictMessage('config:get', {
        timestamp: Date.now(),
      });

      // Set loaded state after attempting initial load
      this._isLoaded.set(true);
      this._lastSync.set(Date.now());
      console.log('WebviewConfigService: Configuration initialized successfully');
    } catch (error) {
      console.warn('Failed to load initial configuration, using defaults:', error);
      this._isLoaded.set(true);
      this._lastSync.set(Date.now());
    }
  }

  /**
   * Setup configuration synchronization with backend
   */
  private setupConfigurationSync(): void {
    // Listen for configuration updates from backend
    this.vscode
      .onMessage()
      .pipe(
        filter(
          (msg) =>
            typeof msg === 'object' &&
            msg !== null &&
            'type' in msg &&
            typeof msg.type === 'string' &&
            msg.type.startsWith('config:'),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((msg) => {
        const message = msg as unknown as { type: string; payload: unknown };
        this.handleConfigurationMessage(message);
      });
  }

  /**
   * Handle configuration messages from backend
   */
  private handleConfigurationMessage(msg: { type: string; payload: unknown }): void {
    const messageType = msg.type;

    try {
      switch (messageType) {
        case 'config:updated':
        case 'config:refreshed':
          this.updateConfiguration(msg.payload);
          break;

        case 'config:error':
          console.error('Configuration error from backend:', msg.payload);
          break;

        default:
          console.warn('Unknown configuration message type:', messageType);
      }
    } catch (error) {
      console.error('Error handling configuration message:', error);
    }
  }

  /**
   * Update configuration from backend data
   */
  private updateConfiguration(data: unknown): void {
    try {
      // Basic type validation
      if (typeof data !== 'object' || data === null) {
        console.error('Invalid configuration data received: not an object');
        return;
      }

      // Parse configuration payload
      const configData = data as WebviewConfiguration;
      const validationResult = this.validateConfiguration(configData);

      if (!validationResult.isValid) {
        console.error('Invalid configuration received:', validationResult.errors);
        return;
      }

      // Update configuration if different
      const previous = { ...this._config() };
      if (JSON.stringify(previous) !== JSON.stringify(configData)) {
        this._config.set(configData);
        this._lastSync.set(Date.now());

        this.notifyConfigurationChange(previous, configData);
      }
    } catch (error) {
      console.error('Error updating configuration:', error);
    }
  }

  /**
   * Notify configuration change listeners
   */
  private notifyConfigurationChange(
    previous: WebviewConfiguration,
    current: WebviewConfiguration,
  ): void {
    const affectedSections = this.getAffectedSections(previous, current);

    if (affectedSections.length > 0) {
      const event: WebviewConfigChangeEvent = {
        previous,
        current,
        affectedSections,
      };

      // Add to change history (keep last 10)
      this._configChanges.update((changes) => {
        const newChanges = [...changes, event];
        return newChanges.slice(-10);
      });

      console.log('Configuration changed:', {
        affectedSections,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Get affected configuration sections
   */
  private getAffectedSections(
    previous: WebviewConfiguration,
    current: WebviewConfiguration,
  ): string[] {
    const affected: string[] = [];

    for (const section of Object.keys(current) as Array<keyof WebviewConfiguration>) {
      if (JSON.stringify(previous[section]) !== JSON.stringify(current[section])) {
        affected.push(section);
      }
    }

    return affected;
  }
}
