/**
 * Ptah Configuration Service
 *
 * Centralized configuration management for VS Code extension with:
 * - Environment-based configuration
 * - User-configurable settings via VS Code settings
 * - Type-safe configuration interface
 * - Default fallbacks for all settings
 * - AI provider management configuration
 */

import { ProviderId } from '@ptah-extension/shared';

import * as vscode from 'vscode';
import { Logger } from '../core/logger';

/**
 * Configuration interface with strict typing
 */
/**
 * Provider-specific configuration interfaces
 */
export interface ClaudeCliProviderConfig {
  readonly enabled: boolean;
  readonly cliPath: string;
  readonly customPath?: string;
  readonly timeout: number;
}

export interface VSCodeLMProviderConfig {
  readonly enabled: boolean;
  readonly preferredFamily: string;
  readonly fallbackModels: readonly string[];
  readonly maxRetries: number;
  readonly modelSelectionStrategy: 'first-available' | 'best-match' | 'user-preference';
}

/**
 * Main configuration interface with strict typing
 */
export interface PtahConfiguration {
  readonly claude: {
    readonly cliPath: string;
    readonly defaultProvider: 'anthropic' | 'bedrock' | 'vertex';
    readonly model: string;
    readonly temperature: number;
    readonly maxTokens: number;
  };
  readonly providers: {
    readonly defaultProvider: ProviderId;
    readonly fallbackEnabled: boolean;
    readonly autoSwitchOnFailure: boolean;
    readonly claudeCli: ClaudeCliProviderConfig;
    readonly vscodeLm: VSCodeLMProviderConfig;
  };
  readonly streaming: {
    readonly bufferSize: number;
    readonly chunkSize: number;
    readonly timeoutMs: number;
  };
  readonly context: {
    readonly autoIncludeOpenFiles: boolean;
    readonly contextOptimization: boolean;
    readonly maxFileSize: number;
  };
  readonly analytics: {
    readonly enabled: boolean;
  };
  readonly development: {
    readonly enableDebugLogging: boolean;
    readonly mockResponses: boolean;
  };
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: PtahConfiguration = {
  claude: {
    cliPath: 'claude',
    defaultProvider: 'anthropic',
    model: 'claude-3-sonnet-20241022',
    temperature: 0.1,
    maxTokens: 200000,
  },
  providers: {
    defaultProvider: 'claude-cli',
    fallbackEnabled: true,
    autoSwitchOnFailure: true,
    claudeCli: {
      enabled: true,
      cliPath: 'claude',
      timeout: 30000,
    },
    vscodeLm: {
      enabled: true,
      preferredFamily: 'gpt-4',
      fallbackModels: ['gpt-4', 'gpt-3.5-turbo'],
      maxRetries: 3,
      modelSelectionStrategy: 'first-available',
    },
  },
  streaming: {
    bufferSize: 8192,
    chunkSize: 1024,
    timeoutMs: 30000,
  },
  context: {
    autoIncludeOpenFiles: true,
    contextOptimization: true,
    maxFileSize: 1024 * 1024, // 1MB
  },
  analytics: {
    enabled: true,
  },
  development: {
    enableDebugLogging: false,
    mockResponses: false,
  },
};

/**
 * Configuration change event
 */
export interface ConfigurationChangeEvent {
  readonly affectedSections: readonly string[];
  readonly previousConfig: PtahConfiguration;
  readonly newConfig: PtahConfiguration;
}

/**
 * Configuration service for centralized settings management
 */
export class PtahConfigService {
  private static instance: PtahConfigService;
  private currentConfig: PtahConfiguration;
  private readonly changeListeners: ((event: ConfigurationChangeEvent) => void)[] = [];
  private configWatcher?: vscode.Disposable;

  private constructor() {
    this.currentConfig = this.loadConfiguration();
    this.setupConfigurationWatcher();

    Logger.info('Ptah Configuration Service initialized', {
      config: this.sanitizeConfigForLogging(this.currentConfig),
    });
  }

  /**
   * Get singleton instance
   */
  static getInstance(): PtahConfigService {
    if (!PtahConfigService.instance) {
      PtahConfigService.instance = new PtahConfigService();
    }
    return PtahConfigService.instance;
  }

  /**
   * Get current configuration (immutable)
   */
  getConfig(): Readonly<PtahConfiguration> {
    return Object.freeze({ ...this.currentConfig });
  }

