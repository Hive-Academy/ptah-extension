import {
  ExecutionChatMessage,
  ExecutionNode,
  JSONLMessage,
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
 * Agent session data from backend.
 * Represents a single agent's execution within a parent session.
 */
export interface AgentSessionData {
  /** Unique identifier for the agent */
  agentId: string;
  /** Raw JSONL messages from the agent's execution */
  messages: JSONLMessage[];
}

/**
 * Result of classifying agent messages into summary and execution content.
 * Separates agent metadata (summary) from actual execution messages.
 */
export interface ClassifiedAgentMessages {
  /** Optional summary content describing the agent's execution */
  summaryContent: string | null;
  /** Messages representing actual execution steps */
  executionMessages: JSONLMessage[];
}

/**
 * Types of processed chunks from JSONL streaming.
 * Each type represents a different kind of streaming event.
 */
export type ProcessedChunkType =
  | 'system-init'
  | 'text'
  | 'thinking'
  | 'tool-start'
  | 'tool-result'
  | 'agent-spawn'
  | 'agent-message'
  | 'stream-complete';

/**
 * Result from processing a JSONL chunk.
 * Contains the chunk type, payload data, and execution context.
 */
export interface ProcessedChunk {
  /** Type of the processed chunk */
  type: ProcessedChunkType;
  /** Payload data specific to the chunk type */
  payload: unknown;
  /** Execution context for nested agent/tool operations */
  context: {
    /** ID of parent agent for nested executions */
    parentAgentId?: string;
    /** ID of tool call for tool-related chunks */
    toolCallId?: string;
  };
}

/**
 * Represents a single tab/session in the multi-session UI
 */
export interface TabState {
  /** Unique tab identifier (frontend-generated) */
  id: string;

  /** Real Claude CLI session UUID (null if draft) */
  claudeSessionId: string | null;

  /** Display title for the tab */
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

  /** Current execution tree (if streaming) */
  executionTree: ExecutionNode | null;

  /**
   * ID of the message currently being built during streaming.
   * Per-tab tracking enables proper multi-tab streaming support.
   */
  currentMessageId?: string | null;
}
