/**
 * Claude Agent SDK Type Definitions
 *
 * Copied from @anthropic-ai/claude-agent-sdk to avoid ESM/CommonJS conflicts.
 * These are TYPE-ONLY definitions - no runtime code, not included in production bundle.
 *
 * Source: node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts
 * Last Updated: 2026-03-23
 * SDK Version: 0.2.81 (installed)
 *
 * MAINTENANCE: Update this file when upgrading the SDK version.
 * Run: diff node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts
 */

// =============================================================================
// FOUNDATION TYPES
// =============================================================================

/**
 * UUID type (from crypto module)
 */
export type UUID = `${string}-${string}-${string}-${string}-${string}`;

/**
 * Usage statistics for API calls
 * From @anthropic-ai/sdk BetaUsage
 */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Non-nullable usage (all fields required)
 */
export type NonNullableUsage = {
  [K in keyof Usage]-?: NonNullable<Usage[K]>;
};

/**
 * Per-model usage breakdown
 */
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
  maxOutputTokens: number;
}

// =============================================================================
// OUTPUT FORMAT TYPES
// =============================================================================

/**
 * Output format type for structured responses
 */
export type OutputFormatType = 'json_schema';

/**
 * Base output format
 */
export type BaseOutputFormat = {
  type: OutputFormatType;
};

/**
 * JSON Schema output format for structured responses
 */
export type JsonSchemaOutputFormat = {
  type: 'json_schema';
  schema: Record<string, unknown>;
};

/**
 * Output format union
 */
export type OutputFormat = JsonSchemaOutputFormat;

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

/**
 * API key source
 */
export type ApiKeySource = 'user' | 'project' | 'org' | 'temporary' | 'oauth';

/**
 * Configuration scope for settings
 */
export type ConfigScope = 'local' | 'user' | 'project';

/**
 * Allowed beta headers for SDK options
 */
export type SdkBeta = 'context-1m-2025-08-07';

/**
 * Source for loading filesystem-based settings.
 * - 'user' - Global user settings (~/.claude/settings.json)
 * - 'project' - Project settings (.claude/settings.json)
 * - 'local' - Local settings (.claude/settings.local.json)
 */
export type SettingSource = 'user' | 'project' | 'local';

/**
 * Configuration for loading a plugin.
 */
export type SdkPluginConfig = {
  /** Plugin type. Currently only 'local' is supported */
  type: 'local';
  /** Absolute or relative path to the plugin directory */
  path: string;
};

/**
 * Exit reason for session termination.
 */
export type ExitReason =
  | 'clear'
  | 'resume'
  | 'logout'
  | 'prompt_input_exit'
  | 'other'
  | 'bypass_permissions_disabled';

/**
 * Fast mode state: off, in cooldown after rate limit, or actively enabled.
 */
export type FastModeState = 'off' | 'cooldown' | 'on';

/**
 * Thinking configuration types
 */
export type ThinkingAdaptive = {
  type: 'adaptive';
};

export type ThinkingEnabled = {
  type: 'enabled';
  budgetTokens?: number;
};

export type ThinkingDisabled = {
  type: 'disabled';
};

/**
 * Controls Claude's thinking/reasoning behavior.
 * When set, takes precedence over the deprecated maxThinkingTokens.
 */
export type ThinkingConfig =
  | ThinkingAdaptive
  | ThinkingEnabled
  | ThinkingDisabled;

// =============================================================================
// ANTHROPIC API MESSAGE TYPES (Inlined from @anthropic-ai/sdk)
// =============================================================================

/**
 * Text content block
 */
export interface TextBlock {
  type: 'text';
  text: string;
}

/**
 * Tool use content block
 */
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool result content block
 */
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<TextBlock | { type: 'image'; source: unknown }>;
  is_error?: boolean;
}

/**
 * Thinking content block (extended thinking)
 */
export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

/**
 * Content block union
 */
export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock;

/**
 * User message content (from MessageParam)
 */
export type UserMessageContent =
  | string
  | Array<
      | TextBlock
      | {
          type: 'image';
          source: { type: 'base64'; media_type: string; data: string };
        }
      | ToolResultBlock
    >;

/**
 * API User Message structure
 */
export interface APIUserMessage {
  role: 'user';
  content: UserMessageContent;
}

/**
 * API Assistant Message structure (from BetaMessage)
 */
export interface APIAssistantMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  content: ContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: Usage;
}

// =============================================================================
// RAW MESSAGE STREAM EVENTS (from BetaRawMessageStreamEvent)
// =============================================================================

export interface MessageStartEvent {
  type: 'message_start';
  message: APIAssistantMessage;
}

export interface ContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: ContentBlock;
}

export interface TextDelta {
  type: 'text_delta';
  text: string;
}

export interface InputJsonDelta {
  type: 'input_json_delta';
  partial_json: string;
}

export interface ThinkingDelta {
  type: 'thinking_delta';
  thinking: string;
}

export type Delta = TextDelta | InputJsonDelta | ThinkingDelta;

export interface ContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: Delta;
}

export interface ContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

export interface MessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
    stop_sequence?: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

export interface MessageStopEvent {
  type: 'message_stop';
}

/**
 * Raw message stream event union
 */
export type RawMessageStreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent;

// =============================================================================
// MCP SERVER CONFIGURATION TYPES
// =============================================================================

