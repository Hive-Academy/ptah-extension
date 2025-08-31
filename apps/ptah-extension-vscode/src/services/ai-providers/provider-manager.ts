/**
 * AI Provider Manager
 * Manages multiple AI providers, handles switching, fallback, and health monitoring
 */

import { EventEmitter } from 'events';
import { Logger } from '../../core/logger';
import { PtahConfigService } from '../../config/ptah-config.service';
import {
  IAIProvider,
  IProviderManager,
  ProviderId,
  ProviderHealth,
  ProviderSwitchEvent,
  ProviderErrorEvent,
  ProviderHealthChangeEvent,
  ProviderError,
  ProviderErrorType,
  isProviderError,
} from '@ptah-extension/shared';
import { ProviderFactory } from './provider-factory';

/**
 * Provider Manager Configuration
 */
export interface ProviderManagerConfig {
  defaultProvider: ProviderId;
  fallbackEnabled: boolean;
  autoSwitchOnFailure: boolean;
  healthCheckIntervalMs: number;
  maxRetryAttempts: number;
  retryDelayMs: number;
}

/**
 * Provider Manager Implementation
 */
export class ProviderManager extends EventEmitter implements IProviderManager {
  private providers = new Map<ProviderId, IAIProvider>();
  private currentProvider: IAIProvider | null = null;
  private config: ProviderManagerConfig;
  private healthCheckTimer?: NodeJS.Timeout;
  private configService: PtahConfigService;
  private providerFactory: ProviderFactory;
  private isInitialized = false;

  constructor(
    providerFactory: ProviderFactory,
    configService: PtahConfigService,
    config?: Partial<ProviderManagerConfig>
  ) {
    super();

    this.providerFactory = providerFactory;
    this.configService = configService;
    this.config = {
      defaultProvider: 'claude-cli',
      fallbackEnabled: true,
      autoSwitchOnFailure: true,
      healthCheckIntervalMs: 30000, // 30 seconds
      maxRetryAttempts: 3,
      retryDelayMs: 1000,
      ...config,
    };

    Logger.info('Provider manager initialized');
  }

  /**
   * Initialize the provider manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    Logger.info('Initializing provider manager...');

    try {
      // Load configuration
      await this.loadConfiguration();

      // Initialize available providers
      await this.initializeProviders();

      // Set up default provider
      await this.setDefaultProviderInternal();

      // Start health monitoring
      this.startHealthMonitoring();

      this.isInitialized = true;
      Logger.info('Provider manager initialization completed');
    } catch (error) {
      Logger.error('Failed to initialize provider manager:', error);
      throw error;
    }
  }

  /**
   * Get provider by ID
   */
  getProvider(providerId: ProviderId): IAIProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Get current active provider
   */
  getCurrentProvider(): IAIProvider | undefined {
    return this.currentProvider || undefined;
  }

