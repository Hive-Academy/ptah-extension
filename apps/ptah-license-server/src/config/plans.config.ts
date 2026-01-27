/**
 * Plan Configuration for Ptah License Server
 *
 * TASK_2025_121: Two-Tier Paid Model
 *
 * Pricing Model:
 * - basic: $3/month or $30/year - Core visual editor features (14-day trial)
 * - pro: $5/month or $50/year - All premium features (14-day trial)
 *
 * Plans are hardcoded (not stored in database) to simplify the architecture.
 * Paddle manages billing cycles, trials, and promotional pricing.
 */

export const PLANS = {
  basic: {
    name: 'Basic',
    features: [
      'basic_cli_wrapper',
      'session_history',
      'permission_management',
      'sdk_access',
      'real_time_streaming',
      'basic_workspace_context',
    ],
    expiresAfterDays: null, // Subscription-based (managed by Paddle)
    monthlyPrice: 3, // USD/month
    yearlyPrice: 30, // USD/year (~17% discount)
    isPremium: false,
    description: 'Core visual editor for Claude Code',
  },
  pro: {
    name: 'Pro',
    features: [
      'all_basic_features',
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
 * @param plan - The plan name ('basic' | 'pro')
 * @returns The plan configuration object
 */
export function getPlanConfig(plan: PlanName): (typeof PLANS)[PlanName] {
  return PLANS[plan];
}

/**
 * Calculate expiration date for a plan
 *
 * TASK_2025_121: Both Basic and Pro are subscription-based (managed by Paddle).
 * This function always returns null since there are no time-limited plans.
 * Expiration is determined by subscription billing cycle, not plan type.
 *
 * @param plan - The plan name ('basic' | 'pro')
 * @returns Always null (subscription managed by Paddle)
 *
 * @example
 * calculateExpirationDate('basic') // null (subscription managed by Paddle)
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
