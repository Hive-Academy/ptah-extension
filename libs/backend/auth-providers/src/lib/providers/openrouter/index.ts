/**
 * OpenRouter Provider Module - Barrel exports
 *
 * Enables ALL OpenRouter models (Anthropic, OpenAI, Google, Meta, etc.) to
 * work with the Claude Agent SDK via a local translation proxy that converts
 * between Anthropic Messages format and OpenAI Chat Completions format.
 */

// Auth service (injectable)
export { OpenRouterAuthService } from './openrouter-auth.service';

// Translation proxy (injectable, thin subclass of TranslationProxyBase)
export { OpenRouterTranslationProxy } from './openrouter-translation-proxy';

// Constants
export { OPENROUTER_PROXY_TOKEN_PLACEHOLDER } from './openrouter-provider.types';

// Service interfaces
export type { IOpenRouterAuthService } from './openrouter-provider.types';
