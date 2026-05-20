import { injectable, inject } from 'tsyringe';
import {
  FlatStreamEventUnion,
  SessionId,
  HarnessStreamId,
  WizardPhaseId,
  AuthEnv,
} from '@ptah-extension/shared';
import {
  Logger,
  TOKENS,
  type SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from './di/tokens';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';
import type { IModelResolver } from './auth-env.port';
import type { SessionLifecycleManager } from './helpers/session-lifecycle-manager';
import type { LiveUsageTracker } from './helpers/live-usage-tracker';
import {
  SDKMessage,
  isResultMessage,
  isSystemInit,
  isStreamEvent,
  isUserMessage,
  isAssistantMessage,
  isCompactBoundary,
  isLocalCommandOutput,
  isTaskStarted,
  isTaskProgress,
  isTaskUpdated,
  isTaskNotification,
} from './types/sdk-types/claude-sdk.types';
import {
  AssistantMessageTransformer,
  UserMessageTransformer,
  StreamEventTransformer,
  SystemMessageTransformer,
  ResultMessageTransformer,
  isSkillOrMetaContent,
  userMessageHasToolResult,
} from './message-transform';
import type { TransformerState, TransformerHelpers } from './message-transform';

export { isResultMessage as isSDKResultMessage };

@injectable()
export class SdkMessageTransformer implements TransformerState {
  private readonly currentMessageIdByContext: Map<string, string> = new Map();
  private readonly currentModelByContext: Map<string, string> = new Map();
  private readonly toolCallIdByContextAndBlock: Map<string, string> = new Map();
  private readonly backgroundTaskToolUseIds: Set<string> = new Set();
  private readonly taskIdToParentToolUseId: Map<string, string> = new Map();
  private readonly taskStartedEmitted: Set<string> = new Set();
  private readonly activeSkillToolUseIds: Set<string> = new Set();

  private readonly assistantTransformer: AssistantMessageTransformer;
  private readonly userTransformer: UserMessageTransformer;
  private readonly streamEventTransformer: StreamEventTransformer;
  private readonly systemTransformer: SystemMessageTransformer;
  private readonly resultTransformer: ResultMessageTransformer;
  private readonly helpers: TransformerHelpers;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV)
    private readonly authEnv: AuthEnv,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry: SubagentRegistryService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER)
    private readonly modelResolver: IModelResolver,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly sessionLifecycle: SessionLifecycleManager,
    @inject(SDK_TOKENS.SDK_LIVE_USAGE_TRACKER)
    private readonly usageTracker: LiveUsageTracker,
  ) {
    this.helpers = {
      logger: this.logger,
      subagentRegistry: this.subagentRegistry,
      modelResolver: this.modelResolver,
      sessionLifecycle: this.sessionLifecycle,
      usageTracker: this.usageTracker,
    };
    this.assistantTransformer = new AssistantMessageTransformer();
    this.userTransformer = new UserMessageTransformer();
    this.streamEventTransformer = new StreamEventTransformer();
    this.systemTransformer = new SystemMessageTransformer();
    this.resultTransformer = new ResultMessageTransformer();
  }

  createIsolated(): SdkMessageTransformer {
    return new SdkMessageTransformer(
      this.logger,
      this.authEnv,
      this.subagentRegistry,
      this.modelResolver,
      this.sessionLifecycle,
      this.usageTracker,
    );
  }

  getCumulativeTokens(sessionId: string): number {
    return this.usageTracker.getCumulativeTokens(sessionId);
  }

  clearSessionTokenSnapshot(sessionId: string): void {
    this.usageTracker.clearSessionTokenSnapshot(sessionId);
  }

  transform(
    sdkMessage: SDKMessage,
    sessionId?: SessionId | HarnessStreamId | WizardPhaseId,
  ): FlatStreamEventUnion[] {
    try {
      if (isAssistantMessage(sdkMessage)) {
        return this.assistantTransformer.transform(
          sdkMessage,
          this,
          this.helpers,
          sessionId,
        );
      }

      if (isUserMessage(sdkMessage)) {
        if (sdkMessage.isSynthetic === true) {
          this.logger.debug(
            '[SdkMessageTransformer] Skipping synthetic user message (skill/meta content)',
          );
          return [];
        }

        if (this.activeSkillToolUseIds.size > 0) {
          const hasToolResult = userMessageHasToolResult(sdkMessage);
          if (!hasToolResult) {
            this.logger.info(
              '[SdkMessageTransformer] Skipping user message during active Skill tool execution (skill content injection)',
              { activeSkillTools: [...this.activeSkillToolUseIds] },
            );
            return [];
          }
        }

        if (isSkillOrMetaContent(sdkMessage)) {
          this.logger.info(
            '[SdkMessageTransformer] Skipping user message detected as skill/meta content by pattern',
          );
          return [];
        }

        return this.userTransformer.transform(
          sdkMessage,
          this,
          this.helpers,
          sessionId,
        );
      }

      if (isSystemInit(sdkMessage)) {
        return [];
      }

      if (isCompactBoundary(sdkMessage)) {
        return this.systemTransformer.transformCompactBoundary(
          sdkMessage,
          this,
          this.helpers,
          sessionId,
        );
      }

      if (isLocalCommandOutput(sdkMessage)) {
        return this.systemTransformer.transformLocalCommandOutput(
          sdkMessage,
          this.helpers,
          sessionId,
        );
      }

      if (isResultMessage(sdkMessage)) {
        return this.resultTransformer.transform(
          sdkMessage,
          this.helpers,
          sessionId,
        );
      }

      if (isStreamEvent(sdkMessage)) {
        return this.streamEventTransformer.transform(
          sdkMessage,
          this,
          this.helpers,
          sessionId,
        );
      }

      if (isTaskStarted(sdkMessage)) {
        return this.systemTransformer.transformTaskStarted(
          sdkMessage,
          this,
          this.helpers,
          sessionId,
        );
      }

      if (isTaskProgress(sdkMessage)) {
        return this.systemTransformer.transformTaskProgress(
          sdkMessage,
          this,
          this.helpers,
          sessionId,
        );
      }

      if (isTaskUpdated(sdkMessage)) {
        return this.systemTransformer.transformTaskUpdated(
          sdkMessage,
          this,
          this.helpers,
          sessionId,
        );
      }

      if (isTaskNotification(sdkMessage)) {
        return this.systemTransformer.transformTaskNotification(
          sdkMessage,
          this,
          this.helpers,
          sessionId,
        );
      }

      this.logger.warn(
        '[SdkMessageTransformer] Unknown message type',
        sdkMessage,
      );
      return [];
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        '[SdkMessageTransformer] Transformation failed',
        errorObj,
      );
      return [];
    }
  }

  clearStreamingState(): void {
    this.currentMessageIdByContext.clear();
    this.currentModelByContext.clear();
    this.toolCallIdByContextAndBlock.clear();
    this.backgroundTaskToolUseIds.clear();
    this.activeSkillToolUseIds.clear();
    this.taskIdToParentToolUseId.clear();
    this.taskStartedEmitted.clear();
  }

  getMessageId(contextKey: string): string | undefined {
    return this.currentMessageIdByContext.get(contextKey);
  }

  getCurrentModel(contextKey: string): string | undefined {
    return this.currentModelByContext.get(contextKey);
  }

  getToolCallId(contextKey: string, blockIndex: number): string | undefined {
    return this.toolCallIdByContextAndBlock.get(`${contextKey}:${blockIndex}`);
  }

  hasBackgroundTaskToolUseId(toolUseId: string): boolean {
    return this.backgroundTaskToolUseIds.has(toolUseId);
  }

  getTaskParentToolUseId(taskId: string): string | undefined {
    return this.taskIdToParentToolUseId.get(taskId);
  }

  isTaskStartedEmitted(toolUseId: string): boolean {
    return this.taskStartedEmitted.has(toolUseId);
  }

  hasActiveSkillToolUseId(toolUseId: string): boolean {
    return this.activeSkillToolUseIds.has(toolUseId);
  }

  activeSkillToolUseIdsCount(): number {
    return this.activeSkillToolUseIds.size;
  }

  snapshotActiveSkillToolUseIds(): string[] {
    return [...this.activeSkillToolUseIds];
  }

  setMessageId(contextKey: string, messageId: string): void {
    this.currentMessageIdByContext.set(contextKey, messageId);
  }

  clearMessageId(contextKey: string): void {
    this.currentMessageIdByContext.delete(contextKey);
  }

  setCurrentModel(contextKey: string, model: string): void {
    this.currentModelByContext.set(contextKey, model);
  }

  clearCurrentModel(contextKey: string): void {
    this.currentModelByContext.delete(contextKey);
  }

  setToolCallId(
    contextKey: string,
    blockIndex: number,
    toolUseId: string,
  ): void {
    this.toolCallIdByContextAndBlock.set(
      `${contextKey}:${blockIndex}`,
      toolUseId,
    );
  }

  clearToolCallIdsForContext(contextKey: string): void {
    const prefix = `${contextKey}:`;
    for (const key of this.toolCallIdByContextAndBlock.keys()) {
      if (key.startsWith(prefix)) {
        this.toolCallIdByContextAndBlock.delete(key);
      }
    }
  }

  addBackgroundTaskToolUseId(toolUseId: string): void {
    this.backgroundTaskToolUseIds.add(toolUseId);
  }

  removeBackgroundTaskToolUseId(toolUseId: string): void {
    this.backgroundTaskToolUseIds.delete(toolUseId);
  }

  setTaskParent(taskId: string, parentToolUseId: string): void {
    this.taskIdToParentToolUseId.set(taskId, parentToolUseId);
  }

  clearTaskParent(taskId: string): void {
    this.taskIdToParentToolUseId.delete(taskId);
  }

  markTaskStartedEmitted(toolUseId: string): void {
    this.taskStartedEmitted.add(toolUseId);
  }

  addActiveSkillToolUseId(toolUseId: string): void {
    this.activeSkillToolUseIds.add(toolUseId);
  }

  clearActiveSkillToolUseIds(): void {
    this.activeSkillToolUseIds.clear();
  }
}
