/**
 * OpenAI Request Translator - TASK_2025_193 Batch 1
 *
 * Pure function module that translates Anthropic Messages API requests
 * into OpenAI Chat Completions format for any OpenAI-compatible API.
 *
 * All functions are stateless and exported individually for testability.
 * No classes, no side effects, no external dependencies beyond types.
 *
 * Extracted from copilot-request-translator.ts with parameterized model prefix.
 */

import type {
  AnthropicMessagesRequest,
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicTextBlock,
  AnthropicImageBlock,
  AnthropicToolUseBlock,
  AnthropicToolResultBlock,
  AnthropicToolDefinition,
  AnthropicToolChoice,
  AnthropicSystemPrompt,
  OpenAIChatCompletionsRequest,
  OpenAIChatMessage,
  OpenAIToolDefinition,
  OpenAIToolCall,
  OpenAIContentPart,
} from './openai-translation.types';

// ---------------------------------------------------------------------------
// Translation options
// ---------------------------------------------------------------------------

/** Options for controlling request translation behavior */
export interface TranslateOptions {
  /**
   * Optional prefix to add to model IDs during translation.
   * For example, Copilot requires 'capi:' prefix (e.g., 'capi:claude-sonnet-4.6').
   * Codex uses no prefix (model IDs passed as-is).
   * Default: no prefix.
   */
  modelPrefix?: string;
}

// ---------------------------------------------------------------------------
// Main translation function
// ---------------------------------------------------------------------------

/**
 * Translate a complete Anthropic Messages API request into an OpenAI
 * Chat Completions request suitable for any OpenAI-compatible API.
 *
 * Handles: system prompt, messages (text, images, tool_use, tool_result),
 * tools, tool_choice, streaming. Strips unsupported fields (thinking,
 * metadata, cache_control).
 */
export function translateAnthropicToOpenAI(
  anthropicRequest: AnthropicMessagesRequest,
  options?: TranslateOptions,
): OpenAIChatCompletionsRequest {
  const openaiMessages: OpenAIChatMessage[] = [];

  // 1. Translate system prompt to system message (if present)
  const systemMessage = translateSystemPrompt(anthropicRequest.system);
  if (systemMessage) {
    openaiMessages.push(systemMessage);
  }

  // 2. Translate conversation messages
  const conversationMessages = translateMessages(anthropicRequest.messages);
  openaiMessages.push(...conversationMessages);

  // 3. Build the OpenAI request
  // Apply model prefix if configured (e.g., Copilot needs 'capi:' prefix)
  const prefix = options?.modelPrefix ?? '';
  const model =
    prefix && !anthropicRequest.model.startsWith(prefix)
      ? `${prefix}${anthropicRequest.model}`
      : anthropicRequest.model;

  const openaiRequest: OpenAIChatCompletionsRequest = {
    model,
    messages: openaiMessages,
  };

  // max_tokens → max_completion_tokens (modern OpenAI field name).
  // Newer APIs (Copilot, GPT-4-turbo+) reject 'max_tokens' with
  // "Unsupported parameter: use 'max_completion_tokens' instead".
  if (anthropicRequest.max_tokens != null) {
    openaiRequest.max_completion_tokens = anthropicRequest.max_tokens;
  }

  // stream — direct pass-through, request usage in final chunk
  if (anthropicRequest.stream) {
    openaiRequest.stream = true;
    openaiRequest.stream_options = { include_usage: true };
  }

  // tools — translate format
  if (anthropicRequest.tools && anthropicRequest.tools.length > 0) {
    openaiRequest.tools = translateTools(anthropicRequest.tools);
  }

  // tool_choice — translate format differences
  if (anthropicRequest.tool_choice) {
    openaiRequest.tool_choice = translateToolChoice(
      anthropicRequest.tool_choice,
    );
  }

  return openaiRequest;
}

// ---------------------------------------------------------------------------
// Exported helper functions (individually testable)
// ---------------------------------------------------------------------------

/**
 * Translate Anthropic system prompt into an OpenAI system message.
 * Handles both string and array-of-blocks formats.
 * Returns undefined if no system prompt is provided.
 */
export function translateSystemPrompt(
  system: AnthropicSystemPrompt | undefined,
): OpenAIChatMessage | undefined {
  if (system == null) return undefined;

  let text: string;

  if (typeof system === 'string') {
    text = system;
  } else if (Array.isArray(system)) {
    // Array of { type: 'text', text: '...' } blocks — concatenate
    text = system
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n\n');
  } else {
    return undefined;
  }

  if (!text.trim()) return undefined;

  return { role: 'system', content: text };
}

/**
 * Translate an array of Anthropic messages into OpenAI messages.
 * Handles text, images, tool_use (in assistant messages), and
 * tool_result (which become separate role:'tool' messages).
 */
export function translateMessages(
  messages: AnthropicMessage[],
): OpenAIChatMessage[] {
  const result: OpenAIChatMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push(...translateUserMessage(msg));
    } else if (msg.role === 'assistant') {
      result.push(...translateAssistantMessage(msg));
    }
  }

  return result;
}

/**
 * Translate Anthropic tool definitions into OpenAI function tool definitions.
 */
