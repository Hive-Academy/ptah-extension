/**
 * PricingPlan Interface
 *
 * Data model for pricing plan cards.
 *
 * TASK_2025_128: Freemium Model Conversion
 * - Community: FREE forever (no Paddle, install from VS Code marketplace)
 * - Ptah Builders: founding-member monthly membership (Paddle checkout)
 *
 * Evidence: TASK_2025_121 - Two-Tier Paid Extension Model
 * Evidence: TASK_2025_128 - Freemium Model Conversion
 */
export interface PricingPlan {
  /** Display name (e.g., "Community", "Ptah Builders") */
  name: string;

  /**
   * Tier identifier for programmatic use.
   * 'builders' is the current premium tier being sold; 'pro' is kept for
   * typing legacy paying/trialing subscribers (drains naturally, never sold).
   */
  tier: 'community' | 'builders' | 'pro';

  /** Display price (e.g., "Free", "$5", "$50") */
  price: string;

  /** Optional price subtext (e.g., "per month", "per year", "forever") */
  priceSubtext?: string;

  /** Optional savings badge (e.g., "Save ~17% vs monthly") */
  savings?: string;

  /** Paddle price ID for checkout integration (undefined for free Community tier) */
  priceId?: string;

  /** List of feature descriptions */
  features: string[];

  /** Standout features shown in separate section */
  standoutFeatures?: string[];

  /** "Ideal for" description (e.g., "Perfect for getting started") */
  idealFor?: string;

  /** Call-to-action button text */
  ctaText: string;

  /**
   * CTA action type
   * - 'checkout': Opens Paddle checkout flow (Pro plan)
   * - 'download': Opens VS Code marketplace (Community plan)
   */
  ctaAction: 'checkout' | 'download';

  /** Whether this plan should be highlighted (default: false) */
  highlight?: boolean;

  /** Badge asset filename (e.g., "plan_badge_pro.png") */
  badge?: string;

  /** Trial period in days (e.g., 14) - only for Pro plan */
  trialDays?: number;
}

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
 * TASK_2025_128: Updated for freemium model
 * - Community tier is FREE (no subscription required)
 * - Builders tier requires a Paddle subscription ('pro' is the legacy alias
 *   for existing paying/trialing subscribers, draining naturally)
 *
 * @remarks
 * Used by: PricingGridComponent (unified Free-vs-Builders capability matrix)
 * Source: SubscriptionStateService computed signals
 */
export interface PlanSubscriptionContext {
  /**
   * Whether user is authenticated.
   * True if user has successfully logged in and we have fetched their data.
   */
  isAuthenticated: boolean;

  /**
   * User's current plan tier (null if unknown/loading).
   *
   * - 'community': Free tier (no subscription required)
   * - 'builders': Active Ptah Builders subscription
   * - 'pro': Legacy active Pro subscription (draining, treated as premium)
   * - null: Unknown/loading state
   */
  currentPlanTier: 'community' | 'builders' | 'pro' | null;

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

  /**
   * License reason from API (e.g., 'trial_ended').
   * TASK_2025_143: Used to show trial ended message in Community card.
   */
  licenseReason?: string;
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
   * No premium access yet (anonymous, Community-only, or an unconverted
   * trial). Renders "Join the Builders Waitlist" while checkout is closed,
   * or "Join Ptah Builders" (opens Paddle checkout) once it opens.
   */
  | 'start-trial'
  /**
   * User already has premium access (Builders or legacy Pro), active and in
   * good standing - opens the subscription management portal.
   */
  | 'current-plan'
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
  | 'resume';
