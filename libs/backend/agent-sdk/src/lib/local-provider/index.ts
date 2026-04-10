/**
 * Local Provider Module - Barrel exports
 *
 * @see TASK_2025_265 - Local Model Provider Integration
 */

// Provider registry entries (static data)
export {
  OLLAMA_PROVIDER_ENTRY,
  LM_STUDIO_PROVIDER_ENTRY,
} from './local-provider-entry';

// Translation proxy classes (injectable)
export {
  LocalModelTranslationProxy,
  OllamaTranslationProxy,
  LmStudioTranslationProxy,
} from './local-model-translation-proxy';

// Constants and type guards
export {
  LOCAL_PROXY_TOKEN_PLACEHOLDER,
  LOCAL_PROVIDER_IDS,
  isLocalProviderId,
} from './local-provider.types';