  /**
   * Get specific configuration section
   */
  getSection<K extends keyof PtahConfiguration>(section: K): Readonly<PtahConfiguration[K]> {
    return Object.freeze({ ...this.currentConfig[section] });
  }

  /**
   * Get specific configuration value with type safety
   */
  getValue<K extends keyof PtahConfiguration, T extends keyof PtahConfiguration[K]>(
    section: K,
    key: T
  ): PtahConfiguration[K][T] {
    return this.currentConfig[section][key];
  }

  /**
   * Get provider configuration
   */
  getProviderConfig(): PtahConfiguration['providers'] {
    return this.getSection('providers');
  }

  /**
   * Update provider configuration
   */
  async updateProviderConfig(updates: Partial<PtahConfiguration['providers']>): Promise<void> {
    // Update multiple provider settings
    const promises: Promise<void>[] = [];

    if (updates.defaultProvider !== undefined) {
      promises.push(
        this.updateConfiguration('providers', 'defaultProvider', updates.defaultProvider)
      );
    }

    if (updates.fallbackEnabled !== undefined) {
      promises.push(
        this.updateConfiguration('providers', 'fallbackEnabled', updates.fallbackEnabled)
      );
    }

    if (updates.autoSwitchOnFailure !== undefined) {
      promises.push(
        this.updateConfiguration('providers', 'autoSwitchOnFailure', updates.autoSwitchOnFailure)
      );
    }

    await Promise.all(promises);

    Logger.info('Provider configuration updated', {
      updates: Object.keys(updates),
    });
  }

  /**
   * Get complete configuration (for backward compatibility)
   */
  getConfiguration(): PtahConfiguration {
    return this.getConfig();
  }

  /**
   * Update configuration programmatically
   * This will update the VS Code settings if the value is different
   */
  async updateConfiguration<
    K extends keyof PtahConfiguration,
    T extends keyof PtahConfiguration[K],
  >(
    section: K,
    key: T,
    value: PtahConfiguration[K][T],
    configTarget: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace
  ): Promise<void> {
    const vsCodeConfigKey = this.mapToVSCodeConfigKey(section, key);

    if (vsCodeConfigKey) {
      const config = vscode.workspace.getConfiguration('ptah');
      await config.update(vsCodeConfigKey, value, configTarget);

      Logger.info(`Configuration updated: ${section}.${String(key)}`, {
        value: this.sanitizeValue(String(key), value),
        target: configTarget,
      });
    } else {
      Logger.warn(`Cannot update non-persisted configuration: ${section}.${String(key)}`);
    }
  }

  /**
   * Register configuration change listener
   */
  onConfigurationChanged(listener: (event: ConfigurationChangeEvent) => void): vscode.Disposable {
    this.changeListeners.push(listener);

    return new vscode.Disposable(() => {
      const index = this.changeListeners.indexOf(listener);
      if (index >= 0) {
        this.changeListeners.splice(index, 1);
      }
    });
  }

  /**
   * Reload configuration from VS Code settings
   */
  reloadConfiguration(): void {
    const previousConfig = { ...this.currentConfig };
    this.currentConfig = this.loadConfiguration();

    const affectedSections = this.getAffectedSections(previousConfig, this.currentConfig);

    if (affectedSections.length > 0) {
      const event: ConfigurationChangeEvent = {
        affectedSections,
        previousConfig,
        newConfig: { ...this.currentConfig },
      };

      this.notifyConfigurationChanged(event);

      Logger.info('Configuration reloaded', {
        affectedSections,
        newConfig: this.sanitizeConfigForLogging(this.currentConfig),
      });
    }
  }

