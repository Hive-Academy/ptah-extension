import 'reflect-metadata';
import { SystemMessageTransformer } from './system-message.transformer';
import type { TransformerState } from './transformer-state';
import type { TransformerHelpers } from './transformer-helpers';

function makeState(): jest.Mocked<TransformerState> {
  return {
    getMessageId: jest.fn().mockReturnValue(undefined),
    getCurrentModel: jest.fn().mockReturnValue(undefined),
    getToolCallId: jest.fn().mockReturnValue(undefined),
    hasBackgroundTaskToolUseId: jest.fn().mockReturnValue(false),
    getBackgroundTaskInfo: jest.fn().mockReturnValue(undefined),
    getTaskParentToolUseId: jest.fn().mockReturnValue(undefined),
    isTaskStartedEmitted: jest.fn().mockReturnValue(false),
    isNonAgentTask: jest.fn().mockReturnValue(false),
    hasActiveSkillToolUseId: jest.fn().mockReturnValue(false),
    activeSkillToolUseIdsCount: jest.fn().mockReturnValue(0),
    snapshotActiveSkillToolUseIds: jest.fn().mockReturnValue([]),
    getWorkflowRun: jest.fn().mockReturnValue(undefined),
    registerWorkflowRunRoot: jest.fn(),
    associateWorkflowRunChild: jest.fn(),
    setMessageId: jest.fn(),
    clearMessageId: jest.fn(),
    setCurrentModel: jest.fn(),
    clearCurrentModel: jest.fn(),
    setToolCallId: jest.fn(),
    clearToolCallIdsForContext: jest.fn(),
    addBackgroundTaskToolUseId: jest.fn(),
    removeBackgroundTaskToolUseId: jest.fn(),
    setTaskParent: jest.fn(),
    clearTaskParent: jest.fn(),
    markTaskStartedEmitted: jest.fn(),
    markNonAgentTask: jest.fn(),
    addActiveSkillToolUseId: jest.fn(),
    clearActiveSkillToolUseIds: jest.fn(),
    clearStreamingState: jest.fn(),
  } as jest.Mocked<TransformerState>;
}

function makeHelpers(
  activeIds: string[] = [],
): jest.Mocked<TransformerHelpers> {
  return {
    logger: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    subagentRegistry: {
      markPendingBackground: jest.fn(),
      setTaskId: jest.fn(),
      pruneSession: jest.fn(),
      get: jest.fn().mockReturnValue(null),
      peekPendingTeammateName: jest.fn().mockReturnValue(undefined),
      update: jest.fn(),
    },
    modelResolver: { resolveForPricing: jest.fn() },
    sessionLifecycle: {
      getActiveSessionIds: jest.fn().mockReturnValue(activeIds),
    },
    usageTracker: {
      recordSessionUsage: jest.fn(),
      getCumulativeTokens: jest.fn().mockReturnValue(0),
      clearSessionTokenSnapshot: jest.fn(),
    },
    turnState: {
      markGenerating: jest.fn().mockReturnValue(null),
      settleTurn: jest.fn(),
      applySnapshot: jest.fn().mockReturnValue(null),
      get: jest.fn().mockReturnValue(undefined),
    },
  } as unknown as jest.Mocked<TransformerHelpers>;
}

