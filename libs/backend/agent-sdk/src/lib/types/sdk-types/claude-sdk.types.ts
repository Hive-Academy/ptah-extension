/**
 * Claude Agent SDK Type Definitions
 *
 * SDK types are re-exported from @anthropic-ai/claude-agent-sdk.
 * This file also contains:
 *   - Anthropic API content block types (not exported by the agent SDK)
 *   - Type guards for SDK messages, stream events, and content blocks
 *   - Ptah-specific FlatStreamEvent* types for UI rendering
 */

// =============================================================================
// RE-EXPORT SDK TYPES
// All SDK types are imported and re-exported so consumers have a single import.
// =============================================================================

export type {
  AccountInfo,
  AgentDefinition,
  AgentInfo,
  AgentMcpServerSpec,
  ApiKeySource,
  AsyncHookJSONOutput,
  BaseHookInput,
  CanUseTool,
  ConfigChangeHookInput,
  ConfigScope,
  EffortLevel,
  ElicitationHookInput,
  ElicitationHookSpecificOutput,
  ElicitationRequest,
  ElicitationResultHookInput,
  ElicitationResultHookSpecificOutput,
  ExitReason,
  FastModeState,
  ForkSessionOptions,
  ForkSessionResult,
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
  InstructionsLoadedHookInput,
  JsonSchemaOutputFormat,
  McpClaudeAIProxyServerConfig,
  McpHttpServerConfig,
  McpSdkServerConfig,
  McpServerConfig,
  McpServerConfigForProcessTransport,
  McpServerStatus,
  McpServerStatusConfig,
  McpSetServersResult,
  McpSSEServerConfig,
  McpStdioServerConfig,
  ModelInfo,
  ModelUsage,
  NonNullableUsage,
  NotificationHookInput,
  NotificationHookSpecificOutput,
  OnElicitation,
  Options,
  OutputFormat,
  OutputFormatType,
  PermissionBehavior,
  PermissionMode,
  PermissionRequestHookInput,
  PermissionRequestHookSpecificOutput,
  PermissionResult,
  PermissionRuleValue,
  PermissionUpdate,
  PermissionUpdateDestination,
  PostCompactHookInput,
  PostToolUseFailureHookInput,
  PostToolUseFailureHookSpecificOutput,
  PostToolUseHookInput,
  PostToolUseHookSpecificOutput,
  PreCompactHookInput,
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
  Query,
  RewindFilesResult,
  SDKAPIRetryMessage,
  SDKAssistantMessage,
  SDKAssistantMessageError,
  SDKAuthStatusMessage,
  SDKCompactBoundaryMessage,
  SDKElicitationCompleteMessage,
  SDKFilesPersistedEvent,
  SDKHookProgressMessage,
  SDKHookResponseMessage,
  SDKHookStartedMessage,
  SDKLocalCommandOutputMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKPermissionDenial,
  SDKPromptSuggestionMessage,
  SDKRateLimitEvent,
  SDKRateLimitInfo,
  SDKResultMessage,
  SDKSessionInfo,
  SDKStatus,
  SDKStatusMessage,
  SDKSystemMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
  SDKToolProgressMessage,
  SDKToolUseSummaryMessage,
  SDKUserMessage,
  SDKUserMessageReplay,
  SdkBeta,
  SdkPluginConfig,
  SessionEndHookInput,
  SessionStartHookInput,
  SessionStartHookSpecificOutput,
  SettingSource,
  SetupHookInput,
  SetupHookSpecificOutput,
  SlashCommand,
  StopFailureHookInput,
  StopHookInput,
  SubagentStartHookInput,
  SubagentStartHookSpecificOutput,
  SubagentStopHookInput,
  SyncHookJSONOutput,
  TaskCompletedHookInput,
  TeammateIdleHookInput,
  ThinkingAdaptive,
  ThinkingConfig,
  ThinkingDisabled,
  ThinkingEnabled,
  ToolConfig,
  UserPromptSubmitHookInput,
  UserPromptSubmitHookSpecificOutput,
  WorktreeCreateHookInput,
  WorktreeRemoveHookInput,
} from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };

// Re-export the canonical SDK result type names.
// The legacy aliases SDKResultMessageSuccess / SDKResultMessageError have been
// removed — all consumers must use SDKResultSuccess / SDKResultError.
export type {
  SDKResultSuccess,
  SDKResultError,
} from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };

