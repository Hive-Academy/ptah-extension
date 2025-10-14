/**
 * Provider Manager Smart Component - Angular 20+ Implementation
 * Manages provider state and coordinates with backend services
 */

import { Component, output, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProviderService, ProviderInfo } from '@ptah-extension/core';
import { LoggingService } from '@ptah-extension/core';
import { ProviderSettingsComponent } from '../components/provider-settings.component';

@Component({
  selector: 'ptah-provider-manager',
  standalone: true,
  imports: [CommonModule, ProviderSettingsComponent],
  template: `
    <div class="provider-manager-container">
      @if (showSettings()) {
      <div
        class="settings-overlay"
        role="button"
        tabindex="0"
        aria-label="Close settings overlay"
        (click)="closeSettings()"
        (keydown.enter)="closeSettings()"
        (keydown.space)="closeSettings()"
      >
        <!-- Settings panel - click propagation stopped by component internally -->
        <ptah-provider-settings
          class="settings-panel"
          [availableProviders]="providerService.availableProviders()"
          [currentProvider]="providerService.currentProvider()"
          [providerHealth]="providerService.providerHealth()"
          [loading]="providerService.isLoading()"
          [disabled]="false"
          [lastError]="providerService.lastError()"
          [fallbackEnabled]="providerService.fallbackEnabled()"
          [autoSwitchEnabled]="providerService.autoSwitchEnabled()"
          (providerSelected)="onProviderSelected($event)"
          (fallbackEnabledChange)="onFallbackEnabledChange($event)"
          (autoSwitchEnabledChange)="onAutoSwitchEnabledChange($event)"
          (providersRefresh)="onProvidersRefresh()"
          (errorDismissed)="onErrorDismissed()"
          (panelClosed)="closeSettings()"
          (click)="$event.stopPropagation()"
        />
      </div>
      }
    </div>
  `,
  styles: [
    `
      .provider-manager-container {
        position: relative;
      }

      .settings-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(2px);
      }

      .settings-panel {
        width: 90%;
        max-width: 600px;
        height: 80%;
        max-height: 800px;
        background: var(--vscode-panel-background);
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        border: 1px solid var(--vscode-panel-border);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      @media (max-width: 768px) {
        .settings-panel {
          width: 95%;
          height: 90%;
          border-radius: 8px 8px 0 0;
          align-self: flex-end;
        }
      }
    `,
  ],
})
export class ProviderManagerComponent {
  // Inject the provider service
  protected readonly providerService = inject(ProviderService);
  private readonly logger = inject(LoggingService);

  // ANGULAR 20 PATTERN: Output signals
  readonly settingsOpened = output<void>();
  readonly settingsClosed = output<void>();

  // ANGULAR 20 PATTERN: Internal signals
  private _showSettings = signal(false);

  // ANGULAR 20 PATTERN: Readonly computed signals
  readonly showSettings = this._showSettings.asReadonly();

  constructor() {
    this.setupProviderEventListeners();
  }

  /**
   * Open provider settings panel
   */
  openSettings(): void {
    this._showSettings.set(true);
    this.settingsOpened.emit();
  }

  /**
   * Close provider settings panel
   */
  closeSettings(): void {
    this._showSettings.set(false);
    this.settingsClosed.emit();
  }

  /**
   * Toggle provider settings panel
   */
  toggleSettings(): void {
    if (this.showSettings()) {
      this.closeSettings();
    } else {
      this.openSettings();
    }
  }

  /**
   * Handle provider selection
   */
  protected onProviderSelected(providerId: string): void {
    this.logger.interaction('providerSelected', 'ProviderManagerComponent', {
      providerId,
    });
    this.providerService.switchProvider(providerId, 'user-request');
  }

  /**
   * Handle fallback enabled change
   */
  protected onFallbackEnabledChange(enabled: boolean): void {
    this.logger.interaction(
      'fallbackEnabledChange',
      'ProviderManagerComponent',
      { enabled }
    );
    this.providerService.setFallbackEnabled(enabled);
  }

  /**
   * Handle auto-switch enabled change
   */
  protected onAutoSwitchEnabledChange(enabled: boolean): void {
    this.logger.interaction(
      'autoSwitchEnabledChange',
      'ProviderManagerComponent',
      { enabled }
    );
    this.providerService.setAutoSwitchEnabled(enabled);
  }

  /**
   * Handle providers refresh
   */
  protected onProvidersRefresh(): void {
    this.logger.interaction('providersRefresh', 'ProviderManagerComponent');
    this.providerService.refreshProviders();
  }

  /**
   * Handle error dismissed
   */
  protected onErrorDismissed(): void {
    this.logger.interaction('errorDismissed', 'ProviderManagerComponent');
    this.providerService.clearError();
  }

  /**
   * Get current provider info for external access
   */
  getCurrentProvider(): ProviderInfo | null {
    return this.providerService.currentProvider();
  }

  /**
   * Get current provider status for external access
   */
  getCurrentProviderStatus(): string {
    return this.providerService.currentProviderStatus();
  }

  /**
   * Check if current provider is healthy for external access
   */
  isCurrentProviderHealthy(): boolean {
    return this.providerService.isCurrentProviderHealthy();
  }

  /**
   * Get provider count for external access
   */
  getAvailableProvidersCount(): number {
    return this.providerService.availableProviders().length;
  }

  /**
   * Get healthy providers count for external access
   */
  getHealthyProvidersCount(): number {
    return this.providerService.healthyProvidersCount();
  }

  /**
   * Private: Setup provider event listeners
   */
  private setupProviderEventListeners(): void {
    // Listen for provider switch events
    this.providerService.onProviderSwitch().subscribe((switchEvent) => {
      this.logger.api('providerSwitched', switchEvent, true);

      // Show toast notification or update UI state as needed
      if (switchEvent.reason === 'auto-fallback') {
        this.logger.warn(
          'Automatic provider switch occurred',
          'ProviderManagerComponent',
          switchEvent
        );
      }
    });

    // Listen for provider health changes
    this.providerService.onProviderHealthChange().subscribe((healthEvent) => {
      this.logger.api('providerHealthChanged', healthEvent, true);

      // Handle critical health changes
      if (healthEvent.health.status === 'error') {
        this.logger.error(
          'Provider health error',
          'ProviderManagerComponent',
          healthEvent
        );
      }
    });

    // Listen for provider errors
    this.providerService.onProviderError().subscribe((errorEvent) => {
      this.logger.error(
        'Provider error event',
        'ProviderManagerComponent',
        errorEvent
      );

      // Show error notification or take recovery action
      if (!errorEvent.error.recoverable) {
        this.logger.warn(
          'Non-recoverable provider error',
          'ProviderManagerComponent',
          errorEvent
        );
      }
    });
  }
}
