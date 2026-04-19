/**
 * Local Provider Module - Barrel exports
 *
 * @see TASK_2025_265 - Local Model Provider Integration
 * @see TASK_2025_281 - Ollama Anthropic-Native Upgrade
 */

// Provider registry entries (static data)
export {
  OLLAMA_PROVIDER_ENTRY,
  OLLAMA_CLOUD_PROVIDER_ENTRY,
  LM_STUDIO_PROVIDER_ENTRY,
} from './local-provider-entry';

// Translation proxy classes (injectable) — LM Studio only
export {
  LocalModelTranslationProxy,
  LmStudioTranslationProxy,
} from './local-model-translation-proxy';

// Ollama model discovery (injectable) — TASK_2025_281
export { OllamaModelDiscoveryService } from './ollama-model-discovery.service';

// Constants and type guards
export {
  LOCAL_PROXY_TOKEN_PLACEHOLDER,
  OLLAMA_AUTH_TOKEN_PLACEHOLDER,
  LOCAL_PROVIDER_IDS,
  LOCAL_PROXY_PROVIDER_IDS,
  OLLAMA_PROVIDER_IDS,
  isLocalProviderId,
  isOllamaProviderId,
} from './local-provider.types';
