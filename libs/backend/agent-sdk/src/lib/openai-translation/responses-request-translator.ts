/**
 * OpenAI Responses API Request Translator - TASK_2025_199
 *
 * Pure function module that translates Anthropic Messages API requests
 * into OpenAI Responses API format for GPT-5.3+ and newer models.
 *
 * The Responses API differs from Chat Completions in several ways:
 * - Uses `input` array instead of `messages` array
 * - System prompt becomes `{ role: "developer", content: "..." }`
 * - User content uses `{ type: "input_text", text: "..." }` format
 * - Assistant content uses `{ type: "output_text", text: "..." }` format
 * - Tool calls use `{ type: "function_call", ... }` items
 * - Tool results use `{ type: "function_call_output", ... }` items
 * - Uses `max_output_tokens` instead of `max_tokens`
 * - No `tool_choice` parameter
 *
 * All functions are stateless and exported individually for testability.
 * No classes, no side effects, no external dependencies beyond types.
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
  AnthropicSystemPrompt,
} from './openai-translation.types';

import type { TranslateOptions } from './request-translator';

// ---------------------------------------------------------------------------
// Responses API Types
// ---------------------------------------------------------------------------

/** Content part within a Responses API input message */
export type ResponsesContentPart =
  | ResponsesInputTextPart
  | ResponsesInputImagePart
  | ResponsesOutputTextPart;

/** Input text content part */
export interface ResponsesInputTextPart {
  type: 'input_text';
  text: string;
}

/** Input image content part */
export interface ResponsesInputImagePart {
  type: 'input_image';
  image_url: string;
}

/** Output text content part (in assistant messages) */
export interface ResponsesOutputTextPart {
  type: 'output_text';
  text: string;
}

