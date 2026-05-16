/**
 * Shared provider infrastructure.
 *
 * - provider-registry: the AnthropicProvider contract + ANTHROPIC_PROVIDERS
 *   map consumed by every provider-entry and auth strategy.
 * - translation: OpenAI <-> Anthropic translation classes and pure helpers.
 *   Every translation proxy in providers/{codex,copilot,local,openrouter}
 *   extends TranslationProxyBase from here.
 *
 * Moved from helpers/anthropic-provider-registry.ts and openai-translation/
 *.
 */

export * from './provider-registry';
export * from './translation';
