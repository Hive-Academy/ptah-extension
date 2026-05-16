/**
 * Local Provider Module - Barrel exports
 *
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

// Ollama model discovery (injectable)
export { OllamaModelDiscoveryService } from './ollama-model-discovery.service';

// Ollama Cloud metadata service (injectable).
// Fetches live model tags from https://ollama.com/api/tags when the user
// configures an optional API key. Pricing fetch is a no-op (no public
// pricing endpoint exists on ollama.com — bundled defaults are used).
export {
  OllamaCloudMetadataService,
  isCloudTag,
  type OllamaCloudTag,
} from './ollama-cloud-metadata.service';

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
