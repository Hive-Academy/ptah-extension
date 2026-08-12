/**
 * Plan Configuration for Ptah License Server
 *
 * Open-source + Builders model (exactly two tiers):
 * - community: FREE and open source. The full Ptah coding orchestra runs
 *   locally at no cost — every local capability is included.
 * - builders: "Ptah Builders" — the paid membership tier that layers hosted,
 *   community and priority perks on top of the open-source core. Billing is
 *   managed by Paddle; the Paddle price IDs are env-driven
 *   (PADDLE_PRICE_ID_BUILDERS_MONTHLY / PADDLE_PRICE_ID_BUILDERS_YEARLY).
 *
 * Legacy 'pro' / 'trial_pro' plans have been removed entirely (zero paying
 * subscribers existed). Nothing resolves on those plans anymore.
 *
 * Plans are hardcoded (not stored in database) to simplify the architecture.
 * Paddle manages billing cycles and promotional pricing for the Builders plan.
 * Community tier has no Paddle integration - it's always free.
 */

export const PLANS = {
  community: {
    name: 'Community',
    features: [
      // Everything that runs locally is free and open source.
      'basic_cli_wrapper',
      'session_history',
      'permission_management',
      'sdk_access',
      'real_time_streaming',
      'workspace_context',
      'workspace_intelligence',
      'mcp_server',
      'custom_tools',
      'setup_wizard',
      'cost_tracking',
      'openrouter_proxy',
    ],
    expiresAfterDays: null, // Never expires - FREE forever
    monthlyPrice: 0, // FREE
    yearlyPrice: 0, // FREE
    isPremium: false,
    description: 'Free and open source — the full Ptah coding orchestra',
  },
  builders: {
    name: 'Ptah Builders',
    features: [
      'all_community_features',
      'builders_membership',
      'priority_support',
      'hosted_gateway',
      'early_access',
      'community_access',
    ],
    // Subscription-based: expiration is driven by the Paddle billing cycle,
    // never by a fixed day count.
    expiresAfterDays: null,
    // Display pricing only — actual charges are governed by the env-driven
    // Paddle price IDs (PADDLE_PRICE_ID_BUILDERS_MONTHLY / _YEARLY).
    monthlyPrice: 29, // USD/month (display)
    yearlyPrice: 290, // USD/year (display, ~17% discount)
    isPremium: true,
    description:
      'The Ptah Builders membership — hosted perks, priority support and early access on top of the open-source core',
  },
} as const;

/**
 * Type-safe plan name enum derived from PLANS object
 */
export type PlanName = keyof typeof PLANS;

/**
 * Get plan configuration by plan name
 *
 * @param plan - The plan name ('community' | 'builders')
 * @returns The plan configuration object
 */
export function getPlanConfig(plan: PlanName): (typeof PLANS)[PlanName] {
  return PLANS[plan];
}

/**
 * Calculate expiration date for a plan
 *
 * Community is FREE forever, Builders is subscription-based (Paddle).
 * This function always returns null since:
 * - Community tier never expires (FREE forever)
 * - Builders/Pro tier expiration is determined by subscription billing cycle
 *
 * @param plan - The plan name ('community' | 'builders')
 * @returns Always null (Community never expires, paid tiers managed by Paddle)
 *
 * @example
 * calculateExpirationDate('community') // null (FREE forever)
 * calculateExpirationDate('builders') // null (subscription managed by Paddle)
 */
export function calculateExpirationDate(plan: PlanName): Date | null {
  const config = PLANS[plan];

  if (config.expiresAfterDays === null) {
    return null; // All plans are subscription-based
  }
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.expiresAfterDays);
  return expiresAt;
}
