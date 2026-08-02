/**
 * Authentication Strategy Types
 *
 * The 5 strategies map 1:1 to actual authentication flows:
 * - api-key:       Direct API key (Anthropic, OpenRouter, Moonshot, Z.AI)
 * - oauth-proxy:   OAuth token + translation proxy (Copilot, Codex)
 * - local-native:  Local server speaking Anthropic API (Ollama v0.14+)
 * - local-proxy:   Local server + translation proxy (LM Studio)
 * - cli:           AMBIENT credentials — the host's `~/.claude` login created by
 *                  the Claude CLI. This is the "Claude (Subscription)" route:
 *                  no base-url override, no auth token, no reachability probe.
 *                  The Agent SDK stays on its default credential chain.
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
 * to select the correct IAuthStrategy. Because EVERY save path (Electron
 * webview, VS Code webview, TUI, `ptah auth`) funnels through this function,
 * routing decisions belong here and nowhere else — a per-caller special case
 * would silently diverge on the surfaces that forgot it.
 *
 * Decision tree:
 *   legacyMethod === 'claudeCli'                              → 'cli'
 *   legacyMethod === 'apiKey'                                 → 'api-key'
 *   legacyMethod === 'thirdParty' (i.e., "use a provider"):
 *     provider.nativeAuth === true                            → 'cli'
 *     provider.authType === 'oauth' && provider.requiresProxy → 'oauth-proxy'
 *     provider.authType === 'none'  && !provider.requiresProxy→ 'local-native'
 *     provider.authType === 'none'  && provider.requiresProxy → 'local-proxy'
 *     otherwise (apiKey providers like OpenRouter/Moonshot/Z.AI)→ 'api-key'
 *
 * The `nativeAuth` test MUST come first. `claude-cli` ("Claude
 * (Subscription)") is declared `authType: 'none'` with no proxy, which is
 * byte-identical to Ollama's declaration — without the `nativeAuth`
 * short-circuit it fell into `local-native`, where `LocalNativeStrategy`
 * probed an Ollama daemon on 127.0.0.1:11434 and then set
 * `ANTHROPIC_BASE_URL=''` plus an Ollama placeholder token, destroying the
 * ambient `~/.claude` login the tile exists to use. `nativeAuth` providers
 * must reach a strategy that writes NO auth env at all — that is `'cli'`.
 *
 * @param legacyMethod - The stored config value ('apiKey' | 'claudeCli' | 'thirdParty')
 * @param provider - Optional provider metadata from the provider registry
 */
export function resolveStrategy(
  legacyMethod: LegacyAuthMethod,
  provider?: {
    authType?: 'apiKey' | 'oauth' | 'none';
    requiresProxy?: boolean;
    nativeAuth?: boolean;
  },
): AuthStrategyType {
  if (legacyMethod === 'claudeCli') return 'cli';
  if (legacyMethod === 'apiKey') return 'api-key';
  if (!provider) return 'api-key'; // fallback when no provider metadata

  // Ambient/subscription credentials (`claude-cli`): leave the Agent SDK on
  // its default credential chain. Checked before authType/proxy because a
  // nativeAuth provider is otherwise indistinguishable from a local one.
  if (provider.nativeAuth === true) return 'cli';

  if (provider.authType === 'oauth' && provider.requiresProxy)
    return 'oauth-proxy';
  if (provider.authType === 'none' && !provider.requiresProxy)
    return 'local-native';
  if (provider.authType === 'none' && provider.requiresProxy)
    return 'local-proxy';

  // Default for API-key providers (OpenRouter, Moonshot, Z.AI, Sakana).
  // apiKey providers with requiresProxy:true (Sakana) also land here — the
  // ApiKeyStrategy starts the translation proxy internally; no separate route.
  return 'api-key';
}

/**
 * Normalize any persisted `authMethod` value (legacy or new spelling) to the
 * canonical `LegacyAuthMethod` triad. Defaults to `'apiKey'` on unknown input.
 *
 * Mapping (first match wins, default `'apiKey'`):
 *   'apiKey'                              → 'apiKey'
 *   'claudeCli' | 'claude-cli'            → 'claudeCli'
 *   'thirdParty' | 'oauth' | 'openrouter' → 'thirdParty'
 *   anything else                         → 'apiKey'
 */
export function normalizeAuthMethod(rawValue: unknown): LegacyAuthMethod {
  if (typeof rawValue !== 'string') {
    return 'apiKey';
  }

  if (rawValue === 'apiKey') return 'apiKey';
  if (rawValue === 'claudeCli' || rawValue === 'claude-cli') return 'claudeCli';
  if (
    rawValue === 'thirdParty' ||
    rawValue === 'oauth' ||
    rawValue === 'openrouter'
  ) {
    return 'thirdParty';
  }

  return 'apiKey';
}
