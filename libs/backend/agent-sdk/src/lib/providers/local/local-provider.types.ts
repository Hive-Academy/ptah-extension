/**
 * Local Provider Types
 *
 * Types and constants for Ollama and LM Studio providers.
 * Ollama providers use Anthropic-native API (no proxy).
 * LM Studio uses OpenAI translation proxy.
 */

/** Placeholder API key used when the translation proxy manages auth internally */
export const LOCAL_PROXY_TOKEN_PLACEHOLDER = 'local-proxy-managed';

/** Placeholder token for Ollama providers (Anthropic-native, no proxy) */
export const OLLAMA_AUTH_TOKEN_PLACEHOLDER = 'ollama';

/** IDs of all local providers that use a translation proxy (OpenAI-compat) */
export const LOCAL_PROXY_PROVIDER_IDS = ['lm-studio'] as const;

/** IDs of all Ollama-family providers (Anthropic-native, no proxy) */
export const OLLAMA_PROVIDER_IDS = ['ollama', 'ollama-cloud'] as const;

/** IDs of all local/no-auth providers (union of proxy + Ollama) */
export const LOCAL_PROVIDER_IDS = [
  ...OLLAMA_PROVIDER_IDS,
  ...LOCAL_PROXY_PROVIDER_IDS,
] as const;

/** Type guard: is this provider ID a local provider? */
export function isLocalProviderId(id: string): boolean {
  return LOCAL_PROVIDER_IDS.includes(id as (typeof LOCAL_PROVIDER_IDS)[number]);
}

/** Type guard: is this an Ollama-family provider (Anthropic-native)? */
export function isOllamaProviderId(id: string): boolean {
  return OLLAMA_PROVIDER_IDS.includes(
    id as (typeof OLLAMA_PROVIDER_IDS)[number],
  );
}
