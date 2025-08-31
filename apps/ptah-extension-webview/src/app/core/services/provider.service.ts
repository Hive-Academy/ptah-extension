/**
 * Provider Service - Angular 20+ Implementation
 * Manages AI provider state, switching, and health monitoring
 * Uses modern Angular signals and computed properties
 */

import { Injectable, signal, computed, effect } from '@angular/core';
import { Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { VSCodeService } from './vscode.service';
import { StrictMessage, MessagePayloadMap } from '@ptah-extension/shared';

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
  readonly status: 'available' | 'unavailable' | 'error' | 'initializing' | 'disabled';
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
  // ANGULAR 20 PATTERN: Private signals for internal state
  private _availableProviders = signal<ProviderInfo[]>([]);
  private _currentProvider = signal<ProviderInfo | null>(null);
  private _providerHealth = signal<Record<string, ProviderHealth>>({});
  private _isLoading = signal(false);
  private _lastError = signal<ProviderError | null>(null);
  private _fallbackEnabled = signal(true);
  private _autoSwitchEnabled = signal(true);

  // ANGULAR 20 PATTERN: Readonly computed signals for external access
  readonly availableProviders = this._availableProviders.asReadonly();
  readonly currentProvider = this._currentProvider.asReadonly();
  readonly providerHealth = this._providerHealth.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly lastError = this._lastError.asReadonly();
  readonly fallbackEnabled = this._fallbackEnabled.asReadonly();
  readonly autoSwitchEnabled = this._autoSwitchEnabled.asReadonly();

  // ANGULAR 20 PATTERN: Computed signals for derived state
  readonly hasAvailableProviders = computed(() => this.availableProviders().length > 0);
  readonly hasCurrentProvider = computed(() => this.currentProvider() !== null);
  readonly currentProviderHealth = computed(() => {
    const current = this.currentProvider();
    return current ? this.providerHealth()[current.id] : null;
  });
  readonly healthyProvidersCount = computed(() => {
    return this.availableProviders().filter((p) => p.health.status === 'available').length;
  });
  readonly currentProviderStatus = computed(() => {
    const current = this.currentProvider();
    return current?.health.status || 'unavailable';
  });
  readonly isCurrentProviderHealthy = computed(() => {
    return this.currentProviderStatus() === 'available';
  });

  constructor(private vscodeService: VSCodeService) {
    this.setupMessageListeners();
    this.setupAutoRefresh();

    // Request initial data
    this.refreshProviders();
  }

  /**
   * Refresh all provider data
   */
  async refreshProviders(): Promise<void> {
    this._isLoading.set(true);
    try {
      this.vscodeService.getAvailableProviders();
      this.vscodeService.getCurrentProvider();
      this.vscodeService.getAllProviderHealth();
    } catch (error) {
      console.error('Failed to refresh providers:', error);
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Switch to a different provider
   */
  async switchProvider(
    providerId: string,
    reason: 'user-request' | 'auto-fallback' | 'error-recovery' = 'user-request',
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
        suggestedAction: 'Try switching to another provider or refresh the page',
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
  getProviderCapabilities(providerId: string): ProviderInfo['capabilities'] | null {
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
    return this.vscodeService.onMessageType('providers:currentChanged');
  }

  /**
   * Observable for provider health changes
   */
  onProviderHealthChange(): Observable<{ providerId: string; health: ProviderHealth }> {
    return this.vscodeService.onMessageType('providers:healthChanged');
  }

  /**
   * Observable for provider errors
   */
  onProviderError(): Observable<{ providerId: string; error: ProviderError; timestamp: number }> {
    return this.vscodeService.onMessageType('providers:error');
  }

  /**
   * Private: Setup message listeners
   */
  private setupMessageListeners(): void {
    // Handle available providers response
    this.vscodeService
      .onMessage()
      .pipe(
        filter((msg) => msg.type === 'providers:getAvailable'),
        map((msg) => msg.payload as ProviderInfo[]),
      )
      .subscribe((providers) => {
        this._availableProviders.set(providers);
        this._isLoading.set(false);
      });

    // Handle current provider response
    this.vscodeService
      .onMessage()
      .pipe(
        filter((msg) => msg.type === 'providers:getCurrent'),
        map((msg) => msg.payload as ProviderInfo | null),
      )
      .subscribe((provider) => {
        this._currentProvider.set(provider);
        this._isLoading.set(false);
      });

    // Handle provider switch events
    this.vscodeService
      .onMessage()
      .pipe(
        filter((msg) => msg.type === 'providers:currentChanged'),
        map((msg) => msg.payload as ProviderSwitchEvent),
      )
      .subscribe((switchEvent) => {
        // Update current provider based on switch event
        const newProvider = this.getProvider(switchEvent.to);
        if (newProvider) {
          this._currentProvider.set(newProvider);
        }
        this._isLoading.set(false);
      });

    // Handle health updates
    this.vscodeService
      .onMessage()
      .pipe(
        filter(
          (msg) => msg.type === 'providers:getAllHealth' || msg.type === 'providers:healthChanged',
        ),
        map((msg) => msg.payload as Record<string, ProviderHealth>),
      )
      .subscribe((healthMap) => {
        this._providerHealth.set(healthMap);
      });

    // Handle provider errors
    this.vscodeService
      .onMessage()
      .pipe(
        filter((msg) => msg.type === 'providers:error'),
        map(
          (msg) => msg.payload as { providerId: string; error: ProviderError; timestamp: number },
        ),
      )
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
            'code' in msg.payload,
        ),
        map((msg) => msg.payload as { code: string; message: string }),
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
   * Private: Setup auto-refresh for health monitoring
   */
  private setupAutoRefresh(): void {
    // Refresh health every 30 seconds
    setInterval(() => {
      if (this.hasAvailableProviders() && !this.isLoading()) {
        this.vscodeService.getAllProviderHealth();
      }
    }, 30000);

    // Use effect to watch for provider changes and update health
    effect(() => {
      const currentProvider = this.currentProvider();
      if (currentProvider && !this.isLoading()) {
        // Refresh health when current provider changes
        setTimeout(() => {
          this.vscodeService.getProviderHealth(currentProvider.id);
        }, 1000);
      }
    });
  }
}
