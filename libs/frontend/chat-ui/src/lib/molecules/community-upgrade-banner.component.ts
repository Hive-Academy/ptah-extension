import {
  Component,
  input,
  signal,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, Sparkles, X, ArrowRight } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';

/**
 * CommunityUpgradeBannerComponent - Banner for users downgraded to Community
 *
 * TASK_2025_143: Shows when user's trial ended and they're on Community plan
 *
 * Displays:
 * - Message that trial has ended and user is on Community
 * - Upgrade to Pro CTA button
 * - Dismissible per session
 *
 * Shown when: isCommunity === true && reason === 'trial_ended'
 *
 * Complexity Level: 1 (Simple molecule with conditional display)
 *
 * SOLID Principles:
 * - Single Responsibility: Display upgrade prompt for downgraded users only
 * - Composition Over Inheritance: Uses signal inputs for data
 */
@Component({
  selector: 'ptah-community-upgrade-banner',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shouldShow()) {
      <div
        class="bg-gradient-to-r from-primary/10 via-secondary/10 to-primary/10
             border border-primary/20 rounded-lg p-4 mb-3"
      >
        <div class="flex items-start justify-between gap-3">
          <!-- Main content -->
          <div class="flex items-start gap-3 flex-1">
            <div
              class="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0"
            >
              <lucide-angular
                [img]="SparklesIcon"
                class="w-5 h-5 text-primary"
                aria-hidden="true"
              />
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-sm text-base-content mb-1">
                Your Pro Trial Has Ended
              </h3>
              <p class="text-xs text-base-content/70 mb-3">
                You're now on the Community plan with limited features. Upgrade
                to Pro to unlock advanced AI capabilities, multi-agent
                orchestration, and priority support.
              </p>
              <button
                class="btn btn-primary btn-sm gap-1.5"
                (click)="openPricing()"
                type="button"
              >
                <lucide-angular
                  [img]="SparklesIcon"
                  class="w-3.5 h-3.5"
                  aria-hidden="true"
                />
                Upgrade to Pro
                <lucide-angular
                  [img]="ArrowRightIcon"
                  class="w-3.5 h-3.5"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>

          <!-- Dismiss button -->
          <button
            class="btn btn-ghost btn-xs btn-circle flex-shrink-0"
            (click)="dismiss()"
            aria-label="Dismiss banner"
            type="button"
          >
            <lucide-angular
              [img]="XIcon"
              class="w-3.5 h-3.5"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    }
  `,
})
export class CommunityUpgradeBannerComponent {
  // Inputs from parent
  readonly isCommunity = input<boolean>(false);
  readonly reason = input<string | undefined>(undefined);

  // Internal state
  private readonly dismissed = signal(false);

  // Icons
  protected readonly SparklesIcon = Sparkles;
  protected readonly XIcon = X;
  protected readonly ArrowRightIcon = ArrowRight;

  // Session storage key
  private readonly DISMISS_KEY = 'ptah_community_upgrade_banner_dismissed';

  // RPC service for opening pricing
  private readonly rpcService = inject(ClaudeRpcService);

  constructor() {
    // Check if dismissed this session
    if (typeof sessionStorage !== 'undefined') {
      this.dismissed.set(sessionStorage.getItem(this.DISMISS_KEY) === 'true');
    }
  }

  /**
   * Computed: Should the banner be displayed?
   * Shows when user is on Community plan due to trial ending and not dismissed
   */
  shouldShow(): boolean {
    return (
      this.isCommunity() && this.reason() === 'trial_ended' && !this.dismissed()
    );
  }

  /**
   * Open pricing page via RPC command
   */
  async openPricing(): Promise<void> {
    await this.rpcService.call('command:execute', {
      command: 'ptah.openPricing',
    });
  }

  /**
   * Dismiss banner for this session
   */
  dismiss(): void {
    this.dismissed.set(true);
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(this.DISMISS_KEY, 'true');
    }
  }
}
