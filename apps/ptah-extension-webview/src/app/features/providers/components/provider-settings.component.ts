/**
 * Provider Settings Component - Angular 20+ Implementation
 * Comprehensive provider configuration and management panel
 */

import { Component, input, output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProviderInfo, ProviderHealth, ProviderError } from '../../core/services/provider.service';
import {
  ProviderSelectorDropdownComponent,
  ProviderOption,
} from './provider-selector-dropdown.component';

@Component({
  selector: 'app-provider-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ProviderSelectorDropdownComponent],
  template: `
    <div class="provider-settings-container">
      <!-- Header -->
      <div class="settings-header">
        <div class="header-content">
          <h2>AI Provider Settings</h2>
          <p>Configure and manage your AI providers</p>
        </div>
        <button
          type="button"
          class="close-button"
          (click)="closePanel()"
          aria-label="Close settings panel"
        >
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path
              d="M12.207 3.793a1 1 0 0 0-1.414 0L8 6.586 5.207 3.793a1 1 0 1 0-1.414 1.414L6.586 8l-2.793 2.793a1 1 0 1 0 1.414 1.414L8 9.414l2.793 2.793a1 1 0 0 0 1.414-1.414L9.414 8l2.793-2.793a1 1 0 0 0 0-1.414Z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>

      <!-- Provider Selection Section -->
      <div class="settings-section">
        <div class="section-header">
          <h3>Current Provider</h3>
          <p>Select your active AI provider</p>
        </div>

        <div class="section-content">
          <app-provider-selector-dropdown
            [availableProviders]="providerOptions()"
            [currentProvider]="currentProviderOption()"
            [loading]="loading()"
            [disabled]="disabled()"
            (providerSelected)="onProviderSelected($event)"
          />
        </div>
      </div>

      <!-- Provider Health Section -->
      @if (hasCurrentProvider()) {
        <div class="settings-section">
          <div class="section-header">
            <h3>Provider Health</h3>
            <p>Real-time status and performance metrics</p>
          </div>

          <div class="section-content">
            <div class="health-card">
              @if (currentProvider(); as current) {
                <div class="health-header">
                  <div class="provider-info">
                    <span class="provider-name">{{ current.name }}</span>
                    <span class="provider-vendor">{{ current.vendor }}</span>
                  </div>
                  <div
                    class="health-status"
                    [class.healthy]="isCurrentProviderHealthy()"
                    [class.unhealthy]="!isCurrentProviderHealthy()"
                  >
                    {{ currentProviderStatus() | titlecase }}
                  </div>
                </div>

                @if (currentProviderHealth(); as health) {
                  <div class="health-metrics">
                    <div class="metric">
                      <label>Last Check</label>
                      <span>{{ formatTimestamp(health.lastCheck) }}</span>
                    </div>

                    @if (health.responseTime) {
                      <div class="metric">
                        <label>Response Time</label>
                        <span>{{ health.responseTime }}ms</span>
                      </div>
                    }

                    @if (health.uptime) {
                      <div class="metric">
                        <label>Uptime</label>
                        <span>{{ formatUptime(health.uptime) }}</span>
                      </div>
                    }

                  </div>

                  @if (health.errorMessage) {
                    <div class="health-error">
                      <strong>Error:</strong> {{ health.errorMessage }}
                    </div>
                  }
                }
              }

            </div>
          </div>
        </div>
      }

      <!-- Provider Capabilities Section -->
      @if (currentProviderCapabilities(); as capabilities) {
        <div class="settings-section">
          <div class="section-header">
            <h3>Provider Capabilities</h3>
            <p>Features supported by the current provider</p>
          </div>

          <div class="section-content">
            <div class="capabilities-grid">
              <div class="capability" [class.enabled]="capabilities.streaming">
                <div class="capability-icon">📡</div>
                <div class="capability-info">
                  <span class="capability-name">Streaming</span>
                  <span class="capability-status">{{
                    capabilities.streaming ? 'Supported' : 'Not Supported'
                  }}</span>
                </div>
              </div>

              <div class="capability" [class.enabled]="capabilities.fileAttachments">
                <div class="capability-icon">📎</div>
                <div class="capability-info">
                  <span class="capability-name">File Attachments</span>
                  <span class="capability-status">{{
                    capabilities.fileAttachments ? 'Supported' : 'Not Supported'
                  }}</span>
                </div>
              </div>

              <div class="capability" [class.enabled]="capabilities.codeGeneration">
                <div class="capability-icon">💻</div>
                <div class="capability-info">
                  <span class="capability-name">Code Generation</span>
                  <span class="capability-status">{{
                    capabilities.codeGeneration ? 'Supported' : 'Not Supported'
                  }}</span>
                </div>
              </div>

              <div class="capability" [class.enabled]="capabilities.imageAnalysis">
                <div class="capability-icon">🖼️</div>
                <div class="capability-info">
                  <span class="capability-name">Image Analysis</span>
                  <span class="capability-status">{{
                    capabilities.imageAnalysis ? 'Supported' : 'Not Supported'
                  }}</span>
                </div>
              </div>

              <div class="capability" [class.enabled]="capabilities.functionCalling">
                <div class="capability-icon">⚡</div>
                <div class="capability-info">
                  <span class="capability-name">Function Calling</span>
                  <span class="capability-status">{{
                    capabilities.functionCalling ? 'Supported' : 'Not Supported'
                  }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      }

      <!-- Fallback Settings Section -->
      <div class="settings-section">
        <div class="section-header">
          <h3>Fallback & Recovery</h3>
          <p>Configure automatic provider switching</p>
        </div>

        <div class="section-content">
          <div class="setting-item">
            <label class="setting-label">
              <input
                type="checkbox"
                [checked]="fallbackEnabled()"
                (change)="onFallbackEnabledChange($event)"
                [disabled]="disabled()"
              />
              <span>Enable automatic provider fallback</span>
            </label>
            <p class="setting-description">
              Automatically switch to backup provider when primary fails
            </p>
          </div>

          <div class="setting-item">
            <label class="setting-label">
              <input
                type="checkbox"
                [checked]="autoSwitchEnabled()"
                (change)="onAutoSwitchEnabledChange($event)"
                [disabled]="disabled()"
              />
              <span>Auto-switch on provider errors</span>
            </label>
            <p class="setting-description">
              Switch providers automatically when errors are detected
            </p>
          </div>
        </div>
      </div>

      <!-- Error Display -->
      @if (lastError(); as error) {
        <div class="settings-section error-section">
          <div class="error-card">
            <div class="error-header">
              <div class="error-icon">⚠️</div>
              <div class="error-info">
                <strong>{{ formattedErrorType() | titlecase }}</strong>
                <p>{{ error.message }}</p>
              </div>
              <button
                type="button"
                class="dismiss-error"
                (click)="dismissError()"
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>

            @if (error.suggestedAction) {
              <div class="error-action">
                <strong>Suggested action:</strong> {{ error.suggestedAction }}
              </div>
            }

            @if (error.recoverable) {
              <div class="error-recovery">
                <button
                  type="button"
                  class="retry-button"
                  (click)="retryOperation()"
                  [disabled]="loading()"
                >
                  Retry
                </button>
              </div>
            }
          </div>
        </div>
      }

      <!-- Footer Actions -->
      <div class="settings-footer">
        <button
          type="button"
          class="refresh-button"
          (click)="refreshProviders()"
          [disabled]="loading()"
        >
          @if (loading()) {
            <span class="spinner"></span>
          }
          Refresh Providers
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .provider-settings-container {
        background: var(--vscode-panel-background);
        color: var(--vscode-foreground);
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .settings-header {
        padding: 16px 20px;
        border-bottom: 1px solid var(--vscode-panel-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: var(--vscode-editor-background);
      }

      .header-content {
        h2 {
          margin: 0 0 4px 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--vscode-foreground);
        }

        p {
          margin: 0;
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
        }
      }

      .close-button {
        background: transparent;
        border: none;
        color: var(--vscode-icon-foreground);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;

        &:hover {
          background: var(--vscode-toolbar-hoverBackground);
        }
      }

      .settings-content {
        flex: 1;
        overflow-y: auto;
        padding: 0;
      }

      .settings-section {
        border-bottom: 1px solid var(--vscode-panel-border);

        &:last-child {
          border-bottom: none;
        }

        &.error-section {
          border-bottom: none;
        }
      }

      .section-header {
        padding: 16px 20px 8px 20px;

        h3 {
          margin: 0 0 4px 0;
          font-size: 14px;
          font-weight: 600;
          color: var(--vscode-foreground);
        }

        p {
          margin: 0;
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
        }
      }

      .section-content {
        padding: 0 20px 16px 20px;
      }

      .health-card {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        padding: 12px;
      }

      .health-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }

      .provider-info {
        display: flex;
        flex-direction: column;

        .provider-name {
          font-weight: 500;
          font-size: 13px;
          color: var(--vscode-foreground);
        }

        .provider-vendor {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
        }
      }

      .health-status {
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 12px;
        font-weight: 500;

        &.healthy {
          background: rgba(76, 175, 80, 0.1);
          color: var(--vscode-gitDecoration-addedResourceForeground, #4caf50);
        }

        &.unhealthy {
          background: rgba(244, 67, 54, 0.1);
          color: var(--vscode-gitDecoration-deletedResourceForeground, #f44336);
        }
      }

      .health-metrics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 8px;
        margin-bottom: 12px;
      }

      .metric {
        display: flex;
        flex-direction: column;

        label {
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
          margin-bottom: 2px;
          text-transform: uppercase;
          font-weight: 500;
        }

        span {
          font-size: 12px;
          color: var(--vscode-foreground);

        }
      }

      .health-error {
        background: rgba(244, 67, 54, 0.1);
        color: var(--vscode-gitDecoration-deletedResourceForeground, #f44336);
        padding: 8px;
        border-radius: 4px;
        font-size: 11px;
        margin-bottom: 8px;
      }

      .health-actions {
        display: flex;
        gap: 8px;
      }


      .capabilities-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 8px;
      }

      .capability {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
        opacity: 0.6;

        &.enabled {
          opacity: 1;
          border-color: var(--vscode-gitDecoration-addedResourceForeground);
        }
      }

      .capability-icon {
        font-size: 16px;
      }

      .capability-info {
        display: flex;
        flex-direction: column;

        .capability-name {
          font-size: 12px;
          font-weight: 500;
          color: var(--vscode-foreground);
        }

        .capability-status {
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
        }
      }

      .setting-item {
        margin-bottom: 12px;

        &:last-child {
          margin-bottom: 0;
        }
      }

      .setting-label {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;

        input[type='checkbox'] {
          margin: 0;
        }

        span {
          font-size: 13px;
          color: var(--vscode-foreground);
        }
      }

      .setting-description {
        margin: 4px 0 0 20px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      .error-card {
        background: var(--vscode-inputValidation-errorBackground);
        border: 1px solid var(--vscode-inputValidation-errorBorder);
        border-radius: 6px;
        padding: 12px;
        margin: 0 20px 16px 20px;
      }

      .error-header {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }

      .error-icon {
        font-size: 16px;
      }

      .error-info {
        flex: 1;

        strong {
          color: var(--vscode-inputValidation-errorForeground);
          font-size: 13px;
        }

        p {
          margin: 4px 0 0 0;
          font-size: 11px;
          color: var(--vscode-foreground);
        }
      }

      .dismiss-error {
        background: transparent;
        border: none;
        color: var(--vscode-icon-foreground);
        cursor: pointer;
        font-size: 16px;
        padding: 0;
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .error-action {
        margin-top: 8px;
        font-size: 11px;
        color: var(--vscode-foreground);

        strong {
          color: var(--vscode-inputValidation-errorForeground);
        }
      }

      .error-recovery {
        margin-top: 8px;
      }

      .retry-button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        cursor: pointer;

        &:hover:not(:disabled) {
          background: var(--vscode-button-hoverBackground);
        }
      }

      .settings-footer {
        padding: 16px 20px;
        border-top: 1px solid var(--vscode-panel-border);
        background: var(--vscode-editor-background);
      }

      .refresh-button {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;

        &:hover:not(:disabled) {
          background: var(--vscode-button-secondaryHoverBackground);
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }

      .spinner {
        width: 12px;
        height: 12px;
        border: 2px solid var(--vscode-progressBar-background, #e0e0e0);
        border-top: 2px solid var(--vscode-progressBar-foreground, #007acc);
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class ProviderSettingsComponent {
  // ANGULAR 20 PATTERN: Input signals
  readonly availableProviders = input.required<ProviderInfo[]>();
  readonly currentProvider = input<ProviderInfo | null>(null);
  readonly providerHealth = input<Record<string, ProviderHealth>>({});
  readonly loading = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly lastError = input<ProviderError | null>(null);
  readonly fallbackEnabled = input<boolean>(true);
  readonly autoSwitchEnabled = input<boolean>(true);

  // ANGULAR 20 PATTERN: Output signals
  readonly providerSelected = output<string>();
  readonly defaultProviderSet = output<string>();
  readonly fallbackEnabledChange = output<boolean>();
  readonly autoSwitchEnabledChange = output<boolean>();
  readonly providersRefresh = output<void>();
  readonly errorDismissed = output<void>();
  readonly panelClosed = output<void>();

  // ANGULAR 20 PATTERN: Computed signals
  readonly hasCurrentProvider = computed(() => this.currentProvider() !== null);
  readonly currentProviderHealth = computed(() => {
    const current = this.currentProvider();
    const health = this.providerHealth();
    return current ? health[current.id] : null;
  });
  readonly currentProviderStatus = computed(() => {
    const health = this.currentProviderHealth();
    return health?.status || 'unavailable';
  });
  readonly isCurrentProviderHealthy = computed(() => {
    return this.currentProviderStatus() === 'available';
  });
  readonly currentProviderCapabilities = computed(() => {
    return this.currentProvider()?.capabilities || null;
  });
  readonly providerOptions = computed((): ProviderOption[] => {
    const current = this.currentProvider();
    return this.availableProviders().map((provider) => ({
      id: provider.id,
      name: provider.name,
      description: provider.description,
      vendor: provider.vendor,
      status: provider.health.status,
      isHealthy: provider.health.status === 'available',
      isCurrent: current?.id === provider.id,
    }));
  });
  readonly currentProviderOption = computed((): ProviderOption | null => {
    return this.providerOptions().find((p) => p.isCurrent) || null;
  });

  readonly formattedErrorType = computed(() => {
    const error = this.lastError();
    if (!error) return '';
    return error.type.replace(/_/g, ' ');
  });

  /**
   * Handle provider selection
   */
  onProviderSelected(providerId: string): void {
    this.providerSelected.emit(providerId);
  }

  /**
   * Handle fallback enabled change
   */
  onFallbackEnabledChange(event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    this.fallbackEnabledChange.emit(checkbox.checked);
  }

  /**
   * Handle auto-switch enabled change
   */
  onAutoSwitchEnabledChange(event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    this.autoSwitchEnabledChange.emit(checkbox.checked);
  }


  /**
   * Refresh providers
   */
  refreshProviders(): void {
    this.providersRefresh.emit();
  }

  /**
   * Dismiss error
   */
  dismissError(): void {
    this.errorDismissed.emit();
  }

  /**
   * Retry operation
   */
  retryOperation(): void {
    this.refreshProviders();
  }

  /**
   * Close settings panel
   */
  closePanel(): void {
    this.panelClosed.emit();
  }

  /**
   * Format timestamp for display
   */
  formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Format uptime for display
   */
  formatUptime(uptime: number): string {
    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return `${seconds}s`;
    }
  }
}
