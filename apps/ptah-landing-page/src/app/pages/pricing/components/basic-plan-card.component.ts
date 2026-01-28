import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { NgClass, DatePipe } from '@angular/common';
import { LucideAngularModule, Check, ArrowRight, Settings, Crown } from 'lucide-angular';
import {
  PricingPlan,
  PlanSubscriptionContext,
  PlanCtaVariant,
  PlanBadgeVariant,
} from '../models/pricing-plan.interface';
import { isPriceIdPlaceholder } from '../../../utils/paddle-validation.util';

/**
 * BasicPlanCardComponent - Basic plan card with subscription awareness
 *
 * This component handles the Basic plan which has both monthly and yearly options.
 * The billing toggle is integrated directly into the card.
 *
 * Subscription-Aware Features:
 * - Shows "Current Plan" badge for active Basic subscribers
 * - Shows "Trial - X days left" for trial users
 * - Shows "Included in Pro" for Pro subscribers viewing Basic
 * - Adjusts CTA button based on subscription state
 *
 * Evidence: TASK_2025_121 - Two-Tier Paid Extension Model
 * Evidence: TASK_2025_127 - Subscription State Awareness
 */
@Component({
  selector: 'ptah-basic-plan-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, DatePipe, LucideAngularModule],
  template: `
    <div
      class="relative rounded-2xl p-6 lg:p-8 h-full flex flex-col
             bg-base-200/40 border transition-all duration-500 group"
      [ngClass]="cardBorderClass()"
    >
      <!-- Subscription-Aware Badge -->
      @switch (badgeVariant()) {
        @case ('current') {
          <div
            class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                   bg-success rounded-full
                   text-xs font-bold text-success-content uppercase tracking-wider
                   shadow-lg shadow-success/30 flex items-center gap-1.5"
          >
            <lucide-angular [img]="CrownIcon" class="w-3 h-3" aria-hidden="true" />
            Current Plan
          </div>
        }
        @case ('trial-active') {
          <div
            class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                   bg-info rounded-full
                   text-xs font-bold text-info-content uppercase tracking-wider
                   shadow-lg shadow-info/30"
          >
            Trial - {{ subscriptionContext()?.trialDaysRemaining }} days left
          </div>
        }
        @case ('trial-ending') {
          <div
            class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                   bg-warning rounded-full
                   text-xs font-bold text-warning-content uppercase tracking-wider
                   shadow-lg shadow-warning/30"
          >
            Trial ends in {{ subscriptionContext()?.trialDaysRemaining }} days
          </div>
        }
        @case ('canceling') {
          <div
            class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                   bg-warning rounded-full
                   text-xs font-bold text-warning-content uppercase tracking-wider
                   shadow-lg shadow-warning/30"
          >
            Ends {{ subscriptionContext()?.periodEndDate | date:'MMM d, y' }}
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
        @case ('included') {
          <div
            class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                   bg-base-300 rounded-full
                   text-xs font-bold text-base-content/60 uppercase tracking-wider
                   shadow-lg"
          >
            Included in Pro
          </div>
        }
        @default {
          <!-- Default trial badge for unauthenticated users -->
          @if (activePlan().trialDays) {
            <div
              class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                     bg-gradient-to-r from-sky-500 to-cyan-500 rounded-full
                     text-xs font-bold text-base-100 uppercase tracking-wider
                     shadow-lg shadow-sky-500/30"
            >
              {{ activePlan().trialDays }}-Day Free Trial
            </div>
          }
        }
      }

      <!-- Plan Header -->
      <div class="mb-4 mt-2">
        <h3
          class="font-display text-xl lg:text-2xl font-semibold text-base-content tracking-wide uppercase mb-1"
        >
          {{ activePlan().name }}
        </h3>
        <p class="text-sm text-base-content/50">{{ activePlan().idealFor }}</p>
      </div>

      <!-- Billing Toggle (inside card) -->
      <div class="mb-6">
        <div
          class="inline-flex items-center p-1 rounded-full bg-base-100/50 border border-base-content/10"
        >
          <button
            type="button"
            class="px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-300"
            [ngClass]="{
              'bg-sky-500 text-base-100 shadow-md':
                billingPeriod() === 'monthly',
              'text-base-content/60 hover:text-base-content':
                billingPeriod() !== 'monthly'
            }"
            (click)="billingPeriod.set('monthly')"
          >
            Monthly
          </button>
          <button
            type="button"
            class="px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-300 flex items-center gap-2"
            [ngClass]="{
              'bg-sky-500 text-base-100 shadow-md':
                billingPeriod() === 'yearly',
              'text-base-content/60 hover:text-base-content':
                billingPeriod() !== 'yearly'
            }"
            (click)="billingPeriod.set('yearly')"
          >
            Yearly
            <span
              class="px-1.5 py-0.5 text-[10px] font-bold rounded bg-success text-success-content"
            >
              -17%
            </span>
          </button>
        </div>
      </div>

      <!-- Price Section -->
      <div class="mb-6">
        <div class="flex items-baseline gap-2">
          <span class="text-5xl lg:text-6xl font-bold text-base-content">
            {{ activePlan().price }}
          </span>
          <span class="text-base-content/50 text-sm">
            / {{ activePlan().priceSubtext }}
          </span>
        </div>
        @if (activePlan().savings) {
        <div
          class="inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold
                 bg-success/20 text-success"
        >
          {{ activePlan().savings }}
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
          Core Features
        </h4>
        <ul class="space-y-2.5">
          @for (feature of basicFeatures; track feature) {
          <li class="flex items-start gap-2.5">
            <lucide-angular
              [img]="CheckIcon"
              class="flex-shrink-0 w-4 h-4 text-sky-400 mt-0.5"
            />
            <span class="text-sm text-base-content/80">{{ feature }}</span>
          </li>
          }
        </ul>
      </div>

      <!-- CTA Button - Subscription Aware -->
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
            <lucide-angular [img]="SettingsIcon" class="w-4 h-4" aria-hidden="true" />
          }
          <span>{{ ctaText() }}</span>
          @if (ctaVariant() !== 'current-plan' && ctaVariant() !== 'included') {
            <lucide-angular
              [img]="ArrowRightIcon"
              class="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1"
              aria-hidden="true"
            />
          }
        }
      </button>

      <!-- Disabled tooltip -->
      @if (isCtaDisabled() && !isLoading() && !isLoadingContext() && ctaVariant() !== 'included') {
        <p class="text-center text-xs text-base-content/40 mt-2">
          Checkout temporarily unavailable
        </p>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `,
  ],
})
export class BasicPlanCardComponent {
  /** Lucide icon references */
  public readonly CheckIcon = Check;
  public readonly ArrowRightIcon = ArrowRight;
  public readonly SettingsIcon = Settings;
  public readonly CrownIcon = Crown;

