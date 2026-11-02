/**
 * Placeholder tokens written into AuthEnv.ANTHROPIC_AUTH_TOKEN when a
 * translation proxy is managing real authentication internally.
 *
 * Shared between SDK route readers and provider authentication. The retired
 * Codex marker remains so persisted proxy environments are refused explicitly.
 */

export const COPILOT_PROXY_TOKEN_PLACEHOLDER = 'copilot-proxy-managed';
/** Historical marker for retired Codex proxy routes; no new route writes it. */
export const CODEX_PROXY_TOKEN_PLACEHOLDER = 'codex-proxy-managed';
export const KIMI_CODE_PROXY_TOKEN_PLACEHOLDER = 'kimi-code-proxy-managed';
export const OPENROUTER_PROXY_TOKEN_PLACEHOLDER = 'openrouter-proxy-token';
export const SAKANA_PROXY_TOKEN_PLACEHOLDER = 'sakana-proxy-token';
export const LOCAL_PROXY_TOKEN_PLACEHOLDER = 'local-proxy-managed';
export const OLLAMA_AUTH_TOKEN_PLACEHOLDER = 'ollama';