// Internal imports for type guard parameter types
import type {
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKResultSuccess,
  SDKResultError,
  SDKSystemMessage,
  SDKCompactBoundaryMessage,
  SDKLocalCommandOutputMessage,
  SDKUserMessage,
  SDKUserMessageReplay,
  SDKAssistantMessage,
  SDKAssistantMessageError,
  SDKToolProgressMessage,
  SDKToolUseSummaryMessage,
  SDKRateLimitEvent,
  SDKPromptSuggestionMessage,
  SDKAPIRetryMessage,
  SDKTaskStartedMessage,
  SDKTaskProgressMessage,
  SDKTaskUpdatedMessage,
  SDKTaskNotificationMessage,
  HookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  PreToolUseHookInput,
  PostToolUseHookInput,
  SessionStartHookInput,
  SessionEndHookInput,
  SetupHookInput,
  WorktreeCreateHookInput,
  WorktreeRemoveHookInput,
  NonNullableUsage,
  ModelUsage,
  Options,
  Query,
} from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };

// =============================================================================
// CONVENIENCE ALIASES
// =============================================================================

export type UUID = `${string}-${string}-${string}-${string}-${string}`;

/** Type alias for the SDK's query() function signature */
export type QueryFunction = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => Query;

// =============================================================================
// ANTHROPIC API CONTENT BLOCK TYPES
// The agent SDK uses BetaContentBlock from @anthropic-ai/sdk internally,
// but we define simplified versions that match the subset we actually handle.
// =============================================================================

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<TextBlock | { type: 'image'; source: unknown }>;
  is_error?: boolean;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock;

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

export interface APIUserMessage {
  role: 'user';
  content: UserMessageContent;
}

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
// USAGE & STREAM EVENT TYPES (from @anthropic-ai/sdk, simplified)
// =============================================================================

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

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
    stop_reason:
      | 'end_turn'
      | 'max_tokens'
      | 'stop_sequence'
      | 'tool_use'
      | null;
    stop_sequence: string | null;
  };
  usage: { output_tokens: number };
}

export interface MessageStopEvent {
  type: 'message_stop';
}

export type RawMessageStreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent;

// =============================================================================
// SDK MESSAGE TYPE GUARDS
// =============================================================================

export function isStreamEvent(
  msg: SDKMessage,
): msg is SDKPartialAssistantMessage {
  return msg.type === 'stream_event';
}

export function isResultMessage(msg: SDKMessage): msg is SDKResultMessage {
  return msg.type === 'result';
}

export function isSuccessResult(msg: SDKMessage): msg is SDKResultSuccess {
  return msg.type === 'result' && msg.subtype === 'success';
}

export function isErrorResult(msg: SDKMessage): msg is SDKResultError {
  return msg.type === 'result' && msg.subtype !== 'success';
}

export function isSystemInit(msg: SDKMessage): msg is SDKSystemMessage {
  return msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init';
}

export function isCompactBoundary(
  msg: SDKMessage,
): msg is SDKCompactBoundaryMessage {
  return (
    msg.type === 'system' &&
    'subtype' in msg &&
    msg.subtype === 'compact_boundary'
  );
}

export function isLocalCommandOutput(
  msg: SDKMessage,
): msg is SDKLocalCommandOutputMessage {
  return (
    msg.type === 'system' &&
    'subtype' in msg &&
    msg.subtype === 'local_command_output'
  );
}

export function isUserMessage(msg: SDKMessage): msg is SDKUserMessage {
  return msg.type === 'user' && !('isReplay' in msg && msg.isReplay);
}

export function isReplayMessage(msg: SDKMessage): msg is SDKUserMessageReplay {
  return msg.type === 'user' && 'isReplay' in msg && msg.isReplay === true;
}

export function isAssistantMessage(
  msg: SDKMessage,
): msg is SDKAssistantMessage {
  return msg.type === 'assistant';
}

export function isToolProgress(msg: SDKMessage): msg is SDKToolProgressMessage {
  return msg.type === 'tool_progress';
}

export function isToolUseSummary(
  msg: SDKMessage,
): msg is SDKToolUseSummaryMessage {
  return msg.type === 'tool_use_summary';
}

export function isRateLimitEvent(msg: SDKMessage): msg is SDKRateLimitEvent {
  return msg.type === 'rate_limit_event';
}

export function isPromptSuggestion(
  msg: SDKMessage,
): msg is SDKPromptSuggestionMessage {
  return msg.type === 'prompt_suggestion';
}

export function isAPIRetryMessage(msg: SDKMessage): msg is SDKAPIRetryMessage {
  return (
    msg.type === 'system' && 'subtype' in msg && msg.subtype === 'api_retry'
  );
}

