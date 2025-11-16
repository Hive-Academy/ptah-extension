/**
 * Provider Manager - Reactive provider orchestration with EventBus integration
 * Manages multiple AI providers with health monitoring and intelligent failover
 */

import { injectable, inject } from 'tsyringe';
import { BehaviorSubject, Observable, interval, Subscription } from 'rxjs';
import type {
  ProviderId,
  ProviderHealth,
  IProviderManager,
  IAIProvider,
} from '@ptah-extension/shared';
import { PROVIDER_MESSAGE_TYPES } from '@ptah-extension/shared';
import type { EventBus } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
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
export class ProviderManager implements IProviderManager {
  private readonly providersSubject: BehaviorSubject<ActiveProviderState>;
  private readonly providers = new Map<ProviderId, EnhancedAIProvider>();
  private healthMonitoringSubscription?: Subscription;

  /**
   * Observable stream of provider state changes
   * Emit on provider registration, selection, or health updates
   */
  readonly state$: Observable<ActiveProviderState>;

  constructor(
    @inject(TOKENS.EVENT_BUS) private readonly eventBus: EventBus,
    @inject(TOKENS.INTELLIGENT_PROVIDER_STRATEGY)
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
    console.log(`[ProviderManager] ===== registerProvider() called =====`);
    console.log(`[ProviderManager] Provider ID: ${provider.providerId}`);
    console.log(`[ProviderManager] Provider Name: ${provider.info.name}`);
    console.log(
      `[ProviderManager] Provider count BEFORE registration: ${this.providers.size}`
    );

    this.providers.set(provider.providerId, provider);

    console.log(
      `[ProviderManager] Provider count AFTER registration: ${this.providers.size}`
    );
    console.log(
      `[ProviderManager] All registered provider IDs:`,
      Array.from(this.providers.keys())
    );

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
    console.log(
      `[ProviderManager] State updated, available count: ${newState.available.size}`
    );

    // Publish available providers updated event
    this.eventBus.publish(PROVIDER_MESSAGE_TYPES.AVAILABLE_UPDATED, {
      availableProviders: Array.from(this.providers.values()).map((p) => ({
        id: p.providerId,
        name: p.info.name,
        status: p.getHealth().status,
      })),
    });
    console.log(
      `[ProviderManager] Published AVAILABLE_UPDATED event to EventBus`
    );
    console.log(`[ProviderManager] ===== registerProvider() complete =====`);
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
      this.eventBus.publish(PROVIDER_MESSAGE_TYPES.CURRENT_CHANGED, {
        from: previousProviderId,
        to: result.providerId,
        reason: 'user-request',
        timestamp: Date.now(),
      });
    }

