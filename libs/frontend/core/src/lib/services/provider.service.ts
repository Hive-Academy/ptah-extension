/**
 * Provider Service - Angular 20+ Implementation
 * Manages AI provider state, switching, and health monitoring
 *
 * Migrated from: apps/ptah-extension-webview/src/app/core/services/provider.service.ts
 *
 * Modernizations applied:
 * - inject() pattern instead of constructor injection
 * - Pure signal-based state management (NO RxJS for state)
 * - Computed signals for derived state
 * - Type-safe VS Code message handling
 * - Zero `any` types
 */

import {
  Injectable,
  signal,
  computed,
  inject,
  DestroyRef,
  Injector,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Observable, interval } from 'rxjs';
import {
  filter,
  map,
  debounceTime,
  distinctUntilChanged,
} from 'rxjs/operators';
import { PROVIDER_MESSAGE_TYPES, toResponseType } from '@ptah-extension/shared';
import { VSCodeService } from './vscode.service';

/**
 * Provider Information Interface
 */
export interface ProviderInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly vendor: string;
  readonly capabilities: {
    readonly streaming: boolean;
    readonly fileAttachments: boolean;
    readonly contextManagement: boolean;
    readonly sessionPersistence: boolean;
    readonly multiTurn: boolean;
    readonly codeGeneration: boolean;
    readonly imageAnalysis: boolean;
    readonly functionCalling: boolean;
  };
  readonly health: ProviderHealth;
}

/**
 * Provider Health Status
 */
export interface ProviderHealth {
  readonly status:
    | 'available'
    | 'unavailable'
    | 'error'
    | 'initializing'
    | 'disabled';
  readonly lastCheck: number;
  readonly errorMessage?: string;
  readonly responseTime?: number;
  readonly uptime?: number;
}

/**
 * Provider Error Information
 */
export interface ProviderError {
  readonly type: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly suggestedAction: string;
  readonly context?: Record<string, unknown>;
}

/**
 * Provider Switch Event
 */
export interface ProviderSwitchEvent {
  readonly from: string | null;
  readonly to: string;
  readonly reason: 'user-request' | 'auto-fallback' | 'error-recovery';
  readonly timestamp: number;
}

@Injectable({
  providedIn: 'root',
})
export class ProviderService {
  // ANGULAR 20 PATTERN: inject() for dependencies
  private readonly vscodeService = inject(VSCodeService);
  private readonly destroyRef = inject(DestroyRef);

  private injector = inject(Injector);
  // ANGULAR 20 PATTERN: Private signals for internal state
  private readonly _availableProviders = signal<ProviderInfo[]>([]);
  private readonly _currentProvider = signal<ProviderInfo | null>(null);
  private readonly _providerHealth = signal<Record<string, ProviderHealth>>({});
  private readonly _isLoading = signal(false);
  private readonly _lastError = signal<ProviderError | null>(null);
  private readonly _fallbackEnabled = signal(true);
  private readonly _autoSwitchEnabled = signal(true);
  private _initialized = false;
  private _isRefreshing = false; // Prevent refresh loops

  // ANGULAR 20 PATTERN: Readonly signals for external access
  readonly availableProviders = this._availableProviders.asReadonly();
  readonly currentProvider = this._currentProvider.asReadonly();
  readonly providerHealth = this._providerHealth.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly lastError = this._lastError.asReadonly();
  readonly fallbackEnabled = this._fallbackEnabled.asReadonly();
  readonly autoSwitchEnabled = this._autoSwitchEnabled.asReadonly();

  // ANGULAR 20 PATTERN: Computed signals for derived state
  readonly hasAvailableProviders = computed(
    () => this.availableProviders().length > 0
  );
  readonly hasCurrentProvider = computed(() => this.currentProvider() !== null);
  readonly currentProviderHealth = computed(() => {
    const current = this.currentProvider();
    return current ? this.providerHealth()[current.id] : null;
  });
  readonly healthyProvidersCount = computed(() => {
    return this.availableProviders().filter(
      (p) => p.health.status === 'available'
    ).length;
  });
  readonly currentProviderStatus = computed(() => {
    const current = this.currentProvider();
    return current?.health.status || 'unavailable';
  });
  readonly isCurrentProviderHealthy = computed(() => {
    return this.currentProviderStatus() === 'available';
  });

