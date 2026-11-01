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
  BackgroundAgentCompletedEvent,
  BackgroundAgentStoppedEvent,
  BackgroundTasksSnapshotEvent,
  ToolResultEvent,
  SessionId,
  isAgentTaskType,
} from '@ptah-extension/shared';

import type {
  SDKMessage,
  SDKTaskStartedMessage,
  SDKTaskProgressMessage,
  SDKTaskUpdatedMessage,
  SDKTaskNotificationMessage,
  SDKBackgroundTasksChangedMessage,
} from '../types/sdk-types/claude-sdk.types';
import { generateEventId } from './message-transform-helpers';
import { toTurnStateEvent } from '../helpers/session-turn-state.registry';
import type {
  BackgroundAnnounceOrigin,
  TransformerState,
  TransformerSessionId,
} from './transformer-state';
import type { TransformerHelpers } from './transformer-helpers';

export class SystemMessageTransformer {
  transformBackgroundTasksChanged(
    msg: SDKBackgroundTasksChangedMessage,
    state: TransformerState,
    sessionId?: TransformerSessionId,
  ): BackgroundTasksSnapshotEvent[] {
    const owner = sessionId || msg.session_id;
    if (!owner) return [];
    const tasks = msg.tasks.filter((task) => task.ambient !== true);
    state.retainBackgroundTaskCommands(
      owner,
      tasks.map((task) => task.task_id),
    );
    const snapshot: BackgroundTasksSnapshotEvent = {
      id: generateEventId(),
      eventType: 'background_tasks_snapshot',
      messageId: `background-tasks-${owner}`,
      timestamp: Date.now(),
      sessionId: owner,
      tasks: tasks.map((task) => {
        const command = state.getBackgroundTaskCommand(owner, task.task_id);
        return {
          taskId: task.task_id,
          taskType: task.task_type,
          description: task.description,
          ...(command !== undefined ? { command } : {}),
          status: 'running' as const,
        };
      }),
    };
    state.cacheBackgroundTasksSnapshot(snapshot);
    return [snapshot];
  }

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

    // Order matters and used to be wrong. `activeIds[0]` is just the
    // most-recently-active session in the process — it sat AHEAD of the id the
    // SDK put on this very message, so with two live sessions the prune and the
    // token-snapshot clear below ran against the other one, and the
    // compaction_complete event was addressed to it too (TASK_2026_295).
    // The caller's id still wins: for harness and wizard streams it is a
    // HarnessStreamId / WizardPhaseId, i.e. the routing key the frontend
    // subscribed with, which no SDK payload carries.
    const activeIds = helpers.sessionLifecycle.getActiveSessionIds();
    const resolvedSessionId =
      sessionId ||
      (sdkMessage.session_id as SessionId | undefined) ||
      activeIds[0];

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
    helpers.compactionBoundaryRegistry.recordExpectedBoundary(
      resolvedSessionId,
      (sdkMessage as SDKMessage & { uuid?: string }).uuid,
    );

