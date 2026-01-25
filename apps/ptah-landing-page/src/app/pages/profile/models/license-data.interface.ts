/**
 * LicenseData Interface
 *
 * Data model for user account information fetched from backend API.
 * MUST match backend response from GET /api/v1/licenses/me
 *
 * Backend API: GET /api/v1/licenses/me
 * Evidence: apps/ptah-license-server/src/license/controllers/license.controller.ts
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

/** Subscription information for Pro users */
export interface SubscriptionInfo {
  /** Subscription status: active, paused, canceled, past_due */
  status: string;

  /** Current billing period end date (ISO 8601) */
  currentPeriodEnd: string;

  /** Cancellation date if canceled (ISO 8601) */
  canceledAt: string | null;
}

/** Complete license/account data from API */
export interface LicenseData {
  /** User profile information */
  user: UserInfo;

  /** License plan identifier */
  plan: 'free' | 'early_adopter' | 'pro';

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

  /** Subscription info for Pro users with Paddle subscription */
  subscription: SubscriptionInfo | null;
}

/** Feature display configuration */
export interface FeatureDisplay {
  /** Feature key from backend */
  key: string;

  /** Human-readable label */
  label: string;

  /** Feature description */
  description: string;

  /** Category for grouping */
  category: 'core' | 'advanced' | 'enterprise';
}

/** Feature display mapping */
export const FEATURE_DISPLAY_MAP: Record<string, FeatureDisplay> = {
  basic_cli_wrapper: {
    key: 'basic_cli_wrapper',
    label: 'Claude CLI Integration',
    description: 'Seamless VS Code integration with Claude Code CLI',
    category: 'core',
  },
  session_history: {
    key: 'session_history',
    label: 'Session History',
    description: 'Access and manage your conversation history',
    category: 'core',
  },
  permission_management: {
    key: 'permission_management',
    label: 'Permission Management',
    description: 'Fine-grained control over Claude permissions',
    category: 'core',
  },
  mcp_configuration: {
    key: 'mcp_configuration',
    label: 'MCP Configuration',
    description: 'Model Context Protocol server management',
    category: 'core',
  },
  sdk_access: {
    key: 'sdk_access',
    label: 'Agent SDK Access',
    description: '10x faster responses with direct SDK integration',
    category: 'advanced',
  },
  custom_tools: {
    key: 'custom_tools',
    label: 'Custom Tools',
    description: 'Create and configure custom MCP tools',
    category: 'advanced',
  },
  workspace_semantic_search: {
    key: 'workspace_semantic_search',
    label: 'Semantic Search',
    description: 'AI-powered codebase search and navigation',
    category: 'advanced',
  },
  editor_context_awareness: {
    key: 'editor_context_awareness',
    label: 'Editor Context',
    description: 'Automatic context from your active editor',
    category: 'advanced',
  },
  git_workspace_info: {
    key: 'git_workspace_info',
    label: 'Git Integration',
    description: 'Git-aware workspace intelligence',
    category: 'advanced',
  },
  all_premium_features: {
    key: 'all_premium_features',
    label: 'All Premium Features',
    description: 'Full access to current and future premium features',
    category: 'enterprise',
  },
  priority_support: {
    key: 'priority_support',
    label: 'Priority Support',
    description: 'Fast-track support and feature requests',
    category: 'enterprise',
  },
  unlimited_sessions: {
    key: 'unlimited_sessions',
    label: 'Unlimited Sessions',
    description: 'No limits on concurrent sessions',
    category: 'enterprise',
  },
};
