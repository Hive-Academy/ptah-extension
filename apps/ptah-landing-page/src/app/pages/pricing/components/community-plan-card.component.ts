import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
} from '@angular/core';
import { NgClass } from '@angular/common';
import {
  LucideAngularModule,
  Check,
  Download,
  Crown,
  Clock,
  Sparkles,
} from 'lucide-angular';
import {
  PricingPlan,
  PlanSubscriptionContext,
} from '../models/pricing-plan.interface';

/**
 * CommunityPlanCardComponent - Free tier display card
 *
 * TASK_2025_128: Freemium model conversion
 *
 * This component displays the Community (free) tier:
 * - No pricing or checkout (it's free forever)
 * - CTA: "Install Free" -> Opens VS Code marketplace
 * - Shows "Current Plan" badge for authenticated Community users
 * - Shows "Included in Pro" badge for Pro users
 *
 * Key differences from Pro plan card:
 * - No Paddle checkout integration
 * - No billing period toggle (always free)
 * - No trial period (free forever)
 * - CTA opens VS Code marketplace instead of checkout
 */
@Component({
  selector: 'ptah-community-plan-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, LucideAngularModule],
  template: `
    <div
      class="relative rounded-2xl p-6 lg:p-8 h-full flex flex-col
             bg-base-200/40 border transition-all duration-500 group"
      [ngClass]="cardBorderClass()"
    >
      <!-- Badge -->
      <div aria-live="polite" aria-atomic="true">
        @if (isCurrentPlan()) {
        <div
          class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                   bg-success rounded-full
                   text-xs font-bold text-success-content uppercase tracking-wider
                   shadow-lg shadow-success/30 flex items-center gap-1.5"
        >
          <lucide-angular
            [img]="CrownIcon"
            class="w-3 h-3"
            aria-hidden="true"
          />
          Current Plan
        </div>
        } @else if (isProUser()) {
        <div
          class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                   bg-base-300 rounded-full
                   text-xs font-bold text-base-content/60 uppercase tracking-wider"
        >
          Included in Pro
        </div>
        } @else {
        <div
          class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                   bg-gradient-to-r from-green-500 to-emerald-500 rounded-full
                   text-xs font-bold text-white uppercase tracking-wider
                   shadow-lg shadow-green-500/30"
        >
          Free Forever
        </div>
        }
      </div>

      <!-- Trial Ended Alert (TASK_2025_143) -->
      @if (isTrialEnded()) {
      <div
        class="mt-4 p-3 rounded-lg bg-warning/10 border border-warning/30"
        role="alert"
      >
        <div class="flex items-start gap-2">
          <lucide-angular
            [img]="ClockIcon"
            class="w-4 h-4 text-warning flex-shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <div class="flex-1">
            <p class="text-sm font-medium text-warning">
              Your Pro Trial Has Ended
            </p>
            <p class="text-xs text-base-content/70 mt-1">
              You're now on the Community plan. Upgrade to Pro to unlock
              advanced features like MCP servers and workspace intelligence.
            </p>
          </div>
        </div>
      </div>
      }

      <!-- Plan Header -->
      <div class="mb-4 mt-2">
        <h3
          class="font-display text-xl lg:text-2xl font-semibold text-base-content tracking-wide uppercase mb-1"
        >
          {{ plan().name }}
        </h3>
        <p class="text-sm text-base-content/50">{{ plan().idealFor }}</p>
      </div>

      <!-- Price Section -->
      <div class="mb-6">
        <div class="flex items-baseline gap-2">
          <span class="text-5xl lg:text-6xl font-bold text-base-content">
            {{ plan().price }}
          </span>
          <span class="text-base-content/50 text-sm">
            / {{ plan().priceSubtext }}
          </span>
        </div>
      </div>

      <!-- Divider -->
      <div class="h-px bg-base-content/10 mb-6"></div>

      <!-- Features Section -->
      <div class="flex-1">
        <h4
          class="text-xs font-semibold text-base-content/40 uppercase tracking-wider mb-3"
        >
          Core Features
        </h4>
        <ul class="space-y-2.5">
          @for (feature of plan().standoutFeatures; track feature) {
          <li class="flex items-start gap-2.5">
            <lucide-angular
              [img]="CheckIcon"
              class="flex-shrink-0 w-4 h-4 text-green-400 mt-0.5"
              aria-hidden="true"
            />
            <span class="text-sm text-base-content/80">{{ feature }}</span>
          </li>
          }
        </ul>
      </div>

      <!-- CTA Button -->
      <button
        class="mt-8 w-full py-3.5 px-6 rounded-xl font-semibold text-sm
               flex items-center justify-center gap-2 transition-all duration-300
               group-hover:gap-3"
        [ngClass]="ctaButtonClass()"
        [disabled]="isProUser()"
        (click)="handleClick()"
      >
        @if (isProUser()) {
        <span>Included in Your Plan</span>
        } @else {
        <lucide-angular
          [img]="DownloadIcon"
          class="w-4 h-4"
          aria-hidden="true"
        />
        <span>{{ plan().ctaText }}</span>
        }
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        contain: layout style;
        backface-visibility: hidden;
      }
    `,
  ],
})
export class CommunityPlanCardComponent {
  /** Lucide icon references */
  public readonly CheckIcon = Check;
  public readonly DownloadIcon = Download;
  public readonly CrownIcon = Crown;
  public readonly ClockIcon = Clock;
  public readonly SparklesIcon = Sparkles;

