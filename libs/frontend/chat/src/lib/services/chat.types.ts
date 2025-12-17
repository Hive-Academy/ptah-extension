import {
  ExecutionChatMessage,
  ExecutionNode,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';

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

  /** Current message ID being built during streaming */
  currentMessageId: string | null;

  /** Current token usage for the active message */
  currentTokenUsage: { input: number; output: number } | null;
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
    currentMessageId: null,
    currentTokenUsage: null,
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
}
