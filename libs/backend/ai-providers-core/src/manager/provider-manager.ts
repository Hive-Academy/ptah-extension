/**
 * Provider Manager - Reactive provider orchestration with EventBus integration
 * Manages multiple AI providers with health monitoring and intelligent failover
 */

import { injectable } from 'tsyringe';
import { BehaviorSubject, Observable, interval, Subscription } from 'rxjs';
import type { ProviderId, ProviderHealth } from '@ptah-extension/shared';
import type { EventBus } from '@ptah-extension/vscode-core';
import type {
  ProviderContext,
  EnhancedAIProvider,
  ProviderSelectionResult,
} from '../interfaces';
import type { ActiveProviderState } from './provider-state.types';
import { IntelligentProviderStrategy } from '../strategies';

/**
 * Provider Manager - Orchestrates multiple AI providers with reactive state management
 *
 * Features:
 * - RxJS BehaviorSubject for reactive state tracking
 * - Automatic health monitoring every 30 seconds
 * - EventBus integration for provider lifecycle events
 * - Intelligent provider selection with fallback support
 *
 * @injectable Registered with DI container for dependency injection
 */
@injectable()
export class ProviderManager {
  private readonly providersSubject: BehaviorSubject<ActiveProviderState>;
  private readonly providers = new Map<ProviderId, EnhancedAIProvider>();
  private healthMonitoringSubscription?: Subscription;

  /**
   * Observable stream of provider state changes
   * Emit on provider registration, selection, or health updates
   */
  readonly state$: Observable<ActiveProviderState>;

  constructor(
    private readonly eventBus: EventBus,
    private readonly strategy: IntelligentProviderStrategy
  ) {
    // Initialize with empty state
    const initialState: ActiveProviderState = {
      current: null,
      available: new Map(),
      health: new Map(),
      lastSwitch: null,
    };

    this.providersSubject = new BehaviorSubject<ActiveProviderState>(
      initialState
    );
    this.state$ = this.providersSubject.asObservable();

    this.setupEventListeners();
    this.startHealthMonitoring();
  }

  /**
   * Registers a provider with the manager
   * Publishes provider:registered event via EventBus
   *
   * @param provider - Enhanced AI provider to register
   */
  registerProvider(provider: EnhancedAIProvider): void {
    this.providers.set(provider.providerId, provider);

    // Update state with new provider
    const currentState = this.providersSubject.value;
    const newState: ActiveProviderState = {
      ...currentState,
      available: new Map(this.providers),
      health: new Map([
        ...currentState.health,
        [provider.providerId, provider.getHealth()],
      ]),
    };

    this.providersSubject.next(newState);

    // Publish available providers updated event
    this.eventBus.publish('providers:availableUpdated', {
      availableProviders: Array.from(this.providers.values()).map((p) => ({
        id: p.providerId,
        name: p.info.name,
        status: p.getHealth().status,
      })),
    });
  }

  /**
   * Selects the best provider for a given context using the intelligent strategy
   * Updates current provider and publishes provider:switched event
   *
   * @param context - Task context for provider selection
   * @returns Selection result with provider ID and reasoning
   * @throws Error if no suitable provider found
   */
  async selectBestProvider(
    context: ProviderContext
  ): Promise<ProviderSelectionResult> {
    const result = await this.strategy.selectProvider(context, this.providers);

    const selectedProvider = this.providers.get(result.providerId);
    if (!selectedProvider) {
      throw new Error(`Provider ${result.providerId} not found in registry`);
    }

    // Update current provider
    const currentState = this.providersSubject.value;
    const previousProviderId = currentState.current?.providerId ?? null;

    const newState: ActiveProviderState = {
      ...currentState,
      current: selectedProvider,
      lastSwitch: {
        timestamp: Date.now(),
        from: previousProviderId,
        to: result.providerId,
        reason: 'user-request',
      },
    };

    this.providersSubject.next(newState);

    // Publish provider switch event (currentChanged)
    if (previousProviderId !== result.providerId) {
      this.eventBus.publish('providers:currentChanged', {
        from: previousProviderId,
        to: result.providerId,
        reason: 'user-request',
        timestamp: Date.now(),
      });
    }

    return result;
  }

  /**
   * Gets the currently active provider
   *
   * @returns Current provider or null if none selected
   */
  getCurrentProvider(): EnhancedAIProvider | null {
    return this.providersSubject.value.current;
  }

  /**
   * Gets all registered providers
   *
   * @returns ReadonlyMap of all registered providers
   */
  getAvailableProviders(): ReadonlyMap<ProviderId, EnhancedAIProvider> {
    return this.providers;
  }

