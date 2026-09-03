import 'reflect-metadata';
import { findModelPricing } from '@ptah-extension/shared';
import { AssistantMessageTransformer } from './assistant-message.transformer';
import type { TransformerState } from './transformer-state';
import type { TransformerHelpers } from './transformer-helpers';

function makeState(): jest.Mocked<TransformerState> {
  return {
    getMessageId: jest.fn().mockReturnValue(undefined),
    getCurrentModel: jest.fn().mockReturnValue(undefined),
    getToolCallId: jest.fn().mockReturnValue(undefined),
    isMessageSynthesized: jest.fn().mockReturnValue(false),
    markMessageSynthesized: jest.fn(),
    clearMessageSynthesized: jest.fn(),
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
      isSubscriptionCovered: jest.fn().mockReturnValue(false),
      resolveForCost: jest.fn().mockImplementation((m: string) => ({
        modelId: m,
        pricing: findModelPricing(m),
        subscriptionCovered: false,
      })),
    },
    sessionLifecycle: {
      getActiveSessionIds: jest.fn().mockReturnValue([]),
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

  it('suppresses envelopes for signature-only empty thinking', () => {
    const msg = {
      uuid: 'u-empty-thinking',
      message: {
        id: 'm-empty-thinking',
        model: 'claude-opus',
        content: [{ type: 'thinking', thinking: '', signature: 'sig' }],
      },
    } as never;

    const events = transformer.transform(
      msg,
      state,
      helpers,
      'sess-empty-thinking' as never,
    );

    expect(events).toEqual([]);
    expect(helpers.logger.debug).toHaveBeenCalledWith(
      '[SdkMessageTransformer] Skipping assistant message without renderable events',
      { messageId: 'm-empty-thinking' },
    );
  });

  it('preserves root turn_state when suppressing empty thinking envelopes', () => {
    const generating = {
      phase: 'generating',
      revision: 1,
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: null,
      timestamp: 1,
    };
    (helpers.turnState.markGenerating as jest.Mock).mockReturnValue(generating);
    const msg = {
      uuid: 'u-empty-thinking-turn',
      message: {
        id: 'm-empty-thinking-turn',
        model: 'claude-opus',
        content: [{ type: 'thinking', thinking: '', signature: 'sig' }],
      },
    } as never;

    const events = transformer.transform(
      msg,
      state,
      helpers,
      'sess-empty-thinking-turn' as never,
    );

    expect(events.map((event) => event.eventType)).toEqual(['turn_state']);
    expect(events[0]).toMatchObject({
      phase: 'generating',
      sessionId: 'sess-empty-thinking-turn',
    });
  });

  it('suppresses envelopes for an empty-string text block', () => {
    const msg = {
      uuid: 'u-empty-text',
      message: {
        id: 'm-empty-text',
        model: 'claude-opus',
        content: [{ type: 'text', text: '' }],
      },
    } as never;

    const events = transformer.transform(
      msg,
      state,
      helpers,
      'sess-empty-text' as never,
    );

    expect(events).toEqual([]);
    expect(helpers.logger.debug).toHaveBeenCalledWith(
      '[SdkMessageTransformer] Skipping assistant message without renderable events',
      { messageId: 'm-empty-text' },
    );
  });

  it('still emits text_delta with the correct blockIndex for a non-empty text block', () => {
    const msg = {
      uuid: 'u-nonempty-text',
      message: {
        id: 'm-nonempty-text',
        model: 'claude-opus',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: 'answer' },
        ],
      },
    } as never;

    const events = transformer.transform(
      msg,
      state,
      helpers,
      'sess-nonempty-text' as never,
    );

    const textDelta = events.find((e) => e.eventType === 'text_delta');
    expect(textDelta).toMatchObject({ delta: 'answer', blockIndex: 1 });
  });

  it('emits envelopes for renderable thinking and text', () => {
    const msg = {
      uuid: 'u-thinking-text',
      message: {
        id: 'm-thinking-text',
        model: 'claude-opus',
        content: [
          { type: 'thinking', thinking: 'considering', signature: 'sig' },
          { type: 'text', text: 'answer' },
        ],
      },
    } as never;

    const events = transformer.transform(
      msg,
      state,
      helpers,
      'sess-thinking-text' as never,
    );

    expect(events.map((event) => event.eventType)).toEqual([
      'message_start',
      'thinking_delta',
      'text_delta',
      'message_complete',
    ]);
  });

  it('emits the full event set for a tool_use-only message', () => {
    const msg = {
      uuid: 'u-tool-use',
      message: {
        id: 'm-tool-use',
        model: 'claude-opus',
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Task',
            input: { description: 'do work', prompt: 'work' },
          },
        ],
      },
    } as never;

    const events = transformer.transform(
      msg,
      state,
      helpers,
      'sess-tool-use' as never,
    );

    expect(events.map((event) => event.eventType)).toEqual([
      'message_start',
      'agent_start',
      'tool_start',
      'message_complete',
    ]);
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

    // The tool_use block is the only message carrying subagent_type and
    // description, so they are stashed for the later placeholder tool_result.
    expect(state.addBackgroundTaskToolUseId).toHaveBeenCalledWith('tool-bg-1', {
      agentType: 'worker',
      agentDescription: 'desc',
    });
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

  it('emits background_agent_started BEFORE the tool_result for the same toolCallId', () => {
    state.hasBackgroundTaskToolUseId.mockReturnValue(true);
    const msg = {
      uuid: 'u-order',
      message: {
        id: 'm-order',
        model: 'claude-opus',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-bg-order',
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
      'sess-order' as never,
    );

    const bgIndex = events.findIndex(
      (e) => e.eventType === 'background_agent_started',
    );
    const resultIndex = events.findIndex(
      (e) =>
        e.eventType === 'tool_result' &&
        (e as { toolCallId?: string }).toolCallId === 'tool-bg-order',
    );
    expect(bgIndex).toBeGreaterThanOrEqual(0);
    expect(resultIndex).toBeGreaterThanOrEqual(0);
    expect(bgIndex).toBeLessThan(resultIndex);
  });

  // The tool_result that triggers background_agent_started carries neither the
  // agent type nor the SDK agent id. Both used to be dropped: agentType was the
  // literal 'unknown' and agentId was omitted, so the tray chip read "unknown"
  // and the frontend hid its transcript action (gated on hasRealAgentId).
  it('carries the real agentType, agentId and description on background_agent_started', () => {
    state.hasBackgroundTaskToolUseId.mockReturnValue(true);
    state.getBackgroundTaskInfo.mockReturnValue({
      agentType: 'Explore',
      agentDescription: 'sweep the canvas libs',
    });
    (helpers.subagentRegistry.get as jest.Mock).mockReturnValue({
      toolCallId: 'tool-bg-2',
      agentType: 'Explore',
      agentId: 'adcecb7',
      teammateName: 'scout',
      status: 'running',
      startedAt: 0,
    });

    const msg = {
      uuid: 'u-6',
      message: {
        id: 'm-6',
        model: 'claude-opus',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-bg-2',
            content: 'started',
            is_error: false,
          },
        ],
      },
    } as never;

    const events = transformer.transform(
      msg,
      state,
      helpers,
      'sess-6' as never,
    );

    expect(
      events.find((e) => e.eventType === 'background_agent_started'),
    ).toMatchObject({
      agentType: 'Explore',
      agentId: 'adcecb7',
      teammateName: 'scout',
      agentDescription: 'sweep the canvas libs',
    });
  });

  // The SubagentStart hook can fire after the SDK's placeholder tool_result, so
  // the registry record may not exist yet. The spawning tool_use block is the
  // fallback — 'unknown' is the last resort, not the default.
  it('falls back to the spawning tool_use agentType when no registry record exists', () => {
    state.hasBackgroundTaskToolUseId.mockReturnValue(true);
    state.getBackgroundTaskInfo.mockReturnValue({ agentType: 'worker' });
    (helpers.subagentRegistry.get as jest.Mock).mockReturnValue(null);

    const msg = {
      uuid: 'u-7',
      message: {
        id: 'm-7',
        model: 'claude-opus',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-bg-3',
            content: 'started',
            is_error: false,
          },
        ],
      },
    } as never;

    const events = transformer.transform(
      msg,
      state,
      helpers,
      'sess-7' as never,
    );

    expect(
      events.find((e) => e.eventType === 'background_agent_started'),
    ).toMatchObject({ agentType: 'worker' });
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

