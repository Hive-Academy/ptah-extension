/**
 * PricingPlan Interface
 *
 * Data model for pricing plan cards.
 * Used to display Free, Early Adopter, and Pro tiers.
 *
 * Evidence: implementation-plan.md Phase 2 - Pricing Page
 * Design Spec: developer-handoff.md:110-223
 */
export interface PricingPlan {
  /** Display name (e.g., "Early Adopter") */
  name: string;

  /** Tier identifier for programmatic use */
  tier: 'free' | 'early_adopter' | 'pro';

  /** Display price (e.g., "$49" or "$99/mo") */
  price: string;

  /** Paddle price ID for checkout integration (optional) */
  priceId?: string;

  /** List of feature descriptions */
  features: string[];

  /** Call-to-action button text */
  ctaText: string;

  /** CTA action type */
  ctaAction: 'download' | 'checkout';

  /** Whether this plan should be highlighted (default: false) */
  highlight?: boolean;

  /** Badge asset filename (e.g., "plan_badge_early_adopter.png") */
  badge?: string;
}
