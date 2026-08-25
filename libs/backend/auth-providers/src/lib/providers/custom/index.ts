/**
 * Custom Provider Module - Barrel exports
 *
 * The generic, base-URL-driven translation proxy backing user-defined
 * OpenAI-compatible provider entries (`lane: 'openai'` in
 * `provider.custom.entries`). Custom entries declared `lane: 'anthropic'` need
 * nothing from this module — they ride the existing direct-passthrough path in
 * ApiKeyStrategy.
 */
export {
  CustomOpenAiTranslationProxy,
  normalizeOpenAiApiRoot,
} from './custom-openai-translation-proxy';
export { createCustomOpenAiProxy } from './custom-proxy.factory';
export { CUSTOM_PROXY_TOKEN_PLACEHOLDER } from './custom-provider.types';
export type { CustomOpenAiProxyConfig } from './custom-provider.types';
