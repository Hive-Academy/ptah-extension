/**
 * Subagent Registry Types
 *
 * TASK_2025_103: Subagent Resumption Feature
 *
 * These types support tracking subagent lifecycle state to enable
 * resumption of interrupted subagent executions. The SubagentRegistryService
 * uses these types to maintain in-memory state of all subagents.
 */

/**
 * Subagent lifecycle status
 *
 * - 'running': Agent is currently executing
 * - 'completed': Agent finished successfully (SubagentStop hook fired)
 * - 'interrupted': Agent was aborted mid-execution (session ended before completion)
 */
export type SubagentStatus = 'running' | 'completed' | 'interrupted';

/**
 * Record tracking a subagent's lifecycle state
 *
 * Stored in SubagentRegistryService's in-memory Map, keyed by toolCallId.
 * Used to track subagent state for resumption capability.
 */
export interface SubagentRecord {
  /**
   * The Task tool_use ID from SDK hook SubagentStart event.
   * Used as the primary key for registry lookup.
   */
  readonly toolCallId: string;

  /**
   * The subagent's own session ID (SDK UUID).
   * This is the session ID to pass to SDK's resume parameter.
   * NOT the parent session ID.
   */
  readonly sessionId: string;

  /**
   * Agent type (e.g., 'Explore', 'Plan', 'software-architect').
   * Derived from the SubagentStart hook event.
   */
  readonly agentType: string;

  /**
   * Current lifecycle status of the subagent.
   * Updated when SubagentStop hook fires or session is aborted.
   */
  status: SubagentStatus;

  /**
   * Timestamp (Unix epoch ms) when the subagent started.
   * Set when SubagentStart hook fires.
   */
  readonly startedAt: number;

  /**
   * Timestamp (Unix epoch ms) when the subagent was interrupted.
   * Only set when status transitions to 'interrupted'.
   */
  interruptedAt?: number;

  /**
   * Parent session ID for routing and filtering.
   * The session that spawned this subagent.
   */
  readonly parentSessionId: string;

  /**
   * Short agent identifier (e.g., "adcecb2") from SDK.
   * Used as stable key for summary content lookup.
   */
  readonly agentId: string;
}

// TASK_2025_109: SubagentResumeParams and SubagentResumeResult removed
// Subagent resumption is now handled via context injection in chat:continue RPC,
// allowing Claude to naturally resume interrupted agents through conversation.
// See chat-rpc.handlers.ts for the context injection implementation.

/**
 * Parameters for the subagent:query RPC method
 */
export interface SubagentQueryParams {
  /**
   * Optional session ID to filter subagents by parent session.
   * If not provided, returns all resumable subagents.
   */
  readonly sessionId?: string;

  /**
   * Optional toolCallId to query a specific subagent.
   * If provided, returns single-item array or empty array.
   */
  readonly toolCallId?: string;
}

/**
 * Result of the subagent:query RPC method
 */
export interface SubagentQueryResult {
  /** Array of subagent records matching the query */
  readonly subagents: SubagentRecord[];
}