export type McpStdioServerConfig = {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpSSEServerConfig = {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
};

export type McpHttpServerConfig = {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
};

/**
 * MCP SDK server configuration
 */
export type McpSdkServerConfig = {
  type: 'sdk';
  name: string;
};

/**
 * MCP Claude AI proxy server configuration
 */
export type McpClaudeAIProxyServerConfig = {
  type: 'claudeai-proxy';
  url: string;
  id: string;
};

/**
 * MCP server config for process transport (serializable, no live instances)
 */
export type McpServerConfigForProcessTransport =
  | McpStdioServerConfig
  | McpSSEServerConfig
  | McpHttpServerConfig
  | McpSdkServerConfig;

/**
 * MCP server status configuration (includes proxy config)
 */
export type McpServerStatusConfig =
  | McpServerConfigForProcessTransport
  | McpClaudeAIProxyServerConfig;

/**
 * MCP server config union (without McpSdkServerConfigWithInstance for ESM compat)
 * NOTE: McpSdkServerConfigWithInstance omitted to avoid importing McpServer
 */
export type McpServerConfig =
  | McpStdioServerConfig
  | McpSSEServerConfig
  | McpHttpServerConfig;

/**
 * Result of a setMcpServers operation.
 */
export type McpSetServersResult = {
  /** Names of servers that were added */
  added: string[];
  /** Names of servers that were removed */
  removed: string[];
  /** Map of server names to error messages for servers that failed to connect */
  errors: Record<string, string>;
};

// =============================================================================
// SDK MESSAGE TYPES
// =============================================================================

/**
 * Permission mode for session
 */
export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'delegate'
  | 'dontAsk';

/**
 * Permission denial record
 */
export interface SDKPermissionDenial {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
}

/**
 * SDK User Message (new message from user)
 */
export interface SDKUserMessage {
  type: 'user';
  message: APIUserMessage;
  parent_tool_use_id: string | null;
  /** Synthetic/meta message - should NOT be displayed in the UI.
   * The SDK maps internal isMeta -> isSynthetic when emitting.
   * True for: skill .md content, reminders, system injections, etc. */
  isSynthetic?: boolean;
  /** @deprecated SDK 0.2.25+ maps isMeta -> isSynthetic on emission.
   * Kept for backwards compatibility with older SDK versions and JSONL data. */
  isMeta?: boolean;
  tool_use_result?: unknown;
  /** Message priority for async scheduling */
  priority?: 'now' | 'next' | 'later';
  /** ISO timestamp when the message was created on the originating process */
  timestamp?: string;
  uuid?: UUID;
  session_id: string;
}

/**
 * SDK User Message Replay (historical message during resume)
 */
export interface SDKUserMessageReplay {
  type: 'user';
  message: APIUserMessage;
  parent_tool_use_id: string | null;
  isSynthetic?: boolean;
  tool_use_result?: unknown;
  /** Message priority for async scheduling */
  priority?: 'now' | 'next' | 'later';
  /** ISO timestamp when the message was created on the originating process */
  timestamp?: string;
  uuid: UUID;
  session_id: string;
  /** True if this is a replay - DON'T store these! */
  isReplay: true;
}

/**
 * SDK Assistant Message Error types
 */
export type SDKAssistantMessageError =
  | 'authentication_failed'
  | 'billing_error'
  | 'rate_limit'
  | 'invalid_request'
  | 'server_error'
  | 'unknown'
  | 'max_output_tokens';

/**
 * SDK Assistant Message (complete message)
 */
export interface SDKAssistantMessage {
  type: 'assistant';
  message: APIAssistantMessage;
  parent_tool_use_id: string | null;
  error?: SDKAssistantMessageError;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Result Message - Success
 */
export interface SDKResultMessageSuccess {
  type: 'result';
  subtype: 'success';
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  result: string;
  stop_reason: string | null;
  total_cost_usd: number;
  usage: NonNullableUsage;
  modelUsage: Record<string, ModelUsage>;
  permission_denials: SDKPermissionDenial[];
  structured_output?: unknown;
  fast_mode_state?: FastModeState;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Result Message - Error
 */
export interface SDKResultMessageError {
  type: 'result';
  subtype:
    | 'error_during_execution'
    | 'error_max_turns'
    | 'error_max_budget_usd'
    | 'error_max_structured_output_retries';
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  stop_reason: string | null;
  total_cost_usd: number;
  usage: NonNullableUsage;
  modelUsage: Record<string, ModelUsage>;
  permission_denials: SDKPermissionDenial[];
  errors: string[];
  fast_mode_state?: FastModeState;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Result Message (union)
 */
export type SDKResultMessage = SDKResultMessageSuccess | SDKResultMessageError;

/**
 * SDK System Message - Init
 */
export interface SDKSystemMessage {
  type: 'system';
  subtype: 'init';
  agents?: string[];
  apiKeySource: ApiKeySource;
  betas?: string[];
  claude_code_version: string;
  cwd: string;
  tools: string[];
  mcp_servers: Array<{ name: string; status: string }>;
  model: string;
  permissionMode: PermissionMode;
  slash_commands: string[];
  output_style: string;
  skills: string[];
  plugins: Array<{ name: string; path: string }>;
  fast_mode_state?: FastModeState;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Partial Assistant Message (streaming)
 */
export interface SDKPartialAssistantMessage {
  type: 'stream_event';
  event: RawMessageStreamEvent;
  parent_tool_use_id: string | null;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Compact Boundary Message
 */
export interface SDKCompactBoundaryMessage {
  type: 'system';
  subtype: 'compact_boundary';
  compact_metadata: {
    trigger: 'manual' | 'auto';
    pre_tokens: number;
    /**
     * Relink info for messagesToKeep. Loaders splice the preserved segment
     * at anchor_uuid so resume includes preserved content.
     * Unset when compaction summarizes everything (no messagesToKeep).
     */
    preserved_segment?: {
      head_uuid: UUID;
      anchor_uuid: UUID;
      tail_uuid: UUID;
    };
  };
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Status types
 */
export type SDKStatus = 'compacting' | null;

/**
 * SDK Status Message
 */
export interface SDKStatusMessage {
  type: 'system';
  subtype: 'status';
  status: SDKStatus;
  permissionMode?: PermissionMode;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Hook Started Message
 */
export interface SDKHookStartedMessage {
  type: 'system';
  subtype: 'hook_started';
  hook_id: string;
  hook_name: string;
  hook_event: string;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Hook Progress Message
 */
export interface SDKHookProgressMessage {
  type: 'system';
  subtype: 'hook_progress';
  hook_id: string;
  hook_name: string;
  hook_event: string;
  stdout: string;
  stderr: string;
  output: string;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Hook Response Message
 */
export interface SDKHookResponseMessage {
  type: 'system';
  subtype: 'hook_response';
  hook_id: string;
  hook_name: string;
  hook_event: string;
  output: string;
  stdout: string;
  stderr: string;
  exit_code?: number;
  outcome: 'success' | 'error' | 'cancelled';
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Tool Progress Message
 */
export interface SDKToolProgressMessage {
  type: 'tool_progress';
  tool_use_id: string;
  tool_name: string;
  parent_tool_use_id: string | null;
  elapsed_time_seconds: number;
  task_id?: string;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Auth Status Message
 */
export interface SDKAuthStatusMessage {
  type: 'auth_status';
  isAuthenticating: boolean;
  output: string[];
  error?: string;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Task Notification Message
 */
export interface SDKTaskNotificationMessage {
  type: 'system';
  subtype: 'task_notification';
  task_id: string;
  tool_use_id?: string;
  status: 'completed' | 'failed' | 'stopped';
  output_file: string;
  summary: string;
  usage?: {
    total_tokens: number;
    tool_uses: number;
    duration_ms: number;
  };
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Task Started Message
 */
export interface SDKTaskStartedMessage {
  type: 'system';
  subtype: 'task_started';
  task_id: string;
  tool_use_id?: string;
  description: string;
  task_type?: string;
  prompt?: string;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Task Progress Message
 */
export interface SDKTaskProgressMessage {
  type: 'system';
  subtype: 'task_progress';
  task_id: string;
  tool_use_id?: string;
  description: string;
  usage: {
    total_tokens: number;
    tool_uses: number;
    duration_ms: number;
  };
  last_tool_name?: string;
  summary?: string;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Files Persisted Event
 */
export interface SDKFilesPersistedEvent {
  type: 'system';
  subtype: 'files_persisted';
  files: Array<{
    filename: string;
    file_id: string;
  }>;
  failed: Array<{
    filename: string;
    error: string;
  }>;
  processed_at: string;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Tool Use Summary Message
 */
export interface SDKToolUseSummaryMessage {
  type: 'tool_use_summary';
  summary: string;
  preceding_tool_use_ids: string[];
  uuid: UUID;
  session_id: string;
}

/**
 * SDK API Retry Message
 * Emitted when an API request fails with a retryable error and will be retried after a delay.
 */
export interface SDKAPIRetryMessage {
  type: 'system';
  subtype: 'api_retry';
  attempt: number;
  max_retries: number;
  retry_delay_ms: number;
  error_status: number | null;
  error: SDKAssistantMessageError;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Local Command Output Message
 * Output from a local slash command (e.g. /voice, /cost).
 */
export interface SDKLocalCommandOutputMessage {
  type: 'system';
  subtype: 'local_command_output';
  content: string;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Rate Limit Info
 * Rate limit information for claude.ai subscription users.
 */
export interface SDKRateLimitInfo {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  resetsAt?: number;
  rateLimitType?:
    | 'five_hour'
    | 'seven_day'
    | 'seven_day_opus'
    | 'seven_day_sonnet'
    | 'overage';
  utilization?: number;
  overageStatus?: 'allowed' | 'allowed_warning' | 'rejected';
  overageResetsAt?: number;
  overageDisabledReason?:
    | 'overage_not_provisioned'
    | 'org_level_disabled'
    | 'org_level_disabled_until'
    | 'out_of_credits'
    | 'seat_tier_level_disabled'
    | 'member_level_disabled'
    | 'seat_tier_zero_credit_limit'
    | 'group_zero_credit_limit'
    | 'member_zero_credit_limit'
    | 'org_service_level_disabled'
    | 'org_service_zero_credit_limit'
    | 'no_limits_configured'
    | 'unknown';
  isUsingOverage?: boolean;
  surpassedThreshold?: number;
}

/**
 * SDK Rate Limit Event
 * Emitted when rate limit info changes.
 */
export interface SDKRateLimitEvent {
  type: 'rate_limit_event';
  rate_limit_info: SDKRateLimitInfo;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Prompt Suggestion Message
 * Predicted next user prompt, emitted after each turn when promptSuggestions is enabled.
 */
export interface SDKPromptSuggestionMessage {
  type: 'prompt_suggestion';
  suggestion: string;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Elicitation Complete Message
 * Emitted when an MCP server confirms that a URL-mode elicitation is complete.
 */
export interface SDKElicitationCompleteMessage {
  type: 'system';
  subtype: 'elicitation_complete';
  mcp_server_name: string;
  elicitation_id: string;
  uuid: UUID;
  session_id: string;
}

// =============================================================================
// DISCRIMINATED UNION - THE MAIN TYPE
// =============================================================================

/**
 * SDK Message - Discriminated union of ALL message types
 *
 * Use type guards to narrow:
 * ```typescript
 * if (msg.type === 'stream_event') {
 *   // msg is SDKPartialAssistantMessage
 * }
 * if (msg.type === 'result') {
 *   // msg is SDKResultMessage
 * }
 * ```
 */
export type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKUserMessageReplay
  | SDKResultMessage
  | SDKSystemMessage
  | SDKPartialAssistantMessage
  | SDKCompactBoundaryMessage
  | SDKStatusMessage
  | SDKAPIRetryMessage
  | SDKLocalCommandOutputMessage
  | SDKHookStartedMessage
  | SDKHookProgressMessage
  | SDKHookResponseMessage
  | SDKToolProgressMessage
  | SDKAuthStatusMessage
  | SDKTaskNotificationMessage
  | SDKTaskStartedMessage
  | SDKTaskProgressMessage
  | SDKFilesPersistedEvent
  | SDKToolUseSummaryMessage
  | SDKRateLimitEvent
  | SDKElicitationCompleteMessage
  | SDKPromptSuggestionMessage;

// =============================================================================
// TYPE GUARDS - Use these instead of type casts!
// =============================================================================

/**
 * Check if message is a stream event
 */
export function isStreamEvent(
  msg: SDKMessage
): msg is SDKPartialAssistantMessage {
  return msg.type === 'stream_event';
}

/**
 * Check if message is a result
 */
export function isResultMessage(msg: SDKMessage): msg is SDKResultMessage {
  return msg.type === 'result';
}

/**
 * Check if message is a successful result
 */
export function isSuccessResult(
  msg: SDKMessage
): msg is SDKResultMessageSuccess {
  return msg.type === 'result' && msg.subtype === 'success';
}

/**
 * Check if message is an error result
 */
export function isErrorResult(msg: SDKMessage): msg is SDKResultMessageError {
  return msg.type === 'result' && msg.subtype !== 'success';
}

/**
 * Check if message is system init
 */
export function isSystemInit(msg: SDKMessage): msg is SDKSystemMessage {
  return msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init';
}

/**
 * Check if message is a compact_boundary system message
 */
export function isCompactBoundary(
  msg: SDKMessage
): msg is SDKCompactBoundaryMessage {
  return (
    msg.type === 'system' &&
    'subtype' in msg &&
    msg.subtype === 'compact_boundary'
  );
}

/**
 * Check if message is a user message (not replay)
 */
export function isUserMessage(msg: SDKMessage): msg is SDKUserMessage {
  return msg.type === 'user' && !('isReplay' in msg && msg.isReplay);
}

/**
 * Check if message is a replay (during resume)
 */
export function isReplayMessage(msg: SDKMessage): msg is SDKUserMessageReplay {
  return msg.type === 'user' && 'isReplay' in msg && msg.isReplay === true;
}

/**
 * Check if message is assistant message (complete)
 */
export function isAssistantMessage(
  msg: SDKMessage
): msg is SDKAssistantMessage {
  return msg.type === 'assistant';
}

/**
 * Check if message is tool progress
 */
export function isToolProgress(msg: SDKMessage): msg is SDKToolProgressMessage {
  return msg.type === 'tool_progress';
}

/**
 * Check if message is tool use summary
 */
export function isToolUseSummary(
  msg: SDKMessage
): msg is SDKToolUseSummaryMessage {
  return msg.type === 'tool_use_summary';
}

/**
 * Check if message is a rate limit event
 */
export function isRateLimitEvent(msg: SDKMessage): msg is SDKRateLimitEvent {
  return msg.type === 'rate_limit_event';
}

/**
 * Check if message is a prompt suggestion
 */
export function isPromptSuggestion(
  msg: SDKMessage
): msg is SDKPromptSuggestionMessage {
  return msg.type === 'prompt_suggestion';
}

/**
 * Check if message is an API retry message
 */
export function isAPIRetryMessage(msg: SDKMessage): msg is SDKAPIRetryMessage {
  return (
    msg.type === 'system' && 'subtype' in msg && msg.subtype === 'api_retry'
  );
}

/**
 * Check if message is a task started message
 */
export function isTaskStarted(msg: SDKMessage): msg is SDKTaskStartedMessage {
  return (
    msg.type === 'system' && 'subtype' in msg && msg.subtype === 'task_started'
  );
}

/**
 * Check if message is a task progress message
 */
export function isTaskProgress(msg: SDKMessage): msg is SDKTaskProgressMessage {
  return (
    msg.type === 'system' && 'subtype' in msg && msg.subtype === 'task_progress'
  );
}

// =============================================================================
// STREAM EVENT TYPE GUARDS
// =============================================================================

/**
 * Check if stream event is message_start
 */
export function isMessageStart(
  event: RawMessageStreamEvent
): event is MessageStartEvent {
  return event.type === 'message_start';
}

/**
 * Check if stream event is content_block_start
 */
export function isContentBlockStart(
  event: RawMessageStreamEvent
): event is ContentBlockStartEvent {
  return event.type === 'content_block_start';
}

/**
 * Check if stream event is content_block_delta
 */
export function isContentBlockDelta(
  event: RawMessageStreamEvent
): event is ContentBlockDeltaEvent {
  return event.type === 'content_block_delta';
}

/**
 * Check if stream event is content_block_stop
 */
export function isContentBlockStop(
  event: RawMessageStreamEvent
): event is ContentBlockStopEvent {
  return event.type === 'content_block_stop';
}

/**
 * Check if stream event is message_delta
 */
export function isMessageDelta(
  event: RawMessageStreamEvent
): event is MessageDeltaEvent {
  return event.type === 'message_delta';
}

/**
 * Check if stream event is message_stop
 */
export function isMessageStop(
  event: RawMessageStreamEvent
): event is MessageStopEvent {
  return event.type === 'message_stop';
}

// =============================================================================
// CONTENT BLOCK TYPE GUARDS
// =============================================================================

/**
 * Check if content block is text
 */
export function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === 'text';
}

/**
 * Check if content block is tool_use
 */
export function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === 'tool_use';
}

/**
 * Check if content block is tool_result
 */
export function isToolResultBlock(
  block: ContentBlock
): block is ToolResultBlock {
  return block.type === 'tool_result';
}

/**
 * Check if content block is thinking
 */
export function isThinkingBlock(block: ContentBlock): block is ThinkingBlock {
  return block.type === 'thinking';
}

// =============================================================================
// DELTA TYPE GUARDS
// =============================================================================

/**
 * Check if delta is text_delta
 */
export function isTextDelta(delta: Delta): delta is TextDelta {
  return delta.type === 'text_delta';
}

/**
 * Check if delta is input_json_delta
 */
export function isInputJsonDelta(delta: Delta): delta is InputJsonDelta {
  return delta.type === 'input_json_delta';
}

/**
 * Check if delta is thinking_delta
 */
export function isThinkingDelta(delta: Delta): delta is ThinkingDelta {
  return delta.type === 'thinking_delta';
}

// =============================================================================
// PERMISSION SYSTEM TYPES
// =============================================================================

/**
 * Permission update destination
 */
export type PermissionUpdateDestination =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'session'
  | 'cliArg';

/**
 * Permission behavior
 */
export type PermissionBehavior = 'allow' | 'deny' | 'ask';

/**
 * Permission rule value
 */
export interface PermissionRuleValue {
  toolName: string;
  ruleContent?: string;
}

/**
 * Permission update suggestion - complete SDK union type
 */
export type PermissionUpdate =
  | {
      type: 'addRules';
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'replaceRules';
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'removeRules';
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'setMode';
      mode: PermissionMode;
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'addDirectories';
      directories: string[];
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'removeDirectories';
      directories: string[];
      destination: PermissionUpdateDestination;
    };

/**
 * Permission result returned from canUseTool callback
 * This is a discriminated union with 'behavior' as the discriminator
 */
export type PermissionResult =
  | {
      behavior: 'allow';
      /**
       * Updated tool input to use, if any changes are needed.
       */
      updatedInput?: Record<string, unknown>;
      /**
       * Permissions updates to be applied as part of accepting this tool use.
       * Typically from the `suggestions` field from the CanUseTool callback.
       */
      updatedPermissions?: PermissionUpdate[];
      /**
       * The tool use ID. Supplied and used internally.
       */
      toolUseID?: string;
    }
  | {
      behavior: 'deny';
      /**
       * Message indicating the reason for denial, or guidance of what the
       * model should do instead.
       */
      message: string;
      /**
       * If true, interrupt execution and do not continue.
       */
      interrupt?: boolean;
      /**
       * The tool use ID. Supplied and used internally.
       */
      toolUseID?: string;
    };

/**
 * Tool permission callback (from official SDK)
 *
 * Called by SDK when a tool needs permission to execute.
 * Must return PermissionResult indicating approval/denial.
 */
export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    /** Signaled if the operation should be aborted. */
    signal: AbortSignal;
    /**
     * Suggestions for updating permissions so that the user will not be
     * prompted again for this tool during this session.
     */
    suggestions?: PermissionUpdate[];
    /**
     * The file path that triggered the permission request, if applicable.
     * For example, when a Bash command tries to access a path outside allowed directories.
     */
    blockedPath?: string;
    /** Explains why this permission request was triggered. */
    decisionReason?: string;
    /**
     * Full permission prompt sentence rendered by the bridge (e.g.
     * "Claude wants to read foo.txt"). Use this as the primary prompt
     * text when present instead of reconstructing from toolName+input.
     */
    title?: string;
    /**
     * Short noun phrase for the tool action (e.g. "Read file"), suitable
     * for button labels or compact UI.
     */
    displayName?: string;
    /**
     * Human-readable subtitle from the bridge (e.g. "Claude will have
     * read and write access to files in ~/Downloads").
     */
    description?: string;
    /**
     * Unique identifier for this specific tool call within the assistant message.
     * Multiple tool calls in the same assistant message will have different toolUseIDs.
     */
    toolUseID: string;
    /** If running within the context of a sub-agent, the sub-agent's ID. */
    agentID?: string;
  }
) => Promise<PermissionResult>;

// =============================================================================
// HOOK SYSTEM TYPES
// =============================================================================

/**
 * Hook event names (from SDK HOOK_EVENTS constant)
 */
export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'StopFailure'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PostCompact'
  | 'PermissionRequest'
  | 'Setup'
  | 'TeammateIdle'
  | 'TaskCompleted'
  | 'Elicitation'
  | 'ElicitationResult'
  | 'ConfigChange'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  | 'InstructionsLoaded';

/**
 * Async hook output (for hooks that need more time)
 */
export interface AsyncHookJSONOutput {
  async: true;
  asyncTimeout?: number;
}

/**
 * Hook-specific output types
 */
export type PreToolUseHookSpecificOutput = {
  hookEventName: 'PreToolUse';
  permissionDecision?: 'allow' | 'deny' | 'ask';
  permissionDecisionReason?: string;
  updatedInput?: Record<string, unknown>;
  additionalContext?: string;
};

export type UserPromptSubmitHookSpecificOutput = {
  hookEventName: 'UserPromptSubmit';
  additionalContext?: string;
};

export type SessionStartHookSpecificOutput = {
  hookEventName: 'SessionStart';
  additionalContext?: string;
  initialUserMessage?: string;
};

export type SetupHookSpecificOutput = {
  hookEventName: 'Setup';
  additionalContext?: string;
};

export type SubagentStartHookSpecificOutput = {
  hookEventName: 'SubagentStart';
  additionalContext?: string;
};

export type PostToolUseHookSpecificOutput = {
  hookEventName: 'PostToolUse';
  additionalContext?: string;
  updatedMCPToolOutput?: unknown;
};

export type PostToolUseFailureHookSpecificOutput = {
  hookEventName: 'PostToolUseFailure';
  additionalContext?: string;
};

export type NotificationHookSpecificOutput = {
  hookEventName: 'Notification';
  additionalContext?: string;
};

export type PermissionRequestHookSpecificOutput = {
  hookEventName: 'PermissionRequest';
  decision:
    | {
        behavior: 'allow';
        updatedInput?: Record<string, unknown>;
        updatedPermissions?: PermissionUpdate[];
      }
    | {
        behavior: 'deny';
        message?: string;
        interrupt?: boolean;
      };
};

export type ElicitationHookSpecificOutput = {
  hookEventName: 'Elicitation';
  action?: 'accept' | 'decline' | 'cancel';
  content?: Record<string, unknown>;
};

export type ElicitationResultHookSpecificOutput = {
  hookEventName: 'ElicitationResult';
  action?: 'accept' | 'decline' | 'cancel';
  content?: Record<string, unknown>;
};

/**
 * Sync hook output (most common case)
 */
export interface SyncHookJSONOutput {
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  decision?: 'approve' | 'block';
  systemMessage?: string;
  reason?: string;
  hookSpecificOutput?:
    | PreToolUseHookSpecificOutput
    | UserPromptSubmitHookSpecificOutput
    | SessionStartHookSpecificOutput
    | SetupHookSpecificOutput
    | SubagentStartHookSpecificOutput
    | PostToolUseHookSpecificOutput
    | PostToolUseFailureHookSpecificOutput
    | NotificationHookSpecificOutput
    | PermissionRequestHookSpecificOutput
    | ElicitationHookSpecificOutput
    | ElicitationResultHookSpecificOutput;
}

/**
 * Hook JSON output (union of async and sync)
 */
export type HookJSONOutput = AsyncHookJSONOutput | SyncHookJSONOutput;

/**
 * Hook callback function signature
 */
export type HookCallback = (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal }
) => Promise<HookJSONOutput>;

/**
 * Hook callback matcher configuration
 */
export interface HookCallbackMatcher {
  /** Optional matcher pattern for filtering */
  matcher?: string;
  /** Array of hook callbacks to execute */
  hooks: HookCallback[];
  /** Timeout in seconds for all hooks in this matcher */
  timeout?: number;
}

/**
 * Base hook input (common fields for all hooks)
 */
export interface BaseHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
  /**
   * Subagent identifier. Present only when the hook fires from within a subagent.
   * Absent for the main thread, even in --agent sessions.
   */
  agent_id?: string;
  /**
   * Agent type name (e.g., "general-purpose", "code-reviewer").
   * Present when the hook fires from within a subagent (alongside agent_id),
   * or on the main thread of a session started with --agent (without agent_id).
   */
  agent_type?: string;
}

/**
 * PreToolUse hook input
 */
export interface PreToolUseHookInput extends BaseHookInput {
  hook_event_name: 'PreToolUse';
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
}

/**
 * PermissionRequest hook input
 */
export interface PermissionRequestHookInput extends BaseHookInput {
  hook_event_name: 'PermissionRequest';
  tool_name: string;
  tool_input: unknown;
  permission_suggestions?: PermissionUpdate[];
}

/**
 * PostToolUse hook input
 */
export interface PostToolUseHookInput extends BaseHookInput {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
  tool_use_id: string;
}

/**
 * PostToolUseFailure hook input
 */
export interface PostToolUseFailureHookInput extends BaseHookInput {
  hook_event_name: 'PostToolUseFailure';
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
  error: string;
  is_interrupt?: boolean;
}

/**
 * Notification hook input
 */
export interface NotificationHookInput extends BaseHookInput {
  hook_event_name: 'Notification';
  message: string;
  title?: string;
  notification_type: string;
}

/**
 * UserPromptSubmit hook input
 */
export interface UserPromptSubmitHookInput extends BaseHookInput {
  hook_event_name: 'UserPromptSubmit';
  prompt: string;
}

/**
 * SessionStart hook input
 */
export interface SessionStartHookInput extends BaseHookInput {
  hook_event_name: 'SessionStart';
  source: 'startup' | 'resume' | 'clear' | 'compact';
  agent_type?: string;
  model?: string;
}

/**
 * Stop hook input
 */
export interface StopHookInput extends BaseHookInput {
  hook_event_name: 'Stop';
  stop_hook_active: boolean;
  /** Text content of the last assistant message before stopping */
  last_assistant_message?: string;
}

/**
 * StopFailure hook input
 */
export interface StopFailureHookInput extends BaseHookInput {
  hook_event_name: 'StopFailure';
  error: SDKAssistantMessageError;
  error_details?: string;
  last_assistant_message?: string;
}

/**
 * SubagentStart hook input - fires when a subagent begins execution
 */
export interface SubagentStartHookInput extends BaseHookInput {
  hook_event_name: 'SubagentStart';
  /** Unique identifier for the subagent */
  agent_id: string;
  /** Type of agent (e.g., "software-architect", "backend-developer") */
  agent_type: string;
}

/**
 * SubagentStop hook input - fires when a subagent completes
 */
export interface SubagentStopHookInput extends BaseHookInput {
  hook_event_name: 'SubagentStop';
  stop_hook_active: boolean;
  /** Unique identifier for the subagent (matches SubagentStartHookInput.agent_id) */
  agent_id: string;
  /** Path to the subagent's transcript JSONL file */
  agent_transcript_path: string;
  /** Type of agent (e.g., "software-architect", "backend-developer") */
  agent_type: string;
  /** Text content of the last assistant message before stopping */
  last_assistant_message?: string;
}

/**
 * PreCompact hook input
 */
export interface PreCompactHookInput extends BaseHookInput {
  hook_event_name: 'PreCompact';
  trigger: 'manual' | 'auto';
  custom_instructions: string | null;
}

/**
 * PostCompact hook input
 */
export interface PostCompactHookInput extends BaseHookInput {
  hook_event_name: 'PostCompact';
  trigger: 'manual' | 'auto';
  /** The conversation summary produced by compaction */
  compact_summary: string;
}

/**
 * SessionEnd hook input
 */
export interface SessionEndHookInput extends BaseHookInput {
  hook_event_name: 'SessionEnd';
  reason: ExitReason;
}

/**
 * Setup hook input
 */
export interface SetupHookInput extends BaseHookInput {
  hook_event_name: 'Setup';
  trigger: 'init' | 'maintenance';
}

/**
 * TeammateIdle hook input
 */
export interface TeammateIdleHookInput extends BaseHookInput {
  hook_event_name: 'TeammateIdle';
  teammate_name: string;
  team_name: string;
}

/**
 * TaskCompleted hook input
 */
export interface TaskCompletedHookInput extends BaseHookInput {
  hook_event_name: 'TaskCompleted';
  task_id: string;
  task_subject: string;
  task_description?: string;
  teammate_name?: string;
  team_name?: string;
}

/**
 * Elicitation hook input - fires when an MCP server requests user input
 */
export interface ElicitationHookInput extends BaseHookInput {
  hook_event_name: 'Elicitation';
  mcp_server_name: string;
  message: string;
  mode?: 'form' | 'url';
  url?: string;
  elicitation_id?: string;
  requested_schema?: Record<string, unknown>;
}

/**
 * ElicitationResult hook input - fires after the user responds to an MCP elicitation
 */
export interface ElicitationResultHookInput extends BaseHookInput {
  hook_event_name: 'ElicitationResult';
  mcp_server_name: string;
  elicitation_id?: string;
  mode?: 'form' | 'url';
  action: 'accept' | 'decline' | 'cancel';
  content?: Record<string, unknown>;
}

/**
 * ConfigChange hook input
 */
export interface ConfigChangeHookInput extends BaseHookInput {
  hook_event_name: 'ConfigChange';
  source:
    | 'user_settings'
    | 'project_settings'
    | 'local_settings'
    | 'policy_settings'
    | 'skills';
  file_path?: string;
}

/**
 * InstructionsLoaded hook input
 */
export interface InstructionsLoadedHookInput extends BaseHookInput {
  hook_event_name: 'InstructionsLoaded';
  file_path: string;
  memory_type: 'User' | 'Project' | 'Local' | 'Managed';
  load_reason:
    | 'session_start'
    | 'nested_traversal'
    | 'path_glob_match'
    | 'include'
    | 'compact';
  globs?: string[];
  trigger_file_path?: string;
  parent_file_path?: string;
}

/**
 * WorktreeCreate hook input
 */
export interface WorktreeCreateHookInput extends BaseHookInput {
  hook_event_name: 'WorktreeCreate';
  name: string;
}

/**
 * WorktreeRemove hook input
 */
export interface WorktreeRemoveHookInput extends BaseHookInput {
  hook_event_name: 'WorktreeRemove';
  worktree_path: string;
}

/**
 * Hook input union - all possible hook input types
 */
export type HookInput =
  | PreToolUseHookInput
  | PostToolUseHookInput
  | PostToolUseFailureHookInput
  | NotificationHookInput
  | UserPromptSubmitHookInput
  | SessionStartHookInput
  | SessionEndHookInput
  | StopHookInput
  | StopFailureHookInput
  | SubagentStartHookInput
  | SubagentStopHookInput
  | PreCompactHookInput
  | PostCompactHookInput
  | PermissionRequestHookInput
  | SetupHookInput
  | TeammateIdleHookInput
  | TaskCompletedHookInput
  | ElicitationHookInput
  | ElicitationResultHookInput
  | ConfigChangeHookInput
  | InstructionsLoadedHookInput
  | WorktreeCreateHookInput
  | WorktreeRemoveHookInput;

// =============================================================================
// HOOK TYPE GUARDS
// =============================================================================

/**
 * Check if hook input is SubagentStart
 */
export function isSubagentStartHook(
  input: HookInput
): input is SubagentStartHookInput {
  return input.hook_event_name === 'SubagentStart';
}

/**
 * Check if hook input is SubagentStop
 */
export function isSubagentStopHook(
  input: HookInput
): input is SubagentStopHookInput {
  return input.hook_event_name === 'SubagentStop';
}

/**
 * Check if hook input is PreToolUse
 */
export function isPreToolUseHook(
  input: HookInput
): input is PreToolUseHookInput {
  return input.hook_event_name === 'PreToolUse';
}

/**
 * Check if hook input is PostToolUse
 */
export function isPostToolUseHook(
  input: HookInput
): input is PostToolUseHookInput {
  return input.hook_event_name === 'PostToolUse';
}

/**
 * Check if hook input is SessionStart
 */
export function isSessionStartHook(
  input: HookInput
): input is SessionStartHookInput {
  return input.hook_event_name === 'SessionStart';
}

/**
 * Check if hook input is SessionEnd
 */
export function isSessionEndHook(
  input: HookInput
): input is SessionEndHookInput {
  return input.hook_event_name === 'SessionEnd';
}

/**
 * Check if hook input is Setup
 */
export function isSetupHook(input: HookInput): input is SetupHookInput {
  return input.hook_event_name === 'Setup';
}

// =============================================================================
// AGENT DEFINITION
// =============================================================================

/**
 * MCP server spec for agents - either a string name or a config record
 */
export type AgentMcpServerSpec =
  | string
  | Record<string, McpServerConfigForProcessTransport>;

/**
 * Definition for a custom subagent that can be invoked via the Task tool.
 */
export type AgentDefinition = {
  /** Natural language description of when to use this agent */
  description: string;
  /** Array of allowed tool names. If omitted, inherits all tools from parent */
  tools?: string[];
  /** Array of tool names to explicitly disallow for this agent */
  disallowedTools?: string[];
  /** The agent's system prompt */
  prompt: string;
  /** Model alias (e.g. 'sonnet', 'opus', 'haiku') or full model ID. If omitted or 'inherit', uses the main model */
  model?: string;
  /** MCP servers for this agent */
  mcpServers?: AgentMcpServerSpec[];
  /** Experimental: Critical reminder added to system prompt */
  criticalSystemReminder_EXPERIMENTAL?: string;
  /** Array of skill names to preload into the agent context */
  skills?: string[];
  /** Maximum number of agentic turns (API round-trips) before stopping */
  maxTurns?: number;
};

/**
 * Information about an available subagent that can be invoked via the Task tool.
 */
export interface AgentInfo {
  /** Agent type identifier (e.g., "Explore") */
  name: string;
  /** Description of when to use this agent */
  description: string;
  /** Model alias this agent uses. If omitted, inherits the parent's model */
  model?: string;
}

// =============================================================================
// ACCOUNT & SERVER STATUS TYPES
// =============================================================================

/**
 * Information about an available slash command.
 */
export interface SlashCommand {
  /** Command name (without the leading slash) */
  name: string;
  /** Description of what the command does */
  description: string;
  /** Hint for command arguments (e.g., "<file>") */
  argumentHint: string;
}

/**
 * Information about an available model.
 */
export interface ModelInfo {
  /** Model identifier to use in API calls */
  value: string;
  /** Human-readable display name */
  displayName: string;
  /** Description of the model's capabilities */
  description: string;
  /** Whether this model supports effort levels */
  supportsEffort?: boolean;
  /** Available effort levels for this model */
  supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[];
  /** Whether this model supports adaptive thinking (Claude decides when and how much to think) */
  supportsAdaptiveThinking?: boolean;
  /** Whether this model supports fast mode */
  supportsFastMode?: boolean;
  /** Whether this model supports auto mode */
  supportsAutoMode?: boolean;
}

/**
 * Information about the logged in user's account.
 */
export interface AccountInfo {
  email?: string;
  organization?: string;
  subscriptionType?: string;
  tokenSource?: string;
  apiKeySource?: string;
  /**
   * Active API backend. Anthropic OAuth login only applies when "firstParty";
   * for 3P providers the other fields are absent and auth is external
   * (AWS creds, gcloud ADC, etc.).
   */
  apiProvider?: 'firstParty' | 'bedrock' | 'vertex' | 'foundry';
}

/**
 * Status information for an MCP server connection.
 */
export interface McpServerStatus {
  /** Server name as configured */
  name: string;
  /** Current connection status */
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  /** Server information (available when connected) */
  serverInfo?: {
    name: string;
    version: string;
  };
  /** Error message (available when status is 'failed') */
  error?: string;
  /** Server configuration (includes URL for HTTP/SSE servers) */
  config?: McpServerStatusConfig;
  /** Configuration scope (e.g., project, user, local, claudeai, managed) */
  scope?: string;
  /** Tools provided by this server (available when connected) */
  tools?: Array<{
    name: string;
    description?: string;
    annotations?: {
      readOnly?: boolean;
      destructive?: boolean;
      openWorld?: boolean;
    };
  }>;
}

/**
 * Result of a rewindFiles operation.
 */
export type RewindFilesResult = {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
};

/**
 * Session metadata returned by listSessions and getSessionInfo.
 */
export interface SDKSessionInfo {
  /** Unique session identifier (UUID) */
  sessionId: string;
  /** Display title for the session: custom title, auto-generated summary, or first prompt */
  summary: string;
  /** Last modified time in milliseconds since epoch */
  lastModified: number;
  /** File size in bytes. Only populated for local JSONL storage */
  fileSize?: number;
  /** User-set session title via /rename */
  customTitle?: string;
  /** First meaningful user prompt in the session */
  firstPrompt?: string;
  /** Git branch at the end of the session */
  gitBranch?: string;
  /** Working directory for the session */
  cwd?: string;
  /** User-set session tag */
  tag?: string;
  /** Creation time in milliseconds since epoch */
  createdAt?: number;
}

/**
 * Prompt request option
 */
export interface PromptRequestOption {
  /** Unique key for this option, returned in the response */
  key: string;
  /** Display text for this option */
  label: string;
  /** Optional description shown below the label */
  description?: string;
}

/**
 * Prompt request
 */
export interface PromptRequest {
  /** Request ID. Presence of this key marks the line as a prompt request */
  prompt: string;
  /** The prompt message to display to the user */
  message: string;
  /** Available options for the user to choose from */
  options: PromptRequestOption[];
}

/**
 * Prompt response
 */
export interface PromptResponse {
  /** The request ID from the corresponding prompt request */
  prompt_response: string;
  /** The key of the selected option */
  selected: string;
}

/**
 * Elicitation request from an MCP server, asking the SDK consumer for user input.
 */
export interface ElicitationRequest {
  /** Name of the MCP server requesting elicitation */
  serverName: string;
  /** Message to display to the user */
  message: string;
  /** Elicitation mode: 'form' for structured input, 'url' for browser-based auth */
  mode?: 'form' | 'url';
  /** URL to open (only for 'url' mode) */
  url?: string;
  /** Elicitation ID for correlating URL elicitations with completion notifications */
  elicitationId?: string;
  /** JSON Schema for the requested input (only for 'form' mode) */
  requestedSchema?: Record<string, unknown>;
}

/**
 * Callback for handling MCP elicitation requests.
 * Called when an MCP server requests user input and no hook handles it.
 */
export type OnElicitation = (
  request: ElicitationRequest,
  options: { signal: AbortSignal }
) => Promise<unknown>;

/**
 * Per-tool configuration for built-in tools.
 */
export type ToolConfig = {
  askUserQuestion?: {
    /**
     * Content format for the `preview` field on question options.
     * - 'markdown' - Markdown/ASCII content (CLI default)
     * - 'html' - Self-contained HTML fragments (for web-based SDK consumers)
     */
    previewFormat?: 'markdown' | 'html';
  };
};

// =============================================================================
// SDK QUERY OPTIONS (from Options type)
// =============================================================================

/**
 * SDK Query Options - Configuration for query() function
 */
export interface Options {
  /** Controller for cancelling the query */
  abortController?: AbortController;
  /** Additional directories Claude can access beyond the current working directory */
  additionalDirectories?: string[];
  /** Agent name for the main thread */
  agent?: string;
  /** Programmatically define custom subagents invocable via the Task tool */
  agents?: Record<string, AgentDefinition>;
  /** List of tool names that are allowed */
  allowedTools?: string[];
  /** Custom permission handler for controlling tool usage */
  canUseTool?: CanUseTool;
  /** Continue the most recent conversation */
  continue?: boolean;
  /** Current working directory for the session */
  cwd?: string;
  /** List of tool names that are disallowed */
  disallowedTools?: string[];
  /** Specify the base set of available built-in tools */
  tools?:
    | string[]
    | {
        type: 'preset';
        preset: 'claude_code';
      };
  /** Environment variables to pass to the Claude process */
  env?: Record<string, string | undefined>;
  /** JavaScript runtime to use */
  executable?: 'bun' | 'deno' | 'node';
  /** Additional arguments to pass to the JavaScript runtime */
  executableArgs?: string[];
  /** Additional CLI arguments to pass to Claude */
  extraArgs?: Record<string, string | null>;
  /** Fallback model to use if the primary model fails */
  fallbackModel?: string;
  /** Enable file checkpointing for rewind support */
  enableFileCheckpointing?: boolean;
  /** Per-tool configuration for built-in tools */
  toolConfig?: ToolConfig;
  /** Fork to a new session ID when resuming */
  forkSession?: boolean;
  /** Enable beta features */
  betas?: SdkBeta[];
  /** Hook callbacks for responding to various events */
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  /** Callback for handling MCP elicitation requests */
  onElicitation?: OnElicitation;
  /** When false, disables session persistence to disk */
  persistSession?: boolean;
  /** Include partial/streaming message events in the output */
  includePartialMessages?: boolean;
  /** Thinking/reasoning mode configuration */
  thinking?: ThinkingConfig;
  /** Effort level for reasoning depth */
  effort?: 'low' | 'medium' | 'high' | 'max';
  /** Maximum number of tokens for thinking/reasoning (deprecated: use thinking instead) */
  maxThinkingTokens?: number;
  /** Maximum number of conversation turns */
  maxTurns?: number;
  /** Maximum budget in USD for the query */
  maxBudgetUsd?: number;
  /** MCP server configurations */
  mcpServers?: Record<string, McpServerConfig>;
  /** Claude model to use */
  model?: string;
  /** Output format configuration for structured responses */
  outputFormat?: OutputFormat;
  /** Path to the Claude executable */
  pathToClaudeCodeExecutable?: string;
  /** Permission mode for the session */
  permissionMode?: PermissionMode;
  /** Must be set to true when using permissionMode: 'bypassPermissions' */
  allowDangerouslySkipPermissions?: boolean;
  /** MCP tool name to use for permission prompts */
  permissionPromptToolName?: string;
  /** Load plugins for this session */
  plugins?: SdkPluginConfig[];
  /** Enable prompt suggestions after each turn */
  promptSuggestions?: boolean;
  /** Enable periodic AI-generated progress summaries for running subagents */
  agentProgressSummaries?: boolean;
  /** Session ID to resume */
  resume?: string;
  /** Use a specific session ID for the conversation instead of an auto-generated one */
  sessionId?: string;
  /** When resuming, only resume up to this message UUID */
  resumeSessionAt?: string;
  /** Sandbox settings for command execution isolation */
  sandbox?: Record<string, unknown>;
  /** Additional settings to apply (path or settings object) */
  settings?: string | Record<string, unknown>;
  /** Control which filesystem settings to load */
  settingSources?: SettingSource[];
  /** Enable debug mode */
  debug?: boolean;
  /** Write debug logs to a specific file path */
  debugFile?: string;
  /** Callback for stderr output */
  stderr?: (data: string) => void;
  /** Enforce strict validation of MCP server configurations */
  strictMcpConfig?: boolean;
  /** System prompt configuration */
  systemPrompt?:
    | string
    | {
        type: 'preset';
        preset: 'claude_code';
        append?: string;
      };
  /** Custom function to spawn the Claude process */
  spawnClaudeCodeProcess?: (options: {
    command: string;
    args: string[];
    cwd?: string;
    env: Record<string, string | undefined>;
    signal: AbortSignal;
  }) => unknown;
}

// =============================================================================
// SDK QUERY INTERFACE (the return type of query())
// =============================================================================

/**
 * Query interface - AsyncGenerator with control methods
 */
export interface Query extends AsyncGenerator<SDKMessage, void> {
  /** Interrupt the current query execution */
  interrupt(): Promise<void>;
  /** Change the permission mode for the current session */
  setPermissionMode(mode: PermissionMode): Promise<void>;
  /** Change the model used for subsequent responses */
  setModel(model?: string): Promise<void>;
  /** Set the maximum number of thinking tokens */
  setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
  /** Merge settings into the flag settings layer */
  applyFlagSettings(settings: Record<string, unknown>): Promise<void>;
  /** Get the full initialization result */
  initializationResult(): Promise<unknown>;
  /** Get the list of available slash commands */
  supportedCommands(): Promise<SlashCommand[]>;
  /** Get the list of available models */
  supportedModels(): Promise<ModelInfo[]>;
  /** Get the list of available subagents */
  supportedAgents(): Promise<AgentInfo[]>;
  /** Get the current status of all configured MCP servers */
  mcpServerStatus(): Promise<McpServerStatus[]>;
  /** Get information about the authenticated account */
  accountInfo(): Promise<AccountInfo>;
  /** Rewind tracked files to their state at a specific user message */
  rewindFiles(
    userMessageId: string,
    options?: { dryRun?: boolean }
  ): Promise<RewindFilesResult>;
  /** Reconnect an MCP server by name */
  reconnectMcpServer(serverName: string): Promise<void>;
  /** Enable or disable an MCP server by name */
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void>;
  /** Dynamically set the MCP servers for this session */
  setMcpServers(
    servers: Record<string, McpServerConfig>
  ): Promise<McpSetServersResult>;
  /** Stream input messages to the query */
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
  /** Stop a running task */
  stopTask(taskId: string): Promise<void>;
  /** Close the query and terminate the underlying process */
  close(): void;
}

/**
 * SDK query function type
 * This is the main entry point for the Claude Agent SDK
 */
export type QueryFunction = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => Query;

// =============================================================================
// FLAT STREAM EVENT UNION - Custom type for UI rendering
// (NOT from SDK - this is our custom type for flattened event processing)
// =============================================================================

/**
 * Flattened stream event types used by the UI layer.
 * These are custom Ptah types, NOT from the SDK.
 */
export type FlatStreamEventType =
  | 'message_start'
  | 'text_delta'
  | 'tool_use_start'
  | 'tool_use_delta'
  | 'tool_result'
  | 'thinking_start'
  | 'thinking_delta'
  | 'message_complete'
  | 'user_message'
  | 'error'
  | 'cost_update';

export interface FlatStreamEventBase {
  type: FlatStreamEventType;
  timestamp: number;
  sessionId?: string;
}

export interface FlatMessageStartEvent extends FlatStreamEventBase {
  type: 'message_start';
  messageId: string;
  model: string;
}

export interface FlatTextDeltaEvent extends FlatStreamEventBase {
  type: 'text_delta';
  text: string;
}

export interface FlatToolUseStartEvent extends FlatStreamEventBase {
  type: 'tool_use_start';
  toolUseId: string;
  toolName: string;
}

export interface FlatToolUseDeltaEvent extends FlatStreamEventBase {
  type: 'tool_use_delta';
  toolUseId: string;
  partialJson: string;
}

export interface FlatToolResultEvent extends FlatStreamEventBase {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError: boolean;
}

export interface FlatThinkingStartEvent extends FlatStreamEventBase {
  type: 'thinking_start';
}

export interface FlatThinkingDeltaEvent extends FlatStreamEventBase {
  type: 'thinking_delta';
  thinking: string;
}

export interface FlatMessageCompleteEvent extends FlatStreamEventBase {
  type: 'message_complete';
  stopReason?: string;
}

export interface FlatUserMessageEvent extends FlatStreamEventBase {
  type: 'user_message';
  content: string;
  isSynthetic?: boolean;
}

export interface FlatErrorEvent extends FlatStreamEventBase {
  type: 'error';
  error: string;
  errorType?: SDKAssistantMessageError;
}

export interface FlatCostUpdateEvent extends FlatStreamEventBase {
  type: 'cost_update';
  totalCostUsd: number;
  usage?: NonNullableUsage;
  modelUsage?: Record<string, ModelUsage>;
}

/**
 * Union of all flat stream events
 */
export type FlatStreamEventUnion =
  | FlatMessageStartEvent
  | FlatTextDeltaEvent
  | FlatToolUseStartEvent
  | FlatToolUseDeltaEvent
  | FlatToolResultEvent
  | FlatThinkingStartEvent
  | FlatThinkingDeltaEvent
  | FlatMessageCompleteEvent
  | FlatUserMessageEvent
  | FlatErrorEvent
  | FlatCostUpdateEvent;
