/**
 * OpenRouter Provider Types
 *
 * OpenRouter-specific constants and service interface for the translation proxy
 * pattern. Unlike OpenRouter's previous direct-passthrough mode (SDK →
 * https://openrouter.ai/api/v1/messages), this module routes through a local
 * HTTP proxy that translates Anthropic Messages format to OpenAI Chat
 * Completions format, enabling ALL OpenRouter models (not just Anthropic-family)
 * to work with the Claude Agent SDK.
 *
 * Mirrors the Copilot/Codex translation proxy pattern.
 */

// ---------------------------------------------------------------------------
// OpenRouter Constants
// ---------------------------------------------------------------------------

/** Placeholder API key used when the translation proxy manages auth internally */
export const OPENROUTER_PROXY_TOKEN_PLACEHOLDER = 'openrouter-proxy-token';

// ---------------------------------------------------------------------------
// OpenRouter Authentication Service Interface
// ---------------------------------------------------------------------------

/**
 * OpenRouter authentication service interface.
 *
 * Unlike Copilot (OAuth + token exchange + refresh) or Codex (file-based OAuth),
 * OpenRouter uses a simple per-user API key read directly from SecretStorage.
 * There is no login flow, no token refresh, no expiry handling.
 */
export interface IOpenRouterAuthService {
  /** Check whether a valid OpenRouter API key is available in SecretStorage */
  isAuthenticated(): Promise<boolean>;

  /** Retrieve the raw OpenRouter API key, or null if not configured */
  getApiKey(): Promise<string | null>;

  /**
   * Get the HTTP headers required for OpenRouter API requests.
   * Includes:
   * - Authorization: Bearer <key>
   * - Content-Type: application/json
   * - HTTP-Referer / X-Title: OpenRouter-recommended ranking headers so Ptah
   *   appears in OpenRouter's app leaderboard.
   *
   * @throws Error if the OpenRouter API key is not configured
   */
  getHeaders(): Promise<Record<string, string>>;
}
