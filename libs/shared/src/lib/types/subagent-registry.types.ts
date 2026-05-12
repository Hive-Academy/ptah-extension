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
export type SubagentStatus =
  | 'running'
  | 'completed'
  | 'interrupted'
  | 'background'
  | 'background_completed';

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
   * The session ID from the SubagentStart hook (input.session_id).
   * NOTE: This is actually the PARENT session ID, not the subagent's own session.
   * The SDK hook does not expose the subagent's own session ID.
   * For subagent resumption, use `agentId` (short hex) with the Task tool's resume parameter.
   * @deprecated Use parentSessionId for parent session lookups. This field is redundant.
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

  /**
   * Whether this subagent is running in the background.
   * Background agents outlive the main agent's turn and continue
   * executing independently. Set when Task tool has run_in_background: true,
   * or when user moves a running foreground agent to the background.
   */
  readonly isBackground?: boolean;

  /**
   * Whether this subagent orchestrates a CLI agent process (Gemini, Codex, Copilot, Ptah CLI).
   * CLI agents run as independent processes in AgentProcessManager and should NOT be
   * interrupted when the parent SDK session ends. They stop only on their own completion,
   * timeout, or explicit user action (ptah_agent_stop).
   *
   * TASK_2025_186: Set by AgentProcessManager after spawning a CLI agent.
   */
  readonly isCliAgent?: boolean;

  /**
   * Path to the background agent's output file.
   * Returned by the SDK in the placeholder tool_result when
   * run_in_background: true. Used by TaskOutput tool to retrieve results.
   */
  readonly outputFilePath?: string;

  /**
   * Timestamp (Unix epoch ms) when the agent was moved to background.
   * May differ from startedAt if the agent was initially foreground
   * and moved to background via user action.
   */
  backgroundStartedAt?: number;

  /**
   * Timestamp (Unix epoch ms) when the background agent completed.
   * Only set when status transitions to 'background_completed'.
   */
  completedAt?: number;

  /**
   * SDK task_id from SDKTaskStartedMessage (Phase 1 addition).
   * Populated by SubagentRegistryService.setTaskId() when the SDK emits
   * task_started for this agent. Used by SubagentMessageDispatcher to
   * route subagent:stop calls via Query.stopTask(taskId).
   */
  taskId?: string;
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

// ============================================================================
// Phase 2: Bidirectional messaging + stop/interrupt RPC types
// ============================================================================

/**
 * Parameters for subagent:send-message RPC method
 */
export interface SubagentSendMessageParams {
  /** Session that owns the subagent */
  readonly sessionId: string;
  /** Task tool_use ID that spawned the subagent */
  readonly parentToolUseId: string;
  /** Message text to send into the subagent */
  readonly text: string;
}

/**
 * Parameters for subagent:stop RPC method
 */
export interface SubagentStopParams {
  /** Session that owns the subagent */
  readonly sessionId: string;
  /** SDK task_id from SDKTaskStartedMessage */
  readonly taskId: string;
}

/**
 * Parameters for subagent:interrupt RPC method
 */
export interface SubagentInterruptParams {
  /** Session to interrupt */
  readonly sessionId: string;
}

/**
 * Result shape for command-type subagent RPC methods (send, stop, interrupt)
 */
export interface SubagentCommandResult {
  readonly ok: true;
}
