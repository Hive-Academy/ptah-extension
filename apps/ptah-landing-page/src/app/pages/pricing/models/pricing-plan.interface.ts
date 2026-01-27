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