export function translateTools(
  tools: AnthropicToolDefinition[],
): OpenAIToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      ...(tool.description != null ? { description: tool.description } : {}),
      ...(tool.input_schema != null ? { parameters: tool.input_schema } : {}),
    },
  }));
}

/**
 * Translate Anthropic tool_choice into OpenAI tool_choice format.
 */
export function translateToolChoice(
  toolChoice: AnthropicToolChoice,
): OpenAIChatCompletionsRequest['tool_choice'] {
  switch (toolChoice.type) {
    case 'auto':
      return 'auto';
    case 'any':
      // Anthropic 'any' means "must use a tool" -> OpenAI 'required'
      return 'required';
    case 'tool':
      return { type: 'function', function: { name: toolChoice.name } };
    default:
      return 'auto';
  }
}

// ---------------------------------------------------------------------------
// Private translation helpers
// ---------------------------------------------------------------------------

/**
 * Translate a single Anthropic user message.
 * User messages may contain text, images, and tool_result blocks.
 * tool_result blocks become separate OpenAI role:'tool' messages.
 */
function translateUserMessage(msg: AnthropicMessage): OpenAIChatMessage[] {
  const results: OpenAIChatMessage[] = [];

  if (typeof msg.content === 'string') {
    results.push({ role: 'user', content: msg.content });
    return results;
  }

  if (!Array.isArray(msg.content)) {
    results.push({ role: 'user', content: '' });
    return results;
  }

  // Separate tool_result blocks from other content
  const toolResults: AnthropicToolResultBlock[] = [];
  const otherBlocks: AnthropicContentBlock[] = [];

  for (const block of msg.content) {
    if (block.type === 'tool_result') {
      toolResults.push(block);
    } else {
      otherBlocks.push(block);
    }
  }

  // Emit tool result messages first (OpenAI expects role:'tool' messages
  // right after the assistant's tool_calls)
  for (const toolResult of toolResults) {
    results.push(translateToolResultToMessage(toolResult));
  }

  // Emit the user message with remaining content blocks
  if (otherBlocks.length > 0) {
    const parts = flattenContentBlocks(otherBlocks);
    if (
      parts.length === 1 &&
      typeof parts[0] === 'object' &&
      'type' in parts[0] &&
      parts[0].type === 'text'
    ) {
      // Single text block — use string content for simplicity
      results.push({ role: 'user', content: parts[0].text });
    } else if (parts.length > 0) {
      results.push({ role: 'user', content: parts as OpenAIContentPart[] });
    }
  } else if (toolResults.length === 0) {
    // No content at all — emit empty user message
    results.push({ role: 'user', content: '' });
  }

  return results;
}

/**
 * Translate a single Anthropic assistant message.
 * Assistant messages may contain text blocks and tool_use blocks.
 * tool_use blocks become tool_calls on the assistant message.
 */
function translateAssistantMessage(msg: AnthropicMessage): OpenAIChatMessage[] {
  if (typeof msg.content === 'string') {
    return [{ role: 'assistant', content: msg.content }];
  }

  if (!Array.isArray(msg.content)) {
    return [{ role: 'assistant', content: '' }];
  }

  let textContent = '';
  const toolCalls: OpenAIToolCall[] = [];

  for (const block of msg.content) {
    if (block.type === 'text') {
      textContent += (block as AnthropicTextBlock).text;
    } else if (block.type === 'tool_use') {
      const toolUse = block as AnthropicToolUseBlock;
      toolCalls.push({
        id: toolUse.id,
        type: 'function',
        function: {
          name: toolUse.name,
          arguments: JSON.stringify(toolUse.input),
        },
      });
    }
    // Skip other block types (image in assistant = unusual, ignore)
  }

  const assistantMsg: OpenAIChatMessage = {
    role: 'assistant',
    content: textContent || null,
  };

  if (toolCalls.length > 0) {
    assistantMsg.tool_calls = toolCalls;
  }

  return [assistantMsg];
}

/**
 * Convert an Anthropic tool_result block into an OpenAI role:'tool' message.
 */
function translateToolResultToMessage(
  toolResult: AnthropicToolResultBlock,
): OpenAIChatMessage {
  let content: string;

  if (typeof toolResult.content === 'string') {
    content = toolResult.content;
  } else if (Array.isArray(toolResult.content)) {
    // Extract text from content blocks
    content = toolResult.content
      .filter((b): b is AnthropicTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  } else {
    content = '';
  }

  // If it was an error, prefix with error indicator
  if (toolResult.is_error && content) {
    content = `Error: ${content}`;
  }

  return {
    role: 'tool',
    tool_call_id: toolResult.tool_use_id,
    content,
  };
}

/**
 * Flatten Anthropic content blocks into OpenAI content parts.
 * Handles text and image blocks; skips tool_use and tool_result
 * (those are handled separately).
 */
function flattenContentBlocks(
  blocks: AnthropicContentBlock[],
): OpenAIContentPart[] {
  const parts: OpenAIContentPart[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: (block as AnthropicTextBlock).text });
    } else if (block.type === 'image') {
      const img = block as AnthropicImageBlock;
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${img.source.media_type};base64,${img.source.data}`,
        },
      });
    }
  }

  return parts;
}