export function isTaskStarted(msg: SDKMessage): msg is SDKTaskStartedMessage {
  return (
    msg.type === 'system' && 'subtype' in msg && msg.subtype === 'task_started'
  );
}

export function isTaskProgress(msg: SDKMessage): msg is SDKTaskProgressMessage {
  return (
    msg.type === 'system' && 'subtype' in msg && msg.subtype === 'task_progress'
  );
}

export function isTaskUpdated(msg: SDKMessage): msg is SDKTaskUpdatedMessage {
  return (
    msg.type === 'system' && 'subtype' in msg && msg.subtype === 'task_updated'
  );
}

export function isTaskNotification(
  msg: SDKMessage,
): msg is SDKTaskNotificationMessage {
  return (
    msg.type === 'system' &&
    'subtype' in msg &&
    msg.subtype === 'task_notification'
  );
}

// =============================================================================
// STREAM EVENT TYPE GUARDS
// =============================================================================

export function isMessageStart(
  event: RawMessageStreamEvent | { type: string },
): event is MessageStartEvent {
  return event.type === 'message_start';
}

export function isContentBlockStart(
  event: RawMessageStreamEvent | { type: string },
): event is ContentBlockStartEvent {
  return event.type === 'content_block_start';
}

export function isContentBlockDelta(
  event: RawMessageStreamEvent | { type: string },
): event is ContentBlockDeltaEvent {
  return event.type === 'content_block_delta';
}

export function isContentBlockStop(
  event: RawMessageStreamEvent | { type: string },
): event is ContentBlockStopEvent {
  return event.type === 'content_block_stop';
}

export function isMessageDelta(
  event: RawMessageStreamEvent | { type: string },
): event is MessageDeltaEvent {
  return event.type === 'message_delta';
}

export function isMessageStop(
  event: RawMessageStreamEvent | { type: string },
): event is MessageStopEvent {
  return event.type === 'message_stop';
}

// =============================================================================
// CONTENT BLOCK TYPE GUARDS
// =============================================================================

export function isTextBlock(
  block: ContentBlock | { type: string },
): block is TextBlock {
  return block.type === 'text';
}

export function isToolUseBlock(
  block: ContentBlock | { type: string },
): block is ToolUseBlock {
  return block.type === 'tool_use';
}

export function isToolResultBlock(
  block: ContentBlock | { type: string },
): block is ToolResultBlock {
  return block.type === 'tool_result';
}

export function isThinkingBlock(
  block: ContentBlock | { type: string },
): block is ThinkingBlock {
  return block.type === 'thinking';
}

// =============================================================================
// DELTA TYPE GUARDS
// =============================================================================

export function isTextDelta(
  delta: Delta | { type: string },
): delta is TextDelta {
  return delta.type === 'text_delta';
}

export function isInputJsonDelta(
  delta: Delta | { type: string },
): delta is InputJsonDelta {
  return delta.type === 'input_json_delta';
}

export function isThinkingDelta(
  delta: Delta | { type: string },
): delta is ThinkingDelta {
  return delta.type === 'thinking_delta';
}

// =============================================================================
// HOOK TYPE GUARDS
// =============================================================================

export function isSubagentStartHook(
  input: HookInput,
): input is SubagentStartHookInput {
  return input.hook_event_name === 'SubagentStart';
}

export function isSubagentStopHook(
  input: HookInput,
): input is SubagentStopHookInput {
  return input.hook_event_name === 'SubagentStop';
}

export function isPreToolUseHook(
  input: HookInput,
): input is PreToolUseHookInput {
  return input.hook_event_name === 'PreToolUse';
}

export function isPostToolUseHook(
  input: HookInput,
): input is PostToolUseHookInput {
  return input.hook_event_name === 'PostToolUse';
}

export function isSessionStartHook(
  input: HookInput,
): input is SessionStartHookInput {
  return input.hook_event_name === 'SessionStart';
}

export function isSessionEndHook(
  input: HookInput,
): input is SessionEndHookInput {
  return input.hook_event_name === 'SessionEnd';
}

export function isSetupHook(input: HookInput): input is SetupHookInput {
  return input.hook_event_name === 'Setup';
}

export function isWorktreeCreateHook(
  input: HookInput,
): input is WorktreeCreateHookInput {
  return input.hook_event_name === 'WorktreeCreate';
}

export function isWorktreeRemoveHook(
  input: HookInput,
): input is WorktreeRemoveHookInput {
  return input.hook_event_name === 'WorktreeRemove';
}

// =============================================================================
// FLAT STREAM EVENTS (Ptah-specific, NOT from SDK)
// =============================================================================

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
