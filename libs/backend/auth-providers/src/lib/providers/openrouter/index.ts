/**
 * OpenRouter Provider Module - Barrel exports
 *
 * Enables ALL OpenRouter models (Anthropic, OpenAI, Google, Meta, etc.) to
 * work with the Claude Agent SDK via a local translation proxy that converts
 * between Anthropic Messages format and OpenAI Chat Completions format.
 */
export { OpenRouterAuthService } from './openrouter-auth.service';
export { OpenRouterTranslationProxy } from './openrouter-translation-proxy';
export { OPENROUTER_PROXY_TOKEN_PLACEHOLDER } from './openrouter-provider.types';
export type { IOpenRouterAuthService } from './openrouter-provider.types';
