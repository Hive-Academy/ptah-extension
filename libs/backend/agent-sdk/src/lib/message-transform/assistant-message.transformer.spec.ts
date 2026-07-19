import 'reflect-metadata';
import { AssistantMessageTransformer } from './assistant-message.transformer';
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
    addActiveSkillToolUseId: jest.fn(),
    clearActiveSkillToolUseIds: jest.fn(),
    clearStreamingState: jest.fn(),
  } as jest.Mocked<TransformerState>;
}

function makeHelpers(): jest.Mocked<TransformerHelpers> {
  return {
    logger: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    subagentRegistry: {
      markPendingBackground: jest.fn(),
      markPendingTeammateName: jest.fn(),
      setTaskId: jest.fn(),
      pruneSession: jest.fn(),
      get: jest.fn().mockReturnValue(undefined),
    },
    modelResolver: {
      resolveForPricing: jest.fn().mockImplementation((m: string) => m),
    },
    sessionLifecycle: {
      getActiveSessionIds: jest.fn().mockReturnValue([]),
    },
    usageTracker: {
      recordSessionUsage: jest.fn(),
      getCumulativeTokens: jest.fn().mockReturnValue(0),
      clearSessionTokenSnapshot: jest.fn(),
    },
  } as unknown as jest.Mocked<TransformerHelpers>;
}

