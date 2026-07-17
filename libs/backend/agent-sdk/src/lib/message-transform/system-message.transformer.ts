import {
  FlatStreamEventUnion,
  MessageStartEvent,
  TextDeltaEvent,
  MessageCompleteEvent,
  CompactionCompleteEvent,
  AgentStartEvent,
  AgentProgressEvent,
  AgentStatusEvent,
  AgentCompletedEvent,
  BackgroundAgentStartedEvent,
  SessionId,
} from '@ptah-extension/shared';

import type {
  SDKMessage,
  SDKTaskStartedMessage,
  SDKTaskProgressMessage,
  SDKTaskUpdatedMessage,
  SDKTaskNotificationMessage,
} from '../types/sdk-types/claude-sdk.types';
import { generateEventId } from './message-transform-helpers';
import type {
  TransformerState,
  TransformerSessionId,
} from './transformer-state';
import type { TransformerHelpers } from './transformer-helpers';

export class SystemMessageTransformer {
  transformCompactBoundary(
    sdkMessage: SDKMessage & {
      compact_metadata: {
        trigger: 'manual' | 'auto';
        pre_tokens: number;
        post_tokens?: number;
        duration_ms?: number;
      };
      session_id?: string;
    },
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    helpers.logger.debug(
      '[SdkMessageTransformer] Compact boundary received, resetting streaming state',
      { trigger: sdkMessage.compact_metadata.trigger },
    );
    state.clearStreamingState();

    const activeIds = helpers.sessionLifecycle.getActiveSessionIds();
    const resolvedSessionId =
      sessionId ||
      activeIds[0] ||
      (sdkMessage.session_id as SessionId | undefined);

    if (!resolvedSessionId) {
      helpers.logger.warn(
        '[SdkMessageTransformer] compact_boundary received without resolvable sessionId — skipping compaction_complete emission. Banner will rely on safety timeout.',
        {
          callerSessionId: sessionId,
          sdkSessionId: sdkMessage.session_id,
          activeSessionCount: activeIds.length,
          trigger: sdkMessage.compact_metadata.trigger,
          preTokens: sdkMessage.compact_metadata.pre_tokens,
        },
      );
      return [];
    }

    helpers.subagentRegistry.pruneSession(resolvedSessionId);
    helpers.usageTracker.clearSessionTokenSnapshot(resolvedSessionId);

    const compactionCompleteEvent: CompactionCompleteEvent = {
      id: generateEventId(),
      eventType: 'compaction_complete',
      timestamp: Date.now(),
      sessionId: resolvedSessionId,
      messageId: `compaction-${Date.now()}`,
      trigger: sdkMessage.compact_metadata.trigger,
      preTokens: sdkMessage.compact_metadata.pre_tokens,
      postTokens: sdkMessage.compact_metadata.post_tokens,
      durationMs: sdkMessage.compact_metadata.duration_ms,
    };

    return [compactionCompleteEvent];
  }

  transformLocalCommandOutput(
    sdkMessage: SDKMessage & { content: string; session_id?: string },
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    helpers.logger.debug(
      '[SdkMessageTransformer] Local command output received',
      { contentLength: sdkMessage.content.length },
    );
    const messageId = `cmd_${generateEventId()}`;
    const resolvedSessionId = sessionId || sdkMessage.session_id || '';

    const events: FlatStreamEventUnion[] = [
      {
        id: generateEventId(),
        eventType: 'message_start',
        timestamp: Date.now(),
        sessionId: resolvedSessionId,
        messageId,
        role: 'assistant',
      } as MessageStartEvent,
      {
        id: generateEventId(),
        eventType: 'text_delta',
        timestamp: Date.now(),
        sessionId: resolvedSessionId,
        messageId,
        delta: sdkMessage.content,
        blockIndex: 0,
      } as TextDeltaEvent,
      {
        id: generateEventId(),
        eventType: 'message_complete',
        timestamp: Date.now(),
        sessionId: resolvedSessionId,
        messageId,
      } as MessageCompleteEvent,
    ];
    return events;
  }

  transformTaskStarted(
    msg: SDKTaskStartedMessage,
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    const toolUseId = msg.tool_use_id;

    if (toolUseId) {
      state.setTaskParent(msg.task_id, toolUseId);
      helpers.subagentRegistry.setTaskId(toolUseId, msg.task_id);
    }

    if (msg.skip_transcript) {
      helpers.logger.debug(
        '[SdkMessageTransformer] task_started skip_transcript=true — skipping',
        { taskId: msg.task_id, toolUseId },
      );
      return [];
    }

    if (!toolUseId) {
      helpers.logger.debug(
        '[SdkMessageTransformer] task_started has no tool_use_id — skipping AgentStartEvent',
        { taskId: msg.task_id },
      );
      return [];
    }

    if (state.isTaskStartedEmitted(toolUseId)) {
      return [];
    }
    state.markTaskStartedEmitted(toolUseId);

    const resolvedSession = sessionId ?? (msg.session_id as SessionId);
    const messageId = state.getMessageId('') ?? `task_${msg.task_id}`;

    const event: AgentStartEvent = {
      id: generateEventId(),
      eventType: 'agent_start',
      timestamp: Date.now(),
      sessionId: resolvedSession,
      messageId,
      parentToolUseId: toolUseId,
      toolCallId: toolUseId,
      agentType: msg.task_type ?? 'Task',
      agentDescription: msg.description,
      agentPrompt: msg.prompt,
      teammateName:
        helpers.subagentRegistry.get(toolUseId)?.teammateName ??
        helpers.subagentRegistry.peekPendingTeammateName(toolUseId),
      taskId: msg.task_id,
    };

    helpers.logger.debug('[SdkMessageTransformer] task_started → agent_start', {
      taskId: msg.task_id,
      toolUseId,
    });

    return [event];
  }

