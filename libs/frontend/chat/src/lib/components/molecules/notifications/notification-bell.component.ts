import {
  Component,
  input,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { LucideAngularModule, Bell, Clock, X, Sparkles } from 'lucide-angular';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { ClaudeRpcService } from '@ptah-extension/core';

/**
 * NotificationBellComponent - Header notification icon with dropdown
 *
 * Replaces the inline trial/community banners in the chat view.
 * Shows a bell icon in the header with a colored dot indicator when
 * there are active notifications (trial countdown, community upgrade).
 *
 * Clicking the bell opens a dropdown with notification items.
 *
 * Complexity Level: 2 (Molecule with popover and conditional content)
 */
@Component({
  selector: 'ptah-notification-bell',
  standalone: true,
  imports: [LucideAngularModule, NativePopoverComponent, NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-popover
      [isOpen]="isOpen()"
      [placement]="'bottom-end'"
      [hasBackdrop]="true"
      [backdropClass]="'transparent'"
      (closed)="close()"
    >
      <!-- Trigger: Bell icon button -->
      <button
        trigger
        type="button"
        class="btn btn-square btn-ghost btn-sm relative"
        aria-label="Notifications"
        title="Notifications"
        (click)="toggle()"
      >
        <lucide-angular [img]="BellIcon" class="w-4 h-4" aria-hidden="true" />

        @if (hasNotifications()) {
        <span
          class="absolute top-1 right-1 w-2 h-2 rounded-full"
          [class.bg-info]="dotColor() === 'info'"
          [class.bg-warning]="dotColor() === 'warning'"
          [class.bg-error]="dotColor() === 'error'"
          aria-hidden="true"
        ></span>
        }
      </button>

      <!-- Dropdown content -->
      <div content class="w-72 max-h-80 overflow-y-auto">
        <div class="px-3 py-2 border-b border-base-content/10">
          <span
            class="text-xs font-semibold text-base-content/70 uppercase tracking-wider"
          >
            Notifications
          </span>
        </div>

        <div class="py-1">
          @if (showTrialNotification()) {
          <div
            class="w-full text-left px-3 py-2.5 hover:bg-base-300 transition-colors duration-150 flex items-start gap-2.5 cursor-pointer"
            role="button"
            tabindex="0"
            (click)="openPricing()"
            (keydown.enter)="openPricing()"
          >
            <div
              class="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
              [ngClass]="trialIconBgClass()"
            >
              <lucide-angular
                [img]="ClockIcon"
                class="w-3.5 h-3.5"
                [class.text-info]="urgencyLevel() === 'info'"
                [class.text-warning]="urgencyLevel() === 'warning'"
                [class.text-error]="urgencyLevel() === 'error'"
                aria-hidden="true"
              />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-base-content leading-snug">
                {{ trialBannerText() }}
              </p>
              <p class="text-xs text-base-content/50 mt-0.5">
                Click to view plans
              </p>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-circle flex-shrink-0 mt-0.5"
              (click)="dismissTrial($event)"
              aria-label="Dismiss"
            >
              <lucide-angular
                [img]="XIcon"
                class="w-3 h-3"
                aria-hidden="true"
              />
            </button>
          </div>
          } @if (showCommunityNotification()) {
          <div
            class="w-full text-left px-3 py-2.5 hover:bg-base-300 transition-colors duration-150 flex items-start gap-2.5 cursor-pointer"
            role="button"
            tabindex="0"
            (click)="openPricing()"
            (keydown.enter)="openPricing()"
          >
            <div
              class="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5"
            >
              <lucide-angular
                [img]="SparklesIcon"
                class="w-3.5 h-3.5 text-primary"
                aria-hidden="true"
              />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-base-content leading-snug">
                Your Pro Trial Has Ended
              </p>
              <p class="text-xs text-base-content/50 mt-0.5">
                Upgrade to Pro for full access
              </p>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-circle flex-shrink-0 mt-0.5"
              (click)="dismissCommunity($event)"
              aria-label="Dismiss"
            >
              <lucide-angular
                [img]="XIcon"
                class="w-3 h-3"
                aria-hidden="true"
              />
            </button>
          </div>
          } @if (!hasNotifications()) {
          <div class="px-3 py-6 text-center">
            <lucide-angular
              [img]="BellIcon"
              class="w-6 h-6 text-base-content/20 mx-auto mb-2"
              aria-hidden="true"
            />
            <p class="text-xs text-base-content/40">No notifications</p>
          </div>
          }
        </div>
      </div>
    </ptah-native-popover>
  `,
})
export class NotificationBellComponent {
  // License inputs
  readonly trialActive = input<boolean>(false);
  readonly trialDaysRemaining = input<number | null>(null);
  readonly isCommunity = input<boolean>(false);
  readonly reason = input<string | undefined>(undefined);

  // Popover state
  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  // Dismissed state (session-scoped)
  private readonly trialDismissed = signal(false);
  private readonly communityDismissed = signal(false);

  // Icons
  protected readonly BellIcon = Bell;
  protected readonly ClockIcon = Clock;
  protected readonly XIcon = X;
  protected readonly SparklesIcon = Sparkles;

  // Session storage keys
  private readonly TRIAL_DISMISS_KEY = 'ptah_trial_banner_dismissed';
  private readonly COMMUNITY_DISMISS_KEY =
    'ptah_community_upgrade_banner_dismissed';

  private readonly rpcService = inject(ClaudeRpcService);

  constructor() {
    if (typeof sessionStorage !== 'undefined') {
      this.trialDismissed.set(
        sessionStorage.getItem(this.TRIAL_DISMISS_KEY) === 'true'
      );
      this.communityDismissed.set(
        sessionStorage.getItem(this.COMMUNITY_DISMISS_KEY) === 'true'
      );
    }
  }

  /** Whether to show the trial countdown notification */
  readonly showTrialNotification = computed(() => {
    const days = this.trialDaysRemaining();
    return (
      this.trialActive() && days !== null && days >= 0 && !this.trialDismissed()
    );
  });

  /** Whether to show the community upgrade notification */
  readonly showCommunityNotification = computed(() => {
    return (
      this.isCommunity() &&
      this.reason() === 'trial_ended' &&
      !this.communityDismissed()
    );
  });

  /** Whether there are any active notifications */
  readonly hasNotifications = computed(
    () => this.showTrialNotification() || this.showCommunityNotification()
  );

  /** Urgency level for trial notification styling */
  readonly urgencyLevel = computed((): 'info' | 'warning' | 'error' => {
    const days = this.trialDaysRemaining();
    if (days === null) return 'info';
    if (days <= 1) return 'error';
    if (days <= 3) return 'warning';
    return 'info';
  });

  /** CSS class for trial notification icon background (ngClass for Tailwind `/` syntax) */
  readonly trialIconBgClass = computed(() => {
    const level = this.urgencyLevel();
    if (level === 'error') return 'bg-error/20';
    if (level === 'warning') return 'bg-warning/20';
    return 'bg-info/20';
  });

  /** Dot color - highest urgency wins */
  readonly dotColor = computed((): 'info' | 'warning' | 'error' => {
    if (this.showCommunityNotification()) return 'warning';
    return this.urgencyLevel();
  });

  /** Trial banner text */
  readonly trialBannerText = computed(() => {
    const days = this.trialDaysRemaining();
    if (days === null) return '';
    if (days === 0) return 'Trial expires today';
    if (days === 1) return 'Trial expires tomorrow';
    return `${days} days left in your Pro trial`;
  });

  toggle(): void {
    this._isOpen.update((v) => !v);
  }

  close(): void {
    this._isOpen.set(false);
  }

  async openPricing(): Promise<void> {
    this.close();
    await this.rpcService.call('command:execute', {
      command: 'ptah.openPricing',
    });
  }

  dismissTrial(event: Event): void {
    event.stopPropagation();
    this.trialDismissed.set(true);
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(this.TRIAL_DISMISS_KEY, 'true');
    }
  }

  dismissCommunity(event: Event): void {
    event.stopPropagation();
    this.communityDismissed.set(true);
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(this.COMMUNITY_DISMISS_KEY, 'true');
    }
  }
}
