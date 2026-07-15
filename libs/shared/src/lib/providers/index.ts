/**
 * Anthropic-compatible provider registry (shared foundation).
 *
 * Moved from `libs/backend/agent-sdk/src/lib/providers/_shared/provider-registry.ts`
 * to break the agent-sdk ↔ auth-providers dependency cycle (TASK_2026_123 Win 5).
 *
 * Both `agent-sdk` and `auth-providers` import the registry from here so
 * neither depends on the other for these pure value types.
 */

export * from './provider-registry';
export * from './proxy-token-placeholders';
export {
  COPILOT_PROVIDER_ENTRY,
  COPILOT_DEFAULT_TIERS,
} from './entries/copilot-provider-entry';
export {
  CODEX_PROVIDER_ENTRY,
  CODEX_DEFAULT_TIERS,
} from './entries/codex-provider-entry';
export {
  OLLAMA_PROVIDER_ENTRY,
  OLLAMA_CLOUD_PROVIDER_ENTRY,
  OLLAMA_CLOUD_DIRECT_BASE_URL,
  LM_STUDIO_PROVIDER_ENTRY,
} from './entries/local-provider-entry';
export {
  SAKANA_PROVIDER_ENTRY,
  SAKANA_DEFAULT_TIERS,
} from './entries/sakana-provider-entry';
