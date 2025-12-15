/**
 * Hardcoded Plan Configuration for Ptah License Server
 *
 * This file defines the two available plans:
 * - free: Basic CLI wrapper features, never expires
 * - early_adopter: Premium SDK-powered features, 60-day trial
 *
 * Plans are hardcoded (not stored in database) to simplify the architecture
 * and postpone payment integration decisions.
 */

export const PLANS = {
  free: {
    name: 'Free',
    features: [
      'basic_cli_wrapper',
      'session_history',
      'permission_management',
      'mcp_configuration',
    ],
    expiresAfterDays: null, // Never expires
    isPremium: false,
    description: 'Beautiful UI for Claude CLI',
  },
  early_adopter: {
    name: 'Early Adopter',
    features: [
      'all_premium_features',
      'sdk_access',
      'custom_tools',
      'workspace_semantic_search',
      'editor_context_awareness',
      'git_workspace_info',
    ],
    expiresAfterDays: 60, // 2 months
    futurePrice: 8, // USD/month when payments launch
    isPremium: true,
    description: 'SDK-powered workspace tools + all free features',
  },
} as const;

/**
 * Type-safe plan name enum derived from PLANS object
 */
export type PlanName = keyof typeof PLANS;

/**
 * Get plan configuration by plan name
 *
 * @param plan - The plan name ('free' | 'early_adopter')
 * @returns The plan configuration object
 */
export function getPlanConfig(plan: PlanName) {
  return PLANS[plan];
}

/**
 * Calculate expiration date for a plan
 *
 * @param plan - The plan name ('free' | 'early_adopter')
 * @returns The expiration date, or null if the plan never expires
 *
 * @example
 * calculateExpirationDate('free') // null (never expires)
 * calculateExpirationDate('early_adopter') // Date 60 days from now
 */
export function calculateExpirationDate(plan: PlanName): Date | null {
  const config = PLANS[plan];

  if (config.expiresAfterDays === null) {
    return null; // Free plan never expires
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.expiresAfterDays);
  return expiresAt;
}
