/**
 * Flat streaming event types — foreground events.
 *
 * Replaces ExecutionNode during streaming. Events contain relationship IDs
 * instead of nested children.
 *
 * Extracted from execution-node.types.ts — zero behavior change.
 */

/**
 * EventSource - Indicates the origin of a streaming event.
 *
 * Used to distinguish streaming preview events from definitive complete
 * message events for proper deduplication.
 *
 * - 'stream': Real-time streaming delta from SDK stream_event
 * - 'complete': Definitive data from complete assistant/user messages
 * - 'history': Event reconstructed from session JSONL history
 * - 'hook': Event from file system hook (agent watcher), arrives before SDK events
 *
 * Priority: history > complete > stream > hook (higher priority overwrites lower)
 */
export type EventSource = 'stream' | 'complete' | 'history' | 'hook';

/**
 * Flat streaming event types - replaces ExecutionNode during streaming
 * Events contain relationship IDs instead of nested children
 *
 * Architecture: Backend emits these flat events during streaming,
 * frontend stores them in a Map, builds ExecutionNode tree at render time.
 *
 * This eliminates state corruption from interleaved sub-agent streams.
 */
export type StreamEventType =
  | 'message_start'
  | 'text_delta'
  | 'thinking_start'
  | 'thinking_delta'
  | 'tool_start'
  | 'tool_delta'
  | 'tool_result'
  | 'agent_start'
  | 'message_complete'
  | 'message_delta'
  | 'signature_delta'
  | 'compaction_start'
  | 'compaction_complete'
  | 'background_agent_started'
  | 'background_agent_progress'
  | 'background_agent_completed'
  | 'background_agent_stopped'
  // SDK task_* event surface (subagent visibility)
  | 'agent_progress'
  | 'agent_status'
  | 'agent_completed';

/**
 * Base flat event with common fields
 * All streaming events inherit from this base interface
 */
export interface FlatStreamEvent {
  /** Unique event ID */
  readonly id: string;
  /** Discriminated union type for TypeScript narrowing */
  readonly eventType: StreamEventType;
  /** Event timestamp (Unix epoch ms) */
  readonly timestamp: number;
  /** Session ID this event belongs to */
  readonly sessionId: string;
  /**
   * Event source for deduplication and priority handling.
   * - 'stream': Real-time streaming delta (may be incomplete)
   * - 'complete': Definitive data from complete messages
   * - 'history': Reconstructed from session JSONL history
   */
  readonly source?: EventSource;
  // ---- Relationship IDs for tree building ----
  /** Root message this event belongs to */
  readonly messageId: string;
  /** For nesting under tools (agents, sub-tools) */
  readonly parentToolUseId?: string;
  /** For tool-related events */
  readonly toolCallId?: string;
  /** For multiple text blocks in same message (edge case) */
  readonly blockIndex?: number;
}

/**
 * Message start event - creates message node
 */
export interface MessageStartEvent extends FlatStreamEvent {
  readonly eventType: 'message_start';
  readonly role: 'user' | 'assistant';
  readonly parentToolUseId?: string; // For sub-agent messages
  /** Number of inline images in this user message (set during history replay) */
  readonly imageCount?: number;
}

/**
 * Text delta event - accumulates text content
 */
export interface TextDeltaEvent extends FlatStreamEvent {
  readonly eventType: 'text_delta';
  readonly delta: string; // Text chunk to append
  readonly blockIndex: number; // Which text block (0, 1, 2...) - handles multiple text blocks
}

/**
 * Thinking block start event
 */
export interface ThinkingStartEvent extends FlatStreamEvent {
  readonly eventType: 'thinking_start';
  readonly blockIndex: number;
}

/**
 * Thinking block delta event
 */
export interface ThinkingDeltaEvent extends FlatStreamEvent {
  readonly eventType: 'thinking_delta';
  readonly delta: string;
  readonly blockIndex: number;
  readonly signature?: string; // Thinking verification signature
}

/**
 * Tool execution start event
 */
