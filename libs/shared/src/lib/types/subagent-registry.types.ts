/**
 * Subagent Registry Types
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
   * For subagent resumption, instruct the model to "Resume agent <agentId>"
   * within the same (resumed) session — the Agent tool has no resume parameter.
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
   * Human-legible teammate name passed by the coordinator on the Agent/Task
   * tool's `name` input (e.g. "backend-developer", "reviewer").
   *
   * Captured from the assistant `tool_use.input.name` BEFORE the SubagentStart
   * hook fires and merged onto the record at registration. When present it is
   * preferred over the opaque short-hex `agentId` in user-facing prose (e.g. the
   * coordinator steering instruction). Optional — spawns without a `name` fall
   * back to `agentId`.
   */
  readonly teammateName?: string;

  /**
   * Whether this subagent is running in the background.
   * Background agents outlive the main agent's turn and continue
   * executing independently. Set when Task tool has run_in_background: true,
   * or when user moves a running foreground agent to the background.
   */
  readonly isBackground?: boolean;

  /**
   * Whether this subagent orchestrates a CLI agent process (Codex, Copilot, Ptah CLI).
   * CLI agents run as independent processes in AgentProcessManager and should NOT be
   * interrupted when the parent SDK session ends. They stop only on their own completion,
   * timeout, or explicit user action (ptah_agent_stop).
   *
   * Set by AgentProcessManager after spawning a CLI agent.
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
   * SDK task_id from SDKTaskStartedMessage.
   * Populated by SubagentRegistryService.setTaskId() when the SDK emits
   * task_started for this agent. Used by SubagentMessageDispatcher to
   * route subagent:stop calls via Query.stopTask(taskId).
   */
  taskId?: string;
}

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
 * Parameters for subagent:background RPC method
 */
export interface SubagentBackgroundParams {
  /** Session that owns the running task(s) */
  readonly sessionId: string;
  /**
   * Optional SDK tool_use ID of a single foreground task to background.
   * When omitted, all in-flight foreground tasks are backgrounded (Ctrl+B parity).
   */
  readonly toolUseId?: string;
}

/**
 * Result of the subagent:background RPC method
 */
export interface SubagentBackgroundResult {
  /**
   * Whether any foreground task was moved to the background.
   * False when `toolUseId` was given but matched no foreground task.
   */
  readonly backgrounded: boolean;
}

/**
 * Result shape for command-type subagent RPC methods (send, stop, interrupt)
 */
export interface SubagentCommandResult {
  readonly ok: true;
}

/**
 * A single UI-friendly message from a subagent's historical transcript.
 *
 * Normalized down from the SDK's `SessionMessage` shape: text content blocks are
 * concatenated into `text`, tool noise is dropped, and only user/assistant turns
 * are surfaced. Consumed by the subagent transcript viewer.
 */
export interface SubagentTranscriptMessage {
  /** The turn author. System messages are filtered out during normalization. */
  readonly role: 'user' | 'assistant';
  /** Rendered text content (text blocks concatenated). */
  readonly text: string;
  /** ISO-8601 timestamp when available on the transcript line; omitted otherwise. */
  readonly timestamp?: string;
}

/**
 * Parameters for the subagent:transcript RPC method.
 *
 * Reads a subagent's full historical transcript on demand via the SDK's
 * `getSubagentMessages(sessionId, agentId, { limit, offset })`.
 */
export interface SubagentTranscriptParams {
  /** Parent session UUID that owns the subagent. */
  readonly sessionId: string;
  /** SDK subagent id (the short-hex `agentId`). */
  readonly agentId: string;
  /** Maximum number of messages to return. */
  readonly limit?: number;
  /** Number of messages to skip from the start. */
  readonly offset?: number;
}

/**
 * Result of the subagent:transcript RPC method.
 */
export interface SubagentTranscriptResult {
  /** Normalized transcript messages in chronological order. */
  readonly messages: SubagentTranscriptMessage[];
}
