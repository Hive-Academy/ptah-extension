/**
 * ExecutionNode Types — Recursive data structure for nested UI rendering.
 *
 * This is the core innovation of Ptah: a recursive tree structure that maps 1:1
 * to Claude CLI JSONL message types, enabling visual representation of nested
 * agent orchestration.
 *
 * Extracted from execution-node.types.ts (TASK_2025_291 Wave C2) — zero behavior change.
 */

// ============================================================================
// EXECUTION NODE TYPES
// ============================================================================

/**
 * ExecutionNodeType - Discriminated union for node classification
 *
 * Maps directly to Claude CLI JSONL message types:
 * - system → system node
 * - assistant → message node (with children for content blocks)
 * - tool → tool node (with optional nested agent)
 * - thinking → thinking node (extended thinking block)
 * - text → text node (plain markdown content)
 * - agent → agent node (Task tool spawned agent, RECURSIVE!)
 */
export type ExecutionNodeType =
  | 'message' // User or assistant message container
  | 'agent' // Task tool spawned agent (contains nested children)
  | 'tool' // Tool execution (Read, Write, Bash, etc.)
  | 'thinking' // Extended thinking block
  | 'text' // Plain text/markdown content
  | 'system'; // System messages (init, result)

/**
 * ExecutionStatus - Current state of execution
 */
export type ExecutionStatus =
  | 'pending' // Waiting to execute
  | 'streaming' // Currently receiving content
  | 'complete' // Successfully finished
  | 'interrupted' // User aborted/stopped (TASK_2025_098)
  | 'resumed' // Previously interrupted, now resumed in a new agent (TASK_2025_211)
  | 'error'; // Failed with error

/**
 * MessageRole - Role of the message sender
 */
export type MessageRole = 'user' | 'assistant' | 'system';

// ============================================================================
// TOKEN USAGE TYPE (Aligned with Claude SDK Cost Tracking)
// ============================================================================

/**
 * MessageTokenUsage - Token consumption data aligned with Claude SDK
 *
 * Named "MessageTokenUsage" to distinguish from TokenUsage in common.types
 * which represents context window usage (used/max).
 *
 * @see https://platform.claude.com/docs/en/agent-sdk/cost-tracking
 *
 * Cache tokens are significant for cost optimization:
 * - cacheRead: Tokens read from cache (cheaper than input)
 * - cacheCreation: Tokens used to create cache entries
 */
export interface MessageTokenUsage {
  /** Base input tokens processed */
  readonly input: number;
  /** Tokens generated in the response */
  readonly output: number;
  /** Tokens read from cache (reduces input cost) */
  readonly cacheRead?: number;
  /** Tokens used to create cache entries */
  readonly cacheCreation?: number;
}

// ============================================================================
// EXECUTION NODE INTERFACE
// ============================================================================

/**
 * ExecutionNode - The core recursive data structure
 *
 * This interface enables true nested UI rendering where agents display
 * INSIDE parent messages, exactly like the CLI terminal output but with
 * rich interactive components.
 *
 * Key feature: `children` array enables infinite nesting depth.
 *
 * **IMPORTANT - USAGE CONTEXT** (TASK_2025_082):
 * - ExecutionNode represents **FINALIZED** message trees (after streaming completes)
 * - During streaming, use `FlatStreamEventUnion` instead (no nested children)
 * - Frontend builds ExecutionNode trees **at render time** from flat event map
 * - This prevents state corruption from interleaved sub-agent streams
 * - ExecutionNode is for **storage, rendering, and historical messages** only
 */
