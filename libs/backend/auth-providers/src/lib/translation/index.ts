/**
 * OpenAI Translation Module - Barrel Exports
 *
 * Shared Anthropic <-> OpenAI translation infrastructure used by
 * all translation proxy providers (Copilot, Codex, etc.).
 *
 */
export {
  translateAnthropicToOpenAI,
  translateSystemPrompt,
  translateMessages,
  translateTools,
  translateToolChoice,
} from './request-translator';

export type { TranslateOptions } from './request-translator';
export { OpenAIResponseTranslator } from './response-translator';
export {
  translateAnthropicToResponses,
  translateToolsForResponses,
} from './responses-request-translator';

export type {
  OpenAIResponsesRequest,
  ResponsesToolDefinition,
  ResponsesInputItem,
  ResponsesMessageItem,
  ResponsesFunctionCallItem,
  ResponsesFunctionCallOutputItem,
  ResponsesContentPart,
  ResponsesInputTextPart,
  ResponsesInputImagePart,
  ResponsesOutputTextPart,
} from './responses-request-translator';
export { ResponsesStreamTranslator } from './responses-stream-translator';
export { TranslationProxyBase } from './translation-proxy-base';
export type { TranslationProxyConfig } from './translation-proxy-base';
export type {
  ITranslationProxy,
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
