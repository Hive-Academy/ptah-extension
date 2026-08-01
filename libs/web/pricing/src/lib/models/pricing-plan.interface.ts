/**
 * PricingPlan Interface
 *
 * Data model for pricing plan cards.
 *
 * - Community: FREE forever (no Paddle, install from VS Code marketplace)
 * - Ptah Builders: paid membership (Paddle checkout), $29/mo or $290/yr list
 *   price. Founding waitlist members get a launch discount (35% off monthly
 *   for 12 cycles, 50% off yearly for the first year) applied via a Paddle
 *   discount id passed through the `?promo=founding` checkout flow.
 *
 * Evidence: TASK_2025_121 - Two-Tier Paid Extension Model
 * Evidence: TASK_2025_128 - Freemium Model Conversion
 */
export interface PricingPlan {
  /** Display name (e.g., "Community", "Ptah Builders") */
  name: string;

  /** Tier identifier for programmatic use. There are no legacy tiers. */
  tier: 'community' | 'builders';

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
   * - 'checkout': Opens Paddle checkout flow (Builders plan)
   * - 'download': Opens VS Code marketplace (Community plan)
   */
  ctaAction: 'checkout' | 'download';

  /** Whether this plan should be highlighted (default: false) */
  highlight?: boolean;

  /** Badge asset filename (e.g., "plan_badge_builders.png") */
  badge?: string;
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
 * - Community tier is FREE (no subscription required)
 * - Builders tier requires a Paddle subscription. There is no trial and no
 *   legacy tier — zero paying subscribers exist pre-launch.
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
   * - null: Unknown/loading state
   */
  currentPlanTier: 'community' | 'builders' | null;

  /**
   * Subscription status from Paddle.
   * Validated at runtime to ensure only known statuses are used.
   */
  subscriptionStatus: ValidSubscriptionStatus | null;

  /**
   * Whether the viewer holds a real Paddle subscription (as opposed to a
   * complimentary "Early Adopter" Builders grant, which has none).
   *
   * A comp Builders license has `subscription === null`, so there is nothing
   * for the customer portal to manage — the CTA must render the non-portal
   * `'member'` badge rather than "Manage Subscription".
   */
  hasPaddleSubscription: boolean;

  /**
   * Cancellation period end date (for canceled subscriptions).
   * ISO date string or null if not applicable.
   */
  periodEndDate: string | null;

  /**
   * License reason from API when access has lapsed.
   */
  licenseReason?: 'expired';
}

/**
 * CTA button variant for plan cards
 *
 * Determines the appearance and behavior of the plan card's
 * call-to-action button based on subscription state.
 *
 * @example
 * ```typescript
 * const variant: PlanCtaVariant = 'join';
 * ```
 */
export type PlanCtaVariant =
  /**
   * No premium access yet (anonymous or Community-only). Renders "Join the
   * Builders Waitlist" while checkout is closed, or "Join Ptah Builders"
   * (opens Paddle checkout) once it opens.
   */
  | 'join'
  /**
   * Complimentary "Early Adopter" Builders member — holds the Builders tier
   * with NO Paddle subscription. Renders a non-interactive success badge
   * ("Early Adopter — active"); never a portal action (nothing to manage).
   */
  | 'member'
  /**
   * User already has an active Builders subscription in good standing -
   * opens the subscription management portal.
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
