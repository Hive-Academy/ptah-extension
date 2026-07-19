/**
 * LicenseData Interface
 *
 * Data model for user account information fetched from backend API.
 * MUST match backend response from GET /api/v1/licenses/me
 *
 * Backend API: GET /api/v1/licenses/me
 * Evidence: apps/ptah-license-server/src/license/controllers/license.controller.ts
 *
 * Open-source + Ptah Builders model:
 * - Ptah itself (VS Code extension, Electron app, CLI) is free and open
 *   source — every user gets the 'community' plan with the full local
 *   product, forever.
 * - 'builders' is the paid Ptah Builders membership: hosted perks, priority
 *   support and community/early-access on top of the open-source core.
 * - 'pro' and 'trial_pro' are LEGACY plan values. Existing paying/trialing
 *   subscribers keep resolving on these while they drain naturally; nothing
 *   new is ever issued on them. Treat them as Builders-equivalent for
 *   display purposes.
 */

/** User profile information */
export interface UserInfo {
  /** User email address */
  email: string;

  /** User first name (optional) */
  firstName: string | null;

  /** User last name (optional) */
  lastName: string | null;

  /** Account creation date (ISO 8601) */
  memberSince: string;

  /** Whether email has been verified */
  emailVerified: boolean;
}

/** Subscription information for Builders/legacy Pro users */
export interface SubscriptionInfo {
  /** Subscription status: active, paused, canceled, past_due */
  status: string;

  /** Current billing period end date (ISO 8601) */
  currentPeriodEnd: string;

  /** Cancellation date if canceled (ISO 8601) */
  canceledAt: string | null;
}

/**
 * License plan identifier.
 *
 * - 'community': Free and open source, always valid, no subscription.
 * - 'builders': Paid Ptah Builders membership (current premium tier).
 * - 'pro' / 'trial_pro': LEGACY paid/trialing plans, kept only so existing
 *   subscribers keep working. Display as Builders-equivalent.
 */
export type LicensePlan = 'community' | 'builders' | 'pro' | 'trial_pro';

/** Complete license/account data from API */
export interface LicenseData {
  /** User profile information */
  user: UserInfo;

  /** License plan identifier (see {@link LicensePlan}) */
  plan: LicensePlan;

  /** Human-readable plan name */
  planName: string;

  /** Plan description */
  planDescription: string;

  /** License status */
  status: 'active' | 'none' | 'expired';

  /** Expiration date (ISO 8601, null for lifetime/subscription) */
  expiresAt: string | null;

  /** Days remaining until expiration */
  daysRemaining?: number;

  /** License creation date (ISO 8601) */
  licenseCreatedAt?: string;

  /** Features included in this plan */
  features: string[];

  /** Message for users without active license */
  message?: string;

  /** Subscription info for Builders/legacy Pro users with a Paddle subscription */
  subscription: SubscriptionInfo | null;

  /**
   * Reason for license status when not active
   *
   * - 'trial_ended': Trial period has concluded
   * - 'expired': License/subscription has expired
   *
   * Note: Only these two values are returned by the backend.
   * Returns undefined for active licenses.
   */
  reason?: 'trial_ended' | 'expired';

  /**
   * Whether Ptah Builders checkout is currently open (mirrors the server's
   * BUILDERS_CHECKOUT_ENABLED flag). While false, upgrade CTAs should route
   * to the waitlist instead of Paddle checkout.
   */
  checkoutEnabled: boolean;
}

/**
 * Whether a plan value is a Ptah Builders membership (current or legacy).
 * Legacy 'pro'/'trial_pro' subscribers are treated as Builders-equivalent
 * so paying members keep feeling first-class.
 */
export function isBuildersTier(plan: LicensePlan | null | undefined): boolean {
  return plan === 'builders' || plan === 'pro' || plan === 'trial_pro';
}

/**
 * Whether the given license reflects an active Builders membership, i.e. a
 * Builders-equivalent plan with no trial-ended/expired reason attached.
 */
