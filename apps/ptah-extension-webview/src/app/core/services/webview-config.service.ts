import { Injectable, signal, computed, inject } from '@angular/core';
import { Observable, Subject, BehaviorSubject, filter, catchError, EMPTY, takeUntil } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';

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
  readonly previous: ConfigurationPayloadType;
  readonly current: ConfigurationPayloadType;
  readonly affectedSections: readonly string[];
}

/**
 * Webview Configuration Service
 *
 * Manages configuration for the Angular webview by:
 * - Syncing with backend configuration service
 * - Providing reactive configuration updates
 * - Caching configuration for offline use
 * - Type-safe configuration access
 */
@Injectable({ providedIn: 'root' })
export class WebviewConfigService {
  private readonly vscode = inject(VSCodeService);
  private readonly destroy$ = new Subject<void>();

  // Private state signals
  private readonly _config = signal<ConfigurationPayloadType>(DEFAULT_WEBVIEW_CONFIG);
  private readonly _isLoaded = signal(false);
  private readonly _lastSync = signal<number>(0);

  // Configuration change stream
  private readonly configChange$ = new BehaviorSubject<WebviewConfigChangeEvent | null>(null);

  // Public readonly signals
  readonly config = this._config.asReadonly();
  readonly isLoaded = this._isLoaded.asReadonly();
  readonly lastSync = this._lastSync.asReadonly();

  // Computed configuration sections
  readonly claudeConfig = computed(() => this._config().claude);
  readonly streamingConfig = computed(() => this._config().streaming);

  // Configuration change observable
  readonly onConfigChange$: Observable<WebviewConfigChangeEvent> = this.configChange$.pipe(
    filter((event): event is WebviewConfigChangeEvent => event !== null),
  );

  constructor() {
    this.setupConfigurationSync();
    this.waitForConnectionAndInitialize();
  }

  /**
   * Get current configuration (immutable)
   */
  getConfig(): Readonly<ConfigurationPayloadType> {
    return Object.freeze({ ...this._config() });
  }

  /**
   * Get specific configuration section
   */
  getSection<K extends keyof ConfigurationPayloadType>(
    section: K,
  ): Readonly<ConfigurationPayloadType[K]> {
    return Object.freeze({ ...this._config()[section] });
  }

  /**
   * Get specific configuration value with type safety
   */
  getValue<K extends keyof ConfigurationPayloadType, T extends keyof ConfigurationPayloadType[K]>(
    section: K,
    key: T,
  ): ConfigurationPayloadType[K][T] {
    return this._config()[section][key];
  }

  /**
   * Request configuration update from backend
   */
  async requestConfigUpdate<
    K extends keyof ConfigurationPayloadType,
    T extends keyof ConfigurationPayloadType[K],
  >(section: K, key: T, value: ConfigurationPayloadType[K][T]): Promise<void> {
    try {
      await this.vscode.postStrictMessage('config:update', {
        updates: { [section]: { [key]: value } },
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
  validateConfiguration(config?: ConfigurationPayloadType): { isValid: boolean; errors: string[] } {
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
        takeUntil(this.destroy$),
      )
      .subscribe(() => {
        console.log('WebviewConfigService: VS Code connected, initializing configuration...');
        this.initializeConfiguration();
      });

    // If already connected, initialize immediately
    if (this.vscode.isConnected()) {
      console.log('WebviewConfigService: VS Code already connected, initializing configuration...');
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
        filter((msg) => MessageValidators.safeParseMessage(msg).success),
        filter((msg) => {
          const parsed = MessageValidators.safeParseMessage(msg);
          return parsed.success && parsed.data.type.startsWith('config:');
        }),
        catchError((error) => {
          console.error('Configuration sync error:', error);
          return EMPTY;
        }),
        takeUntil(this.destroy$),
      )
      .subscribe((msg) => {
        this.handleConfigurationMessage(msg);
      });
  }

  /**
   * Handle configuration messages from backend
   */
  private handleConfigurationMessage(msg: any): void {
    const messageType = msg.type;

    try {
      switch (messageType) {
        case 'config:updated':
        case 'config:refreshed':
          this.updateConfiguration(msg.data);
          break;

        case 'config:error':
          console.error('Configuration error from backend:', msg.data);
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
      // Validate incoming configuration data
      const validation = MessageValidators.safeParseMessage({ type: 'config', data });
      if (!validation.success) {
        console.error('Invalid configuration data received:', validation.error);
        return;
      }

      // Parse configuration payload
      const configData = data as ConfigurationPayloadType;
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
    previous: ConfigurationPayloadType,
    current: ConfigurationPayloadType,
  ): void {
    const affectedSections = this.getAffectedSections(previous, current);

    if (affectedSections.length > 0) {
      const event: WebviewConfigChangeEvent = {
        previous,
        current,
        affectedSections,
      };

      this.configChange$.next(event);

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
    previous: ConfigurationPayloadType,
    current: ConfigurationPayloadType,
  ): string[] {
    const affected: string[] = [];

    for (const section of Object.keys(current) as Array<keyof ConfigurationPayloadType>) {
      if (JSON.stringify(previous[section]) !== JSON.stringify(current[section])) {
        affected.push(section);
      }
    }

    return affected;
  }

  /**
   * Cleanup on service destruction
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.configChange$.complete();
  }
}
