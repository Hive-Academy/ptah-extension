/**
 * Local Provider Module - Barrel exports
 *
 */
export {
  OLLAMA_PROVIDER_ENTRY,
  OLLAMA_CLOUD_PROVIDER_ENTRY,
  LM_STUDIO_PROVIDER_ENTRY,
} from '@ptah-extension/shared';
export {
  LocalModelTranslationProxy,
  LmStudioTranslationProxy,
} from './local-model-translation-proxy';
export { OllamaModelDiscoveryService } from './ollama-model-discovery.service';
export {
  OllamaCloudMetadataService,
  isCloudTag,
  toCloudId,
  type OllamaCloudTag,
} from './ollama-cloud-metadata.service';
export {
  LOCAL_PROXY_TOKEN_PLACEHOLDER,
  OLLAMA_AUTH_TOKEN_PLACEHOLDER,
  LOCAL_PROVIDER_IDS,
  LOCAL_PROXY_PROVIDER_IDS,
  OLLAMA_PROVIDER_IDS,
  isLocalProviderId,
  isOllamaProviderId,
} from './local-provider.types';