describe('SystemMessageTransformer', () => {
  let transformer: SystemMessageTransformer;
  let state: jest.Mocked<TransformerState>;

  beforeEach(() => {
    transformer = new SystemMessageTransformer();
    state = makeState();
  });

  describe('compact_boundary', () => {
    it('emits compaction_complete with sessionId resolved from active lifecycle ids', () => {
      const helpers = makeHelpers(['active-sess']);
      const msg = {
        compact_metadata: { trigger: 'auto' as const, pre_tokens: 100 },
      } as never;
      const events = transformer.transformCompactBoundary(msg, state, helpers);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('compaction_complete');
      expect(state.clearStreamingState).toHaveBeenCalled();
      expect(helpers.subagentRegistry.pruneSession).toHaveBeenCalledWith(
        'active-sess',
      );
      expect(
        helpers.usageTracker.clearSessionTokenSnapshot,
      ).toHaveBeenCalledWith('active-sess');
    });

    // TASK_2026_295: `sessionId || activeIds[0] || sdkMessage.session_id` put
    // the most-recently-active session AHEAD of the id the SDK stamped on this
    // very message. With two live sessions, pruneSession and
    // clearSessionTokenSnapshot ran against the wrong one and the
    // compaction_complete event was addressed to it too.
    it('prefers the SDK message session_id over the most-recently-active session', () => {
      const helpers = makeHelpers(['some-other-active-sess']);
      const msg = {
        compact_metadata: { trigger: 'auto' as const, pre_tokens: 100 },
        session_id: 'authoritative-sess',
      } as never;

      const events = transformer.transformCompactBoundary(msg, state, helpers);

      expect(events).toHaveLength(1);
      expect((events[0] as { sessionId: string }).sessionId).toBe(
        'authoritative-sess',
      );
      expect(helpers.subagentRegistry.pruneSession).toHaveBeenCalledWith(
        'authoritative-sess',
      );
      expect(
        helpers.usageTracker.clearSessionTokenSnapshot,
      ).toHaveBeenCalledWith('authoritative-sess');
      expect(helpers.subagentRegistry.pruneSession).not.toHaveBeenCalledWith(
        'some-other-active-sess',
      );
    });

    it('still lets the caller id win — it is the routing key for harness and wizard streams', () => {
      const helpers = makeHelpers(['some-other-active-sess']);
      const msg = {
        compact_metadata: { trigger: 'auto' as const, pre_tokens: 100 },
        session_id: 'authoritative-sess',
      } as never;

      const events = transformer.transformCompactBoundary(
        msg,
        state,
        helpers,
        'harness-stream-1' as never,
      );

      expect((events[0] as { sessionId: string }).sessionId).toBe(
        'harness-stream-1',
      );
    });

    it('skips emission and warns when no sessionId can be resolved', () => {
      const helpers = makeHelpers([]);
      const msg = {
        compact_metadata: { trigger: 'auto' as const, pre_tokens: 0 },
      } as never;
      const events = transformer.transformCompactBoundary(msg, state, helpers);
      expect(events).toEqual([]);
      expect(helpers.logger.warn).toHaveBeenCalled();
    });
  });

  describe('local_command_output', () => {
    it('emits message_start + text_delta + message_complete with content', () => {
      const helpers = makeHelpers();
      const msg = { content: 'output text', session_id: 'sess-x' } as never;
      const events = transformer.transformLocalCommandOutput(
        msg,
        helpers,
        undefined,
      );
      expect(events.map((e) => e.eventType)).toEqual([
        'message_start',
        'text_delta',
        'message_complete',
      ]);
      expect((events[1] as { delta: string }).delta).toBe('output text');
    });
  });

  describe('task_started', () => {
    it('registers the task→tool mapping and forwards to subagent registry', () => {
      const helpers = makeHelpers();
      const msg = {
        task_id: 'task-1',
        tool_use_id: 'tool-1',
        skip_transcript: false,
        task_type: 'Task',
        session_id: 'sess',
      } as never;
      transformer.transformTaskStarted(msg, state, helpers, 'sess' as never);
      expect(state.setTaskParent).toHaveBeenCalledWith('task-1', 'tool-1');
      expect(helpers.subagentRegistry.setTaskId).toHaveBeenCalledWith(
        'tool-1',
        'task-1',
      );
      expect(state.markTaskStartedEmitted).toHaveBeenCalledWith('tool-1');
    });

    it('does not emit when task_started has no tool_use_id', () => {
      const helpers = makeHelpers();
      const msg = {
        task_id: 'task-2',
        skip_transcript: false,
        task_type: 'Task',
      } as never;
      const events = transformer.transformTaskStarted(msg, state, helpers);
      expect(events).toEqual([]);
      expect(helpers.subagentRegistry.setTaskId).not.toHaveBeenCalled();
    });

    it('dedupes when state.isTaskStartedEmitted is true', () => {
      state.isTaskStartedEmitted.mockReturnValue(true);
      const helpers = makeHelpers();
      const msg = {
        task_id: 'task-3',
        tool_use_id: 'tool-3',
        skip_transcript: false,
      } as never;
      const events = transformer.transformTaskStarted(msg, state, helpers);
      expect(events).toEqual([]);
      expect(state.markTaskStartedEmitted).not.toHaveBeenCalled();
    });

    it('rejects a local_bash task_started: no agent_start, no bookkeeping, task marked', () => {
      const helpers = makeHelpers();
      const msg = {
        task_id: 'task-bash',
        tool_use_id: 'toolu_bash',
        skip_transcript: false,
        task_type: 'local_bash',
        description: 'Create Nx React+Vite workspace in temp dir',
        session_id: 'sess',
      } as never;

      const events = transformer.transformTaskStarted(
        msg,
        state,
        helpers,
        'sess' as never,
      );

      expect(events).toEqual([]);
      expect(state.markNonAgentTask).toHaveBeenCalledWith('task-bash');
      expect(state.setTaskParent).not.toHaveBeenCalled();
      expect(helpers.subagentRegistry.setTaskId).not.toHaveBeenCalled();
      expect(state.markTaskStartedEmitted).not.toHaveBeenCalled();
    });

    it('still emits agent_start for an unknown task_type (denylist, not allowlist)', () => {
      const helpers = makeHelpers();
      const msg = {
        task_id: 'task-new',
        tool_use_id: 'toolu_new',
        skip_transcript: false,
        task_type: 'some_future_agent_flavour',
        session_id: 'sess',
      } as never;

      const events = transformer.transformTaskStarted(
        msg,
        state,
        helpers,
        'sess' as never,
      );

      expect(events.map((e) => e.eventType)).toEqual(['agent_start']);
      expect(state.markNonAgentTask).not.toHaveBeenCalled();
    });

    it('populates teammateName from a registered record', () => {
      const helpers = makeHelpers();
      (helpers.subagentRegistry.get as jest.Mock).mockReturnValue({
        teammateName: 'backend-developer',
      });
      const msg = {
        task_id: 'task-4',
        tool_use_id: 'tool-4',
        skip_transcript: false,
        task_type: 'Task',
      } as never;
      const [event] = transformer.transformTaskStarted(
        msg,
        state,
        helpers,
        'sess' as never,
      );
      expect(event).toMatchObject({
        eventType: 'agent_start',
        teammateName: 'backend-developer',
      });
    });

    it('registers a workflow run root and stamps workflowRunId/workflowName for task_type=local_workflow', () => {
      const helpers = makeHelpers();
      // Simulate registerWorkflowRunRoot populating the run lookup.
      state.getWorkflowRun.mockReturnValue({ runId: 'wf-tool', name: 'spec' });
      const msg = {
        task_id: 'task-wf',
        tool_use_id: 'wf-tool',
        skip_transcript: false,
        task_type: 'local_workflow',
        workflow_name: 'spec',
      } as never;

      const [event] = transformer.transformTaskStarted(
        msg,
        state,
        helpers,
        'sess' as never,
      );

      expect(state.registerWorkflowRunRoot).toHaveBeenCalledWith(
        'wf-tool',
        'spec',
      );
      expect(event).toMatchObject({
        eventType: 'agent_start',
        workflowRunId: 'wf-tool',
        workflowName: 'spec',
      });
    });

    it('a descendant task_started inherits the workflowRunId already registered for its tool_use id', () => {
      const helpers = makeHelpers();
      state.getWorkflowRun.mockReturnValue({ runId: 'wf-tool', name: 'spec' });
      const msg = {
        task_id: 'task-sub',
        tool_use_id: 'sub-tool',
        skip_transcript: false,
        task_type: 'Task',
      } as never;

      const [event] = transformer.transformTaskStarted(
        msg,
        state,
        helpers,
        'sess' as never,
      );

      // Not a local_workflow root — must NOT re-register a root.
      expect(state.registerWorkflowRunRoot).not.toHaveBeenCalled();
      expect(event).toMatchObject({
        eventType: 'agent_start',
        workflowRunId: 'wf-tool',
        workflowName: 'spec',
      });
    });

    it('leaves workflow fields undefined for a non-workflow task', () => {
      const helpers = makeHelpers();
      state.getWorkflowRun.mockReturnValue(undefined);
      const msg = {
        task_id: 'task-plain',
        tool_use_id: 'plain-tool',
        skip_transcript: false,
        task_type: 'Task',
      } as never;

      const [event] = transformer.transformTaskStarted(
        msg,
        state,
        helpers,
        'sess' as never,
      );

      expect(
        (event as { workflowRunId?: string }).workflowRunId,
      ).toBeUndefined();
      expect((event as { workflowName?: string }).workflowName).toBeUndefined();
    });

    it('falls back to the non-consuming pending peek when the record is not yet registered', () => {
      const helpers = makeHelpers();
      // record does not exist yet (get → null), but the tool_use `name` was
      // pre-marked before the SubagentStart hook fired.
      (helpers.subagentRegistry.get as jest.Mock).mockReturnValue(null);
      (
        helpers.subagentRegistry.peekPendingTeammateName as jest.Mock
      ).mockReturnValue('reviewer');
      const msg = {
        task_id: 'task-5',
        tool_use_id: 'tool-5',
        skip_transcript: false,
        task_type: 'Task',
      } as never;
      const [event] = transformer.transformTaskStarted(
        msg,
        state,
        helpers,
        'sess' as never,
      );
      expect(event).toMatchObject({
        eventType: 'agent_start',
        teammateName: 'reviewer',
      });
      expect(
        helpers.subagentRegistry.peekPendingTeammateName,
      ).toHaveBeenCalledWith('tool-5');
    });
  });

  describe('task_progress', () => {
    it('emits agent_progress when parentToolUseId is resolvable', () => {
      state.getTaskParentToolUseId.mockReturnValue('tool-progress');
      const helpers = makeHelpers();
      const msg = {
        task_id: 'task-p',
        description: 'desc',
        summary: 'sum',
        last_tool_name: 'Bash',
        usage: { total_tokens: 10, tool_uses: 2, duration_ms: 100 },
      } as never;
      const events = transformer.transformTaskProgress(
        msg,
        state,
        helpers,
        'sess' as never,
      );
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('agent_progress');
    });

    it('carries the registry agentId once the SubagentStart hook has minted it', () => {
      state.getTaskParentToolUseId.mockReturnValue('tool-progress');
      const helpers = makeHelpers();
      (helpers.subagentRegistry.get as jest.Mock).mockReturnValue({
        toolCallId: 'tool-progress',
        agentId: 'a01fea2eb1b977576',
      });
      const msg = {
        task_id: 'task-p',
        description: 'desc',
        usage: { total_tokens: 10, tool_uses: 2, duration_ms: 100 },
      } as never;

      const [event] = transformer.transformTaskProgress(
        msg,
        state,
        helpers,
        'sess' as never,
      );

      expect(helpers.subagentRegistry.get).toHaveBeenCalledWith(
        'tool-progress',
      );
      expect(event).toMatchObject({
        eventType: 'agent_progress',
        agentId: 'a01fea2eb1b977576',
      });
    });

    it('returns [] when no parent tool use id', () => {
      const helpers = makeHelpers();
      const msg = {
        task_id: 'task-p2',
        usage: { total_tokens: 0, tool_uses: 0, duration_ms: 0 },
      } as never;
      expect(transformer.transformTaskProgress(msg, state, helpers)).toEqual(
        [],
      );
    });

    it('returns [] for a task marked non-agent, even with a tool_use_id on the payload', () => {
      state.isNonAgentTask.mockReturnValue(true);
      const helpers = makeHelpers();
      const msg = {
        task_id: 'task-bash',
        tool_use_id: 'toolu_bash',
        description: 'npm run build',
        usage: { total_tokens: 10, tool_uses: 2, duration_ms: 100 },
      } as never;
      expect(transformer.transformTaskProgress(msg, state, helpers)).toEqual(
        [],
      );
    });
  });

  describe('task_updated', () => {
    it('emits agent_status with patch.status', () => {
      state.getTaskParentToolUseId.mockReturnValue('tool-u');
      const helpers = makeHelpers();
      const msg = {
        task_id: 'task-u',
        patch: { status: 'failed', error: 'boom' },
      } as never;
      const events = transformer.transformTaskUpdated(msg, state, helpers);
      expect(events).toHaveLength(1);
      expect((events[0] as { status: string }).status).toBe('failed');
    });

    it('returns [] when patch has no status', () => {
      state.getTaskParentToolUseId.mockReturnValue('tool-u');
      const helpers = makeHelpers();
      const msg = { task_id: 'task-u2', patch: {} } as never;
      expect(transformer.transformTaskUpdated(msg, state, helpers)).toEqual([]);
    });

    it('returns [] for a task marked non-agent — a backgrounded bash must not become a background agent', () => {
      state.isNonAgentTask.mockReturnValue(true);
      state.getTaskParentToolUseId.mockReturnValue('toolu_bash');
      const helpers = makeHelpers();
      const msg = {
        task_id: 'task-bash',
        patch: { status: 'running', is_backgrounded: true },
      } as never;

      expect(transformer.transformTaskUpdated(msg, state, helpers)).toEqual([]);
      expect(helpers.subagentRegistry.update).not.toHaveBeenCalled();
    });

    it('emits both agent_status and background_agent_started when patch.is_backgrounded is true', () => {
      state.getTaskParentToolUseId.mockReturnValue('toolu_bg');
      const helpers = makeHelpers();
      (helpers.subagentRegistry.get as jest.Mock).mockReturnValue({
        toolCallId: 'toolu_bg',
        agentType: 'software-architect',
        agentId: 'a1b2c3d',
        status: 'running',
        outputFilePath: '/tmp/bg.txt',
      });
      const msg = {
        task_id: 'task-bg',
        patch: { status: 'running', is_backgrounded: true },
        session_id: 'sess',
      } as never;

      const events = transformer.transformTaskUpdated(
        msg,
        state,
        helpers,
        'sess' as never,
      );

      expect(events.map((e) => e.eventType)).toEqual([
        'agent_status',
        'background_agent_started',
      ]);
      const bg = events.find(
        (e) => e.eventType === 'background_agent_started',
      ) as { toolCallId: string; agentType: string; agentId?: string };
      expect(bg.toolCallId).toBe('toolu_bg');
      expect(bg.agentType).toBe('software-architect');
      expect(bg.agentId).toBe('a1b2c3d');

      // Registry kept coherent with the run_in_background:true spawn path.
      expect(helpers.subagentRegistry.update).toHaveBeenCalledWith(
        'toolu_bg',
        expect.objectContaining({ status: 'background', isBackground: true }),
      );
    });

    it('emits background_agent_started even when patch has no status change', () => {
      state.getTaskParentToolUseId.mockReturnValue('toolu_bg2');
      const helpers = makeHelpers();
      (helpers.subagentRegistry.get as jest.Mock).mockReturnValue({
        toolCallId: 'toolu_bg2',
        agentType: 'Explore',
        agentId: 'bg99999',
        status: 'running',
      });
      const msg = {
        task_id: 'task-bg2',
        patch: { is_backgrounded: true },
      } as never;

      const events = transformer.transformTaskUpdated(msg, state, helpers);

      expect(events.map((e) => e.eventType)).toEqual([
        'background_agent_started',
      ]);
    });

    it('does not emit a duplicate background_agent_started when the record is already background', () => {
      state.getTaskParentToolUseId.mockReturnValue('toolu_bg3');
      const helpers = makeHelpers();
      (helpers.subagentRegistry.get as jest.Mock).mockReturnValue({
        toolCallId: 'toolu_bg3',
        agentType: 'Explore',
        agentId: 'bg33333',
        status: 'background',
        isBackground: true,
      });
      const msg = {
        task_id: 'task-bg3',
        patch: { status: 'running', is_backgrounded: true },
      } as never;

      const events = transformer.transformTaskUpdated(msg, state, helpers);

      // Repeat patch: only the status event, no second background_agent_started.
      expect(events.map((e) => e.eventType)).toEqual(['agent_status']);
      expect(helpers.subagentRegistry.update).not.toHaveBeenCalled();
    });

    it('leaves a plain task_updated (no is_backgrounded) unchanged', () => {
      state.getTaskParentToolUseId.mockReturnValue('tool-u');
      const helpers = makeHelpers();
      const msg = {
        task_id: 'task-plain',
        patch: { status: 'running' },
      } as never;

      const events = transformer.transformTaskUpdated(msg, state, helpers);

      expect(events.map((e) => e.eventType)).toEqual(['agent_status']);
      // A read-only registry lookup (for the agentId) is fine; what must not
      // happen without `is_backgrounded` is the background status WRITE.
      expect(helpers.subagentRegistry.update).not.toHaveBeenCalled();
    });
  });

  describe('task_notification', () => {
    it('cleans up taskId mapping and emits agent_completed', () => {
      state.getTaskParentToolUseId.mockReturnValue('tool-n');
      const helpers = makeHelpers();
      const msg = {
        task_id: 'task-n',
        status: 'success',
        summary: 'done',
        output_file: '/tmp/x',
        usage: { total_tokens: 1, tool_uses: 0, duration_ms: 1 },
      } as never;
      const events = transformer.transformTaskNotification(msg, state, helpers);
      expect(state.clearTaskParent).toHaveBeenCalledWith('task-n');
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('agent_completed');
    });

    it('still cleans up taskId mapping when skip_transcript=true and emits nothing', () => {
      state.getTaskParentToolUseId.mockReturnValue('tool-skip');
      const helpers = makeHelpers();
      const msg = {
        task_id: 'task-skip',
        status: 'success',
        skip_transcript: true,
      } as never;
      const events = transformer.transformTaskNotification(msg, state, helpers);
      expect(state.clearTaskParent).toHaveBeenCalledWith('task-skip');
      expect(events).toEqual([]);
    });

    it('emits nothing for a task marked non-agent, and still clears the mapping', () => {
      state.isNonAgentTask.mockReturnValue(true);
      const helpers = makeHelpers();
      const msg = {
        task_id: 'task-bash',
        tool_use_id: 'toolu_bash',
        status: 'success',
        usage: { total_tokens: 1, tool_uses: 0, duration_ms: 1 },
      } as never;

      const events = transformer.transformTaskNotification(msg, state, helpers);

      expect(events).toEqual([]);
      expect(state.clearTaskParent).toHaveBeenCalledWith('task-bash');
    });
  });
});

