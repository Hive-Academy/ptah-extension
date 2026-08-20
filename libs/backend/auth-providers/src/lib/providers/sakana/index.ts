/**
 * Sakana Provider Module - Barrel exports
 *
 * Enables Sakana's Fugu models to work with the Claude Agent SDK via a local
 * translation proxy that converts between Anthropic Messages format and OpenAI
 * Chat Completions format.
 */
export { SakanaAuthService } from './sakana-auth.service';
export { SakanaTranslationProxy } from './sakana-translation-proxy';
export { createSakanaProxyForKey } from './sakana-proxy.factory';
export { SAKANA_PROXY_TOKEN_PLACEHOLDER } from './sakana-provider.types';
export type { ISakanaAuthService } from './sakana-provider.types';
