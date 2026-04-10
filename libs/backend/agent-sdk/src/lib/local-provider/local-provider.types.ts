/**
 * Local Provider Types - TASK_2025_265
 *
 * Types and constants for local model providers (Ollama, LM Studio).
 * These providers require no authentication and run on localhost.
 */

/** Placeholder API key used when the translation proxy manages auth internally */
export const LOCAL_PROXY_TOKEN_PLACEHOLDER = 'local-proxy-managed';

/** IDs of all local providers */
export const LOCAL_PROVIDER_IDS = ['ollama', 'lm-studio'] as const;

/** Type guard: is this provider ID a local provider? */
export function isLocalProviderId(id: string): boolean {
  return LOCAL_PROVIDER_IDS.includes(id as (typeof LOCAL_PROVIDER_IDS)[number]);
}
