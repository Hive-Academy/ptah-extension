import {
  Component,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProviderService, AppStateManager } from '@ptah-extension/core';
import { ProviderCardComponent } from '../provider-card/provider-card.component';

/**
 * Settings View Component - Provider Configuration UI
 *
 * Complexity Level: 2 (Medium)
 * Signals:
 * - Multiple provider states displayed
 * - User interactions for switching providers
 * - Composition of ProviderCard components
 *
 * Patterns Applied:
 * - Standalone component (Angular 20+)
 * - Signal-based state (inject() pattern)
 * - OnPush change detection for performance
 * - Modern control flow (@if, @for)
 * - Composition (ProviderCard sub-components)
 *
 * SOLID Compliance:
 * - Single Responsibility: Display and manage provider settings
 * - Dependency Inversion: Depends on ProviderService abstraction
 */
@Component({
  selector: 'ptah-settings-view',
  standalone: true,
  imports: [CommonModule, ProviderCardComponent],
  templateUrl: './settings-view.component.html',
  styleUrls: ['./settings-view.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsViewComponent {
  // inject() pattern (Angular 20+)
  private readonly providerService = inject(ProviderService);
  private readonly appState = inject(AppStateManager);

  // Expose provider service signals to template
  readonly availableProviders = this.providerService.availableProviders;
  readonly currentProvider = this.providerService.currentProvider;
  readonly isLoading = this.providerService.isLoading;
  readonly providerHealth = this.providerService.providerHealth;

  // Computed: Check if providers are available
  readonly hasProviders = computed(() => this.availableProviders().length > 0);

  constructor() {
    // Debug logging to see what's happening
    console.log('[SettingsViewComponent] Initializing...');
    console.log(
      '[SettingsViewComponent] Initial providers:',
      this.availableProviders()
    );
    console.log(
      '[SettingsViewComponent] Current provider:',
      this.currentProvider()
    );
    console.log('[SettingsViewComponent] Is loading:', this.isLoading());

    // CRITICAL: Request fresh provider data when component loads
    // The providers:availableUpdated event only sends minimal data (id, name, status)
    // We need to fetch full ProviderInfo objects with all details
    console.log('[SettingsViewComponent] Requesting full provider data...');
    this.providerService.refreshProviders();
  }

  // Computed: Get health for a specific provider
  getProviderHealth(providerId: string) {
    return computed(() => this.providerHealth()[providerId]);
  }

  /**
   * Navigate back to chat view
   */
  navigateToChat(): void {
    console.log('Navigating back to chat view');
    this.appState.setCurrentView('chat');
  }

  /**
   * Refresh providers list
   */
  refreshProviders(): void {
    console.log('[SettingsViewComponent] Refreshing providers...');
    this.providerService.refreshProviders();
  }

  /**
   * Handle provider switch action
   */
  onSwitchProvider(providerId: string): void {
    console.log('Switching to provider:', providerId);
    this.providerService.switchProvider(providerId);
  }

  /**
   * Handle set default provider action
   */
  onSetDefaultProvider(providerId: string): void {
    console.log('Setting default provider:', providerId);
    this.providerService.setDefaultProvider(providerId);
  }

  /**
   * Check if provider is current
   */
  isCurrentProvider(providerId: string): boolean {
    return this.currentProvider()?.id === providerId;
  }
}