  /**
   * Validate current configuration
   */
  validateConfiguration(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate Claude configuration
    if (this.currentConfig.claude.temperature < 0 || this.currentConfig.claude.temperature > 1) {
      errors.push('Claude temperature must be between 0 and 1');
    }

    if (this.currentConfig.claude.maxTokens <= 0) {
      errors.push('Claude maxTokens must be positive');
    }

    // Validate streaming configuration
    if (this.currentConfig.streaming.bufferSize <= 0) {
      errors.push('Streaming bufferSize must be positive');
    }

    if (this.currentConfig.streaming.chunkSize <= 0) {
      errors.push('Streaming chunkSize must be positive');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get environment-specific configuration
   */
  getEnvironmentConfig(): { isDevelopment: boolean; isProduction: boolean; environment: string } {
    const extensionMode = vscode.env.machineId === 'someValue' ? 'development' : 'production';

    return {
      isDevelopment: extensionMode === 'development',
      isProduction: extensionMode === 'production',
      environment: extensionMode,
    };
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.configWatcher?.dispose();
    this.changeListeners.length = 0;
    Logger.info('Ptah Configuration Service disposed');
  }

  /**
   * Load configuration from VS Code settings with fallbacks
   */
  private loadConfiguration(): PtahConfiguration {
    const config = vscode.workspace.getConfiguration('ptah');

    return {
      claude: {
        cliPath: config.get<string>('claudeCliPath') ?? DEFAULT_CONFIG.claude.cliPath,
        defaultProvider:
          config.get<'anthropic' | 'bedrock' | 'vertex'>('defaultProvider') ??
          DEFAULT_CONFIG.claude.defaultProvider,
        model: config.get<string>('claude.model') ?? DEFAULT_CONFIG.claude.model,
        temperature: config.get<number>('claude.temperature') ?? DEFAULT_CONFIG.claude.temperature,
        maxTokens: config.get<number>('maxTokens') ?? DEFAULT_CONFIG.claude.maxTokens,
      },
      providers: {
        defaultProvider:
          config.get<ProviderId>('providers.defaultProvider') ??
          DEFAULT_CONFIG.providers.defaultProvider,
        fallbackEnabled:
          config.get<boolean>('providers.fallbackEnabled') ??
          DEFAULT_CONFIG.providers.fallbackEnabled,
        autoSwitchOnFailure:
          config.get<boolean>('providers.autoSwitchOnFailure') ??
          DEFAULT_CONFIG.providers.autoSwitchOnFailure,
        claudeCli: {
          enabled:
            config.get<boolean>('providers.claudeCli.enabled') ??
            DEFAULT_CONFIG.providers.claudeCli.enabled,
          cliPath:
            config.get<string>('providers.claudeCli.cliPath') ??
            DEFAULT_CONFIG.providers.claudeCli.cliPath,
          customPath: config.get<string>('providers.claudeCli.customPath'),
          timeout:
            config.get<number>('providers.claudeCli.timeout') ??
            DEFAULT_CONFIG.providers.claudeCli.timeout,
        },
        vscodeLm: {
          enabled:
            config.get<boolean>('providers.vscodeLm.enabled') ??
            DEFAULT_CONFIG.providers.vscodeLm.enabled,
          preferredFamily:
            config.get<string>('providers.vscodeLm.preferredFamily') ??
            DEFAULT_CONFIG.providers.vscodeLm.preferredFamily,
          fallbackModels:
            config.get<string[]>('providers.vscodeLm.fallbackModels') ??
            DEFAULT_CONFIG.providers.vscodeLm.fallbackModels,
          maxRetries:
            config.get<number>('providers.vscodeLm.maxRetries') ??
            DEFAULT_CONFIG.providers.vscodeLm.maxRetries,
          modelSelectionStrategy:
            config.get<'first-available' | 'best-match' | 'user-preference'>(
              'providers.vscodeLm.modelSelectionStrategy'
            ) ?? DEFAULT_CONFIG.providers.vscodeLm.modelSelectionStrategy,
        },
      },
      streaming: {
        bufferSize:
          config.get<number>('streaming.bufferSize') ?? DEFAULT_CONFIG.streaming.bufferSize,
        chunkSize: config.get<number>('streaming.chunkSize') ?? DEFAULT_CONFIG.streaming.chunkSize,
        timeoutMs: config.get<number>('streaming.timeoutMs') ?? DEFAULT_CONFIG.streaming.timeoutMs,
      },
      context: {
        autoIncludeOpenFiles:
          config.get<boolean>('autoIncludeOpenFiles') ??
          DEFAULT_CONFIG.context.autoIncludeOpenFiles,
        contextOptimization:
          config.get<boolean>('contextOptimization') ?? DEFAULT_CONFIG.context.contextOptimization,
        maxFileSize:
          config.get<number>('context.maxFileSize') ?? DEFAULT_CONFIG.context.maxFileSize,
      },
      analytics: {
        enabled: config.get<boolean>('analyticsEnabled') ?? DEFAULT_CONFIG.analytics.enabled,
      },
      development: {
        enableDebugLogging:
          config.get<boolean>('development.enableDebugLogging') ??
          DEFAULT_CONFIG.development.enableDebugLogging,
        mockResponses:
          config.get<boolean>('development.mockResponses') ??
          DEFAULT_CONFIG.development.mockResponses,
      },
    };
  }

  /**
   * Setup VS Code configuration watcher
   */
  private setupConfigurationWatcher(): void {
    this.configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('ptah')) {
        this.reloadConfiguration();
      }
    });
  }

