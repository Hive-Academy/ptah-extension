/**
 * ExecutionNode Types — Recursive data structure for nested UI rendering.
 *
 * This is the core innovation of Ptah: a recursive tree structure that maps 1:1
 * to Claude CLI JSONL message types, enabling visual representation of nested
 * agent orchestration.
 */

import type { SessionId } from '../branded.types';

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
  | 'interrupted' // User aborted/stopped
  | 'resumed' // Previously interrupted, now resumed in a new agent
  | 'error'; // Failed with error

/**
 * MessageRole - Role of the message sender
 */
export type MessageRole = 'user' | 'assistant' | 'system';

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

/**
 * Payloads a retention pass is allowed to bound on an ExecutionNode.
 *
 * `content` is deliberately absent: for `text` and `thinking` nodes it is the
 * assistant's prose, which is the thing the transcript exists to show.
 */
export type NodeRetentionField = 'toolInput' | 'toolOutput';

/**
 * NodeRetentionNotice - "this node's tool payload was bounded, and here is what
 * went".
 *
 * **Written by** `capFinalizedTree` in
 * `libs/frontend/chat-streaming/src/lib/execution-tree-retention.ts`.
 * **Read by** `ToolInputDisplayComponent` and `ToolOutputDisplayComponent` in
 * `libs/frontend/chat-ui/src/lib/molecules/tool-execution/`.
 *
 * It exists as a typed field rather than an in-band string marker (the shape
 * `agent-output-retention.ts` is forced into for a flat `string`) so that two
 * properties come for free: the marker cannot be eaten by a later trim, and
 * re-applying the pass accumulates counts by READING A NUMBER instead of
 * re-parsing its own prose. An in-band marker is written into the payload as
 * well, so a user who copies the tool output out of the transcript takes the
 * fact with them.
 *
 * Optional, and absent on every node written before this field existed — a
 * restored `localStorage` tab or a `chat:resume` replay reads `undefined` and
 * renders exactly as it always did.
 */
export interface NodeRetentionNotice {
  /**
   * Total characters dropped from this node, CUMULATIVE over every application
   * of the pass. Never derived by re-parsing an in-band marker.
   */
  readonly droppedChars: number;
  /**
   * Which payloads were bounded. Emitted in the fixed order
   * `['toolInput', 'toolOutput']` so the field is deterministic.
   */
  readonly capped: readonly NodeRetentionField[];
  /**
   * True when the payload could not be turned into text at all (a cycle, a
   * `BigInt`, a throwing getter) and nothing was preserved. The notice is
   * emitted either way — a cap the user cannot see is indistinguishable from
   * data corruption.
   */
  readonly foldFailed: boolean;
  /** Why the fold failed, when it did. Absent on a successful fold. */
  readonly reason?: string;
}

/**
 * ExecutionNode - The core recursive data structure
 *
 * This interface enables true nested UI rendering where agents display
 * INSIDE parent messages, exactly like the CLI terminal output but with
 * rich interactive components.
 *
 * Key feature: `children` array enables infinite nesting depth.
 *
 * **IMPORTANT - USAGE CONTEXT**:
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
  /** Main content (markdown for text/thinking, description for agent) */
  readonly content: string | null;
  /** Error message if status is 'error' */
  readonly error?: string;
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
   */
  readonly agentId?: string;
  /**
   * Summary content for agent nodes - Real-time text updates from agent session.
   * This is populated during streaming by the AgentSessionWatcherService,
   * which tails the agent's JSONL file for text blocks.
   */
  readonly summaryContent?: string;
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
  /**
   * Child nodes - THE KEY TO NESTED RENDERING
   *
   * For message nodes: contains text, thinking, tool nodes
   * For agent nodes: contains all tool executions within that agent
   * For tool nodes: may contain nested result details
   */
  readonly children: readonly ExecutionNode[];
  /** Whether this node is collapsed in the UI */
  readonly isCollapsed: boolean;
  /** Whether this node is highlighted (e.g., during search) */
  readonly isHighlighted?: boolean;
  /** Whether this is a background agent (continues executing independently of main turn) */
  readonly isBackground?: boolean;
  /**
   * Present only when this node's `toolInput` / `toolOutput` were bounded by
   * the finalized-tree retention pass. See {@link NodeRetentionNotice} for who
   * writes it and who reads it.
   */
  readonly retention?: NodeRetentionNotice;
}

/**
 * SessionSummary - Lightweight session metadata for session list UI
 */
export interface ChatSessionSummary {
  /** Session identifier */
  readonly id: SessionId;
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
  /**
   * Whether the SDK transcript (`~/.claude/projects/<workspace>/<id>.jsonl`)
   * still exists on disk.
   *
   * Session metadata is stored by Ptah and never pruned, but the Claude CLI
   * deletes transcripts older than `cleanupPeriodDays` (default 30). A row
   * with `false` therefore opens with no history — the UI dims it and labels
   * it rather than presenting it as a normal, loadable session.
   *
   * `undefined` means "not determined" (e.g. the projects directory could not
   * be resolved). Consumers must treat only an explicit `false` as expired.
   */
  readonly hasTranscript?: boolean;
}

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
  readonly session_id?: string;
  readonly cwd?: string;
  readonly model?: string;
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
  readonly tool?: string; // Tool name
  readonly tool_use_id?: string; // Links tool_use to tool_result
  readonly parent_tool_use_id?: string; // For nested agent tools
  readonly args?: Record<string, unknown>;
  readonly output?: unknown;
  readonly error?: string;
  readonly cost?: number;
  readonly duration?: number;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
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
  readonly text?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: Record<string, unknown>;
  readonly tool_use_id?: string;
  readonly content?: string | unknown;
  readonly is_error?: boolean;
}
