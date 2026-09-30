import type {
  SessionId,
  HarnessStreamId,
  WizardPhaseId,
} from '@ptah-extension/shared';

export type TransformerSessionId = SessionId | HarnessStreamId | WizardPhaseId;

/**
 * Which system message announced a task as background. Only `task_started`
 * announcements (the SendMessage-resume path) earn a transformer-produced
 * terminal event: a task backgrounded mid-run via `task_updated` has a
 * registry record under the same tool_use id, so the `SubagentStop` hook
 * path already ends its tray entry — a second terminal event would insert
 * a duplicate entry.
 */
export type BackgroundAnnounceOrigin = 'task_started' | 'task_updated';

/**
 * Correlation record for a single `Workflow` tool run.
 *
 * `runId` is the `Workflow` tool_use id (stable across the run root and every
 * descendant agent). `name` is the SDK `workflow_name` — only known once the
 * `local_workflow` task_started arrives, so it may be undefined for a run root
 * that was first observed via its assistant tool_use block.
 */
export interface WorkflowRunInfo {
  readonly runId: string;
  readonly name?: string;
}

/**
 * What the spawning `Task` tool_use block knew about a `run_in_background: true`
 * agent, held until its placeholder tool_result arrives.
 *
 * The tool_use block is the ONLY place `subagent_type` and `description` appear.
 * The tool_result that triggers `background_agent_started` carries neither, and
 * the `SubagentRegistryService` record may not exist yet (the `SubagentStart`
 * hook can fire after the placeholder). Without this, every background chip
 * rendered as "unknown" with no description.
 */
export interface BackgroundTaskInfo {
  readonly agentType?: string;
  readonly agentDescription?: string;
}

export interface TransformerState {
  getMessageId(contextKey: string): string | undefined;
  getCurrentModel(contextKey: string): string | undefined;
  getToolCallId(contextKey: string, blockIndex: number): string | undefined;
  /**
   * True when the context's active message was SYNTHESIZED by the transformer
   * because a `content_block_start` arrived before any `message_start` (D-5c).
   *
   * A real `message_start` that follows describes the SAME message. Without
   * this flag it would open a second envelope under a new id and clear the
   * block-index → tool-call-id map, orphaning every later `input_json_delta`
   * from the `tool_start` already emitted. Cleared with the message id.
   */
  isMessageSynthesized(contextKey: string): boolean;
  hasBackgroundTaskToolUseId(toolUseId: string): boolean;
  /** What the spawning tool_use block knew; undefined when not a tracked spawn. */
  getBackgroundTaskInfo(toolUseId: string): BackgroundTaskInfo | undefined;
  getTaskParentToolUseId(taskId: string): string | undefined;
  isTaskStartedEmitted(toolUseId: string): boolean;
  /**
   * True when this transformer already emitted `background_agent_started`
   * for `toolUseId`. The transformer-level dedup for a task the SDK reports
   * as backgrounded whose subagent registry record does not exist — a
   * subagent resumed via SendMessage: the registry record is keyed by the
   * `SubagentStart` hook's tool_use id, not the SendMessage tool_use id the
   * task lifecycle carries, so the registry cannot dedup and its `update()`
   * is a no-op. NOT cleared by `clearStreamingState` — a compact boundary
   * can land mid-run, and clearing the mark there would lose the terminal
   * event and leave the tray entry `running` forever. Cleared per id, when
   * the terminal event is emitted.
   */
  isBackgroundAnnounced(toolUseId: string): boolean;
  /**
   * The system message that announced `toolUseId` as background; undefined
   * when it was never announced. Only `task_started` announcements get a
   * transformer-produced terminal event (see {@link BackgroundAnnounceOrigin}).
   */
  getBackgroundAnnounceOrigin(
    toolUseId: string,
  ): BackgroundAnnounceOrigin | undefined;
  /**
   * True for a task whose `task_started` was rejected as non-agent (see
   * `isAgentTaskType`). Keyed by task id because the later lifecycle messages
   * (`task_progress` / `task_updated` / `task_notification`) carry the task id
   * and would otherwise upsert a phantom agent into the monitor store.
   */
  isNonAgentTask(taskId: string): boolean;
  hasActiveSkillToolUseId(toolUseId: string): boolean;
  activeSkillToolUseIdsCount(): number;
  snapshotActiveSkillToolUseIds(): string[];
  getWorkflowRun(toolUseId: string): WorkflowRunInfo | undefined;

  setMessageId(contextKey: string, messageId: string): void;
  /** Clears the message id AND the synthesized mark for `contextKey`. */
  clearMessageId(contextKey: string): void;
  markMessageSynthesized(contextKey: string): void;
  clearMessageSynthesized(contextKey: string): void;
  setCurrentModel(contextKey: string, model: string): void;
  clearCurrentModel(contextKey: string): void;
  setToolCallId(
    contextKey: string,
    blockIndex: number,
    toolUseId: string,
  ): void;
  clearToolCallIdsForContext(contextKey: string): void;
  addBackgroundTaskToolUseId(
    toolUseId: string,
    info?: BackgroundTaskInfo,
  ): void;
  removeBackgroundTaskToolUseId(toolUseId: string): void;
  setTaskParent(taskId: string, parentToolUseId: string): void;
  /** Clears the task→tool_use link AND any non-agent mark for `taskId`. */
  clearTaskParent(taskId: string): void;
  markNonAgentTask(taskId: string): void;
  markTaskStartedEmitted(toolUseId: string): void;
  /**
   * Records that `background_agent_started` was emitted for `toolUseId`,
   * and from which system message, so `getBackgroundAnnounceOrigin` can
   * later decide whether the transformer owns the terminal event.
   */
  markBackgroundAnnounced(
    toolUseId: string,
    origin: BackgroundAnnounceOrigin,
  ): void;
  /** Removes the announcement mark for `toolUseId` (task settled). */
  clearBackgroundAnnounced(toolUseId: string): void;
  addActiveSkillToolUseId(toolUseId: string): void;
  clearActiveSkillToolUseIds(): void;
  /**
   * Register `toolUseId` as the root of a workflow run. `runId` is set to the
   * tool_use id itself. If a `name` becomes known later (from the
   * `local_workflow` task_started) a second call merges it in.
   */
  registerWorkflowRunRoot(toolUseId: string, name?: string): void;
  /**
   * Associate a child tool_use with an already-known workflow run so that a
   * later `task_started` for the child inherits the parent's runId/name. No-op
   * when the parent is not part of a workflow run.
   */
  associateWorkflowRunChild(
    childToolUseId: string,
    parentToolUseId: string,
  ): void;
  clearStreamingState(): void;
}
