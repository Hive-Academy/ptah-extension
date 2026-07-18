import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  ArrowRight,
  Check,
  Crown,
  LucideAngularModule,
  Pause,
  Settings,
} from 'lucide-angular';
import { isPriceIdPlaceholder } from '../../../utils/paddle-validation.util';
import {
  PlanBadgeVariant,
  PlanCtaVariant,
  PlanSubscriptionContext,
  PricingPlan,
} from '../models/pricing-plan.interface';
import {
  computeBadgeVariant,
  computeCtaButtonClass,
  computeCtaText,
  computeCtaVariant,
  formatTrialDaysText,
  isPortalAction,
} from '../utils/plan-card-state.utils';

/**
 * ProPlanCardComponent - Ptah Builders plan card with subscription awareness
 *
 * The default (unauthenticated, no subscription) CTA links to the Builders
 * waitlist anchor instead of launching Paddle checkout.
 *
 * Subscription-Aware Features:
 * - Shows "Current Plan" badge for active Pro subscribers
 * - Shows "Trial - X days left" for Pro trial users
 * - Shows "Subscription Paused" for paused subscriptions
 * - Shows "Upgrade to Pro" for Community users
 * - CTA is NEVER disabled due to "included" (Pro is highest tier)
 *
 * Evidence: TASK_2025_121 - Two-Tier Paid Extension Model
 * Evidence: TASK_2025_127 - Subscription State Awareness
 */
