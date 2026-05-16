/**
 * Codex Provider Types
 *
 * Codex-specific types for OpenAI Codex provider authentication
 * and proxy configuration. Mirrors the auth file structure used
 * by the Codex CLI (~/.codex/auth.json).
 */

// ---------------------------------------------------------------------------
// Codex Constants
// ---------------------------------------------------------------------------

/** Placeholder API key used when the translation proxy manages auth internally */
export const CODEX_PROXY_TOKEN_PLACEHOLDER = 'codex-proxy-managed';

/** Sentinel value identifying a Codex OAuth-based provider configuration */
export const CODEX_OAUTH_SENTINEL = 'codex-oauth';

// ---------------------------------------------------------------------------
// Codex Authentication Types
// ---------------------------------------------------------------------------

/**
 * Shape of the ~/.codex/auth.json file written by the Codex CLI.
 * Supports both API key authentication and OAuth token-based authentication.
 *
 * @see codex-cli.adapter.ts for the original definition
 */
export interface CodexAuthFile {
  /** Authentication mode */
  auth_mode?: 'ApiKey' | 'Chatgpt' | 'ChatgptAuthTokens';
  /**
   * Direct OpenAI API key (takes priority over OAuth tokens).
   * Codex CLI serializes this as snake_case in the JSON file.
   */
  openai_api_key?: string | null;
  /** @deprecated Legacy uppercase variant — check both for safety */
  OPENAI_API_KEY?: string | null;
  /** OAuth tokens obtained via Codex CLI login */
  tokens?: {
    /** OAuth access token for API authentication */
    access_token?: string;
    /** OAuth refresh token for token renewal */
    refresh_token?: string;
    /** OpenID Connect ID token */
    id_token?: string;
    /** OpenAI account identifier */
    account_id?: string;
  };
  /** ISO 8601 timestamp of the last token refresh */
  last_refresh?: string;
  /** Custom API base URL (overrides default endpoint) */
  api_base_url?: string;
}

/**
 * Codex authentication service interface.
 * Handles file-based auth from ~/.codex/auth.json.
 *
 * Unlike CopilotAuthService, Codex auth is managed externally via the `codex` CLI.
 * There is no login() method -- users must run `codex login` to authenticate.
 */
export interface ICodexAuthService {
  /** Check whether valid Codex credentials are available */
  isAuthenticated(): Promise<boolean>;
  /** Get HTTP headers required for Codex API requests */
  getHeaders(): Promise<Record<string, string>>;
  /** Get the Codex API base endpoint URL (API key mode or user-configured OAuth endpoint) */
  getApiEndpoint(): string;
  /** Check if credentials are available and not stale. Returns false if OAuth token needs re-login. */
  ensureTokensFresh(): Promise<boolean>;
  /** Invalidate the in-memory auth file cache, forcing next read from disk */
  clearCache(): void;
  /**
   * Get the current Codex token status for auth UI display.
   * Returns whether credentials exist and whether OAuth tokens are stale.
   */
  getTokenStatus(): Promise<{ authenticated: boolean; stale: boolean }>;
}
