import {
  Component,
  inject,
  ChangeDetectionStrategy,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import {
  LucideAngularModule,
  ArrowLeft,
  Sparkles,
  Lock,
  Shield,
  Clock,
  CreditCard,
  UserPlus,
  Key,
  ExternalLink,
  Wand2,
} from 'lucide-angular';
import { AuthConfigComponent } from './auth-config.component';
import { ProviderModelSelectorComponent } from './provider-model-selector.component';
import { PromptPowerUpsComponent } from './prompt-power-ups/prompt-power-ups.component';
import { CustomPromptEditorComponent } from './custom-prompt-editor/custom-prompt-editor.component';
import { PromptPreviewComponent } from './prompt-preview/prompt-preview.component';
import {
  AppStateManager,
  ClaudeRpcService,
  AuthStateService,
} from '@ptah-extension/core';
import type {
  LicenseGetStatusResponse,
  UserPromptSectionInfo,
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
    ProviderModelSelectorComponent,
    PromptPowerUpsComponent,
    CustomPromptEditorComponent,
    PromptPreviewComponent,
    LucideAngularModule,
  ],
  templateUrl: './settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit {
  private readonly appState = inject(AppStateManager);
  private readonly rpcService = inject(ClaudeRpcService);

  // TASK_2025_133 Batch 2: Centralized auth state from AuthStateService
  readonly authState = inject(AuthStateService);

  // Lucide icons
  readonly ArrowLeftIcon = ArrowLeft;
  readonly SparklesIcon = Sparkles;
  readonly LockIcon = Lock;
  readonly ShieldIcon = Shield;
  readonly ClockIcon = Clock;
  readonly CreditCardIcon = CreditCard;
  readonly UserPlusIcon = UserPlus;
  readonly KeyIcon = Key;
  readonly ExternalLinkIcon = ExternalLink;
  readonly Wand2Icon = Wand2;

  // TASK_2025_135: Custom prompt sections state for CustomPromptEditorComponent
  readonly customSections = signal<UserPromptSectionInfo[]>([]);

  // License status signals
  readonly isPremium = signal(false);
  readonly licenseTier = signal<'community' | 'pro' | 'trial_pro' | 'expired'>(
    'expired'
  );
  readonly isLoadingLicenseStatus = signal(true);

  // License status card signals
  readonly licenseValid = signal(false);
  readonly trialActive = signal(false);
  readonly trialDaysRemaining = signal<number | null>(null);
  readonly daysRemaining = signal<number | null>(null);
  readonly planName = signal<string | null>(null);
  readonly planDescription = signal<string | null>(null);
  readonly isCommunity = signal(false);

  // User profile signals (TASK_2025_129)
  readonly userEmail = signal<string | null>(null);
  readonly userFirstName = signal<string | null>(null);
  readonly userLastName = signal<string | null>(null);

  /**
   * Computed: Whether any auth credential is configured
   * Delegates to AuthStateService (TASK_2025_133)
   */
  readonly hasAnyCredential = this.authState.hasAnyCredential;

  /**
   * Computed: Whether provider model mapping section should be shown
   * Delegates to AuthStateService which checks authMethod + hasProviderKey (TASK_2025_133)
   */
  readonly showProviderModels = this.authState.showProviderModels;

  /**
   * Computed: Whether the user is fully authenticated (has credential + not loading)
   */
  readonly isAuthenticated = computed(
    () => !this.authState.isLoading() && this.authState.hasAnyCredential()
  );

  /**
   * Computed: Whether to show premium-only sections
   * Requires: authenticated + premium license
   */
  readonly showPremiumSections = computed(
    () => this.isAuthenticated() && this.isPremium()
  );

  /**
   * Computed: Display name for the current tier
   */
  readonly tierDisplayName = computed(() => {
    switch (this.licenseTier()) {
      case 'pro':
        return 'Pro';
      case 'trial_pro':
        return 'Pro Trial';
      case 'community':
        return 'Community';
      case 'expired':
        return 'Expired';
      default:
        return 'Unknown';
    }
  });

  /**
   * Computed: Whether to show trial info section
   */
  readonly showTrialInfo = computed(
    () => this.trialActive() && this.trialDaysRemaining() !== null
  );

  /**
   * Computed: User display name (first + last name, or email fallback)
   * TASK_2025_129
   */
  readonly userDisplayName = computed(() => {
    const first = this.userFirstName();
    const last = this.userLastName();
    if (first || last) {
      return [first, last].filter(Boolean).join(' ');
    }
    return this.userEmail();
  });

  /**
   * Computed: Whether to show user display name separately from email (TASK_2025_129)
   */
  readonly showUserName = computed(() => {
    const name = this.userDisplayName();
    return !!name && name !== this.userEmail();
  });

  /**
   * Computed: User initials for avatar (e.g., "JD" for John Doe)
   * (TASK_2025_129)
   */
  readonly userInitials = computed(() => {
    const first = this.userFirstName();
    const last = this.userLastName();
    if (first && last) {
      return `${first[0]}${last[0]}`.toUpperCase();
    }
    if (first) {
      return first[0].toUpperCase();
    }
    if (last) {
      return last[0].toUpperCase();
    }
    const email = this.userEmail();
    if (email && email.length > 0) {
      return email[0].toUpperCase();
    }
    return '?';
  });

  /**
   * Initialize: Load auth and license status on component mount
   * TASK_2025_133: Auth status now loaded via AuthStateService
   */
  async ngOnInit(): Promise<void> {
    await Promise.all([
      this.authState.loadAuthStatus(),
      this.fetchLicenseStatus(),
    ]);
  }

  /**
   * Navigate back to chat view
   */
  backToChat(): void {
    this.appState.setCurrentView('chat');
  }

  /**
   * Open signup page in browser
   */
  async openSignup(): Promise<void> {
    await this.rpcService.call('command:execute', {
      command: 'ptah.openSignup',
    });
  }

  /**
   * Open license key entry dialog
   */
  async enterLicenseKey(): Promise<void> {
    await this.rpcService.call('command:execute', {
      command: 'ptah.enterLicenseKey',
    });
  }

  /**
   * Open pricing page in browser
   */
  async openPricing(): Promise<void> {
    await this.rpcService.call('command:execute', {
      command: 'ptah.openPricing',
    });
  }

  /**
   * TASK_2025_135: Handle custom sections change from CustomPromptEditorComponent
   * Save updated sections via RPC
   */
  async onCustomSectionsChange(
    sections: UserPromptSectionInfo[]
  ): Promise<void> {
    this.customSections.set(sections);
    try {
      await this.rpcService.call('promptHarness:saveConfig', {
        customSections: sections,
      });
    } catch (error) {
      console.error(
        '[SettingsComponent] Failed to save custom sections:',
        error
      );
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
        this.licenseValid.set(data.valid);
        this.trialActive.set(data.trialActive);
        this.trialDaysRemaining.set(data.trialDaysRemaining);
        this.daysRemaining.set(data.daysRemaining);
        this.isCommunity.set(data.isCommunity);
        this.planName.set(data.plan?.name ?? null);
        this.planDescription.set(data.plan?.description ?? null);
        // TASK_2025_129: User profile data
        this.userEmail.set(data.user?.email ?? null);
        this.userFirstName.set(data.user?.firstName ?? null);
        this.userLastName.set(data.user?.lastName ?? null);
      }
    } catch (error) {
      console.error(
        '[SettingsComponent] Failed to fetch license status:',
        error
      );
      // Graceful degradation: assume expired (no access without valid license)
      this.isPremium.set(false);
      this.licenseTier.set('expired');
      // TASK_2025_129: Reset user signals to prevent stale profile display
      this.userEmail.set(null);
      this.userFirstName.set(null);
      this.userLastName.set(null);
    } finally {
      this.isLoadingLicenseStatus.set(false);
    }
  }
}
