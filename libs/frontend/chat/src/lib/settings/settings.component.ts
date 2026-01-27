import {
  Component,
  inject,
  ChangeDetectionStrategy,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { LucideAngularModule, ArrowLeft, Sparkles, Lock } from 'lucide-angular';
import { AuthConfigComponent } from './auth-config.component';
import { OpenRouterModelSelectorComponent } from './openrouter-model-selector.component';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import type {
  AuthGetAuthStatusResponse,
  LicenseGetStatusResponse,
} from '@ptah-extension/shared';

/**
 * SettingsComponent - Main settings page container
 *
 * Complexity Level: 2 (Container with visibility logic based on auth and license status)
 * Patterns: Signal-based navigation, conditional rendering
 *
 * Responsibilities:
 * - Display settings page header with back navigation
 * - Container for settings sections (authentication, model selection, autopilot)
 * - Navigate back to chat view on back button click
 * - Conditional visibility: Show additional sections only after auth configured
 * - Premium gating: Show MCP port and LLM settings only for premium users
 *
 * SOLID Principles:
 * - Single Responsibility: Settings page layout and navigation
 * - Composition: Uses AuthConfigComponent for authentication section
 *
 * TASK_2025_079: Added auth status and license status for conditional visibility
 */
@Component({
  selector: 'ptah-settings',
  standalone: true,
  imports: [
    AuthConfigComponent,
    OpenRouterModelSelectorComponent,
    LucideAngularModule,
  ],
  templateUrl: './settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit {
  private readonly appState = inject(AppStateManager);
  private readonly rpcService = inject(ClaudeRpcService);

  // Lucide icons
  readonly ArrowLeftIcon = ArrowLeft;
  readonly SparklesIcon = Sparkles;
  readonly LockIcon = Lock;

  // Auth status signals
  readonly hasOAuthToken = signal(false);
  readonly hasApiKey = signal(false);
  // TASK_2025_091: OpenRouter key status
  readonly hasOpenRouterKey = signal(false);
  readonly isLoadingAuthStatus = signal(true);

  // License status signals
  readonly isPremium = signal(false);
  readonly licenseTier = signal<
    'basic' | 'pro' | 'trial_basic' | 'trial_pro' | 'expired'
  >('expired');
  readonly isLoadingLicenseStatus = signal(true);

  /**
   * Computed: Whether any auth credential is configured
   * Shows additional settings sections when true
   */
  readonly hasAnyCredential = computed(
    () => this.hasOAuthToken() || this.hasApiKey() || this.hasOpenRouterKey()
  );

  /**
   * Computed: Whether the user is fully authenticated (has credential + not loading)
   */
  readonly isAuthenticated = computed(
    () => !this.isLoadingAuthStatus() && this.hasAnyCredential()
  );

  /**
   * Computed: Whether to show premium-only sections
   * Requires: authenticated + premium license
   */
  readonly showPremiumSections = computed(
    () => this.isAuthenticated() && this.isPremium()
  );

  /**
   * Initialize: Fetch auth and license status on component mount
   */
  async ngOnInit(): Promise<void> {
    await Promise.all([this.fetchAuthStatus(), this.fetchLicenseStatus()]);
  }

  /**
   * Navigate back to chat view
   */
  backToChat(): void {
    this.appState.setCurrentView('chat');
  }

  /**
   * Refresh auth status (called by child components after credential changes)
   */
  async refreshAuthStatus(): Promise<void> {
    await this.fetchAuthStatus();
  }

  /**
   * Fetch auth status from backend
   */
  private async fetchAuthStatus(): Promise<void> {
    this.isLoadingAuthStatus.set(true);
    try {
      const result = await this.rpcService.call('auth:getAuthStatus', {});

      if (result.isSuccess() && result.data) {
        const data = result.data as AuthGetAuthStatusResponse;
        this.hasOAuthToken.set(data.hasOAuthToken);
        this.hasApiKey.set(data.hasApiKey);
        // TASK_2025_091: OpenRouter status
        this.hasOpenRouterKey.set(data.hasOpenRouterKey);
      }
    } catch (error) {
      console.error('[SettingsComponent] Failed to fetch auth status:', error);
    } finally {
      this.isLoadingAuthStatus.set(false);
    }
  }

  /**
   * Fetch license status from backend
   */
  private async fetchLicenseStatus(): Promise<void> {
    this.isLoadingLicenseStatus.set(true);
    try {
      const result = await this.rpcService.call('license:getStatus', {});

      if (result.isSuccess() && result.data) {
        const data = result.data as LicenseGetStatusResponse;
        this.isPremium.set(data.isPremium);
        this.licenseTier.set(data.tier);
      }
    } catch (error) {
      console.error(
        '[SettingsComponent] Failed to fetch license status:',
        error
      );
      // Graceful degradation: assume expired (no access without valid license)
      this.isPremium.set(false);
      this.licenseTier.set('expired');
    } finally {
      this.isLoadingLicenseStatus.set(false);
    }
  }
}