    const id = generateEventId();
    const uuid = (sdkMessage as SDKMessage & { uuid?: string }).uuid;
    const boundaryId = typeof uuid === 'string' && uuid.length > 0 ? uuid : id;
    const { pre_tokens: preTokens, post_tokens: postTokens } =
      sdkMessage.compact_metadata;
    const measurement =
      typeof preTokens === 'number' &&
      Number.isFinite(preTokens) &&
      preTokens >= 0 &&
      typeof postTokens === 'number' &&
      Number.isFinite(postTokens) &&
      postTokens >= 0
        ? {
            source: 'sdk-compact-metadata' as const,
            boundaryId,
            preTokens,
            postTokens,
          }
        : undefined;
    const idleCompaction = helpers.sessionLifecycle.idleCompactionNoticeFor?.(
      (sdkMessage.session_id ?? resolvedSessionId) as SessionId,
    );
    const compactionCompleteEvent: CompactionCompleteEvent = {
      id,
      boundaryId,
      ...(measurement && { measurement }),
      ...(idleCompaction && { idleCompaction }),
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
    // `||` not `??`: an empty `session_id` on the payload is not an id, and the
    // trailing `undefined` keeps it from becoming one. Local command output is
    // still worth emitting unattributed — it is the user's own `/command`
    // echo, and dropping it would lose visible transcript content.
    const resolvedSessionId = sessionId || sdkMessage.session_id || undefined;

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

    // A background Bash command arrives on the very same task lifecycle as a
    // subagent, tagged `task_type: 'local_bash'` and parented to the Bash
    // tool_use id. Left alone it becomes an agent_start, which the execution
    // tree nests as a subagent bubble under the Bash node and the monitor
    // store files as a live agent. Reject it here and mark the task so the
    // rest of its lifecycle is rejected too — none of the bookkeeping below
    // (task parent link, subagent registry) applies to a shell command.
    if (!isAgentTaskType(msg.task_type)) {
      state.markNonAgentTask(
        msg.task_id,
        toolUseId,
        sessionId || msg.session_id,
      );
      helpers.logger.debug(
        '[SdkMessageTransformer] task_started with non-agent task_type — skipping AgentStartEvent',
        { taskId: msg.task_id, taskType: msg.task_type, toolUseId },
      );
      return [];
    }

    if (toolUseId) {
      state.setTaskParent(msg.task_id, toolUseId);
      helpers.subagentRegistry.setTaskId(toolUseId, msg.task_id);

      // A `local_workflow` task_started is the root of a workflow run: its
      // tool_use_id is the `Workflow` tool_use id and it carries the
      // workflow_name. Register (or merge the name into) the run root so this
      // event and every descendant agent share the same workflowRunId.
      if (msg.task_type === 'local_workflow') {
        state.registerWorkflowRunRoot(toolUseId, msg.workflow_name);
      }
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

    // `sessionId` already IS `callerSessionId || msg.session_id || undefined` —
    // `SdkMessageTransformer.transform` resolves it off this same object before
    // dispatching here. The old `?? (msg.session_id as SessionId)` was not just
    // redundant, it was harmful: `??` treats `''` as present, so an empty
    // payload `session_id` that the dispatcher had correctly rejected got pulled
    // straight back in as a fake id.
    const resolvedSession = sessionId;
    const messageId = state.getMessageId('') ?? `task_${msg.task_id}`;

    // A task registered in the background from the start never gets a
    // task_updated is_backgrounded patch, so announce it here or the
    // background tray never learns about it.
    const announceIfBackgrounded = (
      origin: BackgroundAnnounceOrigin,
    ): BackgroundAgentStartedEvent | null =>
      msg.is_backgrounded === true
        ? this.announceBackgrounded({
            state,
            toolUseId,
            taskId: msg.task_id,
            description: msg.description,
            fallbackAgentType: msg.subagent_type,
            sessionId: resolvedSession,
            messageId,
            helpers,
            origin,
          })
        : null;

    // The assistant transformer already emitted agent_start from the Task
    // tool_use, so only the background announcement can still be new here.
    // The SDK backgrounds a Task by default and then OMITS
    // `run_in_background` from the tool input, so the tool_use alone did not
    // classify it; `is_backgrounded` here is the only signal. Two cases stay
    // silent so each agent gets exactly one started event:
    //  - an explicit `run_in_background: true` spawn whose placeholder
    //    tool_result has not arrived yet — that tool_result announces it
    //    (with the agentId and output file the placeholder carries);
    //  - a task already announced (placeholder first, or a repeat) —
    //    `announceBackgrounded` dedups on the stream mark and the registry.
    // The origin is `task_tool`: the registry record shares this tool_use
    // id, so the SubagentStop path ends the tray entry and the transformer
    // must not emit a second terminal event.
    if (state.isTaskStartedEmitted(toolUseId)) {
      if (state.hasBackgroundTaskToolUseId(toolUseId)) {
        return [];
      }
      const bgEvent = announceIfBackgrounded('task_tool');
      return bgEvent ? [bgEvent] : [];
    }
    state.markTaskStartedEmitted(toolUseId);

    const workflowRun = state.getWorkflowRun(toolUseId);
    const record = helpers.subagentRegistry.get(toolUseId);

    const event: AgentStartEvent = {
      id: generateEventId(),
      eventType: 'agent_start',
      timestamp: Date.now(),
      sessionId: resolvedSession,
      messageId,
      parentToolUseId: toolUseId,
      toolCallId: toolUseId,
      // `task_type` is the SDK task category (`local_agent`), not the agent's
      // name. When task_started beats the Task tool_use, this event is the
      // only agent_start, so the spawned `subagent_type` must win here.
      agentType:
        msg.subagent_type || record?.agentType || msg.task_type || 'Task',
      agentDescription: msg.description,
      agentPrompt: msg.prompt,
      // Usually still undefined here — the SubagentStart hook that mints the
      // id tends to fire after task_started. The later lifecycle events carry
      // it once the registry has it (see AgentProgressEvent.agentId).
      agentId: record?.agentId,
      teammateName:
        record?.teammateName ??
        helpers.subagentRegistry.peekPendingTeammateName(toolUseId),
      taskId: msg.task_id,
      workflowRunId: workflowRun?.runId,
      workflowName: workflowRun?.name,
    };

    helpers.logger.debug('[SdkMessageTransformer] task_started → agent_start', {
      taskId: msg.task_id,
      toolUseId,
    });

    // No Task tool_use preceded this — notably a subagent resumed via
    // SendMessage, which the SDK always backgrounds. Its registry record is
    // keyed by another tool_use id, so the transformer owns its terminal
    // event (origin `task_started`, see `takeBackgroundTerminalEvent`).
    const bgEvent = announceIfBackgrounded('task_started');
    return bgEvent ? [event, bgEvent] : [event];
  }

  transformTaskProgress(
    msg: SDKTaskProgressMessage,
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    if (state.isNonAgentTask(msg.task_id)) {
      return [];
    }

    const parentToolUseId =
      msg.tool_use_id ?? state.getTaskParentToolUseId(msg.task_id);

    if (!parentToolUseId) {
      helpers.logger.debug(
        '[SdkMessageTransformer] task_progress: no parentToolUseId, skipping',
        { taskId: msg.task_id },
      );
      return [];
    }

    // `sessionId` already IS `callerSessionId || msg.session_id || undefined` —
    // `SdkMessageTransformer.transform` resolves it off this same object before
    // dispatching here. The old `?? (msg.session_id as SessionId)` was not just
    // redundant, it was harmful: `??` treats `''` as present, so an empty
    // payload `session_id` that the dispatcher had correctly rejected got pulled
    // straight back in as a fake id.
    const resolvedSession = sessionId;
    const workflowRun = state.getWorkflowRun(parentToolUseId);

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
      agentId: helpers.subagentRegistry.get(parentToolUseId)?.agentId,
      workflowRunId: workflowRun?.runId,
      workflowName: workflowRun?.name,
    };

    return [event];
  }