describe('AssistantMessageTransformer', () => {
  let transformer: AssistantMessageTransformer;
  let state: jest.Mocked<TransformerState>;
  let helpers: jest.Mocked<TransformerHelpers>;

  beforeEach(() => {
    transformer = new AssistantMessageTransformer();
    state = makeState();
    helpers = makeHelpers();
  });

  it('emits message_start + text_delta + message_complete for a text-only message', () => {
    const msg = {
      uuid: 'u-1',
      message: {
        id: 'm-1',
        model: 'claude-opus',
        content: [{ type: 'text', text: 'hello' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      },
    } as never;

    const events = transformer.transform(
      msg,
      state,
      helpers,
      'sess-1' as never,
    );

    const kinds = events.map((e) => e.eventType);
    expect(kinds).toEqual(['message_start', 'text_delta', 'message_complete']);
    expect((events[1] as { delta: string }).delta).toBe('hello');
    expect((events[2] as { model?: string }).model).toBe('claude-opus');
  });

  it('skips a message whose only content is the SDK interrupt sentinel', () => {
    const msg = {
      uuid: 'u-int',
      message: {
        id: 'm-int',
        model: 'claude-opus',
        content: [{ type: 'text', text: '[Request interrupted by user]' }],
      },
    } as never;

    const events = transformer.transform(
      msg,
      state,
      helpers,
      'sess-int' as never,
    );

    expect(events).toEqual([]);
  });

  it('marks background Task tools through the state mutator and registry', () => {
    const msg = {
      uuid: 'u-2',
      message: {
        id: 'm-2',
        model: 'claude-opus',
        content: [
          {
            type: 'tool_use',
            id: 'tool-bg-1',
            name: 'Task',
            input: {
              subagent_type: 'worker',
              description: 'desc',
              prompt: 'go',
              run_in_background: true,
            },
          },
        ],
      },
    } as never;

    transformer.transform(msg, state, helpers, 'sess-2' as never);

    expect(state.addBackgroundTaskToolUseId).toHaveBeenCalledWith('tool-bg-1');
    expect(helpers.subagentRegistry.markPendingBackground).toHaveBeenCalledWith(
      'tool-bg-1',
    );
  });

  // TASK: teammates phase 1 (6c4733a02) — capture-side of AgentInput.name.
  // The transformer observes `name` on a Task tool_use input BEFORE the
  // SubagentStart hook fires and hands it to the registry as a "pending"
  // name, keyed by the tool_use id (block.id).
  it('captures AgentInput.name off a Task tool_use into markPendingTeammateName', () => {
    const msg = {
      uuid: 'u-name-1',
      message: {
        id: 'm-name-1',
        model: 'claude-opus',
        content: [
          {
            type: 'tool_use',
            id: 'tool-name-1',
            name: 'Task',
            input: {
              subagent_type: 'backend-developer',
              description: 'desc',
              prompt: 'go',
              name: 'backend-developer',
            },
          },
        ],
      },
    } as never;

    transformer.transform(msg, state, helpers, 'sess-name-1' as never);

    expect(
      helpers.subagentRegistry.markPendingTeammateName,
    ).toHaveBeenCalledWith('tool-name-1', 'backend-developer');
  });

  it('carries teammateName on the emitted agent_start event', () => {
    const msg = {
      uuid: 'u-name-start',
      message: {
        id: 'm-name-start',
        model: 'claude-opus',
        content: [
          {
            type: 'tool_use',
            id: 'tool-name-start',
            name: 'Task',
            input: {
              subagent_type: 'backend-developer',
              description: 'desc',
              prompt: 'go',
              name: 'backend-developer',
            },
          },
        ],
      },
    } as never;

    const events = transformer.transform(
      msg,
      state,
      helpers,
      'sess-name-start' as never,
    );

    const agentStart = events.find((e) => e.eventType === 'agent_start');
    expect(agentStart).toMatchObject({ teammateName: 'backend-developer' });
  });

  it('trims whitespace off AgentInput.name before capturing it', () => {
    const msg = {
      uuid: 'u-name-2',
      message: {
        id: 'm-name-2',
        model: 'claude-opus',
        content: [
          {
            type: 'tool_use',
            id: 'tool-name-2',
            name: 'Task',
            input: {
              description: 'desc',
              prompt: 'go',
              name: '  reviewer  ',
            },
          },
        ],
      },
    } as never;

    transformer.transform(msg, state, helpers, 'sess-name-2' as never);

    expect(
      helpers.subagentRegistry.markPendingTeammateName,
    ).toHaveBeenCalledWith('tool-name-2', 'reviewer');
  });

  it('does not capture a teammate name when input.name is absent', () => {
    const msg = {
      uuid: 'u-name-3',
      message: {
        id: 'm-name-3',
        model: 'claude-opus',
        content: [
          {
            type: 'tool_use',
            id: 'tool-name-3',
            name: 'Task',
            input: { description: 'desc', prompt: 'go' },
          },
        ],
      },
    } as never;

    transformer.transform(msg, state, helpers, 'sess-name-3' as never);

    expect(
      helpers.subagentRegistry.markPendingTeammateName,
    ).not.toHaveBeenCalled();
  });

  it('does not capture a teammate name that is only whitespace', () => {
    const msg = {
      uuid: 'u-name-4',
      message: {
        id: 'm-name-4',
        model: 'claude-opus',
        content: [
          {
            type: 'tool_use',
            id: 'tool-name-4',
            name: 'Task',
            input: { description: 'desc', prompt: 'go', name: '   ' },
          },
        ],
      },
    } as never;

    transformer.transform(msg, state, helpers, 'sess-name-4' as never);

    expect(
      helpers.subagentRegistry.markPendingTeammateName,
    ).not.toHaveBeenCalled();
  });

  it('does not capture a non-string input.name', () => {
    const msg = {
      uuid: 'u-name-5',
      message: {
        id: 'm-name-5',
        model: 'claude-opus',
        content: [
          {
            type: 'tool_use',
            id: 'tool-name-5',
            name: 'Task',
            input: { description: 'desc', prompt: 'go', name: 42 },
          },
        ],
      },
    } as never;

    transformer.transform(msg, state, helpers, 'sess-name-5' as never);

    expect(
      helpers.subagentRegistry.markPendingTeammateName,
    ).not.toHaveBeenCalled();
  });

  it('captures both name and background flags when a Task tool_use carries both', () => {
    const msg = {
      uuid: 'u-name-6',
      message: {
        id: 'm-name-6',
        model: 'claude-opus',
        content: [
          {
            type: 'tool_use',
            id: 'tool-name-6',
            name: 'Task',
            input: {
              description: 'desc',
              prompt: 'go',
              name: 'long-runner',
              run_in_background: true,
            },
          },
        ],
      },
    } as never;

    transformer.transform(msg, state, helpers, 'sess-name-6' as never);

    expect(
      helpers.subagentRegistry.markPendingTeammateName,
    ).toHaveBeenCalledWith('tool-name-6', 'long-runner');
    expect(helpers.subagentRegistry.markPendingBackground).toHaveBeenCalledWith(
      'tool-name-6',
    );
  });

  it('tracks Skill tool_use via state.addActiveSkillToolUseId', () => {
    const msg = {
      uuid: 'u-3',
      message: {
        id: 'm-3',
        model: 'claude-opus',
        content: [
          {
            type: 'tool_use',
            id: 'tool-skill-1',
            name: 'Skill',
            input: {},
          },
        ],
      },
    } as never;

    transformer.transform(msg, state, helpers, 'sess-3' as never);

    expect(state.addActiveSkillToolUseId).toHaveBeenCalledWith('tool-skill-1');
  });

  it('suppresses agent_start when state.isTaskStartedEmitted returns true for the tool_use_id', () => {
    state.isTaskStartedEmitted.mockReturnValue(true);
    const msg = {
      uuid: 'u-4',
      message: {
        id: 'm-4',
        model: 'claude-opus',
        content: [
          {
            type: 'tool_use',
            id: 'tool-dup-1',
            name: 'Task',
            input: { description: 'd', prompt: 'p' },
          },
        ],
      },
    } as never;

    const events = transformer.transform(
      msg,
      state,
      helpers,
      'sess-4' as never,
    );
    const agentStarts = events.filter((e) => e.eventType === 'agent_start');
    expect(agentStarts).toHaveLength(0);
  });

  it('emits background_agent_started when tool_result matches a tracked background task', () => {
    state.hasBackgroundTaskToolUseId.mockReturnValue(true);
    const msg = {
      uuid: 'u-5',
      message: {
        id: 'm-5',
        model: 'claude-opus',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-bg-1',
            content: 'started\noutput_file: /tmp/bg.log\n',
            is_error: false,
          },
        ],
      },
    } as never;

    const events = transformer.transform(
      msg,
      state,
      helpers,
      'sess-5' as never,
    );

    expect(state.removeBackgroundTaskToolUseId).toHaveBeenCalledWith(
      'tool-bg-1',
    );
    const bg = events.find((e) => e.eventType === 'background_agent_started');
    expect(bg).toBeDefined();
    expect((bg as { outputFilePath?: string }).outputFilePath).toBe(
      '/tmp/bg.log',
    );
  });

  it('clears activeSkillToolUseIds on the next assistant message', () => {
    state.activeSkillToolUseIdsCount.mockReturnValue(2);
    state.snapshotActiveSkillToolUseIds.mockReturnValue(['s1', 's2']);
    const msg = {
      uuid: 'u-6',
      message: {
        id: 'm-6',
        model: 'claude-opus',
        content: [{ type: 'text', text: 'hi' }],
      },
    } as never;

    transformer.transform(msg, state, helpers, 'sess-6' as never);

    expect(state.clearActiveSkillToolUseIds).toHaveBeenCalled();
  });
});