describe('SystemMessageTransformer - task_notification turn_state (TASK_2026_360)', () => {
  const T1 = {
    id: 'task-n',
    type: 'subagent',
    status: 'running',
    description: 'a',
  };
  const T2 = {
    id: 'task-other',
    type: 'subagent',
    status: 'running',
    description: 'b',
  };
  const AWAITING = {
    phase: 'awaiting-background',
    revision: 2,
    backgroundTasks: [T1, T2],
    sessionCrons: [],
    terminalReason: 'completed',
    timestamp: 1,
  };
  const NEXT = { ...AWAITING, revision: 3, backgroundTasks: [T2] };

  it('applies the remaining tasks (current minus the settled task_id) and APPENDS the turn_state', () => {
    const transformer = new SystemMessageTransformer();
    const state = makeState();
    state.getTaskParentToolUseId.mockReturnValue('tool-n');
    const helpers = makeHelpers();
    (helpers.turnState.get as jest.Mock).mockReturnValue(AWAITING);
    (helpers.turnState.applySnapshot as jest.Mock).mockReturnValue(NEXT);

    const events = transformer.transformTaskNotification(
      { task_id: 'task-n', status: 'success' } as never,
      state,
      helpers,
      'sess-1' as never,
    );

    expect(events.map((e) => e.eventType)).toEqual([
      'agent_completed',
      'turn_state',
    ]);
    expect(helpers.turnState.applySnapshot).toHaveBeenCalledWith('sess-1', [
      T2,
    ]);
    expect(events[1]).toMatchObject({
      phase: 'awaiting-background',
      revision: 3,
    });
  });

  it('still emits the turn_state for a non-agent (local_bash) task that emits no agent_completed', () => {
    const transformer = new SystemMessageTransformer();
    const state = makeState();
    state.isNonAgentTask.mockReturnValue(true);
    const helpers = makeHelpers();
    (helpers.turnState.get as jest.Mock).mockReturnValue(AWAITING);
    (helpers.turnState.applySnapshot as jest.Mock).mockReturnValue(NEXT);

    const events = transformer.transformTaskNotification(
      {
        task_id: 'task-n',
        tool_use_id: 'toolu_bash',
        status: 'success',
      } as never,
      state,
      helpers,
      'sess-1' as never,
    );

    expect(events.map((e) => e.eventType)).toEqual(['turn_state']);
  });

  it('emits no turn_state while generating (applySnapshot returns null)', () => {
    const transformer = new SystemMessageTransformer();
    const state = makeState();
    state.getTaskParentToolUseId.mockReturnValue('tool-n');
    const helpers = makeHelpers();
    (helpers.turnState.get as jest.Mock).mockReturnValue({
      ...AWAITING,
      phase: 'generating',
    });

    const events = transformer.transformTaskNotification(
      { task_id: 'task-n', status: 'success' } as never,
      state,
      helpers,
      'sess-1' as never,
    );

    expect(events.map((e) => e.eventType)).toEqual(['agent_completed']);
  });

  it('skips the registry when the session id is unknown', () => {
    const transformer = new SystemMessageTransformer();
    const state = makeState();
    state.getTaskParentToolUseId.mockReturnValue('tool-n');
    const helpers = makeHelpers();

    transformer.transformTaskNotification(
      { task_id: 'task-n', status: 'success' } as never,
      state,
      helpers,
    );

    expect(helpers.turnState.applySnapshot).not.toHaveBeenCalled();
  });
});