  /**
   * Switch to a different provider
   */
  async switchProvider(
    providerId: ProviderId,
    reason: 'user-request' | 'auto-fallback' | 'error-recovery' = 'user-request'
  ): Promise<boolean> {
    Logger.info(`Switching provider to: ${providerId} (reason: ${reason})`);

    const previousProvider = this.currentProvider;
    const previousProviderId = previousProvider?.providerId || null;

    try {
      // Get or create the target provider
      let targetProvider = this.providers.get(providerId);

      if (!targetProvider) {
        Logger.info(`Provider ${providerId} not loaded, creating...`);
        targetProvider = await this.providerFactory.createProvider(providerId);
        this.providers.set(providerId, targetProvider);

        // Set up provider event listeners
        this.setupProviderEventListeners(targetProvider);
      }

      // Verify provider health
      const health = targetProvider.getHealth();
      if (health.status !== 'available') {
        Logger.warn(`Target provider ${providerId} is not healthy: ${health.status}`);

        if (reason === 'auto-fallback') {
          // Don't fallback to an unhealthy provider
          return false;
        }

        // For manual switches, try to initialize
        const initialized = await targetProvider.initialize();
        if (!initialized) {
          throw new Error(`Provider ${providerId} initialization failed`);
        }
      }

      // Switch to the new provider
      this.currentProvider = targetProvider;

      // Update configuration
      await this.configService.updateProviderConfig({
        defaultProvider: providerId,
      });

      // Emit switch event
      const switchEvent: ProviderSwitchEvent = {
        from: previousProviderId,
        to: providerId,
        reason,
        timestamp: Date.now(),
      };

      this.emit('provider-switched', switchEvent);
      Logger.info(`Provider switched successfully: ${previousProviderId} -> ${providerId}`);

      return true;
    } catch (error) {
      Logger.error(`Failed to switch to provider ${providerId}:`, error);

      // Emit error event
      if (isProviderError(error)) {
        const errorEvent: ProviderErrorEvent = {
          providerId,
          error: error as ProviderError,
          timestamp: Date.now(),
          context: { reason, previousProvider: previousProviderId },
        };
        this.emit('provider-error', errorEvent);
      }

      // Try fallback if enabled and this wasn't already a fallback attempt
      if (this.config.fallbackEnabled && reason !== 'auto-fallback') {
        Logger.info('Attempting fallback to alternative provider...');
        return await this.attemptFallback(providerId);
      }

      return false;
    }
  }

  /**
   * Get all available providers
   */
  getAvailableProviders(): readonly IAIProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get provider health
   */
  getProviderHealth(providerId: ProviderId): ProviderHealth | undefined {
    const provider = this.providers.get(providerId);
    return provider ? provider.getHealth() : undefined;
  }

  /**
   * Get all provider health statuses
   */
  getAllProviderHealth(): Record<ProviderId, ProviderHealth> {
    const healthMap: Record<string, ProviderHealth> = {};

    for (const [providerId, provider] of this.providers) {
      healthMap[providerId] = provider.getHealth();
    }

    return healthMap as Record<ProviderId, ProviderHealth>;
  }

  /**
   * Set default provider
   */
  async setDefaultProvider(providerId: ProviderId): Promise<void> {
    this.config.defaultProvider = providerId;
    await this.configService.updateProviderConfig({
      defaultProvider: providerId,
    });

    // Switch to the new default if not already current
    if (this.currentProvider?.providerId !== providerId) {
      await this.switchProvider(providerId, 'user-request');
    }

    Logger.info(`Default provider set to: ${providerId}`);
  }

