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
 * Subscription context for plan cards
 *
 * Provides subscription state information to plan card components
 * for determining CTA button state and visual styling.
 *
 * Used by: BasicPlanCardComponent, ProPlanCardComponent
 * Source: SubscriptionStateService computed signals
 */
export interface PlanSubscriptionContext {
  /** Whether user is authenticated */
  isAuthenticated: boolean;

  /** User's current plan tier (null if no subscription) */
  currentPlanTier: 'basic' | 'pro' | null;

  /** Whether user is on trial */
  isOnTrial: boolean;

  /** Days remaining in trial (null if not on trial) */
  trialDaysRemaining: number | null;

  /** Subscription status from Paddle */
  subscriptionStatus:
    | 'active'
    | 'trialing'
    | 'canceled'
    | 'past_due'
    | 'paused'
    | null;

  /** Cancellation period end date (for canceled subscriptions) */
  periodEndDate: string | null;
}

/**
 * CTA button variant for plan cards
 *
 * Determines the appearance and behavior of the plan card's
 * call-to-action button based on subscription state.
 *
 * Variants:
 * - 'start-trial': Default for unauthenticated users -> opens checkout
 * - 'current-plan': User has this plan active -> opens subscription management
 * - 'upgrade': Lower tier user viewing higher tier -> opens checkout
 * - 'downgrade': Higher tier user viewing lower tier (disabled or muted)
 * - 'upgrade-now': Trial user -> opens checkout to convert
 * - 'reactivate': Canceled subscription -> opens portal to reactivate
 * - 'update-payment': Past due subscription -> opens portal to update payment
 * - 'included': Pro user viewing Basic plan (disabled)
 */
export type PlanCtaVariant =
  | 'start-trial'
  | 'current-plan'
  | 'upgrade'
  | 'downgrade'
  | 'upgrade-now'
  | 'reactivate'
  | 'update-payment'
  | 'included';

/**
 * Badge variant for plan cards
 *
 * Determines the appearance of the badge displayed on plan cards
 * based on subscription state and user context.
 *
 * Variants:
 * - 'trial': Default trial badge (cyan) - "14-Day Free Trial"
 * - 'current': User's current plan (green) - "Current Plan"
 * - 'trial-active': Active trial with days left (blue) - "Trial - X days left"
 * - 'trial-ending': Trial ending soon <= 3 days (amber) - "Trial ends in X days"
 * - 'canceling': Canceled but still active (amber) - "Ends [date]"
 * - 'past-due': Payment issues (red) - "Payment Issue"
 * - 'popular': Marketing badge (amber gradient) - "Most Popular"
 * - 'included': Pro user viewing Basic (muted) - "Included in Pro"
 */
export type PlanBadgeVariant =
  | 'trial'
  | 'current'
  | 'trial-active'
  | 'trial-ending'
  | 'canceling'
  | 'past-due'
  | 'popular'
  | 'included';