export interface ExecutionNode {
  /** Unique identifier for this node */
  readonly id: string;
  /** Node type for discriminated rendering */
  readonly type: ExecutionNodeType;
  /** Current execution status */
  readonly status: ExecutionStatus;
  // ---- Content (varies by type) ----
  /** Main content (markdown for text/thinking, description for agent) */
  readonly content: string | null;
  /** Error message if status is 'error' */
  readonly error?: string;
  // ---- Tool-specific fields ----
  /** Tool name (e.g., 'Read', 'Write', 'Bash', 'Task') */
  readonly toolName?: string;
  /** Tool input parameters */
  readonly toolInput?: Record<string, unknown>;
  /** Tool execution output/result */
  readonly toolOutput?: unknown;
  /** Tool call ID (for linking tool_use to tool_result) */
  readonly toolCallId?: string;
  /**
   * Parent tool use ID - links sub-agent messages to their parent agent
   * Used to nest execution trees: Parent Message → Agent Tool → Sub-agent Message
   */
  readonly parentToolUseId?: string;
  /**
   * Whether this tool execution is awaiting permission.
   * Set when tool_result has is_error: true AND error message contains "permission".
   * Used to show special permission request UI instead of generic error.
   */
  readonly isPermissionRequest?: boolean;
  // ---- Agent-specific fields (type: 'agent') ----
  /** Agent subtype from Task tool args.subagent_type */
  readonly agentType?: string;
  /** Model used by agent (opus, sonnet, haiku) */
  readonly agentModel?: string;
  /** Short description from Task tool args.description */
  readonly agentDescription?: string;
  /** Full prompt sent to agent */
  readonly agentPrompt?: string;
  /**
   * Short agent identifier (e.g., "adcecb2") from SDK SubagentStart hook.
   * Used as a stable key for summary content lookup since toolCallId differs
   * between hook (UUID format) and complete message (toolu_* format).
   * @see TASK_2025_099 - Real-time subagent streaming
   */
  readonly agentId?: string;
  /**
   * Summary content for agent nodes - Real-time text updates from agent session.
   * This is populated during streaming by the AgentSessionWatcherService,
   * which tails the agent's JSONL file for text blocks.
   */
  readonly summaryContent?: string;
  // ---- Metrics ----
  /** Execution start timestamp (Unix epoch ms) */
  readonly startTime?: number;
  /** Execution end timestamp (Unix epoch ms) */
  readonly endTime?: number;
  /** Duration in milliseconds */
  readonly duration?: number;
  /** Token usage for this node (aligned with Claude SDK) */
  readonly tokenUsage?: MessageTokenUsage;
  /** Cost in USD calculated from token usage */
  readonly cost?: number;
  /** Model ID used for this execution (e.g., 'claude-opus-4-5-20251101') */
  readonly model?: string;
  /** Tool execution count (for agents) */
  readonly toolCount?: number;
  // ---- Recursive children ----
  /**
   * Child nodes - THE KEY TO NESTED RENDERING
   *
   * For message nodes: contains text, thinking, tool nodes
   * For agent nodes: contains all tool executions within that agent
   * For tool nodes: may contain nested result details
   */
  readonly children: readonly ExecutionNode[];
  // ---- UI State ----
  /** Whether this node is collapsed in the UI */
  readonly isCollapsed: boolean;
  /** Whether this node is highlighted (e.g., during search) */
  readonly isHighlighted?: boolean;
  /** Whether this is a background agent (continues executing independently of main turn) */
  readonly isBackground?: boolean;
}

// ============================================================================
// SESSION SUMMARY
// ============================================================================

/**
 * SessionSummary - Lightweight session metadata for session list UI
 */
export interface ChatSessionSummary {
  /** Session identifier */
  readonly id: string;
  /** Session display name */
  readonly name: string;
  /** Number of messages in session */
  readonly messageCount: number;
  /** Creation timestamp */
  readonly createdAt: number;
  /** Last activity timestamp */
  readonly lastActivityAt: number;
  /** Token usage totals (aligned with Claude SDK) */
  readonly tokenUsage?: MessageTokenUsage;
  /** Whether this session is currently active */
  readonly isActive: boolean;
}

// ============================================================================
// JSONL MESSAGE MAPPING
// ============================================================================

/**
 * JSONLMessageType - Claude CLI JSONL message types
 *
 * These are the raw message types from `claude --output-format stream-json`
 */
export type JSONLMessageType =
  | 'system' // System initialization, config
  | 'assistant' // Assistant response content
  | 'user' // User message (in history)
  | 'tool' // Tool execution (start/result)
  | 'result'; // Final result summary

/**
 * JSONLMessage - Raw message from Claude CLI JSONL stream
 *
 * This is the shape of messages received from:
 * `claude --output-format stream-json --verbose`
 */
export interface JSONLMessage {
  /** Message type discriminator */
  readonly type: JSONLMessageType;
  /** Subtype for further discrimination (e.g., 'init', 'start', 'result') */
  readonly subtype?: string;
  // ---- System message fields ----
  readonly session_id?: string;
  readonly cwd?: string;
  readonly model?: string;
  // ---- Assistant message fields ----
  readonly thinking?: string;
  readonly delta?: string; // Streaming text delta
  readonly message?: {
    readonly content?: readonly ContentBlockJSON[];
    readonly stop_reason?: string;
    readonly usage?: {
      readonly input_tokens?: number;
      readonly output_tokens?: number;
    };
    readonly model?: string;
  };
  // ---- Tool message fields ----
  readonly tool?: string; // Tool name
  readonly tool_use_id?: string; // Links tool_use to tool_result
  readonly parent_tool_use_id?: string; // For nested agent tools
  readonly args?: Record<string, unknown>;
  readonly output?: unknown;
  readonly error?: string;
  // ---- Result message fields ----
  readonly cost?: number;
  readonly duration?: number;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
  // ---- Metadata ----
  readonly timestamp?: string;
  readonly isMeta?: boolean;
  readonly uuid?: string;
  readonly sessionId?: string;
}

/**
 * ContentBlockJSON - Raw content block from Claude CLI
 */
export interface ContentBlockJSON {
  readonly type: 'text' | 'tool_use' | 'tool_result';
  // text block
  readonly text?: string;
  // tool_use block
  readonly id?: string;
  readonly name?: string;
  readonly input?: Record<string, unknown>;
  // tool_result block
  readonly tool_use_id?: string;
  readonly content?: string | unknown;
  readonly is_error?: boolean;
}
