/**
 * LicenseData Interface
 *
 * Data model for user account information fetched from backend API.
 * MUST match backend response from GET /api/v1/licenses/me
 *
 * Backend API: GET /api/v1/licenses/me
 * Evidence: apps/ptah-license-server/src/license/controllers/license.controller.ts
 *
 * Open-source + Ptah Builders model. There are no legacy tiers — zero
 * paying subscribers exist pre-launch:
 * - Ptah itself (VS Code extension, Electron app, CLI) is free and open
 *   source — every user gets the 'community' plan with the full local
 *   product, forever.
 * - 'builders' is the paid Ptah Builders membership: hosted perks, priority
 *   support and community/early-access on top of the open-source core.
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

/**
 * A member's cohort/group membership, as surfaced by `/licenses/me` and
 * `/members/sessions`. `key` is the immutable slug assigned by the admin
 * (e.g. `'founding'`); `name` is the display name for that cohort.
 */
export interface MemberGroupBadge {
  key: string;
  name: string;
}

/** Subscription information for Builders members */
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
 * - 'builders': Paid Ptah Builders membership (the only paid tier).
 */
export type LicensePlan = 'community' | 'builders';

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

  /** Subscription info for Builders members with a Paddle subscription */
  subscription: SubscriptionInfo | null;

  /**
   * Reason for license status when not active
   *
   * - 'expired': License/subscription has expired
   *
   * Note: Only this value is returned by the backend.
   * Returns undefined for active licenses.
   */
  reason?: 'expired';

  /**
   * Whether Ptah Builders checkout is currently open (mirrors the server's
   * BUILDERS_CHECKOUT_ENABLED flag). While false, upgrade CTAs should route
   * to the waitlist instead of Paddle checkout.
   */
  checkoutEnabled: boolean;

  /**
   * Cohort/group memberships (e.g. the founding cohort). Optional — absent
   * on older cached responses; empty or missing for non-members and members
   * with no group assignment.
   */
  memberGroups?: MemberGroupBadge[];
}

/** Whether a plan value is a Ptah Builders membership. */
export function isBuildersTier(plan: LicensePlan | null | undefined): boolean {
  return plan === 'builders';
}

/**
 * Whether the given license reflects an active Builders membership, i.e. a
 * Builders plan with no expired reason attached.
 */
export function hasActiveMembership(
  license: Pick<LicenseData, 'plan' | 'reason'> | null | undefined,
): boolean {
  return isBuildersTier(license?.plan) && !license?.reason;
}

/**
 * Whether a {@link MemberGroupBadge} is the seeded founding cohort — gets the
 * amber "Founding Member" chip treatment on `/members` and `/profile`.
 */
export function isFoundingMemberGroup(group: MemberGroupBadge): boolean {
  return group.key === 'founding';
}

/**
 * Display label for a cohort chip: `'Founding Member'` for the founding
 * cohort, the group's own `name` for every other cohort.
 */
export function getMemberGroupBadgeLabel(group: MemberGroupBadge): string {
  return isFoundingMemberGroup(group) ? 'Founding Member' : group.name;
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
 * `apps/ptah-license-server/src/config/plans.config.ts` exactly (community
 * and builders draw from this same map).
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
