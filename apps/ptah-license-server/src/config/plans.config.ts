/**
 * Plan Configuration for Ptah License Server
 *
 * Pricing Model:
 * - free: 14-day trial with all features (no credit card required)
 * - pro: $8/month or $80/year subscription with ongoing access
 *
 * Plans are hardcoded (not stored in database) to simplify the architecture.
 * Paddle manages billing cycles and promotional pricing.
 */

export const PLANS = {
  free: {
    name: 'Free Trial',
    features: [
      'basic_cli_wrapper',
      'session_history',
      'permission_management',
      'mcp_configuration',
      'sdk_access', // Include during trial
      'custom_tools', // Include during trial
    ],
    expiresAfterDays: 14, // 2-week free trial
    isPremium: false,
    description: '14-day trial with full access to all features',
  },
  pro: {
    name: 'Pro',
    features: [
      'all_premium_features',
      'sdk_access',
      'custom_tools',
      'workspace_semantic_search',
      'editor_context_awareness',
      'git_workspace_info',
      'priority_support',
      'unlimited_sessions',
    ],
    expiresAfterDays: null, // Subscription-based (managed by Paddle)
    monthlyPrice: 8, // USD/month
    yearlyPrice: 80, // USD/year (~17% discount)
    isPremium: true,
    description: 'Full workspace intelligence with ongoing updates',
  },
} as const;

/**
 * Type-safe plan name enum derived from PLANS object
 */
export type PlanName = keyof typeof PLANS;

/**
 * Get plan configuration by plan name
 *
 * @param plan - The plan name ('free' | 'pro')
 * @returns The plan configuration object
 */
export function getPlanConfig(plan: PlanName) {
  return PLANS[plan];
}

/**
 * Calculate expiration date for a plan
 *
 * @param plan - The plan name ('free' | 'pro')
 * @returns The expiration date, or null if subscription-based
 *
 * @example
 * calculateExpirationDate('free') // Date 14 days from now
 * calculateExpirationDate('pro') // null (subscription managed by Paddle)
 */
export function calculateExpirationDate(plan: PlanName): Date | null {
  const config = PLANS[plan];

  if (config.expiresAfterDays === null) {
    return null; // Pro plan is subscription-based
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.expiresAfterDays);
  return expiresAt;
}
