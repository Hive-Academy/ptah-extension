import {
  ExecutionChatMessage,
  ExecutionNode,
  FlatStreamEventUnion,
  InlineImageAttachment,
  EffortLevel,
} from '@ptah-extension/shared';

/**
 * Options for sending a message (options bag pattern).
 * Replaces positional optional parameters for clarity and extensibility.
 * Defined here (not in service file) to avoid circular dependencies with TabState.
 */
export interface SendMessageOptions {
  /** Optional file paths to include */
  files?: string[];
  /** Optional inline images (pasted/dropped) */
  images?: InlineImageAttachment[];
  /** Optional effort level for reasoning depth (TASK_2025_184) */
  effort?: EffortLevel;
}

/**
 * TASK_2025_102: Content block from agent JSONL file - preserves interleaved structure.
 * Mirrors the backend AgentContentBlock type for frontend usage.
 */
export interface AgentContentBlock {
  /** Block type - text for narrative, tool_ref for tool position marker */
  type: 'text' | 'tool_ref';
  /** Text content (only for type: 'text') */
  text?: string;
  /** Tool use ID for correlation with SDK events (only for type: 'tool_ref') */
  toolUseId?: string;
  /** Tool name (only for type: 'tool_ref') */
  toolName?: string;
}

/**
 * Maps for tracking execution nodes during session operations.
 * Shared between session loading and streaming to maintain node references.
 */
export interface NodeMaps {
  /** Map of agent IDs to their execution nodes */
  agents: Map<string, ExecutionNode>;
  /** Map of tool call IDs to their execution nodes */
  tools: Map<string, ExecutionNode>;
}

/**
 * Flat event-based streaming state (replaces ExecutionNode tree).
 * Stores all streaming events as flat list with lookup maps for performance.
 */
export interface StreamingState {
  /** All streaming events indexed by event ID */
  events: Map<string, FlatStreamEventUnion>;

  /** Ordered list of event IDs for message-level events (excludes chunks/deltas) */
  messageEventIds: string[];

  /** Maps tool call IDs to their child event IDs */
  toolCallMap: Map<string, string[]>;

  /** Accumulated text for text-delta events, keyed by parent event ID */
  textAccumulators: Map<string, string>;

  /** Accumulated tool input for input-json-delta events, keyed by tool call ID */
  toolInputAccumulators: Map<string, string>;

  /**
   * Accumulated agent summary content from real-time file watcher.
   * Keyed by toolCallId (agent's tool use ID).
   * Updated via AGENT_SUMMARY_CHUNK events from backend.
   * @deprecated Use agentContentBlocksMap for proper interleaving
   */
  agentSummaryAccumulators: Map<string, string>;

  /**
   * TASK_2025_102: Structured content blocks from agent file watcher.
   * Preserves the interleaved structure of text and tool_use blocks.
   * Keyed by agentId (stable across hook and complete events).
   * Frontend uses this to interleave text nodes between tool nodes.
   */
  agentContentBlocksMap: Map<string, AgentContentBlock[]>;

  /** Current message ID being built during streaming */
  currentMessageId: string | null;

  /** Current token usage for the active message */
  currentTokenUsage: { input: number; output: number } | null;

  /** Pre-indexed events by messageId for O(1) lookup (eliminates O(n²) iteration) */
  eventsByMessage: Map<string, FlatStreamEventUnion[]>;

  /**
   * Pending session stats to apply during finalization.
   * Stores stats that arrive before finalizeCurrentMessage is called.
   */
  pendingStats?: {
    cost: number;
    tokens: { input: number; output: number };
    duration: number;
  } | null;
}

/**
 * Factory function to create an empty StreamingState.
 * Used for tab initialization and resetting streaming state.
 */
export function createEmptyStreamingState(): StreamingState {
  return {
    events: new Map(),
    messageEventIds: [],
    toolCallMap: new Map(),
    textAccumulators: new Map(),
    toolInputAccumulators: new Map(),
    agentSummaryAccumulators: new Map(),
    agentContentBlocksMap: new Map(), // TASK_2025_102: Structured content blocks
    currentMessageId: null,
    currentTokenUsage: null,
    eventsByMessage: new Map(),
    pendingStats: null,
  };
}

/**
 * Session lifecycle status values.
 * Tracks the current state of session operations.
 */
export type SessionStatus =
  | 'fresh'
  | 'draft'
  | 'loaded'
  | 'streaming'
  | 'resuming'
  | 'switching';

/**
 * Session state information.
 * Tracks the current session's lifecycle and identity.
 */