  /**
   * Map internal config key to VS Code settings key
   */
  private mapToVSCodeConfigKey<
    K extends keyof PtahConfiguration,
    T extends keyof PtahConfiguration[K],
  >(section: K, key: T): string | null {
    const mappings: Record<string, string> = {
      'claude.cliPath': 'claudeCliPath',
      'claude.defaultProvider': 'defaultProvider',
      'claude.model': 'claude.model',
      'claude.temperature': 'claude.temperature',
      'claude.maxTokens': 'maxTokens',
      'providers.defaultProvider': 'providers.defaultProvider',
      'providers.fallbackEnabled': 'providers.fallbackEnabled',
      'providers.autoSwitchOnFailure': 'providers.autoSwitchOnFailure',
      'providers.claudeCli.enabled': 'providers.claudeCli.enabled',
      'providers.claudeCli.cliPath': 'providers.claudeCli.cliPath',
      'providers.claudeCli.customPath': 'providers.claudeCli.customPath',
      'providers.claudeCli.timeout': 'providers.claudeCli.timeout',
      'providers.vscodeLm.enabled': 'providers.vscodeLm.enabled',
      'providers.vscodeLm.preferredFamily': 'providers.vscodeLm.preferredFamily',
      'providers.vscodeLm.fallbackModels': 'providers.vscodeLm.fallbackModels',
      'providers.vscodeLm.maxRetries': 'providers.vscodeLm.maxRetries',
      'providers.vscodeLm.modelSelectionStrategy': 'providers.vscodeLm.modelSelectionStrategy',
      'streaming.bufferSize': 'streaming.bufferSize',
      'streaming.chunkSize': 'streaming.chunkSize',
      'streaming.timeoutMs': 'streaming.timeoutMs',
      'context.autoIncludeOpenFiles': 'autoIncludeOpenFiles',
      'context.contextOptimization': 'contextOptimization',
      'context.maxFileSize': 'context.maxFileSize',
      'analytics.enabled': 'analyticsEnabled',
    };

    const fullKey = `${section}.${String(key)}`;
    return mappings[fullKey] || null;
  }

  /**
   * Get sections affected by configuration changes
   */
  private getAffectedSections(previous: PtahConfiguration, current: PtahConfiguration): string[] {
    const affected: string[] = [];

    for (const section of Object.keys(current) as Array<keyof PtahConfiguration>) {
      const prevSection = previous[section];
      const currSection = current[section];

      if (JSON.stringify(prevSection) !== JSON.stringify(currSection)) {
        affected.push(section);
      }
    }

    return affected;
  }

  /**
   * Notify all listeners of configuration changes
   */
  private notifyConfigurationChanged(event: ConfigurationChangeEvent): void {
    for (const listener of this.changeListeners) {
      try {
        listener(event);
      } catch (error) {
        Logger.error('Error in configuration change listener', error);
      }
    }
  }

  /**
   * Sanitize configuration for logging (remove sensitive data)
   */
  private sanitizeConfigForLogging(config: PtahConfiguration): Partial<PtahConfiguration> {
    return {
      claude: {
        ...config.claude,
        // Don't log sensitive paths or tokens
        cliPath: config.claude.cliPath.includes('/') ? '[PATH]' : config.claude.cliPath,
      },
      providers: {
        ...config.providers,
        claudeCli: {
          ...config.providers.claudeCli,
          cliPath: config.providers.claudeCli.cliPath.includes('/')
            ? '[PATH]'
            : config.providers.claudeCli.cliPath,
          customPath: config.providers.claudeCli.customPath?.includes('/')
            ? '[PATH]'
            : config.providers.claudeCli.customPath,
        },
      },
      streaming: config.streaming,
      context: config.context,
      analytics: config.analytics,
      development: config.development,
    };
  }

  /**
   * Sanitize individual values for logging
   */
  private sanitizeValue(key: string, value: unknown): unknown {
    if (key.toLowerCase().includes('path') || key.toLowerCase().includes('token')) {
      return '[SANITIZED]';
    }
    return value;
  }
}

/**
 * Convenience function to get configuration service instance
 */
export const getConfigService = (): PtahConfigService => PtahConfigService.getInstance();
