/**
 * ExecutionNode Types - Recursive data structure for nested UI rendering
 *
 * This is the core innovation of Ptah: a recursive tree structure that maps 1:1
 * to Claude CLI JSONL message types, enabling visual representation of nested
 * agent orchestration - something no other VS Code extension can do.
 *
 * @example
 * ```
 * UserMessage
 * └── AssistantMessage
 *     ├── TextContent: "Let me help you with that"
 *     ├── ThinkingBlock: [collapsible] "Analyzing the codebase..."
 *     └── AgentExecution: [collapsible card]
 *         ├── AgentHeader: "software-architect"
 *         ├── ToolCall: "Read" → [collapsible result]
 *         └── AgentExecution: [nested!]
 *             ├── AgentHeader: "frontend-developer"
 *             └── ToolCall: "Write" → [collapsible result]
 * ```
 */

import { z } from 'zod';

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
  | 'error'; // Failed with error

/**
 * MessageRole - Role of the message sender
 */
export type MessageRole = 'user' | 'assistant' | 'system';

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

  // ---- Metrics ----

  /** Execution start timestamp (Unix epoch ms) */
  readonly startTime?: number;

  /** Execution end timestamp (Unix epoch ms) */
  readonly endTime?: number;

  /** Duration in milliseconds */
  readonly duration?: number;

  /** Token usage for this node */
  readonly tokenUsage?: {
    readonly input: number;
    readonly output: number;
  };

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
}

// ============================================================================
// EXECUTION CHAT MESSAGE WRAPPER
// ============================================================================

/**
 * AgentInfo - Metadata for agent-specific chat bubbles
 *
 * When a message is an agent bubble (extracted from parent assistant message),
 * this contains the agent's identifying information for custom styling.
 *
 * Agent bubbles have two sections:
 * 1. Summary Section - Real-time progress updates (XML-like format)
 * 2. Execution Section - Actual tool calls and detailed results
 *
 * During streaming, either section may be missing. The UI should gracefully
 * handle partial data and show appropriate loading states.
 */
export interface AgentInfo {
  /** Agent subtype (e.g., 'Explore', 'Plan', 'software-architect') */
  readonly agentType: string;

  /** Short description of the agent task */
  readonly agentDescription?: string;

  /** Model used by agent (opus, sonnet, haiku) */
  readonly agentModel?: string;

  /**
   * Summary content - The XML-like progress updates from the summary session.
   * Contains <function_calls>, <thinking>, etc. tags that show real-time progress.
   * May be undefined during streaming or if no summary session exists.
   */
  readonly summaryContent?: string;

  /**
   * Indicates if we expect a summary section (for streaming state).
   * When true but summaryContent is undefined, show a loading placeholder.
   */
  readonly hasSummary?: boolean;

  /**
   * Indicates if we have execution data (tool calls, results).
   * When true but executionTree is empty, show a loading placeholder.
   */
  readonly hasExecution?: boolean;

  /**
   * Indicates if this agent was interrupted (session closed mid-execution).
   * When true, show "interrupted" state instead of "in progress" loading spinner.
   * This happens when loading historical sessions that were not completed.
   */
  readonly isInterrupted?: boolean;
}

/**
 * ExecutionChatMessage - Top-level message wrapper for the ExecutionNode-based chat UI
 *
 * Each ExecutionChatMessage contains either:
 * - rawContent (for user messages): Plain text input
 * - executionTree (for assistant messages): Root ExecutionNode with nested children
 *
 * Note: Named "ExecutionChatMessage" to avoid conflict with legacy ChatMessage type
 */
export interface ExecutionChatMessage {
  /** Unique message identifier */
  readonly id: string;

  /** Message role */
  readonly role: MessageRole;

  /** Message timestamp (Unix epoch ms) */
  readonly timestamp: number;

  /**
   * Root of the execution tree (for assistant messages)
   * This contains all nested content: text, thinking, tools, agents
   */
  readonly executionTree: ExecutionNode | null;

  /** Raw text content (for user messages) */
  readonly rawContent?: string;

  /** Attached file paths (for user messages with @ syntax) */
  readonly files?: readonly string[];

  /** Session ID this message belongs to */
  readonly sessionId?: string;

  /**
   * Agent information (for extracted agent bubbles)
   * When present, this message is an agent execution extracted as a separate bubble.
   */
  readonly agentInfo?: AgentInfo;
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

