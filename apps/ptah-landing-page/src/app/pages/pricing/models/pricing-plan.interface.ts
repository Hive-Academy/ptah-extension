/**
 * PricingPlan Interface
 *
 * Data model for pricing plan cards.
 * Updated for new pricing model: Basic + Pro (both paid with 14-day trial)
 *
 * Evidence: TASK_2025_121 - Two-Tier Paid Extension Model
 */
export interface PricingPlan {
  /** Display name (e.g., "Basic", "Pro") */
  name: string;

  /** Tier identifier for programmatic use */
  tier: 'basic' | 'pro';

  /** Display price (e.g., "$3", "$5", "$30", "$50") */
  price: string;

  /** Optional price subtext (e.g., "per month", "per year") */
  priceSubtext?: string;

  /** Optional savings badge (e.g., "Save ~17% vs monthly") */
  savings?: string;

  /** Paddle price ID for checkout integration (required for all plans) */
  priceId?: string;

  /** List of feature descriptions */
  features: string[];

  /** Standout features shown in separate section */
  standoutFeatures?: string[];

  /** "Ideal for" description (e.g., "Perfect for individual developers") */
  idealFor?: string;

  /** Call-to-action button text */
  ctaText: string;

  /** CTA action type - always checkout since both plans are paid */
  ctaAction: 'checkout';

  /** Whether this plan should be highlighted (default: false) */
  highlight?: boolean;

  /** Badge asset filename (e.g., "plan_badge_pro.png") */
  badge?: string;

  /** Trial period in days (e.g., 14) */
  trialDays?: number;
}

/**
 * Threshold in days for showing "trial ending" warning badge.
 * When trial days remaining is at or below this value, show warning.
 */
export const TRIAL_WARNING_THRESHOLD_DAYS = 3;

/**
 * Valid subscription statuses from Paddle API.
 * Used for runtime validation of subscription status values.
 */
export const VALID_SUBSCRIPTION_STATUSES = [
  'active',
  'canceled',
  'past_due',
  'paused',
] as const;

/**
 * Valid subscription status type derived from the constant array.
 */
export type ValidSubscriptionStatus =
  (typeof VALID_SUBSCRIPTION_STATUSES)[number];

/**
 * Subscription context for plan cards
 *
 * Provides subscription state information to plan card components
 * for determining CTA button state and visual styling.
 *
 * @remarks
 * Used by: BasicPlanCardComponent, ProPlanCardComponent
 * Source: SubscriptionStateService computed signals
 */
export interface PlanSubscriptionContext {
  /**
   * Whether user is authenticated.
   * True if user has successfully logged in and we have fetched their data.
   */
  isAuthenticated: boolean;

  /**
   * User's current plan tier (null if no subscription).
   * Normalized from trial_basic/trial_pro to basic/pro.
   */
  currentPlanTier: 'basic' | 'pro' | null;

  /**
   * Whether user is on trial.
   * True if plan starts with 'trial_' prefix.
   */
  isOnTrial: boolean;

  /**
   * Days remaining in trial (null if not on trial).
   * Can be 0 or negative if trial has expired but data not yet updated.
   */
  trialDaysRemaining: number | null;

  /**
   * Subscription status from Paddle.
   * Note: 'trialing' is a Paddle status but we detect trials via plan prefix instead.
   * Validated at runtime to ensure only known statuses are used.
   */
  subscriptionStatus: ValidSubscriptionStatus | null;

  /**
   * Cancellation period end date (for canceled subscriptions).
   * ISO date string or null if not applicable.
   */
  periodEndDate: string | null;
}

/**
 * CTA button variant for plan cards
 *
 * Determines the appearance and behavior of the plan card's
 * call-to-action button based on subscription state.
 *
 * @example
 * ```typescript
 * const variant: PlanCtaVariant = 'start-trial';
 * ```
 */
export type PlanCtaVariant =
  /**
   * Default for unauthenticated users - opens checkout flow
   */
  | 'start-trial'
  /**
   * User has this plan active - opens subscription management portal
   */
  | 'current-plan'
  /**
   * Lower tier user viewing higher tier - opens checkout for upgrade
   */
  | 'upgrade'
  /**
   * Higher tier user viewing lower tier (disabled or muted)
   */
  | 'downgrade'
  /**
   * Trial user - opens checkout to convert trial to paid
   */
  | 'upgrade-now'
  /**
   * Canceled subscription - opens portal to reactivate
   */
  | 'reactivate'
  /**
   * Past due subscription - opens portal to update payment method
   */
  | 'update-payment'
  /**
   * Paused subscription - opens portal to resume subscription
   */
  | 'resume'
  /**
   * Pro user viewing Basic plan (disabled - Basic is included)
   */
  | 'included';

/**
 * Badge variant for plan cards
 *
 * Determines the appearance of the badge displayed on plan cards
 * based on subscription state and user context.
 *
 * @example
 * ```typescript
 * const badge: PlanBadgeVariant = 'current';
 * ```
 */
export type PlanBadgeVariant =
  /**
   * Default trial badge (cyan) - "14-Day Free Trial"
   */
  | 'trial'
  /**
   * User's current plan (green) - "Current Plan"
   */
  | 'current'
  /**
   * Active trial with days left (blue) - "Trial - X days left"
   */
  | 'trial-active'
  /**
   * Trial ending soon <= TRIAL_WARNING_THRESHOLD_DAYS (amber) - "Trial ends in X days"
   */
  | 'trial-ending'
  /**
   * Canceled but still active (amber) - "Ends [date]"
   */
  | 'canceling'
  /**
   * Subscription is paused (amber) - "Subscription Paused"
   */
  | 'paused'
  /**
   * Payment issues (red) - "Payment Issue"
   */
  | 'past-due'
  /**
   * Marketing badge (amber gradient) - "Most Popular"
   */
  | 'popular'
  /**
   * Pro user viewing Basic (muted) - "Included in Pro"
   */
  | 'included';
