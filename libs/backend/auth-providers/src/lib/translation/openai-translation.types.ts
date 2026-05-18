/**
 * OpenAI Translation Types
 *
 * Protocol-level types for Anthropic <-> OpenAI translation.
 * These types are provider-agnostic and shared across all translation proxies
 * (Copilot, Codex, etc.).
 *
 * Extracted from copilot-provider.types.ts to enable reuse.
 */

// ---------------------------------------------------------------------------
// Translation Proxy Interface
// ---------------------------------------------------------------------------

/**
 * Translation proxy lifecycle interface.
 * Manages a local HTTP server that translates between Anthropic and OpenAI protocols.
 */
export interface ITranslationProxy {
  /** Start the proxy server, returning the assigned port and base URL */
  start(): Promise<{ port: number; url: string }>;
  /** Stop the proxy server and release resources */
  stop(): Promise<void>;
  /** Whether the proxy server is currently listening */
  isRunning(): boolean;
  /** The proxy base URL if running, undefined otherwise */
  getUrl(): string | undefined;
}

// ---------------------------------------------------------------------------
// Simplified OpenAI Chat Completions Protocol Types
// (Only the fields we need for Anthropic <-> OpenAI translation)
// ---------------------------------------------------------------------------

/** A single message in an OpenAI Chat Completions request */
export interface OpenAIChatMessage {
  /** Message role */
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** Text content (string or structured content parts) */
  content?: string | OpenAIContentPart[] | null;
  /** Tool calls made by the assistant */
  tool_calls?: OpenAIToolCall[];
  /** Tool call ID this message responds to (for role: 'tool') */
  tool_call_id?: string;
}

/** Structured content part in an OpenAI message */
export type OpenAIContentPart = OpenAITextPart | OpenAIImagePart;

/** Text content part */
export interface OpenAITextPart {
  type: 'text';
  text: string;
}

/** Image content part with URL (supports data: URIs for base64) */
export interface OpenAIImagePart {
  type: 'image_url';
  image_url: { url: string };
}

/** A tool call in an OpenAI assistant message */
export interface OpenAIToolCall {
  /** Tool call identifier */
  id: string;
  /** Always 'function' for function calling */
  type: 'function';
  /** Function name and arguments */
  function: {
    name: string;
    arguments: string;
  };
}

/** Tool definition in OpenAI format */
export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** OpenAI Chat Completions request body */
export interface OpenAIChatCompletionsRequest {
  /** Model identifier */
  model: string;
  /** Conversation messages */
  messages: OpenAIChatMessage[];
  /**
   * Maximum tokens to generate (modern field).
   * Newer OpenAI-compatible APIs (Copilot, GPT-4-turbo+) require this
   * instead of `max_tokens`. The Copilot API rejects `max_tokens` with
   * "Unsupported parameter: use 'max_completion_tokens' instead".
   */
  max_completion_tokens?: number;
  /** Whether to stream the response */
  stream?: boolean;
  /** Stream options for usage reporting */
  stream_options?: { include_usage: boolean };
  /** Tool definitions */
  tools?: OpenAIToolDefinition[];
  /** Tool choice preference */
  tool_choice?:
    | 'auto'
    | 'none'
    | 'required'
    | { type: 'function'; function: { name: string } };
}

/** A single SSE chunk from OpenAI streaming response */
export interface OpenAIStreamChunk {
  /** Chunk identifier */
  id?: string;
  /** Object type (always 'chat.completion.chunk') */
  object?: string;
  /** Model used */
  model?: string;
  /** Array of choice deltas */
  choices?: OpenAIStreamChoice[];
  /** Token usage (sent in final chunk when stream_options.include_usage is true) */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** A single choice delta in an OpenAI streaming chunk */
export interface OpenAIStreamChoice {
  /** Choice index (usually 0) */
  index: number;
  /** Incremental content delta */
  delta: {
    /** Role (only present in first chunk) */
    role?: string;
    /** Text content delta */
    content?: string | null;
    /** Tool call deltas */
    tool_calls?: OpenAIToolCallDelta[];
  };
  /** Finish reason (null until stream completes) */
  finish_reason?: string | null;
}

/** Incremental tool call delta in streaming */
export interface OpenAIToolCallDelta {
  /** Tool call index (for correlating deltas of the same tool call) */
  index: number;
  /** Tool call ID (only in first delta for this index) */
  id?: string;
  /** Type (only in first delta) */
  type?: 'function';
  /** Function name/arguments delta */
  function?: {
    /** Function name (only in first delta for this index) */
    name?: string;
    /** Incremental JSON arguments string */
    arguments?: string;
  };
}

// ---------------------------------------------------------------------------
// Simplified Anthropic Messages Protocol Types
// (Only the fields we need for translation from the SDK's outgoing requests)
// ---------------------------------------------------------------------------

/** A content block in an Anthropic message */
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

/** Text content block */
export interface AnthropicTextBlock {
  type: 'text';
  text: string;
  cache_control?: unknown;
}

/** Image content block */
export interface AnthropicImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

/** Tool use content block (assistant requesting a tool call) */
export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Tool result content block (user providing tool output) */
export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | AnthropicContentBlock[];
  is_error?: boolean;
}

/** A message in an Anthropic Messages request */
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

/** Anthropic system prompt — can be a string or array of content blocks */
export type AnthropicSystemPrompt =
  | string
  | Array<{ type: 'text'; text: string; cache_control?: unknown }>;

/** Tool definition in Anthropic format */
export interface AnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

/** Anthropic tool_choice specification */
export type AnthropicToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string };

/** Anthropic Messages API request body (simplified — only fields we translate) */
export interface AnthropicMessagesRequest {
  /** Model identifier */
  model: string;
  /** Maximum tokens to generate */
  max_tokens: number;
  /** System prompt (top-level, separate from messages) */
  system?: AnthropicSystemPrompt;
  /** Conversation messages */
  messages: AnthropicMessage[];
  /** Whether to stream the response */
  stream?: boolean;
  /** Tool definitions */
  tools?: AnthropicToolDefinition[];
  /** Tool choice preference */
  tool_choice?: AnthropicToolChoice;
  /** Extended thinking configuration (stripped — unsupported by OpenAI-compatible APIs) */
  thinking?: unknown;
  /** Request metadata (stripped — unsupported by OpenAI-compatible APIs) */
  metadata?: unknown;
}
