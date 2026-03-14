/**
 * OpenAI Translation Module - Barrel Exports
 *
 * Shared Anthropic <-> OpenAI translation infrastructure used by
 * all translation proxy providers (Copilot, Codex, etc.).
 *
 * @see TASK_2025_193 - Codex Translation Proxy Support
 */

// Request translator (pure functions, stateless)
export {
  translateAnthropicToOpenAI,
  translateSystemPrompt,
  translateMessages,
  translateTools,
  translateToolChoice,
} from './request-translator';

export type { TranslateOptions } from './request-translator';

// Response translator (stateful, create per-request)
export { OpenAIResponseTranslator } from './response-translator';

// Abstract base class for translation proxies
export { TranslationProxyBase } from './translation-proxy-base';
export type { TranslationProxyConfig } from './translation-proxy-base';

// Protocol types
export type {
  // Translation proxy interface
  ITranslationProxy,
  // OpenAI types
  OpenAIChatMessage,
  OpenAIContentPart,
  OpenAITextPart,
  OpenAIImagePart,
  OpenAIToolCall,
  OpenAIToolDefinition,
  OpenAIChatCompletionsRequest,
  OpenAIStreamChunk,
  OpenAIStreamChoice,
  OpenAIToolCallDelta,
  // Anthropic types
  AnthropicContentBlock,
  AnthropicTextBlock,
  AnthropicImageBlock,
  AnthropicToolUseBlock,
  AnthropicToolResultBlock,
  AnthropicMessage,
  AnthropicSystemPrompt,
  AnthropicToolDefinition,
  AnthropicToolChoice,
  AnthropicMessagesRequest,
} from './openai-translation.types';
