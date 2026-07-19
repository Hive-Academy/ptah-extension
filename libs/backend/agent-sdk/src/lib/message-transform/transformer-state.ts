import type {
  SessionId,
  HarnessStreamId,
  WizardPhaseId,
} from '@ptah-extension/shared';

export type TransformerSessionId = SessionId | HarnessStreamId | WizardPhaseId;

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

export interface TransformerState {
  getMessageId(contextKey: string): string | undefined;
  getCurrentModel(contextKey: string): string | undefined;
  getToolCallId(contextKey: string, blockIndex: number): string | undefined;
  hasBackgroundTaskToolUseId(toolUseId: string): boolean;
  getTaskParentToolUseId(taskId: string): string | undefined;
  isTaskStartedEmitted(toolUseId: string): boolean;
  hasActiveSkillToolUseId(toolUseId: string): boolean;
  activeSkillToolUseIdsCount(): number;
  snapshotActiveSkillToolUseIds(): string[];
  getWorkflowRun(toolUseId: string): WorkflowRunInfo | undefined;

  setMessageId(contextKey: string, messageId: string): void;
  clearMessageId(contextKey: string): void;
  setCurrentModel(contextKey: string, model: string): void;
  clearCurrentModel(contextKey: string): void;
  setToolCallId(
    contextKey: string,
    blockIndex: number,
    toolUseId: string,
  ): void;
  clearToolCallIdsForContext(contextKey: string): void;
  addBackgroundTaskToolUseId(toolUseId: string): void;
  removeBackgroundTaskToolUseId(toolUseId: string): void;
  setTaskParent(taskId: string, parentToolUseId: string): void;
  clearTaskParent(taskId: string): void;
  markTaskStartedEmitted(toolUseId: string): void;
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