  transformTaskUpdated(
    msg: SDKTaskUpdatedMessage,
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    if (state.isNonAgentTask(msg.task_id)) {
      return [];
    }

    const parentToolUseId = state.getTaskParentToolUseId(msg.task_id);

    if (!parentToolUseId) {
      helpers.logger.debug(
        '[SdkMessageTransformer] task_updated: no parentToolUseId, skipping',
        { taskId: msg.task_id },
      );
      return [];
    }

    const patch = msg.patch;
    // `sessionId` already IS `callerSessionId || msg.session_id || undefined` —
    // `SdkMessageTransformer.transform` resolves it off this same object before
    // dispatching here. The old `?? (msg.session_id as SessionId)` was not just
    // redundant, it was harmful: `??` treats `''` as present, so an empty
    // payload `session_id` that the dispatcher had correctly rejected got pulled
    // straight back in as a fake id.
    const resolvedSession = sessionId;
    const messageId = state.getMessageId('') ?? `task_${msg.task_id}`;
    const workflowRun = state.getWorkflowRun(parentToolUseId);
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
        agentId: helpers.subagentRegistry.get(parentToolUseId)?.agentId,
        workflowRunId: workflowRun?.runId,
        workflowName: workflowRun?.name,
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
      const bgEvent = this.announceBackgrounded({
        state,
        toolUseId: parentToolUseId,
        taskId: msg.task_id,
        description: patch.description,
        sessionId: resolvedSession,
        messageId,
        helpers,
        origin: 'task_updated',
      });
      if (bgEvent) {
        events.push(bgEvent);
      }
    }