  /** Token usage totals */
  readonly tokenUsage?: {
    readonly input: number;
    readonly output: number;
  };

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

// ============================================================================
// ZOD SCHEMAS FOR RUNTIME VALIDATION
// ============================================================================

export const ExecutionNodeTypeSchema = z.enum([
  'message',
  'agent',
  'tool',
  'thinking',
  'text',
  'system',
]);

export const ExecutionStatusSchema = z.enum([
  'pending',
  'streaming',
  'complete',
  'error',
]);

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system']);

// Recursive schema requires lazy evaluation
export const ExecutionNodeSchema: z.ZodType<ExecutionNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: ExecutionNodeTypeSchema,
    status: ExecutionStatusSchema,
    content: z.string().nullable(),
    error: z.string().optional(),
    toolName: z.string().optional(),
    toolInput: z.record(z.string(), z.unknown()).optional(),
    toolOutput: z.unknown().optional(),
    toolCallId: z.string().optional(),
    isPermissionRequest: z.boolean().optional(),
    agentType: z.string().optional(),
    agentModel: z.string().optional(),
    agentDescription: z.string().optional(),
    agentPrompt: z.string().optional(),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
    duration: z.number().optional(),
    tokenUsage: z
      .object({
        input: z.number(),
        output: z.number(),
      })
      .optional(),
    toolCount: z.number().optional(),
    children: z.array(ExecutionNodeSchema),
    isCollapsed: z.boolean(),
    isHighlighted: z.boolean().optional(),
  })
);

export const AgentInfoSchema = z.object({
  agentType: z.string(),
  agentDescription: z.string().optional(),
  agentModel: z.string().optional(),
  summaryContent: z.string().optional(),
  hasSummary: z.boolean().optional(),
  hasExecution: z.boolean().optional(),
  isInterrupted: z.boolean().optional(),
});

export const ExecutionChatMessageSchema = z.object({
  id: z.string(),
  role: MessageRoleSchema,
  timestamp: z.number(),
  executionTree: ExecutionNodeSchema.nullable(),
  rawContent: z.string().optional(),
  files: z.array(z.string()).readonly().optional(),
  sessionId: z.string().optional(),
  agentInfo: AgentInfoSchema.optional(),
});

export const ChatSessionSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  messageCount: z.number().int().nonnegative(),
  createdAt: z.number(),
  lastActivityAt: z.number(),
  tokenUsage: z
    .object({
      input: z.number(),
      output: z.number(),
    })
    .optional(),
  isActive: z.boolean(),
});

export const JSONLMessageTypeSchema = z.enum([
  'system',
  'assistant',
  'user',
  'tool',
  'result',
]);

export const ContentBlockJSONSchema = z.object({
  type: z.enum(['text', 'tool_use', 'tool_result']),
  text: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  tool_use_id: z.string().optional(),
  content: z.union([z.string(), z.unknown()]).optional(),
  is_error: z.boolean().optional(),
});

export const JSONLMessageSchema = z.object({
  type: JSONLMessageTypeSchema,
  subtype: z.string().optional(),
  session_id: z.string().optional(),
  cwd: z.string().optional(),
  model: z.string().optional(),
  thinking: z.string().optional(),
  delta: z.string().optional(),
  message: z
    .object({
      content: z.array(ContentBlockJSONSchema).readonly().optional(),
      stop_reason: z.string().optional(),
    })
    .optional(),
  tool: z.string().optional(),
  tool_use_id: z.string().optional(),
  parent_tool_use_id: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  cost: z.number().optional(),
  duration: z.number().optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
  timestamp: z.string().optional(),
});

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a new ExecutionNode with default values
 */
export function createExecutionNode(
  partial: Partial<ExecutionNode> & Pick<ExecutionNode, 'id' | 'type'>
): ExecutionNode {
  return {
    status: 'pending',
    content: null,
    children: [],
    isCollapsed: false,
    ...partial,
  };
}

/**
 * Create a new ExecutionChatMessage
 */
export function createExecutionChatMessage(
  partial: Partial<ExecutionChatMessage> &
    Pick<ExecutionChatMessage, 'id' | 'role'>
): ExecutionChatMessage {
  return {
    timestamp: Date.now(),
    executionTree: null,
    ...partial,
  };
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if node is an agent (contains nested execution)
 */
export function isAgentNode(node: ExecutionNode): boolean {
  return node.type === 'agent';
}

/**
 * Check if node is a tool execution
 */
export function isToolNode(node: ExecutionNode): boolean {
  return node.type === 'tool';
}

/**
 * Check if node has children
 */
export function hasChildren(node: ExecutionNode): boolean {
  return node.children.length > 0;
}

/**
 * Check if node is still streaming
 */
export function isStreaming(node: ExecutionNode): boolean {
  return node.status === 'streaming';
}

/**
 * Check if JSONL message is a Task tool (agent spawn)
 */
export function isTaskToolMessage(msg: JSONLMessage): boolean {
  return msg.type === 'tool' && msg.tool === 'Task';
}

/**
 * Check if JSONL message is nested under an agent
 */
export function isNestedToolMessage(msg: JSONLMessage): boolean {
  return !!msg.parent_tool_use_id;
}