export interface SessionState {
  /** Current session lifecycle status */
  status: SessionStatus;
  /** Active session identifier, null if no session active */
  sessionId: string | null;
  /** Whether the session was loaded from existing data or is new */
  isExistingSession: boolean;
}

/**
 * Result from loading a session's historical data.
 * Contains all messages and node mappings needed to reconstruct session state.
 */
export interface SessionLoadResult {
  /** Loaded chat messages with execution context */
  messages: ExecutionChatMessage[];
  /** Node maps for agents and tools referenced in the session */
  nodeMaps: NodeMaps;
}

/**
 * Represents a single tab/session in the multi-session UI
 */
export interface TabState {
  /** Unique tab identifier (frontend-generated) */
  id: string;

  /** Real Claude CLI session UUID (null if draft) */
  claudeSessionId: string | null;

  /**
   * Placeholder session ID (proper UUID v4) used temporarily before Claude SDK resolves real ID.
   * Generated via uuid.v4() at tab creation.
   * Cleared after session:id-resolved event updates claudeSessionId.
   *
   * @example "550e8400-e29b-41d4-a716-446655440000"
   */
  placeholderSessionId: string | null;

  /** User-provided or auto-generated session name */
  name: string;

  /** Display title shown in tab UI (typically derived from name) */
  title: string;

  /** Tab order position */
  order: number;

  /** Current session status */
  status: SessionStatus;

  /** Whether session has unsent input */
  isDirty: boolean;

  /** Timestamp of last activity */
  lastActivityAt: number;

  /** Messages for this session */
  messages: ExecutionChatMessage[];

  /** Current streaming state (flat events model, replaces executionTree) */
  streamingState: StreamingState | null;

  /**
   * ID of the message currently being built during streaming.
   * Per-tab tracking enables proper multi-tab streaming support.
   */
  currentMessageId?: string | null;

  /**
   * Single queued message content (appended on multiple sends).
   * When user sends messages during streaming, content is appended here.
   * Auto-sent via continueConversation() when streaming completes.
   */
  queuedContent?: string | null;

  /**
   * Options associated with the queued message (files, images, effort).
   * Stored alongside queuedContent to preserve full message context.
   * When multiple messages are queued, only the first message's options are kept
   * (subsequent queued messages are text-only appends).
   */
  queuedOptions?: SendMessageOptions | null;

  /**
   * Preloaded stats from backend (for old sessions loaded from JSONL).
   * Used to display cost/tokens for historical sessions without recalculation.
   */
  preloadedStats?: {
    totalCost: number;
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheCreation: number;
    };
    messageCount: number;
  } | null;

  /**
   * Live model stats from current session (updated after each turn completion).
   * Includes context window size for percentage calculation and model name.
   * Used by SessionStatsSummaryComponent to display context usage.
   */
  liveModelStats?: {
    /** Primary model name (first model in modelUsage list) */
    model: string;
    /** Total context tokens used (input + output) */
    contextUsed: number;
    /** Total context window size */
    contextWindow: number;
    /** Context usage as percentage (0-100) */
    contextPercent: number;
  } | null;

  /**
   * Original model from session history (detected from system init message).
   * Used to pass the correct model when continuing a loaded historical session.
   */
  sessionModel?: string | null;

  /**
   * System prompt preset selection for this tab.
   * - 'claude_code': Default preset with minimal customization
   * - 'enhanced': AI-generated project-specific guidance
   *
   * When undefined, defaults to 'enhanced' if enhanced prompts are generated,
   * otherwise falls back to 'claude_code'.
   */
  preset?: 'claude_code' | 'enhanced';

  /**
   * Number of context compactions that occurred during this session.
   * Incremented on each compaction_complete event.
   */
  compactionCount?: number;

  /**
   * Full per-model usage breakdown for collapsible display.
   * Contains all models used in the session with their individual stats.
   */
  modelUsageList?: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUSD: number;
    contextWindow: number;
    cacheReadInputTokens?: number;
  }> | null;
}

/**
 * Accumulator key helpers to ensure consistency across streaming-handler and tree-builder.
 * Prevents magic string coupling.
 */
export const AccumulatorKeys = {
  toolInput: (toolCallId: string) => `${toolCallId}-input`,
  textBlock: (messageId: string, blockIndex: number) =>
    `${messageId}-block-${blockIndex}`,
  thinkingBlock: (messageId: string, blockIndex: number) =>
    `${messageId}-thinking-${blockIndex}`,
  /**
   * Key for agent summary content, keyed by agentId (NOT toolCallId).
   * TASK_2025_099: agentId is stable across hook (UUID toolCallId) and
   * complete message (toolu_* toolCallId), making it the reliable lookup key.
   */
  agentSummary: (agentId: string) => agentId,
} as const;