  transformTaskProgress(
    msg: SDKTaskProgressMessage,
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    const parentToolUseId =
      msg.tool_use_id ?? state.getTaskParentToolUseId(msg.task_id);

    if (!parentToolUseId) {
      helpers.logger.debug(
        '[SdkMessageTransformer] task_progress: no parentToolUseId, skipping',
        { taskId: msg.task_id },
      );
      return [];
    }

    const resolvedSession = sessionId ?? (msg.session_id as SessionId);

    const event: AgentProgressEvent = {
      id: generateEventId(),
      eventType: 'agent_progress',
      timestamp: Date.now(),
      sessionId: resolvedSession,
      messageId: state.getMessageId('') ?? `task_${msg.task_id}`,
      parentToolUseId,
      taskId: msg.task_id,
      description: msg.description,
      summary: msg.summary,
      lastToolName: msg.last_tool_name,
      totalTokens: msg.usage.total_tokens,
      toolUses: msg.usage.tool_uses,
      durationMs: msg.usage.duration_ms,
    };

    return [event];
  }

  transformTaskUpdated(
    msg: SDKTaskUpdatedMessage,
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    const parentToolUseId = state.getTaskParentToolUseId(msg.task_id);

    if (!parentToolUseId) {
      helpers.logger.debug(
        '[SdkMessageTransformer] task_updated: no parentToolUseId, skipping',
        { taskId: msg.task_id },
      );
      return [];
    }

    const patch = msg.patch;
    const resolvedSession = sessionId ?? (msg.session_id as SessionId);
    const messageId = state.getMessageId('') ?? `task_${msg.task_id}`;
    const events: FlatStreamEventUnion[] = [];

    if (patch.status) {
      const statusEvent: AgentStatusEvent = {
        id: generateEventId(),
        eventType: 'agent_status',
        timestamp: Date.now(),
        sessionId: resolvedSession,
        messageId,
        parentToolUseId,
        taskId: msg.task_id,
        status: patch.status,
        description: patch.description,
        errorMessage: patch.error,
      };
      events.push(statusEvent);
    }

    // Mid-run backgrounding (Ctrl+B / subagent:background RPC → Query.background
    // Tasks): the SDK flips `patch.is_backgrounded` to true. Emit a
    // background_agent_started ALONGSIDE the agent_status patch so the frontend
    // BackgroundAgentStore registers the agent immediately — otherwise the
    // Background badge only appears once the task settles. The registry is the
    // dedup source: emit once per task, and keep the SubagentRecord coherent
    // with the run_in_background:true spawn path (status 'background' +
    // isBackground) so getBackgroundAgents and the SubagentStop hook's
    // background_completed handling treat it the same.
    if (patch.is_backgrounded === true) {
      const record = helpers.subagentRegistry.get(parentToolUseId);
      const alreadyBackground =
        record?.status === 'background' || record?.isBackground === true;

      if (!alreadyBackground) {
        helpers.subagentRegistry.update(parentToolUseId, {
          status: 'background',
          isBackground: true,
          backgroundStartedAt: Date.now(),
        });

        const bgEvent: BackgroundAgentStartedEvent = {
          id: generateEventId(),
          eventType: 'background_agent_started',
          timestamp: Date.now(),
          sessionId: resolvedSession,
          messageId,
          parentToolUseId,
          toolCallId: parentToolUseId,
          agentType: record?.agentType ?? 'unknown',
          agentId: record?.agentId,
          teammateName: record?.teammateName,
          agentDescription: patch.description,
          outputFilePath: record?.outputFilePath,
        };
        events.push(bgEvent);

        helpers.logger.debug(
          '[SdkMessageTransformer] task_updated → background_agent_started (mid-run backgrounding)',
          {
            taskId: msg.task_id,
            toolCallId: parentToolUseId,
            agentId: record?.agentId,
          },
        );
      }
    }

    return events;
  }

  transformTaskNotification(
    msg: SDKTaskNotificationMessage,
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    const parentToolUseId =
      msg.tool_use_id ?? state.getTaskParentToolUseId(msg.task_id);

    state.clearTaskParent(msg.task_id);

    if (msg.skip_transcript) {
      return [];
    }

    if (!parentToolUseId) {
      helpers.logger.debug(
        '[SdkMessageTransformer] task_notification: no parentToolUseId, skipping',
        { taskId: msg.task_id, status: msg.status },
      );
      return [];
    }

    const resolvedSession = sessionId ?? (msg.session_id as SessionId);

    const event: AgentCompletedEvent = {
      id: generateEventId(),
      eventType: 'agent_completed',
      timestamp: Date.now(),
      sessionId: resolvedSession,
      messageId: state.getMessageId('') ?? `task_${msg.task_id}`,
      parentToolUseId,
      taskId: msg.task_id,
      status: msg.status,
      summary: msg.summary,
      outputFile: msg.output_file,
      totalTokens: msg.usage?.total_tokens,
      toolUses: msg.usage?.tool_uses,
      durationMs: msg.usage?.duration_ms,
    };

    helpers.logger.debug(
      '[SdkMessageTransformer] task_notification → agent_completed',
      { taskId: msg.task_id, status: msg.status },
    );

    return [event];
  }
}