export interface ToolStartEvent extends FlatStreamEvent {
  readonly eventType: 'tool_start';
  readonly toolCallId: string; // SDK tool use ID
  readonly toolName: string;
  readonly toolInput?: Record<string, unknown>; // May be streaming JSON
  readonly isTaskTool: boolean; // true if Task tool (agent spawn)
  // Agent-specific fields (only if isTaskTool = true)
  readonly agentType?: string;
  readonly agentDescription?: string;
  readonly agentPrompt?: string;
}

/**
 * Tool input delta event (for streaming JSON input)
 */
export interface ToolDeltaEvent extends FlatStreamEvent {
  readonly eventType: 'tool_delta';
  readonly toolCallId: string;
  readonly delta: string; // Partial JSON for toolInput
}

/**
 * Tool result event
 */
export interface ToolResultEvent extends FlatStreamEvent {
  readonly eventType: 'tool_result';
  readonly toolCallId: string;
  readonly output: unknown;
  readonly isError: boolean;
  readonly isPermissionRequest?: boolean;
}

/**
 * Agent spawn event (when Task tool starts)
 */
export interface AgentStartEvent extends FlatStreamEvent {
  readonly eventType: 'agent_start';
  readonly toolCallId: string; // Links to parent Task tool
  readonly agentType: string;
  readonly agentDescription?: string;
  readonly agentPrompt?: string;
  /**
   * Short agent identifier (e.g., "adcecb2") from SDK SubagentStart hook.
   * Used as a stable key for summary content lookup since toolCallId differs
   * between hook (UUID format) and complete message (toolu_* format).
   */
  readonly agentId?: string;
  /**
   * SDK task_id from SDKTaskStartedMessage. Populated when the SDK emits
   * task_started for this agent. Used by the dispatcher to route
   * subagent:stop calls.
   */
  readonly taskId?: string;
}

/**
 * Message completion event - updates message node with final metadata
 */
export interface MessageCompleteEvent extends FlatStreamEvent {
  readonly eventType: 'message_complete';
  readonly stopReason?: string;
  readonly tokenUsage?: { input: number; output: number };
  readonly cost?: number;
  readonly duration?: number;
  readonly model?: string;
}

/**
 * Message delta event - updates cumulative token usage during streaming
 */
export interface MessageDeltaEvent extends FlatStreamEvent {
  readonly eventType: 'message_delta';
  readonly tokenUsage: { input: number; output: number };
}

/**
 * Signature delta event - validates extended thinking blocks
 *
 * Emitted by the SDK for extended thinking scenarios.
 * Contains cryptographic signature for thinking block verification.
 */
export interface SignatureDeltaEvent extends FlatStreamEvent {
  readonly eventType: 'signature_delta';
  readonly blockIndex: number;
  readonly signature: string; // Cryptographic signature for thinking verification
}

/**
 * Compaction start event - notifies UI that context compaction is starting.
 *
 * Emitted when the SDK detects the context window is approaching threshold
 * and begins automatic compaction (summarizing conversation history).
 * Used to display a notification banner in the chat UI.
 */
export interface CompactionStartEvent extends FlatStreamEvent {
  readonly eventType: 'compaction_start';
  /** Whether compaction was triggered manually or automatically */
  readonly trigger: 'manual' | 'auto';
  /**
   * Cumulative pre-compaction token usage (input + output + cache_read +
   * cache_creation) sampled at PreCompact firing time. Used by the frontend
   * to freeze the pre-compaction header stats during the compaction window
   * and to pair this event with the eventual `compact_boundary` for
   * duration / delta computation.
   */
  readonly preTokens: number;
}

/**
 * Compaction complete event - notifies UI that context compaction has finished
 * Emitted when the SDK sends a compact_boundary system message after compaction.
 * Used to dismiss the compaction banner, reset the execution tree, and clear
 * deduplication state across the compaction boundary.
 */
export interface CompactionCompleteEvent extends FlatStreamEvent {
  readonly eventType: 'compaction_complete';
  /** Whether compaction was triggered manually or automatically */
  readonly trigger: 'manual' | 'auto';
  /** Token count before compaction (from SDK compact_metadata) */
  readonly preTokens?: number;
}