    return result;
  }

  /**
   * Gets the currently active provider (implements IProviderManager)
   *
   * @returns Current provider or undefined if none selected
   */
  getCurrentProvider(): IAIProvider | undefined {
    return this.providersSubject.value.current ?? undefined;
  }

  /**
   * Gets all registered providers as array (implements IProviderManager)
   *
   * @returns Array of all registered providers
   */
  getAvailableProviders(): readonly IAIProvider[] {
    console.log(`[ProviderManager] getAvailableProviders() called`);
    console.log(`[ProviderManager] Provider count: ${this.providers.size}`);
    console.log(
      `[ProviderManager] Provider IDs:`,
      Array.from(this.providers.keys())
    );
    const result = Array.from(this.providers.values());
    console.log(`[ProviderManager] Returning ${result.length} providers`);
    return result;
  }

  /**
   * Gets a specific provider by ID (implements IProviderManager)
   *
   * @param providerId - Provider identifier
   * @returns Provider instance or undefined if not found
   */
  getProvider(providerId: ProviderId): IAIProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Switches to a specific provider (implements IProviderManager)
   *
   * @param providerId - Provider to switch to
   * @returns True if switch successful, false otherwise
   */
  async switchProvider(providerId: ProviderId): Promise<boolean> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return false;
    }

    const currentState = this.providersSubject.value;
    const previousProviderId = currentState.current?.providerId ?? null;

    const newState: ActiveProviderState = {
      ...currentState,
      current: provider,
      lastSwitch: {
        timestamp: Date.now(),
        from: previousProviderId,
        to: providerId,
        reason: 'user-request',
      },
    };

    this.providersSubject.next(newState);

    // Publish provider switch event
    if (previousProviderId !== providerId) {
      this.eventBus.publish(PROVIDER_MESSAGE_TYPES.CURRENT_CHANGED, {
        from: previousProviderId,
        to: providerId,
        reason: 'user-request',
        timestamp: Date.now(),
      });
    }

    return true;
  }

  /**
   * Gets health status for a specific provider (implements IProviderManager)
   *
   * @param providerId - Provider identifier
   * @returns Provider health or undefined if not found
   */
  getProviderHealth(providerId: ProviderId): ProviderHealth | undefined {
    const currentState = this.providersSubject.value;
    return currentState.health.get(providerId);
  }

  /**
   * Sets the default provider (implements IProviderManager)
   *
   * @param providerId - Provider to set as default
   */
  async setDefaultProvider(providerId: ProviderId): Promise<void> {
    // Verify provider exists
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    // Switch to this provider (publishes providers:currentChanged event)
    await this.switchProvider(providerId);

    // TODO: Persist default provider preference to configuration
  }

  /**
   * Enables or disables fallback behavior (implements IProviderManager)
   *
   * @param enabled - True to enable fallback, false to disable
   */
  enableFallback(enabled: boolean): void {
    // TODO TASK_2025_004: Implement fallback configuration storage
    // - Store preference in extension configuration
    // - Strategy should check this setting when selecting providers
    // - Consider publishing custom event if needed
    console.log(
      `[ProviderManager] Fallback ${
        enabled ? 'enabled' : 'disabled'
      } (not yet implemented)`
    );
  }

  /**
   * Sets whether to auto-switch on provider failure (implements IProviderManager)
   *
   * @param enabled - True to enable auto-switch, false to disable
   */
  setAutoSwitchOnFailure(enabled: boolean): void {
    // TODO TASK_2025_004: Implement auto-switch configuration storage
    // - Store preference in extension configuration
    // - Error handler should check this setting before attempting failover
    // - Consider publishing custom event if needed
    console.log(
      `[ProviderManager] Auto-switch on failure ${
        enabled ? 'enabled' : 'disabled'
      } (not yet implemented)`
    );
  }

  /**
   * Registers an event listener (implements IProviderManager)
   *
   * @param event - Event name to listen for
   * @param listener - Callback function
   */
  on(
    event: 'provider-switched' | 'provider-error' | 'provider-health-changed',
    listener: (data: unknown) => void
  ): void {
    // Map IProviderManager event names to EventBus message types
    // Note: Using switch statement to map interface events to MESSAGE_TYPES constants
    let busEvent: (typeof PROVIDER_MESSAGE_TYPES)[keyof typeof PROVIDER_MESSAGE_TYPES];

    switch (event) {
      case 'provider-switched':
        busEvent = PROVIDER_MESSAGE_TYPES.CURRENT_CHANGED;
        break;
      case 'provider-error':
        busEvent = PROVIDER_MESSAGE_TYPES.ERROR;
        break;
      case 'provider-health-changed':
        busEvent = PROVIDER_MESSAGE_TYPES.HEALTH_CHANGED;
        break;
      default:
        return; // Unknown event
    }

    this.eventBus.subscribe(busEvent).subscribe({
      next: (e) => listener(e.payload),
    });
  }

  /**
   * Removes an event listener (implements IProviderManager)
   *
   * @param event - Event name
   * @param _listener - Callback function to remove (unused - TODO: implement tracking)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  off(event: string, _listener: (data: unknown) => void): void {
    // TODO TASK_2025_004: Implement event listener removal
    // EventBus uses RxJS subscriptions - need to track subscriptions
    // and provide unsubscribe mechanism
    // This is a compatibility method for IProviderManager interface
    console.log(
      `[ProviderManager] off() not yet implemented for event: ${event}`
    );
  }

  /**
   * Gets all provider health statuses (implements IProviderManager)
   *
   * @returns Record mapping provider IDs to their health status
   */
  getAllProviderHealth(): Record<ProviderId, ProviderHealth> {
    const currentState = this.providersSubject.value;
    const healthMap: Record<string, ProviderHealth> = {};

    for (const [providerId, health] of currentState.health.entries()) {
      healthMap[providerId] = health;
    }

    return healthMap as Record<ProviderId, ProviderHealth>;
  }

  /**
   * Sets up EventBus listeners for provider events
   * Handles provider:error events for automatic failover
   */
  private setupEventListeners(): void {
    // Listen for provider errors to trigger failover
    this.eventBus.subscribe(PROVIDER_MESSAGE_TYPES.ERROR).subscribe({
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
          this.eventBus.publish(PROVIDER_MESSAGE_TYPES.HEALTH_CHANGED, {
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
      this.eventBus.publish(PROVIDER_MESSAGE_TYPES.ERROR, {
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
      this.eventBus.publish(PROVIDER_MESSAGE_TYPES.CURRENT_CHANGED, {
        from: failedProviderId,
        to: result.providerId,
        reason: 'auto-fallback',
        timestamp: Date.now(),
      });
    } catch (error) {
      this.eventBus.publish(PROVIDER_MESSAGE_TYPES.ERROR, {
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
