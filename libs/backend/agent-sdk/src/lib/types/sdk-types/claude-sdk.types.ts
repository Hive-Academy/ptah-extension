/**
 * Claude Agent SDK Type Definitions
 *
 * Copied from @anthropic-ai/claude-agent-sdk@0.1.69 to avoid ESM/CommonJS conflicts.
 * These are TYPE-ONLY definitions - no runtime code, not included in production bundle.
 *
 * Source: node_modules/@anthropic-ai/claude-agent-sdk/entrypoints/agentSdkTypes.d.ts
 * Last Updated: 2025-12-18
 * SDK Version: 0.1.69
 *
 * MAINTENANCE: Update this file when upgrading the SDK version.
 * Run: diff node_modules/@anthropic-ai/claude-agent-sdk/entrypoints/agentSdkTypes.d.ts libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts
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
}

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
  | 'dontAsk';

/**
 * API key source
 */
export type ApiKeySource = 'user' | 'project' | 'org' | 'temporary';

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
  isSynthetic?: boolean;
  tool_use_result?: unknown;
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
  | 'unknown';

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
  is_error: false;
  num_turns: number;
  result: string;
  total_cost_usd: number;
  usage: NonNullableUsage;
  modelUsage: Record<string, ModelUsage>;
  permission_denials: SDKPermissionDenial[];
  structured_output?: unknown;
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
  is_error: true;
  num_turns: number;
  total_cost_usd: number;
  usage: NonNullableUsage;
  modelUsage: Record<string, ModelUsage>;
  permission_denials: SDKPermissionDenial[];
  errors: string[];
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
  };
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Status Message
 */
export interface SDKStatusMessage {
  type: 'system';
  subtype: 'status';
  status: 'compacting' | null;
  uuid: UUID;
  session_id: string;
}

/**
 * SDK Hook Response Message
 */
export interface SDKHookResponseMessage {
  type: 'system';
  subtype: 'hook_response';
  hook_name: string;
  hook_event: string;
  stdout: string;
  stderr: string;
  exit_code?: number;
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
  | SDKHookResponseMessage
  | SDKToolProgressMessage
  | SDKAuthStatusMessage;

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
      updatedInput: Record<string, unknown>;
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
 *
 * Source: @anthropic-ai/claude-agent-sdk/entrypoints/agentSdkTypes.d.ts:145-171
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
     * Unique identifier for this specific tool call within the assistant message.
     * Multiple tool calls in the same assistant message will have different toolUseIDs.
     */
    toolUseID: string;
    /** If running within the context of a sub-agent, the sub-agent's ID. */
    agentID?: string;
  }
) => Promise<PermissionResult>;
