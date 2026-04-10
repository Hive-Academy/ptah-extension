/**
 * Authentication RPC Type Definitions
 *
 * Types for auth:getHealth, auth:saveSettings, auth:testConnection,
 * auth:copilotLogin/Logout/Status, auth:codexLogin, auth:getAuthStatus
 */

// ============================================================
// Authentication RPC Types (TASK_2025_057)
// ============================================================

/** Supported authentication methods */
export type AuthMethod = 'oauth' | 'apiKey' | 'openrouter' | 'auto';

/** Parameters for auth:getHealth RPC method */
export type AuthGetHealthParams = Record<string, never>;

/** Response from auth:getHealth RPC method */
export interface AuthGetHealthResponse {
  success: boolean;
  health: {
    status: string;
    lastCheck: number;
    errorMessage?: string;
    responseTime?: number;
    uptime?: number;
  };
}

/** Parameters for auth:saveSettings RPC method */
export interface AuthSaveSettingsParams {
  authMethod: AuthMethod;
  claudeOAuthToken?: string;
  anthropicApiKey?: string;
  /** Provider API key - used for OpenRouter, Moonshot, Z.AI, etc. */
  openrouterApiKey?: string;
  /** Selected Anthropic-compatible provider ID (TASK_2025_129 Batch 3) */
  anthropicProviderId?: string;
}

/** Response from auth:saveSettings RPC method */
export interface AuthSaveSettingsResponse {
  success: boolean;
  error?: string;
}

/** Parameters for auth:testConnection RPC method */
export type AuthTestConnectionParams = Record<string, never>;

/** Response from auth:testConnection RPC method */
export interface AuthTestConnectionResponse {
  success: boolean;
  health: {
    status: string;
    lastCheck: number;
    errorMessage?: string;
    responseTime?: number;
    uptime?: number;
  };
  errorMessage?: string;
}

// ============================================================
// Auth Status RPC Types (TASK_2025_076)
// ============================================================

/** Parameters for auth:copilotLogin RPC method */
export type AuthCopilotLoginParams = Record<string, never>;

/** Response from auth:copilotLogin RPC method */
export interface AuthCopilotLoginResponse {
  success: boolean;
  username?: string;
  error?: string;
}

/** Parameters for auth:copilotLogout RPC method */
export type AuthCopilotLogoutParams = Record<string, never>;

/** Response from auth:copilotLogout RPC method */
export interface AuthCopilotLogoutResponse {
  success: boolean;
}

/** Parameters for auth:copilotStatus RPC method */
export type AuthCopilotStatusParams = Record<string, never>;

/** Response from auth:copilotStatus RPC method */
export interface AuthCopilotStatusResponse {
  authenticated: boolean;
  username?: string;
}

/** Parameters for auth:codexLogin RPC method (TASK_2025_199) */
export type AuthCodexLoginParams = Record<string, never>;

/** Response from auth:codexLogin RPC method (TASK_2025_199) */
export interface AuthCodexLoginResponse {
  success: boolean;
  error?: string;
}

/** Parameters for auth:getAuthStatus RPC method */
export interface AuthGetAuthStatusParams {
  /** Optional provider ID to check key status for (defaults to persisted config value) */
  providerId?: string;
}

/**
 * Anthropic-compatible provider info for UI display (TASK_2025_129 Batch 3)
 *
 * NOTE: This interface mirrors `AnthropicProvider` from `@ptah-extension/agent-sdk`
 * (libs/backend/agent-sdk/src/lib/helpers/anthropic-provider-registry.ts) minus the
 * `baseUrl` field (which is backend-only). Any changes to the shared fields in
 * AnthropicProvider must be reflected here, and vice versa.
 * The `shared` library cannot import from `agent-sdk` due to dependency direction constraints.
 */
export interface AnthropicProviderInfo {
  /** Provider identifier */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** URL to obtain API keys */
  helpUrl: string;
  /** Expected key prefix (empty if none) */
  keyPrefix: string;
  /** Placeholder text for key input */
  keyPlaceholder: string;
  /** Masked key display text */
  maskedKeyDisplay: string;
  /** Whether this provider supports dynamic model listing via API (TASK_2025_132) */
  hasDynamicModels?: boolean;
  /** Authentication type: 'apiKey' (default), 'oauth' (e.g., GitHub Copilot), or 'none' (local providers) */
  authType?: 'apiKey' | 'oauth' | 'none';
  /** Whether this is a local provider (no API key needed) */
  isLocal?: boolean;
}

/**
 * Response from auth:getAuthStatus RPC method
 *
 * SECURITY: This response NEVER contains actual credential values.
 * Only boolean flags indicating whether credentials are configured.
 */
export interface AuthGetAuthStatusResponse {
  /** Whether OAuth token is configured in SecretStorage */
  hasOAuthToken: boolean;
  /** Whether API key is configured in SecretStorage */
  hasApiKey: boolean;
  /** Whether provider API key is configured for the currently selected provider */
  hasOpenRouterKey: boolean;
  /** Whether ANY provider has a key configured (covers all third-party providers) */
  hasAnyProviderKey?: boolean;
  /** Current auth method preference */
  authMethod: AuthMethod;
  /** Currently selected Anthropic-compatible provider ID (TASK_2025_129 Batch 3) */
  anthropicProviderId: string;
  /** Available Anthropic-compatible providers (TASK_2025_129 Batch 3) */
  availableProviders: AnthropicProviderInfo[];
  /** Whether Copilot OAuth is authenticated (TASK_2025_191) */
  copilotAuthenticated?: boolean;
  /** Connected GitHub username for Copilot (TASK_2025_191) */
  copilotUsername?: string;
  /** Whether Codex auth file exists and has valid tokens (TASK_2025_199) */
  codexAuthenticated?: boolean;
  /** Whether the Codex OAuth token is expired/stale (TASK_2025_199) */
  codexTokenStale?: boolean;
}