@Component({
  selector: 'ptah-pro-plan-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, LucideAngularModule],
  template: `
    <div
      class="relative rounded-2xl p-6 lg:p-8 h-full flex flex-col
             bg-gradient-to-b from-base-200/80 to-base-300/50
             border shadow-xl transition-all duration-500 group"
      [ngClass]="cardBorderClass()"
    >
      <!-- Subscription-Aware Badge with aria-live for accessibility -->
      <div aria-live="polite" aria-atomic="true">
        @switch (badgeVariant()) {
          @case ('current') {
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
          }
          @case ('paused') {
            <div
              class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                     bg-warning rounded-full
                     text-xs font-bold text-warning-content uppercase tracking-wider
                     shadow-lg shadow-warning/30 flex items-center gap-1.5"
            >
              <lucide-angular
                [img]="PauseIcon"
                class="w-3 h-3"
                aria-hidden="true"
              />
              Subscription Paused
            </div>
          }
          @case ('trial-active') {
            <div
              class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                     bg-info rounded-full
                     text-xs font-bold text-info-content uppercase tracking-wider
                     shadow-lg shadow-info/30"
            >
              Trial - {{ trialDaysDisplay() }}
            </div>
          }
          @case ('trial-ending') {
            <div
              class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                     bg-warning rounded-full
                     text-xs font-bold text-warning-content uppercase tracking-wider
                     shadow-lg shadow-warning/30"
            >
              {{ trialEndingDisplay() }}
            </div>
          }
          @case ('canceling') {
            <div
              class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                     bg-warning rounded-full
                     text-xs font-bold text-warning-content uppercase tracking-wider
                     shadow-lg shadow-warning/30"
            >
              {{ cancelingDisplay() }}
            </div>
          }
          @case ('past-due') {
            <div
              class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                     bg-error rounded-full
                     text-xs font-bold text-error-content uppercase tracking-wider
                     shadow-lg shadow-error/30"
            >
              Payment Issue
            </div>
          }
          @default {
            <!-- Popular Badge (center) for non-subscribed users -->
            <div
              class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                     bg-gradient-to-r from-amber-500 to-secondary rounded-full
                     text-xs font-bold text-base-100 uppercase tracking-wider
                     shadow-lg shadow-amber-500/30"
            >
              Founding Member
            </div>
          }
        }
      </div>

      <!-- Plan Header -->
      <div class="mb-4">
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
          <span
            class="text-4xl sm:text-5xl lg:text-6xl font-bold whitespace-nowrap
                   bg-gradient-to-r from-amber-300 to-secondary bg-clip-text text-transparent"
          >
            {{ plan().price }}
          </span>
          <span class="text-base-content/50 text-sm">
            / {{ plan().priceSubtext }}
          </span>
        </div>
        @if (plan().savings) {
          <div
            class="inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold
                   bg-success/20 text-success"
          >
            {{ plan().savings }}
          </div>
        }
      </div>

      <!-- Divider -->
      <div class="h-px bg-base-content/10 mb-6"></div>

      <!-- Features Section -->
      <div class="flex-1">
        <h4
          class="text-xs font-semibold text-base-content/40 uppercase tracking-wider mb-3"
        >
          Everything free, plus:
        </h4>
        <ul class="space-y-2.5">
          @for (feature of proFeatures; track feature) {
            <li class="flex items-start gap-2.5">
              <lucide-angular
                [img]="CheckIcon"
                class="flex-shrink-0 w-4 h-4 text-amber-400 mt-0.5"
              />
              <span class="text-sm text-base-content/80">{{ feature }}</span>
            </li>
          }
        </ul>
      </div>

      <!-- CTA - Subscription Aware -->
      @if (ctaVariant() === 'start-trial') {
        <a
          href="#waitlist"
          class="mt-8 w-full py-3.5 px-6 rounded-xl font-semibold text-sm
                 flex items-center justify-center gap-2 transition-all duration-300
                 group-hover:gap-3"
          [ngClass]="ctaButtonClass()"
        >
          <span>{{ ctaText() }}</span>
          <lucide-angular
            [img]="ArrowRightIcon"
            class="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1"
            aria-hidden="true"
          />
        </a>
      } @else {
        <button
          class="mt-8 w-full py-3.5 px-6 rounded-xl font-semibold text-sm
                 flex items-center justify-center gap-2 transition-all duration-300
                 group-hover:gap-3"
          [ngClass]="ctaButtonClass()"
          [disabled]="isCtaDisabled()"
          [attr.aria-busy]="isLoading() || isLoadingContext()"
          (click)="handleClick()"
        >
          @if (isLoading() || isLoadingContext()) {
            <span class="loading loading-spinner loading-sm"></span>
            <span>Loading...</span>
          } @else {
            @if (ctaVariant() === 'current-plan') {
              <lucide-angular
                [img]="SettingsIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
            }
            <span>{{ ctaText() }}</span>
            @if (ctaVariant() !== 'current-plan') {
              <lucide-angular
                [img]="ArrowRightIcon"
                class="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1"
                aria-hidden="true"
              />
            }
          }
        </button>

        <!-- Disabled tooltip -->
        @if (isCtaDisabled() && !isLoading() && !isLoadingContext()) {
          <p class="text-center text-xs text-base-content/40 mt-2">
            Checkout temporarily unavailable
          </p>
        }
      }
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
export class ProPlanCardComponent {
  /** Lucide icon references */
  public readonly CheckIcon = Check;
  public readonly ArrowRightIcon = ArrowRight;
  public readonly SettingsIcon = Settings;
  public readonly CrownIcon = Crown;
  public readonly PauseIcon = Pause;

  /** Pro plan data */
  public readonly plan = input.required<PricingPlan>();

  /** Loading state for checkout operation */
  public readonly isLoading = input<boolean>(false);

  /** Subscription context from parent (null for unauthenticated users) */
  public readonly subscriptionContext = input<PlanSubscriptionContext | null>(
    null,
  );

  /** Whether subscription context is being loaded */
  public readonly isLoadingContext = input<boolean>(false);

  /** CTA click event - emits plan for checkout flow */
  public readonly ctaClick = output<PricingPlan>();

  /** Manage subscription event - emits for portal navigation */
  public readonly manageSubscription = output<void>();

  /** Pro features list */
  public readonly proFeatures = [
    'Everything in Ptah (it is free)',
    'Weekly live build sessions',
    'PRD-to-production curriculum',
    'Member skill packs',
    'Priority support',
    'Founding-member pricing, locked in',
  ];

  /**
   * Computed: Is this the user's current active plan (not trial)
   */
  public readonly isCurrentPlan = computed(() => {
    const ctx = this.subscriptionContext();
    if (!ctx?.currentPlanTier) return false;
    return ctx.currentPlanTier === 'pro' && !ctx.isOnTrial;
  });

  /**
   * Computed: Is this the user's trial plan
   */
  public readonly isTrialPlan = computed(() => {
    const ctx = this.subscriptionContext();
    if (!ctx?.isOnTrial) return false;
    return ctx.currentPlanTier === 'pro';
  });

  /**
   * Computed: Badge variant using shared utility
   */
  public readonly badgeVariant = computed<PlanBadgeVariant>(() => {
    return computeBadgeVariant(
      this.subscriptionContext(),
      'pro',
      this.isCurrentPlan(),
      this.isTrialPlan(),
    );
  });

  /**
   * Computed: CTA variant using shared utility
   */
  public readonly ctaVariant = computed<PlanCtaVariant>(() => {
    return computeCtaVariant(this.subscriptionContext(), 'pro');
  });

  /**
   * Computed: CTA button text using shared utility
   */
  public readonly ctaText = computed(() => {
    return computeCtaText(this.ctaVariant());
  });

  /**
   * Computed: Trial days display with proper formatting
   */
  public readonly trialDaysDisplay = computed(() => {
    const ctx = this.subscriptionContext();
    const days = ctx?.trialDaysRemaining ?? null;
    return formatTrialDaysText(days) ?? 'days left';
  });

  /**
   * Computed: Trial ending display with edge case handling
   */
  public readonly trialEndingDisplay = computed(() => {
    const ctx = this.subscriptionContext();
    const days = ctx?.trialDaysRemaining ?? 0;
    if (days <= 0) {
      return 'Trial expiring today';
    }
    if (days === 1) {
      return 'Trial ends in 1 day';
    }
    return `Trial ends in ${days} days`;
  });

  /**
   * Computed: Canceling badge display with null handling
   */
  public readonly cancelingDisplay = computed(() => {
    const ctx = this.subscriptionContext();
    if (!ctx?.periodEndDate) {
      return 'Ending soon';
    }
    const date = new Date(ctx.periodEndDate);
    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    };
    return `Ends ${date.toLocaleDateString('en-US', options)}`;
  });

  /**
   * Computed: Whether CTA button should be disabled
   *
   * Pro card CTA is NEVER disabled due to subscription state
   * (no "included" variant - Pro is highest tier)
   * Only disabled for loading states or invalid price IDs.
   * 'start-trial' renders as a waitlist link, not a checkout button, so it's excluded here.
   */
  public readonly isCtaDisabled = computed(() => {
    if (this.isLoading()) return true;
    if (this.isLoadingContext()) return true;
    const variant = this.ctaVariant();
    if (['upgrade-now', 'upgrade'].includes(variant)) {
      return isPriceIdPlaceholder(this.plan().priceId);
    }

    return false;
  });

  /**
   * Computed: Card border class for visual state indication
   */
  public readonly cardBorderClass = computed(() => {
    if (this.isCurrentPlan()) {
      return 'border-success/50 shadow-success/20';
    }
    return 'border-secondary/50 shadow-amber-500/10';
  });

  /**
   * Computed: CTA button styling using shared utility
   */
  protected readonly ctaButtonClass = computed(() => {
    return computeCtaButtonClass(
      this.ctaVariant(),
      this.isCtaDisabled(),
      'pro',
    );
  });

  /**
   * Handle CTA click
   *
   * Routes to appropriate action based on CTA variant:
   * - Portal actions (current-plan, reactivate, update-payment, resume) -> manageSubscription
   * - Checkout actions (start-trial, upgrade-now, upgrade) -> ctaClick
   */
  protected handleClick(): void {
    if (this.isCtaDisabled()) return;

    const variant = this.ctaVariant();
    if (isPortalAction(variant)) {
      this.manageSubscription.emit();
      return;
    }
    this.ctaClick.emit(this.plan());
  }
}
