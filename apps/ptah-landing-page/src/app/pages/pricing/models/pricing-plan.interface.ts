/**
 * PricingPlan Interface
 *
 * Data model for pricing plan cards.
 * Updated for new pricing model: Free Trial + Pro (Monthly/Yearly)
 *
 * Evidence: Updated per user feedback - simplified single-plan pricing
 */
export interface PricingPlan {
  /** Display name (e.g., "Pro Monthly", "Free Trial") */
  name: string;

  /** Tier identifier for programmatic use */
  tier: 'free' | 'pro';

  /** Display price (e.g., "$8", "$80") */
  price: string;

  /** Optional price subtext (e.g., "per month", "per year", "14 days") */
  priceSubtext?: string;

  /** Optional savings badge (e.g., "Save $16/year") */
  savings?: string;

  /** Paddle price ID for checkout integration (optional for free plan) */
  priceId?: string;

  /** List of feature descriptions */
  features: string[];

  /** Call-to-action button text */
  ctaText: string;

  /** CTA action type */
  ctaAction: 'download' | 'checkout' | 'signup';

  /** Whether this plan should be highlighted (default: false) */
  highlight?: boolean;

  /** Badge asset filename (e.g., "plan_badge_early_adopter.png") */
  badge?: string;
}