describe('AssistantMessageTransformer - turn_state (TASK_2026_360)', () => {
  const GENERATING = {
    phase: 'generating',
    revision: 1,
    backgroundTasks: [],
    sessionCrons: [],
    terminalReason: null,
    timestamp: 1,
  };

  function textMessage(parentToolUseId?: string): never {
    return {
      uuid: 'u-1',
      parent_tool_use_id: parentToolUseId ?? null,
      message: {
        id: 'm-1',
        model: 'claude-opus',
        content: [{ type: 'text', text: 'hello' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      },
    } as never;
  }

  it('PREPENDS a turn_state to the root message_start when the registry reports a new turn', () => {
    const transformer = new AssistantMessageTransformer();
    const helpers = makeHelpers();
    (helpers.turnState.markGenerating as jest.Mock).mockReturnValue(GENERATING);

    const events = transformer.transform(
      textMessage(),
      makeState(),
      helpers,
      'sess-1' as never,
    );

    expect(events.map((e) => e.eventType)).toEqual([
      'turn_state',
      'message_start',
      'text_delta',
      'message_complete',
    ]);
    expect(events[0]).toMatchObject({
      phase: 'generating',
      sessionId: 'sess-1',
    });
  });

  it('emits nothing extra when the registry says the turn already started', () => {
    const transformer = new AssistantMessageTransformer();
    const helpers = makeHelpers();

    const events = transformer.transform(
      textMessage(),
      makeState(),
      helpers,
      'sess-1' as never,
    );

    expect(events[0].eventType).toBe('message_start');
    expect(helpers.turnState.markGenerating).toHaveBeenCalledWith('sess-1');
  });

  it('does not consult the registry for a subagent message', () => {
    const transformer = new AssistantMessageTransformer();
    const helpers = makeHelpers();

    transformer.transform(
      textMessage('toolu_parent'),
      makeState(),
      helpers,
      'sess-1' as never,
    );

    expect(helpers.turnState.markGenerating).not.toHaveBeenCalled();
  });
});