  /** Monthly plan data */
  public readonly monthlyPlan = input.required<PricingPlan>();

  /** Yearly plan data */
  public readonly yearlyPlan = input.required<PricingPlan>();

  /** Loading state for checkout operation */
  public readonly isLoading = input<boolean>(false);

  /** Subscription context from parent (null for unauthenticated users) */
  public readonly subscriptionContext = input<PlanSubscriptionContext | null>(null);

  /** Whether subscription context is being loaded */
  public readonly isLoadingContext = input<boolean>(false);

  /** CTA click event - emits plan for checkout flow */
  public readonly ctaClick = output<PricingPlan>();

  /** Manage subscription event - emits for portal navigation */
  public readonly manageSubscription = output<void>();

  /** Internal billing period state */
  public readonly billingPeriod = signal<'monthly' | 'yearly'>('monthly');

  /** Computed active plan based on billing period */
  public readonly activePlan = computed(() =>
    this.billingPeriod() === 'yearly' ? this.yearlyPlan() : this.monthlyPlan()
  );

  /** Basic features list (same for both monthly and yearly) */
  public readonly basicFeatures = [
    'Beautiful visual interface',
    'Use your Claude Pro/Max subscription',
    'Native VS Code integration',
    'Real-time streaming responses',
    'Session history & management',
    'Basic workspace context',
  ];

  /**
   * Computed: Is this the user's current active plan (not trial)
   */
  public readonly isCurrentPlan = computed(() => {
    const ctx = this.subscriptionContext();
    if (!ctx?.currentPlanTier) return false;
    return ctx.currentPlanTier === 'basic' && !ctx.isOnTrial;
  });

  /**
   * Computed: Is this the user's trial plan
   */
  public readonly isTrialPlan = computed(() => {
    const ctx = this.subscriptionContext();
    if (!ctx?.isOnTrial) return false;
    return ctx.currentPlanTier === 'basic';
  });

  /**
   * Computed: Badge variant based on subscription state
   *
   * Priority order:
   * 1. Current active plan -> 'current'
   * 2. Trial ending soon (<=3 days) -> 'trial-ending'
   * 3. Active trial -> 'trial-active'
   * 4. Canceled subscription -> 'canceling'
   * 5. Past due subscription -> 'past-due'
   * 6. Pro subscriber viewing Basic -> 'included'
   * 7. Default (unauthenticated) -> 'trial'
   */
  public readonly badgeVariant = computed<PlanBadgeVariant>(() => {
    const ctx = this.subscriptionContext();

    // No context = unauthenticated user, show default trial badge
    if (!ctx) return 'trial';

    // Pro subscriber viewing Basic card - show "included" badge
    if (ctx.currentPlanTier === 'pro' && !ctx.isOnTrial) {
      return 'included';
    }

    // Active Basic subscription (not trial)
    if (this.isCurrentPlan()) {
      return 'current';
    }

    // Basic trial user
    if (this.isTrialPlan()) {
      const days = ctx.trialDaysRemaining ?? 0;
      return days <= 3 ? 'trial-ending' : 'trial-active';
    }

    // Canceled Basic subscription (still in grace period)
    if (ctx.subscriptionStatus === 'canceled' && ctx.currentPlanTier === 'basic') {
      return 'canceling';
    }

    // Past due Basic subscription
    if (ctx.subscriptionStatus === 'past_due' && ctx.currentPlanTier === 'basic') {
      return 'past-due';
    }

    // Default for non-authenticated or no subscription
    return 'trial';
  });