export function hasActiveMembership(
  license: Pick<LicenseData, 'plan' | 'reason'> | null | undefined,
): boolean {
  return isBuildersTier(license?.plan) && !license?.reason;
}

/** Feature display configuration */
export interface FeatureDisplay {
  /** Feature key from backend */
  key: string;

  /** Human-readable label */
  label: string;

  /** Feature description */
  description: string;

  /**
   * Category for grouping:
   * - 'core': part of the free, open-source product.
   * - 'builders': part of the paid Ptah Builders membership.
   */
  category: 'core' | 'builders';
}

/**
 * Feature display mapping.
 *
 * Keys mirror `PLANS[*].features` in
 * `apps/ptah-license-server/src/config/plans.config.ts` exactly (community,
 * builders and legacy pro all draw from this same map).
 */
export const FEATURE_DISPLAY_MAP: Record<string, FeatureDisplay> = {
  // --- Community (open-source core) ---
  basic_cli_wrapper: {
    key: 'basic_cli_wrapper',
    label: 'AI Coding Orchestra',
    description: 'VS Code, Electron and CLI runtimes on the Claude Agent SDK',
    category: 'core',
  },
  session_history: {
    key: 'session_history',
    label: 'Session History',
    description: 'Access and manage your full conversation history',
    category: 'core',
  },
  permission_management: {
    key: 'permission_management',
    label: 'Permission Management',
    description: 'Fine-grained control over agent permissions',
    category: 'core',
  },
  sdk_access: {
    key: 'sdk_access',
    label: 'Agent SDK Access',
    description: 'Direct Claude Agent SDK integration',
    category: 'core',
  },
  real_time_streaming: {
    key: 'real_time_streaming',
    label: 'Real-Time Streaming',
    description: 'Live streamed agent output as it happens',
    category: 'core',
  },
  workspace_context: {
    key: 'workspace_context',
    label: 'Workspace Context',
    description: 'Automatic context from your active editor',
    category: 'core',
  },
  workspace_intelligence: {
    key: 'workspace_intelligence',
    label: 'Workspace Intelligence',
    description: 'AST-aware codebase search and navigation',
    category: 'core',
  },
  mcp_server: {
    key: 'mcp_server',
    label: 'MCP Server',
    description: 'Model Context Protocol server management',
    category: 'core',
  },
  custom_tools: {
    key: 'custom_tools',
    label: 'Custom Tools',
    description: 'Create and configure custom MCP tools',
    category: 'core',
  },
  setup_wizard: {
    key: 'setup_wizard',
    label: 'Setup Wizard',
    description: 'Guided onboarding for every workspace',
    category: 'core',
  },
  cost_tracking: {
    key: 'cost_tracking',
    label: 'Cost Tracking',
    description: 'Track token spend across providers',
    category: 'core',
  },
  openrouter_proxy: {
    key: 'openrouter_proxy',
    label: 'OpenRouter Proxy',
    description: 'Bring your own model via OpenRouter',
    category: 'core',
  },
  all_community_features: {
    key: 'all_community_features',
    label: 'The Full Open-Source Core',
    description: 'Everything in Community, included',
    category: 'core',
  },

  // --- Ptah Builders (paid membership) ---
  builders_membership: {
    key: 'builders_membership',
    label: 'Builders Membership',
    description: 'Official Ptah Builders membership status',
    category: 'builders',
  },
  priority_support: {
    key: 'priority_support',
    label: 'Priority Support',
    description: 'Fast-tracked support and feature requests',
    category: 'builders',
  },
  hosted_gateway: {
    key: 'hosted_gateway',
    label: 'Hosted Gateway',
    description: 'Managed Telegram/Discord/Slack gateway, no self-hosting',
    category: 'builders',
  },
  early_access: {
    key: 'early_access',
    label: 'Early Access',
    description: 'First access to new features and skills',
    category: 'builders',
  },
  community_access: {
    key: 'community_access',
    label: 'Builders Community',
    description: 'Access to the private Ptah Builders community',
    category: 'builders',
  },
};
