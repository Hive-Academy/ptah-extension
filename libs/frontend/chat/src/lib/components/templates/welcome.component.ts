import {
  Component,
  inject,
  ChangeDetectionStrategy,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Key,
  Sparkles,
  Zap,
  GitBranch,
  Bot,
  UserPlus,
  Loader2,
  CheckCircle2,
} from 'lucide-angular';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import type {
  LicenseGetStatusResponse,
  LicenseSetKeyResponse,
} from '@ptah-extension/shared';

/**
 * Feature highlight item displayed in the welcome page
 */
interface FeatureHighlight {
  icon: typeof Bot;
  title: string;
  description: string;
}

/**
 * WelcomeComponent - Embedded onboarding page for unlicensed users
 *
 * Complexity Level: 2 (View with RPC and command execution)
 * Pattern: Standalone View (matches setup-wizard, settings)
 *
 * Responsibilities:
 * - Display Ptah branding and value proposition
 * - Show context-aware messaging based on license reason
 * - Provide license key entry action (VS Code command)
 * - Provide pricing/trial actions (external URLs)
 * - Block navigation to other views (no escape hatch - UI design)
 *
 * TASK_2025_126: Replaces VS Code modal for unlicensed users
 */
@Component({
  selector: 'ptah-auth-welcome',
  standalone: true,
  imports: [NgOptimizedImage, FormsModule, LucideAngularModule],
  templateUrl: './welcome.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);

  // Icons
  readonly KeyIcon = Key;
  readonly SparklesIcon = Sparkles;
  readonly ZapIcon = Zap;
  readonly GitBranchIcon = GitBranch;
  readonly BotIcon = Bot;
  readonly UserPlusIcon = UserPlus;
  readonly Loader2Icon = Loader2;
  readonly CheckCircle2Icon = CheckCircle2;

  // State signals
  readonly licenseReason = signal<LicenseGetStatusResponse['reason'] | null>(
    null
  );
  readonly isLoadingStatus = signal(true);
  readonly errorMessage = signal<string | null>(null);

  // Inline license key input state
  readonly showLicenseInput = signal(false);
  readonly licenseKeyInput = signal('');
  readonly isVerifyingKey = signal(false);
  readonly keyError = signal<string | null>(null);
  readonly keySuccess = signal(false);

  // Format validation: ptah_lic_ followed by 64 hex characters
  readonly isKeyFormatValid = computed(() => {
    return /^ptah_lic_[a-f0-9]{64}$/.test(this.licenseKeyInput());
  });

  // Computed signals for derived state (per codebase convention)
  readonly headline = computed(() => {
    const reason = this.licenseReason();
    switch (reason) {
      case 'expired':
        return 'Your subscription has expired';
      case 'trial_ended':
        return 'Your trial has ended';
      default:
        return 'Welcome to Ptah';
    }
  });

  readonly subheadline = computed(() => {
    const reason = this.licenseReason();
    switch (reason) {
      case 'expired':
        return "Renew your subscription to continue using Ptah's premium features.";
      case 'trial_ended':
        return 'Subscribe to Pro for premium features.';
      default:
        return 'Create your account and start a 15-day free trial of premium features. No credit card required.';
    }
  });

  readonly isNewUser = computed(() => {
    const reason = this.licenseReason();
    return !reason || reason === 'no_license';
  });

  // Ptah icon URI from VSCodeService
  readonly ptahIconUri: string;

  // Feature highlights - showcasing Ptah's key capabilities
  readonly features: FeatureHighlight[] = [
    {
      icon: this.BotIcon,
      title: 'AI-Powered Assistance',
      description: 'Get intelligent code suggestions and explanations',
    },
    {
      icon: this.GitBranchIcon,
      title: 'Multi-Agent Orchestration',
      description: 'Coordinate specialized agents for complex tasks',
    },
    {
      icon: this.ZapIcon,
      title: 'VS Code Native Integration',
      description: 'Seamless integration with your development workflow',
    },
    {
      icon: this.SparklesIcon,
      title: 'Session Continuity',
      description: 'Resume conversations and maintain context across sessions',
    },
  ];

  constructor() {
    this.ptahIconUri = this.vscodeService.getPtahIconUri();
  }

  async ngOnInit(): Promise<void> {
    await this.fetchLicenseStatus();
  }

  /**
   * Fetch license status to determine context-aware messaging
   * Pattern: settings.component.ts:140-161
   */
  private async fetchLicenseStatus(): Promise<void> {
    this.isLoadingStatus.set(true);
    this.errorMessage.set(null);

    try {
      const result = await this.rpcService.call('license:getStatus', {});

      if (result.isSuccess() && result.data) {
        const data = result.data as LicenseGetStatusResponse;
        // Extract reason field for context-aware messaging
        // TASK_2025_126: reason field now included in LicenseGetStatusResponse
        this.licenseReason.set(data.reason ?? null);
      }
    } catch (error) {
      console.error(
        '[WelcomeComponent] Failed to fetch license status:',
        error
      );
      this.errorMessage.set('Failed to check license status');
    } finally {
      this.isLoadingStatus.set(false);
    }
  }

  /**
   * Toggle inline license key input visibility
   */
  toggleLicenseInput(): void {
    this.showLicenseInput.update((v) => !v);
    this.keyError.set(null);
    this.keySuccess.set(false);
  }

  /**
   * Submit license key for inline verification via license:setKey RPC
   * Validates format client-side, then calls backend for server verification
   */
  async submitLicenseKey(): Promise<void> {
    const key = this.licenseKeyInput().trim();

    // Client-side format validation
    if (!key) {
      this.keyError.set('Please enter your license key.');
      return;
    }
    if (!/^ptah_lic_[a-f0-9]{64}$/.test(key)) {
      this.keyError.set(
        'Invalid format. License keys start with ptah_lic_ followed by 64 characters.'
      );
      return;
    }

    this.keyError.set(null);
    this.isVerifyingKey.set(true);

    try {
      const result = await this.rpcService.call('license:setKey', {
        licenseKey: key,
      });

      if (result.isSuccess() && result.data) {
        const data = result.data as LicenseSetKeyResponse;
        if (data.success) {
          this.keySuccess.set(true);
          this.keyError.set(null);
          // Window will reload automatically from backend
        } else {
          this.keyError.set(data.error || 'License verification failed.');
        }
      } else {
        this.keyError.set('Failed to verify license key. Please try again.');
      }
    } catch (error) {
      console.error('[WelcomeComponent] Failed to verify license key:', error);
      this.keyError.set('Failed to verify license key. Please try again.');
    } finally {
      this.isVerifyingKey.set(false);
    }
  }

  /**
   * Open pricing page in external browser
   * Uses RPC to execute VS Code command from webview
   * TASK_2025_126: Fixed to use command:execute RPC instead of raw postMessage
   */
  async viewPricing(): Promise<void> {
    try {
      await this.rpcService.call('command:execute', {
        command: 'ptah.openPricing',
      });
    } catch (error) {
      console.error('[WelcomeComponent] Failed to execute openPricing:', error);
      this.errorMessage.set('Failed to open pricing page. Please try again.');
    }
  }

  /**
   * Open signup page in external browser for account creation
   */
  async createAccount(): Promise<void> {
    try {
      await this.rpcService.call('command:execute', {
        command: 'ptah.openSignup',
      });
    } catch (error) {
      console.error('[WelcomeComponent] Failed to open signup:', error);
      this.errorMessage.set('Failed to open signup page. Please try again.');
    }
  }

  /**
   * Retry license status fetch
   * Called from error state retry button
   */
  retryStatus(): void {
    this.fetchLicenseStatus();
  }
}
