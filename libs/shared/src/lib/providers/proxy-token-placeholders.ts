/**
 * Placeholder tokens written into AuthEnv.ANTHROPIC_AUTH_TOKEN when a
 * translation proxy is managing real authentication internally.
 *
 * Shared between `@ptah-extension/agent-sdk` (writes the placeholder into
 * SDK Options.env) and `@ptah-extension/auth-providers` (the proxies
 * recognise their own placeholder when checking whether they are the
 * active route).
 */

export const COPILOT_PROXY_TOKEN_PLACEHOLDER = 'copilot-proxy-managed';
export const CODEX_PROXY_TOKEN_PLACEHOLDER = 'codex-proxy-managed';
export const OPENROUTER_PROXY_TOKEN_PLACEHOLDER = 'openrouter-proxy-token';
export const SAKANA_PROXY_TOKEN_PLACEHOLDER = 'sakana-proxy-token';
export const LOCAL_PROXY_TOKEN_PLACEHOLDER = 'local-proxy-managed';
export const OLLAMA_AUTH_TOKEN_PLACEHOLDER = 'ollama';