  /** Community plan data */
  public readonly plan = input.required<PricingPlan>();

  /** Subscription context from parent (null for unauthenticated users) */
  public readonly subscriptionContext = input<PlanSubscriptionContext | null>(
    null
  );

  /**
   * Computed: Is this the user's current active plan
   *
   * Returns true if:
   * - User is authenticated AND has 'community' tier
   * - OR user is authenticated with no tier (unauthenticated users are Community by default)
   */
  public readonly isCurrentPlan = computed(() => {
    const ctx = this.subscriptionContext();
    if (!ctx?.isAuthenticated) return false;
    // Community users, or users with no plan tier (default to community)
    return ctx.currentPlanTier === 'community' || ctx.currentPlanTier === null;
  });

  /**
   * Computed: Is user a Pro subscriber
   *
   * Pro users see "Included in Pro" badge and disabled button
   */
  public readonly isProUser = computed(() => {
    const ctx = this.subscriptionContext();
    return ctx?.currentPlanTier === 'pro';
  });

  /**
   * Computed: Did user's trial just end?
   *
   * TASK_2025_143: Show alert in Community card when trial ended
   * Returns true if licenseReason === 'trial_ended'
   */
  public readonly isTrialEnded = computed(() => {
    const ctx = this.subscriptionContext();
    return ctx?.licenseReason === 'trial_ended';
  });

  /**
   * Computed: Card border class for visual state indication
   */
  public readonly cardBorderClass = computed(() => {
    if (this.isCurrentPlan()) {
      return 'border-success/50 shadow-lg shadow-success/10';
    }
    if (this.isProUser()) {
      return 'border-base-content/5 opacity-75';
    }
    return 'border-base-content/10 hover:border-base-content/20';
  });

  /**
   * Computed: CTA button styling
   */
  public readonly ctaButtonClass = computed(() => {
    if (this.isProUser()) {
      return 'bg-base-300 text-base-content/40 cursor-not-allowed';
    }
    return `bg-gradient-to-r from-green-600 to-emerald-600
            hover:from-green-500 hover:to-emerald-500
            text-white shadow-lg shadow-green-500/20`;
  });

  /**
   * Handle CTA click
   *
   * Opens VS Code marketplace to install the extension.
   * No-op for Pro users (button is disabled).
   */
  public handleClick(): void {
    if (this.isProUser()) return;

    // Open VS Code marketplace
    window.open(
      'https://marketplace.visualstudio.com/items?itemName=ptah-extensions.ptah-extension-vscode',
      '_blank'
    );
  }
}
