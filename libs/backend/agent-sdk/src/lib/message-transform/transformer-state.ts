import type {
  SessionId,
  HarnessStreamId,
  WizardPhaseId,
} from '@ptah-extension/shared';

export type TransformerSessionId = SessionId | HarnessStreamId | WizardPhaseId;

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
  clearStreamingState(): void;
}
