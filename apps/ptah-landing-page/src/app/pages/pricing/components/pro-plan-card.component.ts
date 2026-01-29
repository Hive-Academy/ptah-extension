import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
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
 * ProPlanCardComponent - Pro plan card with subscription awareness
 *
 * This component handles the Pro plan which has both monthly and yearly options.
 * The billing toggle is integrated directly into the card.
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
        @switch (badgeVariant()) { @case ('current') {
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
        } @case ('paused') {
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
        } @case ('trial-active') {
        <div
          class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                     bg-info rounded-full
                     text-xs font-bold text-info-content uppercase tracking-wider
                     shadow-lg shadow-info/30"
        >
          Trial - {{ trialDaysDisplay() }}
        </div>
        } @case ('trial-ending') {
        <div
          class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                     bg-warning rounded-full
                     text-xs font-bold text-warning-content uppercase tracking-wider
                     shadow-lg shadow-warning/30"
        >
          {{ trialEndingDisplay() }}
        </div>
        } @case ('canceling') {
        <div
          class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                     bg-warning rounded-full
                     text-xs font-bold text-warning-content uppercase tracking-wider
                     shadow-lg shadow-warning/30"
        >
          {{ cancelingDisplay() }}
        </div>
        } @case ('past-due') {
        <div
          class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                     bg-error rounded-full
                     text-xs font-bold text-error-content uppercase tracking-wider
                     shadow-lg shadow-error/30"
        >
          Payment Issue
        </div>
        } @default {
        <!-- Popular Badge (center) for non-subscribed users -->
        <div
          class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                     bg-gradient-to-r from-amber-500 to-secondary rounded-full
                     text-xs font-bold text-base-100 uppercase tracking-wider
                     shadow-lg shadow-amber-500/30"
        >
          Most Popular
        </div>
        } }
      </div>

      <!-- Trial Badge on right side (only for non-current-plan states) -->
      @if (showTrialBadge()) {
      <div
        class="absolute -top-3 right-4 px-3 py-1
                 bg-gradient-to-r from-sky-500 to-cyan-500 rounded-full
                 text-[10px] font-bold text-base-100 uppercase tracking-wider
                 shadow-lg shadow-sky-500/30"
      >
        {{ activePlan().trialDays }}-Day Trial
      </div>
      }

      <!-- Plan Header -->
      <div class="mb-4">
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
              'bg-amber-500 text-base-100 shadow-md':
                billingPeriod() === 'monthly',
              'text-base-content/60 hover:text-base-content':
                billingPeriod() !== 'monthly'
            }"
            (click)="setBillingPeriod('monthly')"
          >
            Monthly
          </button>
          <button
            type="button"
            class="px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-300 flex items-center gap-2"
            [ngClass]="{
              'bg-amber-500 text-base-100 shadow-md':
                billingPeriod() === 'yearly',
              'text-base-content/60 hover:text-base-content':
                billingPeriod() !== 'yearly'
            }"
            (click)="setBillingPeriod('yearly')"
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
          <span
            class="text-5xl lg:text-6xl font-bold
                   bg-gradient-to-r from-amber-300 to-secondary bg-clip-text text-transparent"
          >
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
          Everything in Community, plus:
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
        } @else { @if (ctaVariant() === 'current-plan') {
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
        } }
      </button>

      <!-- Disabled tooltip -->
      @if (isCtaDisabled() && !isLoading() && !isLoadingContext()) {
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
export class ProPlanCardComponent {
  /** Lucide icon references */
  public readonly CheckIcon = Check;
  public readonly ArrowRightIcon = ArrowRight;
  public readonly SettingsIcon = Settings;
  public readonly CrownIcon = Crown;
  public readonly PauseIcon = Pause;

  /** Monthly plan data */
  public readonly monthlyPlan = input.required<PricingPlan>();

  /** Yearly plan data */
  public readonly yearlyPlan = input.required<PricingPlan>();

  /** Loading state for checkout operation */
  public readonly isLoading = input<boolean>(false);

  /** Subscription context from parent (null for unauthenticated users) */
  public readonly subscriptionContext = input<PlanSubscriptionContext | null>(
    null
  );

  /** Whether subscription context is being loaded */
  public readonly isLoadingContext = input<boolean>(false);

  /** CTA click event - emits plan for checkout flow */
  public readonly ctaClick = output<PricingPlan>();

  /** Manage subscription event - emits for portal navigation */
  public readonly manageSubscription = output<void>();

  /** Internal billing period state (private with setter) */
  private readonly _billingPeriod = signal<'monthly' | 'yearly'>('monthly');

  /** Public readonly billing period for template */
  public readonly billingPeriod = this._billingPeriod.asReadonly();

  /** Set billing period */
  public setBillingPeriod(period: 'monthly' | 'yearly'): void {
    this._billingPeriod.set(period);
  }

  /** Computed active plan based on billing period */
  public readonly activePlan = computed(() =>
    this._billingPeriod() === 'yearly' ? this.yearlyPlan() : this.monthlyPlan()
  );

  /** Pro features list (same for both monthly and yearly) */
  public readonly proFeatures = [
    'Intelligent Setup Wizard',
    'Code Execution MCP Server',
    'Workspace Intelligence (13+ project types)',
    'OpenRouter proxy (200+ models)',
    'Project-adaptive agent generation',
    'Real-time cost tracking',
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
   * Computed: Whether to show the trial badge on the right side
   * Only shows for non-subscription states
   */
  public readonly showTrialBadge = computed(() => {
    const badge = this.badgeVariant();
    const hasTrialDays = !!this.activePlan().trialDays;
    const subscriptionBadges = [
      'current',
      'trial-active',
      'trial-ending',
      'canceling',
      'past-due',
      'paused',
    ];
    return hasTrialDays && !subscriptionBadges.includes(badge);
  });

  /**
   * Computed: Badge variant using shared utility
   */
  public readonly badgeVariant = computed<PlanBadgeVariant>(() => {
    return computeBadgeVariant(
      this.subscriptionContext(),
      'pro',
      this.isCurrentPlan(),
      this.isTrialPlan()
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
    // Use Intl for date formatting
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
   * Only disabled for loading states or invalid price IDs
   */
  public readonly isCtaDisabled = computed(() => {
    // Disabled during loading
    if (this.isLoading()) return true;
    if (this.isLoadingContext()) return true;

    // Disabled if price ID is invalid (only for checkout actions)
    const variant = this.ctaVariant();
    if (['start-trial', 'upgrade-now', 'upgrade'].includes(variant)) {
      return isPriceIdPlaceholder(this.activePlan().priceId);
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
      'pro'
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

    // Actions that go to Paddle portal
    if (isPortalAction(variant)) {
      this.manageSubscription.emit();
      return;
    }

    // Actions that open checkout (including 'upgrade' for Community users)
    this.ctaClick.emit(this.activePlan());
  }
}
