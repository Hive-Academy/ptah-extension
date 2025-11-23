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

import { Injectable, signal, computed, inject } from '@angular/core';
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

  // ANGULAR 20 PATTERN: Private signals for internal state
  private readonly _availableProviders = signal<ProviderInfo[]>([]);
  private readonly _currentProvider = signal<ProviderInfo | null>(null);
  private readonly _providerHealth = signal<Record<string, ProviderHealth>>({});
  private readonly _isLoading = signal(false);
  private readonly _lastError = signal<ProviderError | null>(null);
  private readonly _fallbackEnabled = signal(true);
  private readonly _autoSwitchEnabled = signal(true);

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
}