  /**
   * Initialize the provider service and set up message listeners
   * MUST be called explicitly from App component after VS Code service is ready
   */
  initialize(): void {
    if (this._initialized) {
      console.warn('[ProviderService] Already initialized, skipping...');
      return;
    }

    console.log('[ProviderService] Initializing...');
    this._initialized = true;

    this.setupMessageListeners();
    this.setupAutoRefresh();

    // Request initial data
    this.refreshProviders();

    console.log('[ProviderService] Initialized successfully');
  }

  /**
   * Refresh all provider data
   */
  async refreshProviders(): Promise<void> {
    // Prevent concurrent refresh calls
    if (this._isRefreshing) {
      console.log('[ProviderService] Refresh already in progress, skipping...');
      return;
    }

    this._isRefreshing = true;
    this._isLoading.set(true);

    try {
      this.vscodeService.getAvailableProviders();
      this.vscodeService.getCurrentProvider();
      this.vscodeService.getAllProviderHealth();
    } catch (error) {
      console.error('Failed to refresh providers:', error);
    } finally {
      // Reset the refreshing flag after a short delay to allow responses to arrive
      setTimeout(() => {
        this._isRefreshing = false;
        this._isLoading.set(false);
      }, 500);
    }
  }

  /**
   * Switch to a different provider
   */
  async switchProvider(
    providerId: string,
    reason: 'user-request' | 'auto-fallback' | 'error-recovery' = 'user-request'
  ): Promise<void> {
    this._isLoading.set(true);
    this._lastError.set(null);

    try {
      this.vscodeService.switchProvider(providerId, reason);
    } catch (error) {
      console.error('Failed to switch provider:', error);
      this._lastError.set({
        type: 'SWITCH_ERROR',
        message: 'Failed to switch provider',
        recoverable: true,
        suggestedAction:
          'Try switching to another provider or refresh the page',
      });
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Set default provider
   */
  async setDefaultProvider(providerId: string): Promise<void> {
    try {
      this.vscodeService.setDefaultProvider(providerId);
    } catch (error) {
      console.error('Failed to set default provider:', error);
      this._lastError.set({
        type: 'CONFIG_ERROR',
        message: 'Failed to set default provider',
        recoverable: true,
        suggestedAction: 'Try again or check VS Code settings',
      });
    }
  }

  /**
   * Enable or disable provider fallback
   */
  async setFallbackEnabled(enabled: boolean): Promise<void> {
    try {
      this._fallbackEnabled.set(enabled);
      this.vscodeService.enableProviderFallback(enabled);
    } catch (error) {
      console.error('Failed to update fallback setting:', error);
      // Revert on error
      this._fallbackEnabled.set(!enabled);
    }
  }

  /**
   * Enable or disable auto-switch on failure
   */
  async setAutoSwitchEnabled(enabled: boolean): Promise<void> {
    try {
      this._autoSwitchEnabled.set(enabled);
      this.vscodeService.setProviderAutoSwitch(enabled);
    } catch (error) {
      console.error('Failed to update auto-switch setting:', error);
      // Revert on error
      this._autoSwitchEnabled.set(!enabled);
    }
  }

  /**
   * Get provider by ID
   */
  getProvider(providerId: string): ProviderInfo | undefined {
    return this.availableProviders().find((p) => p.id === providerId);
  }

  /**
   * Check if provider is available
   */
  isProviderAvailable(providerId: string): boolean {
    const provider = this.getProvider(providerId);
    return provider?.health.status === 'available';
  }

  /**
   * Get provider capabilities
   */
  getProviderCapabilities(
    providerId: string
  ): ProviderInfo['capabilities'] | null {
    const provider = this.getProvider(providerId);
    return provider?.capabilities || null;
  }

  /**
   * Clear last error
   */
  clearError(): void {
    this._lastError.set(null);
  }

  /**
   * Observable for provider switch events
   */
  onProviderSwitch(): Observable<ProviderSwitchEvent> {
    return this.vscodeService.onMessageType(
      PROVIDER_MESSAGE_TYPES.CURRENT_CHANGED
    );
  }

  /**
   * Observable for provider health changes
   */
  onProviderHealthChange(): Observable<{
    providerId: string;
    health: ProviderHealth;
  }> {
    return this.vscodeService.onMessageType(
      PROVIDER_MESSAGE_TYPES.HEALTH_CHANGED
    );
  }

  /**
   * Observable for provider errors
   */
  onProviderError(): Observable<{
    providerId: string;
    error: ProviderError;
    timestamp: number;
  }> {
    return this.vscodeService.onMessageType(PROVIDER_MESSAGE_TYPES.ERROR);
  }

  /**
   * Private: Setup message listeners
   */
  private setupMessageListeners(): void {
    console.log('[ProviderService] Setting up message listeners...');

    // Handle available providers response (backend sends :response, not event notifications)
    this.vscodeService
      .onMessageType(toResponseType(PROVIDER_MESSAGE_TYPES.GET_AVAILABLE))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((response) => {
        console.log(
          '[ProviderService] Received providers:getAvailable:response:',
          response
        );
        if (response.success && response.data) {
          const result = response.data as { providers?: ProviderInfo[] };
          console.log(
            '[ProviderService] Providers from response:',
            result.providers
          );
          console.log(
            '[ProviderService] Setting available providers to:',
            result.providers?.length,
            'items'
          );

          // FIX: Warn if zero providers available (CRITICAL)
          if (!result.providers || result.providers.length === 0) {
            console.error(
              '╔═══════════════════════════════════════════════════════════════╗'
            );
            console.error(
              '║ [ProviderService] CRITICAL: NO PROVIDERS AVAILABLE!          ║'
            );
            console.error(
              '║ This means provider registration FAILED in the backend       ║'
            );
            console.error(
              '║ Check Extension Host console for registration errors         ║'
            );
            console.error(
              '║ Look for messages from [registerProviders]                   ║'
            );
            console.error(
              '╚═══════════════════════════════════════════════════════════════╝'
            );

            // Set error state
            this._lastError.set({
              type: 'no-providers',
              message:
                'No AI providers are available. Extension may not have initialized properly.',
              recoverable: true,
              suggestedAction:
                'Check Extension Host console logs and restart VS Code',
            });
          }

          this._availableProviders.set(result.providers || []);
          console.log(
            '[ProviderService] Available providers after set:',
            this._availableProviders()
          );
        } else {
          console.warn(
            '[ProviderService] Failed response or no data:',
            response
          );
        }
        this._isLoading.set(false);
      });

    // Handle current provider response (backend sends :response, not event notifications)
    this.vscodeService
      .onMessageType(toResponseType(PROVIDER_MESSAGE_TYPES.GET_CURRENT))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((response) => {
        if (response.success && response.data) {
          const result = response.data as { provider?: ProviderInfo | null };
          this._currentProvider.set(result.provider || null);
        }
        this._isLoading.set(false);
      });

    // Handle provider switch events
    this.vscodeService
      .onMessage()
      .pipe(
        filter((msg) => msg.type === PROVIDER_MESSAGE_TYPES.CURRENT_CHANGED),
        map((msg) => msg.payload as ProviderSwitchEvent),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((switchEvent) => {
        // Update current provider based on switch event
        const newProvider = this.getProvider(switchEvent.to);
        if (newProvider) {
          this._currentProvider.set(newProvider);
        }
        this._isLoading.set(false);
      });

    // Handle get all health response (backend sends :response, not event notifications)
    this.vscodeService
      .onMessageType(toResponseType(PROVIDER_MESSAGE_TYPES.GET_ALL_HEALTH))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((response) => {
        if (response.success && response.data) {
          const result = response.data as {
            healthMap?: Record<string, ProviderHealth>;
          };
          this._providerHealth.set(result.healthMap || {});
        }
      });

    // Handle health changed events (this IS an event notification, not a response)
    this.vscodeService
      .onMessageType(PROVIDER_MESSAGE_TYPES.HEALTH_CHANGED)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => {
        const healthUpdate = payload as {
          providerId: string;
          health: ProviderHealth;
        };
        this._providerHealth.update((current) => ({
          ...current,
          [healthUpdate.providerId]: healthUpdate.health,
        }));
      });

    // Handle providers available updated events (push notification from backend)
    // Backend sends this when providers are registered/unregistered
    // With Task 1's readiness gate, this event arrives after webview is ready
    this.vscodeService
      .onMessageType(PROVIDER_MESSAGE_TYPES.AVAILABLE_UPDATED)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => {
        console.log(
          '[ProviderService] Received providers:availableUpdated notification',
          payload
        );

        // Guard: Validate payload structure
        if (
          payload &&
          typeof payload === 'object' &&
          'availableProviders' in payload &&
          Array.isArray(payload.availableProviders)
        ) {
          // Map minimal provider data to ProviderInfo format
          // Note: This contains basic data (id, name, status) for quick updates
          // Full provider details come from getAvailable response
          const providers = payload.availableProviders.map((p) => ({
            id: p.id,
            name: p.name,
            description: '', // Not included in notification
            vendor: '', // Not included in notification
            capabilities: {
              streaming: false,
              fileAttachments: false,
              contextManagement: false,
              sessionPersistence: false,
              multiTurn: false,
              codeGeneration: false,
              imageAnalysis: false,
              functionCalling: false,
            },
            health: {
              status: p.status,
              lastCheck: Date.now(),
              uptime: 0,
            },
          })) as ProviderInfo[];

          console.log(
            '[ProviderService] Updating available providers from push event:',
            providers.length,
            'providers'
          );
          this._availableProviders.set(providers);
        } else {
          console.warn(
            '[ProviderService] Invalid providers:availableUpdated payload:',
            payload
          );
        }
      });

    // Handle provider current changed events (event notification when current provider changes)
    this.vscodeService
      .onMessageType(PROVIDER_MESSAGE_TYPES.CURRENT_CHANGED)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => {
        console.log(
          '[ProviderService] Received providers:currentChanged:',
          payload
        );
        const update = payload as { provider?: ProviderInfo | null };
        if (update.provider !== undefined) {
          this._currentProvider.set(update.provider);
        }
      });

    // Handle provider errors
    this.vscodeService
      .onMessageType(PROVIDER_MESSAGE_TYPES.ERROR)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((errorEvent) => {
        this._lastError.set(errorEvent.error);
      });

    // Handle error messages
    this.vscodeService
      .onMessage()
      .pipe(
        filter(
          (msg) =>
            msg.type === 'error' &&
            msg.payload &&
            typeof msg.payload === 'object' &&
            'code' in msg.payload
        ),
        map((msg) => msg.payload as { code: string; message: string }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((error) => {
        if (error.code?.startsWith('PROVIDER_')) {
          this._lastError.set({
            type: error.code,
            message: error.message,
            recoverable: true,
            suggestedAction: 'Please try again or contact support',
          });
          this._isLoading.set(false);
        }
      });
  }

  /**
   * Private: Setup auto-refresh for health monitoring using RxJS
   * Uses interval for periodic health checks and observes currentProvider signal changes
   */
  private setupAutoRefresh(): void {
    // Periodic health check every 30 seconds using RxJS interval
    interval(30000)
      .pipe(
        filter(() => this.hasAvailableProviders() && !this.isLoading()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.vscodeService.getAllProviderHealth();
      });

    // Watch for current provider changes and refresh its health
    // Convert signal to Observable using toObservable
    toObservable(this.currentProvider, { injector: this.injector })
      .pipe(
        filter(
          (provider): provider is NonNullable<typeof provider> =>
            provider !== null && !this.isLoading()
        ),
        debounceTime(1000), // Debounce to avoid rapid requests
        distinctUntilChanged((prev, curr) => prev?.id === curr?.id),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((provider) => {
        this.vscodeService.getProviderHealth(provider.id);
      });
  }
}
