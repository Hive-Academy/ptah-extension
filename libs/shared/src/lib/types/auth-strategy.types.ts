/**
 * Authentication Strategy Types - TASK_AUTH_REFACTOR Phase 1
 *
 * The 5 strategies map 1:1 to actual authentication flows:
 * - api-key:       Direct API key (Anthropic, OpenRouter, Moonshot, Z.AI)
 * - oauth-proxy:   OAuth token + translation proxy (Copilot, Codex)
 * - local-native:  Local server speaking Anthropic API (Ollama v0.14+)
 * - local-proxy:   Local server + translation proxy (LM Studio)
 * - cli:           Claude CLI credential store (~/.claude/)
 */

/** The 5 auth strategies, each corresponding to a distinct authentication flow */
export type AuthStrategyType =
  | 'api-key'
  | 'oauth-proxy'
  | 'local-native'
  | 'local-proxy'
  | 'cli';

/**
 * Legacy AuthMethod values stored in config and sent by frontend.
 * Kept for backward compatibility — the frontend continues sending these
 * via RPC, and settings files store these values.
 *
 * Identical to AuthMethod in rpc-auth.types.ts — this is a semantic alias
 * that signals "this is the stored/transmitted format, not the internal one."
 */
export type LegacyAuthMethod = 'apiKey' | 'claudeCli' | 'thirdParty';

/**
 * Map a legacy auth method + provider metadata to the correct strategy.
 *
 * This is the canonical translation point between the legacy config format
 * and the new strategy system. Called at the backend boundary (AuthManager)
 * to select the correct IAuthStrategy.
 *
 * Decision tree:
 *   legacyMethod === 'claudeCli'                              → 'cli'
 *   legacyMethod === 'apiKey'                                 → 'api-key'
 *   legacyMethod === 'thirdParty' (i.e., "use a provider"):
 *     provider.authType === 'oauth' && provider.requiresProxy → 'oauth-proxy'
 *     provider.authType === 'none'  && !provider.requiresProxy→ 'local-native'
 *     provider.authType === 'none'  && provider.requiresProxy → 'local-proxy'
 *     otherwise (apiKey providers like OpenRouter/Moonshot/Z.AI)→ 'api-key'
 *
 * @param legacyMethod - The stored config value ('apiKey' | 'claudeCli' | 'thirdParty')
 * @param provider - Optional provider metadata from the provider registry
 */
export function resolveStrategy(
  legacyMethod: LegacyAuthMethod,
  provider?: {
    authType?: 'apiKey' | 'oauth' | 'none';
    requiresProxy?: boolean;
  },
): AuthStrategyType {
  if (legacyMethod === 'claudeCli') return 'cli';
  if (legacyMethod === 'apiKey') return 'api-key';

  // legacyMethod === 'thirdParty' — determine from provider entry
  if (!provider) return 'api-key'; // fallback when no provider metadata

  if (provider.authType === 'oauth' && provider.requiresProxy)
    return 'oauth-proxy';
  if (provider.authType === 'none' && !provider.requiresProxy)
    return 'local-native';
  if (provider.authType === 'none' && provider.requiresProxy)
    return 'local-proxy';

  return 'api-key'; // default for API-key providers (OpenRouter, Moonshot, Z.AI)
}
