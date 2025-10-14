/**
 * Provider Selector Dropdown Component - Angular 20+ Implementation
 * Dumb component for provider selection with modern Angular patterns
 */

import { Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Provider Selector Option
 */
export interface ProviderOption {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly vendor: string;
  readonly status:
    | 'available'
    | 'unavailable'
    | 'error'
    | 'initializing'
    | 'disabled';
  readonly isHealthy: boolean;
  readonly isCurrent: boolean;
}

@Component({
  selector: 'ptah-provider-selector-dropdown',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="provider-selector-container">
      <!-- Dropdown Trigger -->
      <button
        type="button"
        class="provider-selector-trigger"
        [class.open]="isOpen()"
        [class.disabled]="disabled()"
        [disabled]="disabled()"
        (click)="toggleDropdown()"
        [attr.aria-expanded]="isOpen()"
        [attr.aria-haspopup]="true"
        [attr.aria-label]="
          'Select AI provider. Current: ' + (currentProvider()?.name || 'None')
        "
      >
        <div class="provider-selector-content">
          <!-- Current Provider Info -->
          <div class="current-provider-info">
            @if (currentProvider(); as current) {
            <div class="provider-icon">
              <div
                class="status-indicator"
                [class.healthy]="current.isHealthy"
                [class.unhealthy]="!current.isHealthy"
                [title]="current.status | titlecase"
              ></div>
            </div>
            <div class="provider-details">
              <span class="provider-name">{{ current.name }}</span>
              <span class="provider-vendor">{{ current.vendor }}</span>
            </div>
            } @else {
            <div class="provider-icon">
              <div class="status-indicator unavailable"></div>
            </div>
            <div class="provider-details">
              <span class="provider-name">No Provider</span>
              <span class="provider-vendor">Select a provider</span>
            </div>
            }
          </div>

          <!-- Loading/Error States -->
          @if (loading()) {
          <div class="state-indicator">
            <div class="spinner"></div>
          </div>
          } @else {
          <div class="dropdown-arrow" [class.rotated]="isOpen()">
            <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
              <path
                d="M1 1L6 6L11 1"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
          }
        </div>
      </button>

      <!-- Dropdown Menu -->
      @if (isOpen() && !disabled()) {
      <div class="provider-selector-menu" role="menu">
        <!-- Available Providers -->
        @for (provider of availableProviders(); track provider.id) {
        <button
          type="button"
          class="provider-option"
          [class.selected]="provider.isCurrent"
          [class.healthy]="provider.isHealthy"
          [class.unhealthy]="!provider.isHealthy"
          [class.disabled]="provider.status === 'disabled'"
          [disabled]="provider.status === 'disabled'"
          (click)="selectProvider(provider)"
          role="menuitem"
          [attr.aria-selected]="provider.isCurrent"
        >
          <div class="provider-option-content">
            <div class="provider-info">
              <div class="provider-header">
                <span class="provider-name">{{ provider.name }}</span>
                @if (provider.isCurrent) {
                <span class="current-badge">Current</span>
                }
              </div>
              <div class="provider-meta">
                <span class="provider-vendor">{{ provider.vendor }}</span>
                <span class="provider-status" [class]="provider.status">
                  {{ provider.status | titlecase }}
                </span>
              </div>
              <p class="provider-description">{{ provider.description }}</p>
            </div>

            <div class="provider-status-indicator">
              <div
                class="status-dot"
                [class.healthy]="provider.isHealthy"
                [class.unhealthy]="!provider.isHealthy"
                [class.disabled]="provider.status === 'disabled'"
                [title]="provider.status | titlecase"
              ></div>
            </div>
          </div>
        </button>
        } @empty {
        <div class="no-providers">
          <p>No AI providers available</p>
          <small>Please check your configuration</small>
        </div>
        }
      </div>
      }

      <!-- Backdrop for closing dropdown -->
      @if (isOpen()) {
      <div
        class="dropdown-backdrop"
        role="button"
        tabindex="0"
        (click)="closeDropdown()"
        (keydown.enter)="closeDropdown()"
        (keydown.space)="closeDropdown()"
        aria-label="Close dropdown"
      ></div>
      }
    </div>
  `,
  styles: [
    `
      .provider-selector-container {
        position: relative;
        display: inline-block;
        min-width: 240px;
      }

      .provider-selector-trigger {
        width: 100%;
        padding: 8px 12px;
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        color: var(--vscode-input-foreground);
        cursor: pointer;
        transition: all 0.2s ease;

        &:hover:not(:disabled) {
          background: var(--vscode-inputOption-hoverBackground);
          border-color: var(--vscode-inputOption-activeBorder);
        }

        &.open {
          border-color: var(--vscode-focusBorder);
          box-shadow: 0 0 0 1px var(--vscode-focusBorder);
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }

      .provider-selector-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .current-provider-info {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;
      }

      .provider-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
      }

      .status-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;

        &.healthy {
          background: var(
            --vscode-gitDecoration-addedResourceForeground,
            #4caf50
          );
        }

        &.unhealthy {
          background: var(
            --vscode-gitDecoration-deletedResourceForeground,
            #f44336
          );
        }

        &.unavailable {
          background: var(
            --vscode-gitDecoration-ignoredResourceForeground,
            #9e9e9e
          );
        }
      }

      .provider-details {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        min-width: 0;
        flex: 1;
      }

      .provider-name {
        font-weight: 500;
        font-size: 13px;
        color: var(--vscode-foreground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }

      .provider-vendor {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }

      .state-indicator {
        display: flex;
        align-items: center;
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

      .dropdown-arrow {
        display: flex;
        align-items: center;
        color: var(--vscode-foreground);
        transition: transform 0.2s ease;

        &.rotated {
          transform: rotate(180deg);
        }
      }

      .provider-selector-menu {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        z-index: 1000;
        background: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border);
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        max-height: 300px;
        overflow-y: auto;
        margin-top: 2px;
      }

      .provider-option {
        width: 100%;
        padding: 12px;
        background: transparent;
        border: none;
        text-align: left;
        cursor: pointer;
        transition: background-color 0.2s ease;

        &:hover:not(:disabled) {
          background: var(--vscode-list-hoverBackground);
        }

        &.selected {
          background: var(--vscode-list-activeSelectionBackground);

          &:hover {
            background: var(--vscode-list-activeSelectionBackground);
          }
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }

      .provider-option-content {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }

      .provider-info {
        flex: 1;
        min-width: 0;
      }

      .provider-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 2px;
      }

      .provider-name {
        font-weight: 500;
        color: var(--vscode-foreground);
      }

      .current-badge {
        font-size: 10px;
        padding: 1px 6px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        border-radius: 10px;
        font-weight: 500;
      }

      .provider-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
      }

      .provider-vendor {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      .provider-status {
        font-size: 10px;
        padding: 1px 4px;
        border-radius: 2px;
        font-weight: 500;

        &.available {
          background: rgba(76, 175, 80, 0.1);
          color: var(--vscode-gitDecoration-addedResourceForeground, #4caf50);
        }

        &.error,
        &.unavailable {
          background: rgba(244, 67, 54, 0.1);
          color: var(--vscode-gitDecoration-deletedResourceForeground, #f44336);
        }

        &.initializing {
          background: rgba(255, 193, 7, 0.1);
          color: var(
            --vscode-gitDecoration-modifiedResourceForeground,
            #ffc107
          );
        }
      }

      .provider-description {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin: 0;
        line-height: 1.3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .provider-status-indicator {
        display: flex;
        align-items: center;
        margin-top: 4px;
      }

      .status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;

        &.healthy {
          background: var(
            --vscode-gitDecoration-addedResourceForeground,
            #4caf50
          );
        }

        &.unhealthy {
          background: var(
            --vscode-gitDecoration-deletedResourceForeground,
            #f44336
          );
        }

        &.disabled {
          background: var(
            --vscode-gitDecoration-ignoredResourceForeground,
            #9e9e9e
          );
        }
      }

      .no-providers {
        padding: 16px;
        text-align: center;
        color: var(--vscode-descriptionForeground);

        p {
          margin: 0 0 4px 0;
          font-size: 13px;
        }

        small {
          font-size: 11px;
        }
      }

      .dropdown-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 999;
        background: transparent;
      }
    `,
  ],
})
export class ProviderSelectorDropdownComponent {
  // ANGULAR 20 PATTERN: Input signals
  readonly availableProviders = input.required<ProviderOption[]>();
  readonly currentProvider = input<ProviderOption | null>(null);
  readonly loading = input<boolean>(false);
  readonly disabled = input<boolean>(false);

  // ANGULAR 20 PATTERN: Output signals
  readonly providerSelected = output<string>();
  readonly dropdownOpened = output<void>();
  readonly dropdownClosed = output<void>();

  // ANGULAR 20 PATTERN: Internal signals
  private _isOpen = signal(false);

  // ANGULAR 20 PATTERN: Readonly computed signals
  readonly isOpen = this._isOpen.asReadonly();

  /**
   * Toggle dropdown open/closed
   */
  toggleDropdown(): void {
    if (this.disabled()) return;

    if (this.isOpen()) {
      this.closeDropdown();
    } else {
      this.openDropdown();
    }
  }

  /**
   * Open dropdown
   */
  openDropdown(): void {
    if (this.disabled()) return;

    this._isOpen.set(true);
    this.dropdownOpened.emit();
  }

  /**
   * Close dropdown
   */
  closeDropdown(): void {
    this._isOpen.set(false);
    this.dropdownClosed.emit();
  }

  /**
   * Select a provider
   */
  selectProvider(provider: ProviderOption): void {
    if (provider.status === 'disabled' || provider.isCurrent) {
      return;
    }

    this.providerSelected.emit(provider.id);
    this.closeDropdown();
  }
}