    return events;
  }

  /**
   * Build the `background_agent_started` event for a task the SDK reports as
   * backgrounded, and flip its SubagentRecord to background. Dedup is twofold:
   * the registry (the record is already background) and the per-stream
   * `isBackgroundAnnounced` mark. The mark is what covers a subagent resumed
   * via SendMessage — its registry record is keyed by the SubagentStart
   * hook's tool_use id, not the SendMessage tool_use id this announcement
   * carries, so the registry lookup misses and `update()` is a no-op; without
   * the mark, a later task_updated `is_backgrounded` patch would announce it
   * a second time. The mark also records WHICH message announced the task
   * (see `BackgroundAnnounceOrigin`): only a `task_started` announcement
   * earns a transformer-produced terminal event (see
   * `takeBackgroundTerminalEvent`), because a task backgrounded mid-run via
   * `task_updated`, or a Task tool spawn (`task_tool`), has a registry
   * record under the same tool_use id whose SubagentStop path already ends
   * its tray entry.
   * Returns null when either source says already announced.
   */
  private announceBackgrounded(params: {
    state: TransformerState;
    toolUseId: string;
    taskId: string;
    description?: string;
    fallbackAgentType?: string;
    sessionId?: TransformerSessionId;
    messageId: string;
    helpers: TransformerHelpers;
    origin: BackgroundAnnounceOrigin;
  }): BackgroundAgentStartedEvent | null {
    const { toolUseId, state, helpers } = params;
    const record = helpers.subagentRegistry.get(toolUseId);
    if (
      record?.status === 'background' ||
      record?.isBackground === true ||
      state.isBackgroundAnnounced(toolUseId)
    ) {
      return null;
    }
    state.markBackgroundAnnounced(toolUseId, params.origin);

    if (record) {
      helpers.subagentRegistry.update(toolUseId, {
        status: 'background',
        isBackground: true,
        backgroundStartedAt: Date.now(),
      });
    } else {
      // The SubagentStart hook has not registered it yet; let that
      // registration start it as background.
      helpers.subagentRegistry.markPendingBackground(toolUseId);
    }

    helpers.logger.debug(
      `[SdkMessageTransformer] ${params.origin} → background_agent_started`,
      {
        taskId: params.taskId,
        toolCallId: toolUseId,
        agentId: record?.agentId,
      },
    );

    return {
      id: generateEventId(),
      eventType: 'background_agent_started',
      timestamp: Date.now(),
      sessionId: params.sessionId,
      messageId: params.messageId,
      parentToolUseId: toolUseId,
      toolCallId: toolUseId,
      agentType: record?.agentType ?? params.fallbackAgentType ?? 'unknown',
      agentId: record?.agentId,
      teammateName: record?.teammateName,
      agentDescription: params.description,
      outputFilePath: record?.outputFilePath,
    };
  }

  /**
   * Build the terminal `background_agent_*` event for a task THIS transformer
   * announced as background from `task_started` (see `announceBackgrounded`),
   * and clear the announcement so a repeated notification never emits it
   * twice.
   *
   * WHY THE ORIGIN GATE. Only the `task_started` path (a SendMessage-resumed
   * subagent) is here: its started entry was filed under the SendMessage
   * tool_use id with no agentId, so the frontend's other terminal signal —
   * the SubagentStop hook — can never resolve it and the entry would stay
   * `running` forever. A task backgrounded mid-run via `task_updated`, or a
   * Task tool spawn that started in the background (`task_tool`), has a
   * registry record under the same tool_use id and its SubagentStop path
   * already ends the entry, so a second terminal event here would insert a
   * duplicate tray entry — those are left alone, EXCEPT a user stop
   * (`status: 'stopped'`): only this notification reports it, so it emits
   * `background_agent_stopped` addressed by `toolCallId` alone.
   *
   * WHY THE STATUS BRANCH. `task_notification.status` is
   * 'completed' | 'failed' | 'stopped': a stopped task routes to
   * `background_agent_stopped` (the frontend store renders `stopped`, not
   * `completed`), and a failed one carries `status: 'failed'` on the
   * completed event so the tray renders the failure. The `toolCallId` always
   * matches the started event's, which is how the frontend store resolves
   * the entry. Returns null for every task the transformer did not announce,
   * and for a non-`task_started` announcement that did not end `stopped`.
   */
  private takeBackgroundTerminalEvent(
    msg: SDKTaskNotificationMessage,
    parentToolUseId: string,
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): BackgroundAgentCompletedEvent | BackgroundAgentStoppedEvent | null {
    // The task is settled whatever its origin, so drop the mark either way —
    // compaction no longer clears it, and a task_updated mark would leak.
    const origin = state.getBackgroundAnnounceOrigin(parentToolUseId);
    state.clearBackgroundAnnounced(parentToolUseId);
    if (origin === undefined) {
      return null;
    }
    // A user stop (`subagent:stop` → Query.stopTask) is reported ONLY here.
    // The SubagentStop path completes an entry, so without this a stopped
    // `task_updated`/`task_tool` task would end as `completed`.
    if (origin !== 'task_started' && msg.status !== 'stopped') {
      return null;
    }

    const record = helpers.subagentRegistry.get(parentToolUseId);
    // `agentId` is required by both event types; an empty string is the
    // "not known" encoding the frontend store understands — `resolveKey`
    // treats a zero-length id as absent and falls back to `toolCallId`,
    // which is the key the started entry was filed under. A non-
    // `task_started` entry may already have been re-keyed onto its real
    // agentId; `''` still finds it through the store's toolCallId fallback,
    // where a real agentId that misses would insert a duplicate entry.
    const agentId = origin === 'task_started' ? (record?.agentId ?? '') : '';
    const agentType = record?.agentType ?? 'unknown';
    const id = generateEventId();
    const timestamp = Date.now();
    const messageId = state.getMessageId('') ?? `task_${msg.task_id}`;

    if (msg.status === 'stopped') {
      helpers.logger.debug(
        '[SdkMessageTransformer] task_notification → background_agent_stopped',
        { taskId: msg.task_id, toolCallId: parentToolUseId },
      );
      return {
        id,
        eventType: 'background_agent_stopped',
        timestamp,
        sessionId,
        messageId,
        toolCallId: parentToolUseId,
        agentId,
        agentType,
      };
    }

    helpers.logger.debug(
      '[SdkMessageTransformer] task_notification → background_agent_completed',
      { taskId: msg.task_id, toolCallId: parentToolUseId, status: msg.status },
    );
    return {
      id,
      eventType: 'background_agent_completed',
      timestamp,
      sessionId,
      messageId,
      toolCallId: parentToolUseId,
      agentId,
      agentType,
      // Absent for 'completed' (the default); 'failed' renders the entry
      // as failed in the tray instead of completed.
      ...(msg.status === 'failed' && { status: 'failed' as const }),
      result: msg.summary,
      duration: msg.usage?.duration_ms,
    };
  }

  transformTaskNotification(
    msg: SDKTaskNotificationMessage,
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    const events = this.buildAgentCompleted(msg, state, helpers, sessionId);

    // A settled background task changes the turn state whatever kind of task
    // it was (`local_bash` included), so this runs past every early return
    // above. The SubagentStop hook normally wrote the authoritative list
    // moments earlier; this emits it IN the stream, where order is guaranteed.
    // `applySnapshot` never touches 'generating'. No session → not routable.
    if (sessionId) {
      const current = helpers.turnState.get(sessionId)?.backgroundTasks ?? [];
      const remaining = current.filter((task) => task.id !== msg.task_id);
      const next = helpers.turnState.applySnapshot(sessionId, remaining);
      if (next) {
        events.push(toTurnStateEvent(sessionId, next));
      }
    }

    return events;
  }

  private buildAgentCompleted(
    msg: SDKTaskNotificationMessage,
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    const parentToolUseId =
      msg.tool_use_id ?? state.getTaskParentToolUseId(msg.task_id);

    // Read before clearing — `clearTaskParent` also drops the non-agent mark.
    const isNonAgentTask = state.isNonAgentTask(msg.task_id);

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

    // local_bash tasks never become agent cards, but their terminal task
    // notification must settle the Bash node that launched them.
    if (isNonAgentTask) {
      const event: ToolResultEvent = {
        id: generateEventId(),
        eventType: 'tool_result',
        timestamp: Date.now(),
        sessionId,
        messageId: state.getMessageId('') ?? `task_${msg.task_id}`,
        toolCallId: parentToolUseId,
        output: { summary: msg.summary, outputFile: msg.output_file },
        isError: msg.status !== 'completed',
      };
      return [event];
    }

    // `sessionId` already IS `callerSessionId || msg.session_id || undefined` —
    // `SdkMessageTransformer.transform` resolves it off this same object before
    // dispatching here. The old `?? (msg.session_id as SessionId)` was not just
    // redundant, it was harmful: `??` treats `''` as present, so an empty
    // payload `session_id` that the dispatcher had correctly rejected got pulled
    // straight back in as a fake id.
    const resolvedSession = sessionId;
    const workflowRun = state.getWorkflowRun(parentToolUseId);

    const event: AgentCompletedEvent = {
      id: generateEventId(),
      eventType: 'agent_completed',
      timestamp: Date.now(),
      sessionId: resolvedSession,
      messageId: state.getMessageId('') ?? `task_${msg.task_id}`,
      parentToolUseId,
      taskId: msg.task_id,
      status: msg.status,
      summary:
        msg.status === 'stopped'
          ? (helpers.stopNotices.noticeFor(msg.task_id) ?? msg.summary)
          : msg.summary,
      outputFile: msg.output_file,
      totalTokens: msg.usage?.total_tokens,
      toolUses: msg.usage?.tool_uses,
      durationMs: msg.usage?.duration_ms,
      agentId: helpers.subagentRegistry.get(parentToolUseId)?.agentId,
      workflowRunId: workflowRun?.runId,
      workflowName: workflowRun?.name,
    };

    // The announcement mark is this transformer's own — a task it never
    // announced as background at task_started (SubagentStop-hooked spawn,
    // non-agent task, mid-run task_updated backgrounding) is untouched by
    // this call.
    const backgroundTerminal = this.takeBackgroundTerminalEvent(
      msg,
      parentToolUseId,
      state,
      helpers,
      resolvedSession,
    );

    helpers.logger.debug(
      '[SdkMessageTransformer] task_notification → agent_completed',
      { taskId: msg.task_id, status: msg.status },
    );

    return backgroundTerminal ? [event, backgroundTerminal] : [event];
  }
}