/** A function call item in the Responses API */
export interface ResponsesFunctionCallItem {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

/** A function call output item in the Responses API */
export interface ResponsesFunctionCallOutputItem {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

/** A message input item in the Responses API */
export interface ResponsesMessageItem {
  role: 'developer' | 'user' | 'assistant';
  content: string | ResponsesContentPart[];
}

/** Any item in the Responses API input array */
export type ResponsesInputItem =
  | ResponsesMessageItem
  | ResponsesFunctionCallItem
  | ResponsesFunctionCallOutputItem;

/**
 * Tool definition for the Responses API.
 * Unlike Chat Completions which nests under `function: { name, ... }`,
 * the Responses API uses a FLAT format with `name` at the top level.
 */
export interface ResponsesToolDefinition {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

/** OpenAI Responses API request body */
export interface OpenAIResponsesRequest {
  /** Model identifier */
  model: string;
  /** Input items (messages, function calls, function call outputs) */
  input: ResponsesInputItem[];
  /** System instructions (required by Codex API — extracted from developer message) */
  instructions?: string;
  /** Whether to stream the response */
  stream?: boolean;
  /** Whether to store the response (Codex API requires false) */
  store?: boolean;
  /** Tool definitions (flat format — name at top level, NOT nested under function) */
  tools?: ResponsesToolDefinition[];
}

// ---------------------------------------------------------------------------
// Main translation function
// ---------------------------------------------------------------------------

/**
 * Translate a complete Anthropic Messages API request into an OpenAI
 * Responses API request suitable for GPT-5.3+ models.
 *
 * Handles: system prompt (as developer role), messages (text, images,
 * tool_use, tool_result), tools, streaming. Strips unsupported fields
 * (thinking, metadata, cache_control, tool_choice).
 */
export function translateAnthropicToResponses(
  anthropicRequest: AnthropicMessagesRequest,
  options?: TranslateOptions
): OpenAIResponsesRequest {
  const input: ResponsesInputItem[] = [];

  // 1. Extract system prompt as instructions string (required by Codex API)
  //    Also add as developer message in input for compatibility
  const systemText = extractSystemText(anthropicRequest.system);
  const developerMessage = translateSystemToDeveloper(anthropicRequest.system);
  if (developerMessage) {
    input.push(developerMessage);
  }

  // 2. Translate conversation messages
  const conversationItems = translateMessagesToResponsesInput(
    anthropicRequest.messages
  );
  input.push(...conversationItems);

  // 3. Build the Responses API request
  const prefix = options?.modelPrefix ?? '';
  const model =
    prefix && !anthropicRequest.model.startsWith(prefix)
      ? `${prefix}${anthropicRequest.model}`
      : anthropicRequest.model;

  const responsesRequest: OpenAIResponsesRequest = {
    model,
    input,
    // Codex API requires 'instructions' at top level (not just developer message in input)
    ...(systemText ? { instructions: systemText } : {}),
    // Codex API requires store=false (does not support response storage)
    store: false,
  };

  // Note: max_output_tokens is intentionally NOT mapped for the Responses API.
  // Codex API rejects it as "Unsupported parameter: max_output_tokens".

  // stream — direct pass-through
  if (anthropicRequest.stream) {
    responsesRequest.stream = true;
  }

  // tools — Responses API uses FLAT format (name at top level, not nested under function)
  if (anthropicRequest.tools && anthropicRequest.tools.length > 0) {
    responsesRequest.tools = translateToolsForResponses(anthropicRequest.tools);
  }

  // Note: tool_choice is NOT supported in Responses API — intentionally omitted

  return responsesRequest;
}

// ---------------------------------------------------------------------------
// Exported helper functions (individually testable)
// ---------------------------------------------------------------------------

/**
 * Extract system prompt text as a plain string.
 * Used to populate the `instructions` field required by Codex API.
 */
export function extractSystemText(
  system: AnthropicSystemPrompt | undefined
): string | undefined {
  if (system == null) return undefined;

  if (typeof system === 'string') {
    return system.trim() || undefined;
  }

  if (Array.isArray(system)) {
    const text = system
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n\n')
      .trim();
    return text || undefined;
  }

  return undefined;
}

/**
 * Translate Anthropic system prompt into a Responses API developer message.
 * Returns undefined if no system prompt is provided.
 */
export function translateSystemToDeveloper(
  system: AnthropicSystemPrompt | undefined
): ResponsesMessageItem | undefined {
  if (system == null) return undefined;

  let text: string;

  if (typeof system === 'string') {
    text = system;
  } else if (Array.isArray(system)) {
    text = system
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n\n');
  } else {
    return undefined;
  }

  if (!text.trim()) return undefined;

  return { role: 'developer', content: text };
}

/**
 * Translate an array of Anthropic messages into Responses API input items.
 * Handles text, images, tool_use (as function_call items), and
 * tool_result (as function_call_output items).
 */
export function translateMessagesToResponsesInput(
  messages: AnthropicMessage[]
): ResponsesInputItem[] {
  const result: ResponsesInputItem[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push(...translateUserMessageToResponses(msg));
    } else if (msg.role === 'assistant') {
      result.push(...translateAssistantMessageToResponses(msg));
    }
  }

  return result;
}

/**
 * Translate Anthropic tool definitions into Responses API flat tool format.
 *
 * The Responses API requires `name` at the top level:
 *   { type: "function", name: "tool_name", description: "...", parameters: {...} }
 *
 * This differs from Chat Completions which nests under `function`:
 *   { type: "function", function: { name: "tool_name", description: "...", parameters: {...} } }
 */
export function translateToolsForResponses(
  tools: AnthropicToolDefinition[]
): ResponsesToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    ...(tool.description != null ? { description: tool.description } : {}),
    ...(tool.input_schema != null ? { parameters: tool.input_schema } : {}),
  }));
}

// ---------------------------------------------------------------------------
// Private translation helpers
// ---------------------------------------------------------------------------

/**
 * Translate a single Anthropic user message into Responses API input items.
 * User messages may contain text, images, and tool_result blocks.
 * tool_result blocks become separate function_call_output items.
 */