  /**
   * Computed: CTA variant based on subscription state
   *
   * Determines button action and appearance:
   * - 'start-trial': Opens checkout for new users
   * - 'current-plan': Opens subscription management portal
   * - 'upgrade-now': Opens checkout for trial conversion
   * - 'reactivate': Opens portal for canceled subscriptions
   * - 'update-payment': Opens portal for past due subscriptions
   * - 'included': Disabled state for Pro subscribers
   */
  public readonly ctaVariant = computed<PlanCtaVariant>(() => {
    const ctx = this.subscriptionContext();

    // Not authenticated or no context -> start trial
    if (!ctx?.isAuthenticated) return 'start-trial';
    if (!ctx.currentPlanTier) return 'start-trial';

    // User has Basic subscription
    if (ctx.currentPlanTier === 'basic') {
      // Trial user -> encourage upgrade
      if (ctx.isOnTrial) return 'upgrade-now';
      // Canceled -> offer reactivation
      if (ctx.subscriptionStatus === 'canceled') return 'reactivate';
      // Past due -> prompt payment update
      if (ctx.subscriptionStatus === 'past_due') return 'update-payment';
      // Active subscription -> manage
      return 'current-plan';
    }

    // User has Pro subscription - Basic is included
    if (ctx.currentPlanTier === 'pro') {
      return 'included';
    }

    return 'start-trial';
  });

  /**
   * Computed: CTA button text based on variant
   */
  public readonly ctaText = computed(() => {
    const variant = this.ctaVariant();
    switch (variant) {
      case 'start-trial':
        return 'Start 14-Day Free Trial';
      case 'current-plan':
        return 'Manage Subscription';
      case 'upgrade-now':
        return 'Upgrade Now';
      case 'reactivate':
        return 'Reactivate';
      case 'update-payment':
        return 'Update Payment';
      case 'included':
        return 'Included in Pro';
      default:
        return 'Start 14-Day Free Trial';
    }
  });

  /**
   * Computed: Whether CTA button should be disabled
   */
  public readonly isCtaDisabled = computed(() => {
    // Disabled during loading
    if (this.isLoading()) return true;
    if (this.isLoadingContext()) return true;

    // "Included" variant is always disabled
    const variant = this.ctaVariant();
    if (variant === 'included') return true;

    // Disabled if price ID is invalid (only for checkout actions)
    if (['start-trial', 'upgrade-now'].includes(variant)) {
      return isPriceIdPlaceholder(this.activePlan().priceId);
    }

    return false;
  });

  /**
   * Computed: Card border class for visual state indication
   */
  public readonly cardBorderClass = computed(() => {
    if (this.isCurrentPlan()) {
      return 'border-success/50 shadow-lg shadow-success/10';
    }
    if (this.badgeVariant() === 'included') {
      return 'border-base-content/5 opacity-75';
    }
    return 'border-base-content/10 hover:border-base-content/20';
  });

  /**
   * Computed: CTA button styling based on variant
   */
  protected readonly ctaButtonClass = computed(() => {
    const variant = this.ctaVariant();
    const isDisabled = this.isCtaDisabled();

    // Base disabled state
    if (isDisabled && variant !== 'included') {
      return 'bg-base-content/10 text-base-content/40 cursor-not-allowed opacity-50';
    }

    switch (variant) {
      case 'current-plan':
        return 'bg-success/20 text-success border border-success/30 hover:bg-success/30 cursor-pointer';
      case 'reactivate':
        return 'bg-warning/20 text-warning border border-warning/30 hover:bg-warning/30 cursor-pointer';
      case 'update-payment':
        return 'bg-error/20 text-error border border-error/30 hover:bg-error/30 cursor-pointer';
      case 'included':
        return 'bg-base-300/50 text-base-content/40 cursor-not-allowed';
      case 'upgrade-now':
        return 'bg-sky-500 text-base-100 hover:bg-sky-600 shadow-md shadow-sky-500/25 cursor-pointer';
      case 'start-trial':
      default:
        return 'bg-base-content/10 text-base-content hover:bg-base-content/20 cursor-pointer';
    }
  });

  /**
   * Handle CTA click
   *
   * Routes to appropriate action based on CTA variant:
   * - Portal actions (current-plan, reactivate, update-payment) -> manageSubscription
   * - Checkout actions (start-trial, upgrade-now) -> ctaClick
   * - Disabled actions (included) -> no action
   */
  protected handleClick(): void {
    if (this.isCtaDisabled()) return;

    const variant = this.ctaVariant();

    // Actions that go to Paddle portal
    if (['current-plan', 'reactivate', 'update-payment'].includes(variant)) {
      this.manageSubscription.emit();
      return;
    }

    // Actions that open checkout
    this.ctaClick.emit(this.activePlan());
  }
}
