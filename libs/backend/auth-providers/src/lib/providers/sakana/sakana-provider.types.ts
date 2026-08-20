/**
 * Sakana Provider Types
 *
 * Sakana-specific constants and service interface for the translation proxy
 * pattern. Sakana's API is OpenAI-compatible (Chat Completions + Responses),
 * so requests route through a local HTTP proxy that translates Anthropic
 * Messages format to OpenAI Chat Completions format, enabling Fugu models to
 * work with the Claude Agent SDK.
 *
 * Mirrors the OpenRouter translation proxy pattern.
 */

/** Placeholder API key used when the translation proxy manages auth internally */
export const SAKANA_PROXY_TOKEN_PLACEHOLDER = 'sakana-proxy-token';

/**
 * Sakana authentication service interface.
 *
 * Like OpenRouter, Sakana uses a simple per-user API key read directly from
 * SecretStorage. There is no login flow, no token refresh, no expiry handling.
 */
export interface ISakanaAuthService {
  /** Check whether a valid Sakana API key is available in SecretStorage */
  isAuthenticated(): Promise<boolean>;

  /** Retrieve the raw Sakana API key, or null if not configured */
  getApiKey(): Promise<string | null>;

  /**
   * Get the HTTP headers required for Sakana API requests.
   * Includes:
   * - Authorization: Bearer <key>
   * - Content-Type: application/json
   *
   * @throws SdkError if the Sakana API key is not configured
   */
  getHeaders(): Promise<Record<string, string>>;
}