function translateUserMessageToResponses(
  msg: AnthropicMessage
): ResponsesInputItem[] {
  const results: ResponsesInputItem[] = [];

  if (typeof msg.content === 'string') {
    results.push({
      role: 'user',
      content: [{ type: 'input_text', text: msg.content }],
    });
    return results;
  }

  if (!Array.isArray(msg.content)) {
    results.push({
      role: 'user',
      content: [{ type: 'input_text', text: '' }],
    });
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

  // Emit function_call_output items for tool results first
  for (const toolResult of toolResults) {
    results.push(translateToolResultToFunctionCallOutput(toolResult));
  }

  // Emit the user message with remaining content blocks
  if (otherBlocks.length > 0) {
    const parts = flattenToResponsesContentParts(otherBlocks);
    if (parts.length > 0) {
      results.push({ role: 'user', content: parts });
    }
  } else if (toolResults.length === 0) {
    // No content at all — emit empty user message
    results.push({
      role: 'user',
      content: [{ type: 'input_text', text: '' }],
    });
  }

  return results;
}

/**
 * Translate a single Anthropic assistant message into Responses API input items.
 * Assistant messages may contain text blocks and tool_use blocks.
 * text blocks become an assistant message with output_text content.
 * tool_use blocks become separate function_call items.
 */
function translateAssistantMessageToResponses(
  msg: AnthropicMessage
): ResponsesInputItem[] {
  if (typeof msg.content === 'string') {
    return [
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: msg.content }],
      },
    ];
  }

  if (!Array.isArray(msg.content)) {
    return [
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: '' }],
      },
    ];
  }

  const results: ResponsesInputItem[] = [];
  const textParts: ResponsesOutputTextPart[] = [];

  for (const block of msg.content) {
    if (block.type === 'text') {
      textParts.push({
        type: 'output_text',
        text: (block as AnthropicTextBlock).text,
      });
    } else if (block.type === 'tool_use') {
      const toolUse = block as AnthropicToolUseBlock;
      // If we have accumulated text parts, emit assistant message before tool call
      if (textParts.length > 0) {
        results.push({
          role: 'assistant',
          content: [...textParts],
        });
        textParts.length = 0;
      }
      results.push({
        type: 'function_call',
        call_id: toolUse.id,
        name: toolUse.name,
        arguments: JSON.stringify(toolUse.input),
      });
    }
  }

  // Emit remaining text parts as assistant message
  if (textParts.length > 0) {
    results.push({
      role: 'assistant',
      content: [...textParts],
    });
  } else if (results.length === 0) {
    // No content at all
    results.push({
      role: 'assistant',
      content: [{ type: 'output_text', text: '' }],
    });
  }

  return results;
}

/**
 * Convert an Anthropic tool_result block into a Responses API function_call_output item.
 */
function translateToolResultToFunctionCallOutput(
  toolResult: AnthropicToolResultBlock
): ResponsesFunctionCallOutputItem {
  let output: string;

  if (typeof toolResult.content === 'string') {
    output = toolResult.content;
  } else if (Array.isArray(toolResult.content)) {
    output = toolResult.content
      .filter((b): b is AnthropicTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  } else {
    output = '';
  }

  if (toolResult.is_error && output) {
    output = `Error: ${output}`;
  }

  return {
    type: 'function_call_output',
    call_id: toolResult.tool_use_id,
    output,
  };
}

/**
 * Flatten Anthropic content blocks into Responses API content parts.
 * Handles text and image blocks; skips tool_use and tool_result
 * (those are handled separately).
 */
function flattenToResponsesContentParts(
  blocks: AnthropicContentBlock[]
): ResponsesContentPart[] {
  const parts: ResponsesContentPart[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push({
        type: 'input_text',
        text: (block as AnthropicTextBlock).text,
      });
    } else if (block.type === 'image') {
      const img = block as AnthropicImageBlock;
      parts.push({
        type: 'input_image',
        image_url: `data:${img.source.media_type};base64,${img.source.data}`,
      });
    }
  }

  return parts;
}
