import {
  Component,
  inject,
  ChangeDetectionStrategy,
  signal,
  OnInit,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import {
  LucideAngularModule,
  Key,
  ExternalLink,
  Sparkles,
  Zap,
  GitBranch,
  Bot,
} from 'lucide-angular';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import type { LicenseGetStatusResponse } from '@ptah-extension/shared';

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
  selector: 'ptah-welcome',
  standalone: true,
  imports: [NgOptimizedImage, LucideAngularModule],
  templateUrl: './welcome.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);

  // Icons
  readonly KeyIcon = Key;
  readonly ExternalLinkIcon = ExternalLink;
  readonly SparklesIcon = Sparkles;
  readonly ZapIcon = Zap;
  readonly GitBranchIcon = GitBranch;
  readonly BotIcon = Bot;

  // State signals
  readonly licenseReason = signal<string | null>(null);
  readonly isLoadingStatus = signal(true);
  readonly errorMessage = signal<string | null>(null);

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
   * Get contextual headline based on license reason
   */
  getHeadline(): string {
    const reason = this.licenseReason();
    switch (reason) {
      case 'expired':
        return 'Your subscription has expired';
      case 'trial_ended':
        return 'Your trial has ended';
      default:
        return 'Welcome to Ptah';
    }
  }

  /**
   * Get contextual subheadline based on license reason
   * TASK_2025_128: Updated messaging to mention Community (free) as fallback option
   */
  getSubheadline(): string {
    const reason = this.licenseReason();
    switch (reason) {
      case 'expired':
        return "Renew your subscription to continue using Ptah's premium features, or downgrade to Community (free).";
      case 'trial_ended':
        return 'Subscribe to Pro for premium features, or continue with Community (free).';
      default:
        return 'Transform your Claude Code experience with a native VS Code interface.';
    }
  }

  /**
   * Trigger license key entry via VS Code command
   * Uses RPC to execute VS Code command from webview
   * TASK_2025_126: Fixed to use command:execute RPC instead of raw postMessage
   */
  async enterLicenseKey(): Promise<void> {
    try {
      await this.rpcService.call('command:execute', {
        command: 'ptah.enterLicenseKey',
      });
    } catch (error) {
      console.error(
        '[WelcomeComponent] Failed to execute enterLicenseKey:',
        error
      );
      this.errorMessage.set(
        'Failed to open license key input. Please try again.'
      );
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
   * Start trial (opens pricing page)
   * Trial registration flows through the pricing page
   */
  startTrial(): void {
    this.viewPricing();
  }

  /**
   * Retry license status fetch
   * Called from error state retry button
   */
  retryStatus(): void {
    this.fetchLicenseStatus();
  }
}
