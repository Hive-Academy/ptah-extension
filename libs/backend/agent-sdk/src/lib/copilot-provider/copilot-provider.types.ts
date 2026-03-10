/**
 * Copilot Provider Types - TASK_2025_186 Batch 1
 *
 * All types for the copilot-provider module in one file.
 * Includes Copilot-specific interfaces and simplified OpenAI/Anthropic
 * protocol types needed for request/response translation.
 */

// ---------------------------------------------------------------------------
// Copilot Constants
// ---------------------------------------------------------------------------

/** Placeholder API key used when the translation proxy manages auth internally */
export const COPILOT_PROXY_TOKEN_PLACEHOLDER = 'copilot-proxy-managed';

/** Sentinel value identifying a Copilot OAuth-based provider configuration */
export const COPILOT_OAUTH_SENTINEL = 'copilot-oauth';

// ---------------------------------------------------------------------------
// Copilot Authentication Types
// ---------------------------------------------------------------------------

/**
 * Response from the Copilot token exchange endpoint.
 * Returned by `GET https://api.github.com/copilot_internal/v2/token`.
 */
export interface CopilotTokenResponse {
  /** The Copilot bearer token for API authentication */
  token: string;
  /** Unix timestamp (seconds) when the token expires */
  expires_at: number;
  /** Optional endpoint overrides from the token response */
  endpoints?: {
    /** The API base URL to use (may differ from default) */
    api: string;
  };
}

/**
 * Internal authentication state cached by CopilotAuthService.
 * Contains both the GitHub OAuth token and the exchanged Copilot bearer token.
 */
export interface CopilotAuthState {
  /** GitHub OAuth access token (from VS Code authentication) */
  githubToken: string;
  /** Copilot bearer token (exchanged from GitHub token) */
  bearerToken: string;
  /** Unix timestamp (seconds) when the bearer token expires */
  expiresAt: number;
  /** Copilot API endpoint (default: https://api.githubcopilot.com) */
  apiEndpoint: string;
}

/**
 * Translation proxy lifecycle interface.
 * Manages a local HTTP server that translates between Anthropic and OpenAI protocols.
 */
export interface ICopilotTranslationProxy {
  /** Start the proxy server, returning the assigned port and base URL */
  start(): Promise<{ port: number; url: string }>;
  /** Stop the proxy server and release resources */
  stop(): Promise<void>;
  /** Whether the proxy server is currently listening */
  isRunning(): boolean;
  /** The proxy base URL if running, undefined otherwise */
  getUrl(): string | undefined;
}

/**
 * Copilot authentication service interface.
 * Handles GitHub OAuth login and Copilot bearer token lifecycle.
 */
export interface ICopilotAuthService {
  /** Initiate GitHub OAuth login and exchange for Copilot bearer token */
  login(): Promise<boolean>;
  /** Check whether a valid (non-expired) Copilot bearer token is available */
  isAuthenticated(): Promise<boolean>;
  /** Get the current auth state, or null if not authenticated */
  getAuthState(): Promise<CopilotAuthState | null>;
  /** Get HTTP headers required for Copilot API requests */
  getHeaders(): Promise<Record<string, string>>;
  /** Clear cached auth state (logout) */
  logout(): Promise<void>;
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
  /** Maximum tokens to generate */
  max_tokens?: number;
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
  /** Extended thinking configuration (stripped — unsupported by Copilot) */
  thinking?: unknown;
  /** Request metadata (stripped — unsupported by Copilot) */
  metadata?: unknown;
}
