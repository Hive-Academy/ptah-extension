import {
  Component,
  input,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, Clock, X } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';

/**
 * TrialBannerComponent - Trial countdown banner for chat view
 *
 * TASK_2025_142: Requirement 1
 *
 * Displays trial days remaining with urgency-based styling:
 * - Info (> 3 days): Informational countdown
 * - Warning (3 days or less): Urgency indicator
 * - Error (1 day or less): Critical urgency
 *
 * Behavior:
 * - Dismissible per session (sessionStorage)
 * - Click banner opens pricing page
 * - Only shows when trialActive && trialDaysRemaining >= 0 && not dismissed
 *
 * Complexity Level: 1 (Simple molecule with conditional styling)
 *
 * SOLID Principles:
 * - Single Responsibility: Display trial countdown notification only
 * - Composition Over Inheritance: Uses signal inputs for data
 */
@Component({
  selector: 'ptah-trial-banner',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shouldShow()) {
      <div
        class="alert shadow-sm mb-2 py-2 px-3 cursor-pointer"
        [class.alert-info]="urgencyLevel() === 'info'"
        [class.alert-warning]="urgencyLevel() === 'warning'"
        [class.alert-error]="urgencyLevel() === 'error'"
        (click)="openPricing()"
        (keydown.enter)="openPricing()"
        role="button"
        tabindex="0"
        aria-label="Trial banner - click to view pricing"
      >
        <div class="flex items-center justify-between w-full gap-2">
          <div class="flex items-center gap-2">
            <lucide-angular
              [img]="ClockIcon"
              class="w-4 h-4 flex-shrink-0"
              aria-hidden="true"
            />
            <span class="text-sm font-medium">
              {{ bannerText() }}
            </span>
          </div>
          <button
            class="btn btn-ghost btn-xs"
            (click)="dismiss($event)"
            aria-label="Dismiss trial banner"
            type="button"
          >
            <lucide-angular [img]="XIcon" class="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
      </div>
    }
  `,
})
export class TrialBannerComponent {
  // Inputs from parent (chat-view)
  readonly trialActive = input<boolean>(false);
  readonly trialDaysRemaining = input<number | null>(null);

  // Internal state
  private readonly dismissed = signal(false);

  // Icons
  protected readonly ClockIcon = Clock;
  protected readonly XIcon = X;

  // Session storage key
  private readonly DISMISS_KEY = 'ptah_trial_banner_dismissed';

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
   * Shows when trial is active, days remaining >= 0, and not dismissed
   */
  readonly shouldShow = computed(() => {
    const days = this.trialDaysRemaining();
    return (
      this.trialActive() && days !== null && days >= 0 && !this.dismissed()
    );
  });

  /**
   * Computed: Urgency level for styling
   * - error: 1 day or less (including 0)
   * - warning: 3 days or less
   * - info: more than 3 days
   */
  readonly urgencyLevel = computed((): 'info' | 'warning' | 'error' => {
    const days = this.trialDaysRemaining();
    if (days === null) return 'info';
    if (days <= 1) return 'error';
    if (days <= 3) return 'warning';
    return 'info';
  });

  /**
   * Computed: Banner text based on days remaining
   */
  readonly bannerText = computed(() => {
    const days = this.trialDaysRemaining();
    if (days === null) return '';
    if (days === 0) return 'Trial expires today - Upgrade now';
    if (days === 1) return 'Trial expires tomorrow - Upgrade now';
    return `${days} days remaining in your Pro trial`;
  });

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
   * @param event - Click event (stopPropagation to prevent openPricing)
   */
  dismiss(event: Event): void {
    event.stopPropagation();
    this.dismissed.set(true);
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(this.DISMISS_KEY, 'true');
    }
  }
}
