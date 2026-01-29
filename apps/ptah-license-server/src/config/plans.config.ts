/**
 * Plan Configuration for Ptah License Server
 *
 * TASK_2025_128: Freemium Model Conversion
 *
 * Pricing Model:
 * - community: FREE forever - no subscription required, core visual editor features
 * - pro: $5/month or $50/year - All premium features (14-day trial)
 *
 * Plans are hardcoded (not stored in database) to simplify the architecture.
 * Paddle manages billing cycles, trials, and promotional pricing for Pro plan.
 * Community tier has no Paddle integration - it's always free.
 */

export const PLANS = {
  community: {
    name: 'Community',
    features: [
      'basic_cli_wrapper',
      'session_history',
      'permission_management',
      'sdk_access',
      'real_time_streaming',
      'basic_workspace_context',
      'openrouter_proxy', // TASK_2025_129: Available to all users
    ],
    expiresAfterDays: null, // Never expires - FREE forever
    monthlyPrice: 0, // FREE
    yearlyPrice: 0, // FREE
    isPremium: false,
    description: 'Free visual editor for Claude Code',
  },
  pro: {
    name: 'Pro',
    features: [
      'all_community_features',
      'mcp_server',
      'workspace_intelligence',
      'openrouter_proxy',
      'custom_tools',
      'setup_wizard',
      'cost_tracking',
      'priority_support',
    ],
    expiresAfterDays: null, // Subscription-based (managed by Paddle)
    monthlyPrice: 5, // USD/month
    yearlyPrice: 50, // USD/year (~17% discount)
    isPremium: true,
    description: 'Full workspace intelligence suite',
  },
} as const;

/**
 * Type-safe plan name enum derived from PLANS object
 */
export type PlanName = keyof typeof PLANS;

/**
 * Get plan configuration by plan name
 *
 * @param plan - The plan name ('community' | 'pro')
 * @returns The plan configuration object
 */
export function getPlanConfig(plan: PlanName): (typeof PLANS)[PlanName] {
  return PLANS[plan];
}

/**
 * Calculate expiration date for a plan
 *
 * TASK_2025_128: Community is FREE forever, Pro is subscription-based (Paddle).
 * This function always returns null since:
 * - Community tier never expires (FREE forever)
 * - Pro tier expiration is determined by subscription billing cycle
 *
 * @param plan - The plan name ('community' | 'pro')
 * @returns Always null (Community never expires, Pro managed by Paddle)
 *
 * @example
 * calculateExpirationDate('community') // null (FREE forever)
 * calculateExpirationDate('pro') // null (subscription managed by Paddle)
 */
export function calculateExpirationDate(plan: PlanName): Date | null {
  const config = PLANS[plan];

  if (config.expiresAfterDays === null) {
    return null; // All plans are subscription-based
  }

  // Note: This code path is unreachable with current plan configuration
  // Kept for potential future time-limited plans
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.expiresAfterDays);
  return expiresAt;
}
