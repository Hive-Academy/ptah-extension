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
    getTaskParentToolUseId: jest.fn().mockReturnValue(undefined),
    isTaskStartedEmitted: jest.fn().mockReturnValue(false),
    hasActiveSkillToolUseId: jest.fn().mockReturnValue(false),
    activeSkillToolUseIdsCount: jest.fn().mockReturnValue(0),
    snapshotActiveSkillToolUseIds: jest.fn().mockReturnValue([]),
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
  });
});