  /**
   * Sets up EventBus listeners for provider events
   * Handles provider:error events for automatic failover
   */
  private setupEventListeners(): void {
    // Listen for provider errors to trigger failover
    this.eventBus.subscribe('providers:error').subscribe({
      next: (event) => {
        const currentState = this.providersSubject.value;
        if (currentState.current?.providerId === event.payload.providerId) {
          // Current provider failed - attempt failover
          this.handleProviderFailure(event.payload.providerId as ProviderId);
        }
      },
    });
  }

  /**
   * Starts automatic health monitoring for all registered providers
   * Runs every 30 seconds and updates provider health status
   */
  private startHealthMonitoring(): void {
    // Monitor health every 30 seconds
    this.healthMonitoringSubscription = interval(30000).subscribe({
      next: async () => {
        await this.updateAllProviderHealth();
      },
    });
  }

  /**
   * Updates health status for all registered providers
   * Publishes provider:healthChanged events for status changes
   */
  private async updateAllProviderHealth(): Promise<void> {
    const currentState = this.providersSubject.value;
    const updatedHealth = new Map<ProviderId, ProviderHealth>();

    for (const [providerId, provider] of this.providers.entries()) {
      try {
        const health = await provider.performHealthCheck();
        updatedHealth.set(providerId, health);

        // Publish health changed event if status changed
        const previousHealth = currentState.health.get(providerId);
        if (previousHealth && previousHealth.status !== health.status) {
          this.eventBus.publish('providers:healthChanged', {
            providerId,
            health,
          });
        }
      } catch (error) {
        // Health check failed - mark as error
        const errorHealth: ProviderHealth = {
          status: 'error',
          lastCheck: Date.now(),
          errorMessage:
            error instanceof Error ? error.message : 'Unknown error',
        };
        updatedHealth.set(providerId, errorHealth);
      }
    }

    // Update state with new health data
    const newState: ActiveProviderState = {
      ...currentState,
      health: updatedHealth,
    };

    this.providersSubject.next(newState);
  }

  /**
   * Handles provider failure by attempting automatic failover
   * Publishes provider:failover event on successful switch
   *
   * @param failedProviderId - Provider that failed
   */
  private async handleProviderFailure(
    failedProviderId: ProviderId
  ): Promise<void> {
    const currentState = this.providersSubject.value;

    // Remove failed provider from available map temporarily
    const availableProviders = new Map(this.providers);
    availableProviders.delete(failedProviderId);

    if (availableProviders.size === 0) {
      // No fallback providers available
      this.eventBus.publish('providers:error', {
        providerId: failedProviderId,
        error: {
          type: 'NO_FALLBACK',
          message: 'No fallback providers available',
          recoverable: false,
          suggestedAction:
            'Register additional providers or restart failed provider',
        },
        timestamp: Date.now(),
      });
      return;
    }

    try {
      // Select best available fallback provider
      // Use a generic context for fallback (prefer coding tasks)
      const fallbackContext: ProviderContext = {
        taskType: 'coding',
        complexity: 'medium',
        fileTypes: [],
        contextSize: 0,
      };

      const result = await this.strategy.selectProvider(
        fallbackContext,
        availableProviders
      );

      const fallbackProvider = this.providers.get(result.providerId);
      if (!fallbackProvider) {
        throw new Error(`Fallback provider ${result.providerId} not found`);
      }

      // Update to fallback provider
      const newState: ActiveProviderState = {
        ...currentState,
        current: fallbackProvider,
        lastSwitch: {
          timestamp: Date.now(),
          from: failedProviderId,
          to: result.providerId,
          reason: 'auto-fallback',
        },
      };

      this.providersSubject.next(newState);

      // Publish currentChanged event for successful failover
      this.eventBus.publish('providers:currentChanged', {
        from: failedProviderId,
        to: result.providerId,
        reason: 'auto-fallback',
        timestamp: Date.now(),
      });
    } catch (error) {
      this.eventBus.publish('providers:error', {
        providerId: failedProviderId,
        error: {
          type: 'FAILOVER_FAILED',
          message: error instanceof Error ? error.message : 'Failover failed',
          recoverable: true,
          suggestedAction: 'Check provider health and retry manually',
        },
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Disposes the provider manager and cleans up resources
   * Unsubscribes from health monitoring and disposes all providers
   */
  async dispose(): Promise<void> {
    // Stop health monitoring
    if (this.healthMonitoringSubscription) {
      this.healthMonitoringSubscription.unsubscribe();
    }

    // Dispose all providers
    for (const provider of this.providers.values()) {
      await provider.dispose();
    }

    this.providers.clear();
    this.providersSubject.complete();
  }
}