  /**
   * Enable or disable fallback
   */
  enableFallback(enabled: boolean): void {
    this.config.fallbackEnabled = enabled;
    Logger.info(`Provider fallback ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Enable or disable auto-switch on failure
   */
  setAutoSwitchOnFailure(enabled: boolean): void {
    this.config.autoSwitchOnFailure = enabled;
    Logger.info(`Auto-switch on failure ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Handle provider error (called by providers)
   */
  async handleProviderError(providerId: ProviderId, error: ProviderError): Promise<void> {
    Logger.error(`Provider error from ${providerId}:`, error);

    // Emit error event
    const errorEvent: ProviderErrorEvent = {
      providerId,
      error,
      timestamp: Date.now(),
    };
    this.emit('provider-error', errorEvent);

    // Auto-switch if enabled and this is the current provider
    if (
      this.config.autoSwitchOnFailure &&
      this.currentProvider?.providerId === providerId &&
      error.recoverable === false
    ) {
      Logger.info(`Auto-switching away from failed provider: ${providerId}`);
      await this.attemptFallback(providerId);
    }
  }

  /**
   * Dispose all providers
   */
  dispose(): void {
    Logger.info('Disposing provider manager...');

    // Stop health monitoring
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    // Dispose all providers
    for (const [providerId, provider] of this.providers) {
      try {
        provider.dispose();
        Logger.info(`Provider ${providerId} disposed`);
      } catch (error) {
        Logger.error(`Error disposing provider ${providerId}:`, error);
      }
    }

    this.providers.clear();
    this.currentProvider = null;
    this.isInitialized = false;

    // Remove all listeners
    this.removeAllListeners();

    Logger.info('Provider manager disposed');
  }

  /**
   * Private helper methods
   */
  private async loadConfiguration(): Promise<void> {
    try {
      const providerConfig = this.configService.getProviderConfig();
      this.config = {
        ...this.config,
        defaultProvider: providerConfig.defaultProvider,
        fallbackEnabled: providerConfig.fallbackEnabled,
        autoSwitchOnFailure: providerConfig.autoSwitchOnFailure,
      };
      Logger.info('Provider configuration loaded');
    } catch (error) {
      Logger.warn('Failed to load provider configuration, using defaults:', error);
    }
  }

  private async initializeProviders(): Promise<void> {
    const availableProviderIds = await this.providerFactory.getAvailableProviders();
    Logger.info(`Available providers: ${availableProviderIds.join(', ')}`);

    for (const providerId of availableProviderIds) {
      try {
        const provider = await this.providerFactory.createProvider(providerId);
        this.providers.set(providerId, provider);
        this.setupProviderEventListeners(provider);
        Logger.info(`Provider ${providerId} initialized and ready`);
      } catch (error) {
        Logger.warn(`Failed to initialize provider ${providerId}:`, error);
      }
    }
  }

  private async setDefaultProviderInternal(): Promise<void> {
    const defaultProvider = this.providers.get(this.config.defaultProvider);

    if (defaultProvider) {
      this.currentProvider = defaultProvider;
      Logger.info(`Default provider set: ${this.config.defaultProvider}`);
    } else {
      // Fallback to first available provider
      const firstProvider = Array.from(this.providers.values())[0];
      if (firstProvider) {
        this.currentProvider = firstProvider;
        Logger.warn(
          `Default provider ${this.config.defaultProvider} not available, using: ${firstProvider.providerId}`
        );
      } else {
        Logger.error('No providers available');
        throw new Error('No AI providers available');
      }
    }
  }

  private async attemptFallback(failedProviderId: ProviderId): Promise<boolean> {
    if (!this.config.fallbackEnabled) {
      Logger.info('Fallback disabled, not attempting provider switch');
      return false;
    }

    // Find alternative providers
    const alternatives = Array.from(this.providers.keys()).filter((id) => id !== failedProviderId);

    for (const alternativeId of alternatives) {
      try {
        const success = await this.switchProvider(alternativeId, 'auto-fallback');
        if (success) {
          Logger.info(`Successfully fell back to provider: ${alternativeId}`);
          return true;
        }
      } catch (error) {
        Logger.warn(`Fallback to ${alternativeId} failed:`, error);
      }
    }

    Logger.error('All fallback attempts failed');
    return false;
  }

  private setupProviderEventListeners(provider: IAIProvider): void {
    // Listen for health changes
    provider.on?.('health-changed', (...args: unknown[]) => {
      const health = args[0] as ProviderHealth;
      const event: ProviderHealthChangeEvent = {
        providerId: provider.providerId,
        previousHealth: health, // This would need to be tracked separately for proper implementation
        currentHealth: health,
        timestamp: Date.now(),
      };
      this.emit('provider-health-changed', event);
    });

    // Listen for errors
    provider.on?.('error', (...args: unknown[]) => {
      const error = args[0] as ProviderError;
      this.handleProviderError(provider.providerId, error);
    });
  }

  private startHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      return;
    }

    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.healthCheckIntervalMs);

    Logger.info(`Health monitoring started (interval: ${this.config.healthCheckIntervalMs}ms)`);
  }

  private async performHealthChecks(): Promise<void> {
    for (const [providerId, provider] of this.providers) {
      try {
        const health = provider.getHealth();

        // If provider is unhealthy and it's the current provider, try to recover or switch
        if (health.status === 'error' && this.currentProvider?.providerId === providerId) {
          Logger.warn(`Current provider ${providerId} is unhealthy: ${health.errorMessage}`);

          if (this.config.autoSwitchOnFailure) {
            await this.attemptFallback(providerId);
          }
        }
      } catch (error) {
        Logger.error(`Error during health check for provider ${providerId}:`, error);
      }
    }
  }
}
