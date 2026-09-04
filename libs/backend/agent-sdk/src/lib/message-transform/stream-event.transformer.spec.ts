import 'reflect-metadata';
import { StreamEventTransformer } from './stream-event.transformer';
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
      setTaskId: jest.fn(),
      pruneSession: jest.fn(),
    },
    modelResolver: { resolveForPricing: jest.fn() },
    sessionLifecycle: { getActiveSessionIds: jest.fn().mockReturnValue([]) },
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

describe('StreamEventTransformer', () => {
  let transformer: StreamEventTransformer;
  let state: jest.Mocked<TransformerState>;
  let helpers: jest.Mocked<TransformerHelpers>;

  beforeEach(() => {
    transformer = new StreamEventTransformer();
    state = makeState();
    helpers = makeHelpers();
  });

  it('message_start sets message id and model via state mutators and records usage', () => {
    const sdk = {
      uuid: 'stream-u-1',
      event: {
        type: 'message_start',
        message: {
          id: 'gen-1',
          model: 'claude-opus',
          usage: {
            input_tokens: 100,
            output_tokens: 0,
            cache_read_input_tokens: 50,
            cache_creation_input_tokens: 25,
          },
        },
      },
    } as never;

    const events = transformer.transform(
      sdk,
      state,
      helpers,
      'sess-1' as never,
    );

    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('message_start');
    expect(state.setMessageId).toHaveBeenCalledWith('', 'gen-1');
    expect(state.setCurrentModel).toHaveBeenCalledWith('', 'claude-opus');
    expect(state.clearToolCallIdsForContext).toHaveBeenCalledWith('');
    expect(helpers.usageTracker.recordSessionUsage).toHaveBeenCalledWith(
      'sess-1',
      {
        input: 100,
        output: 0,
        cacheRead: 50,
        cacheCreation: 25,
      },
    );
  });

  it('content_block_start tool_use sets the toolCallId in state', () => {
    state.getMessageId.mockReturnValue('msg-1');
    const sdk = {
      uuid: 'u-2',
      event: {
        type: 'content_block_start',
        index: 3,
        content_block: {
          type: 'tool_use',
          id: 'tool-x',
          name: 'Bash',
        },
      },
    } as never;

    const events = transformer.transform(sdk, state, helpers);
    expect(state.setToolCallId).toHaveBeenCalledWith('', 3, 'tool-x');
    expect(events[0].eventType).toBe('tool_start');
  });

  it('content_block_delta input_json_delta uses state.getToolCallId for the toolCallId', () => {
    state.getMessageId.mockReturnValue('msg-2');
    state.getToolCallId.mockReturnValue('tool-real');
    const sdk = {
      uuid: 'u-3',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"a":1}' },
      },
    } as never;

    const events = transformer.transform(sdk, state, helpers);
    expect(events[0].eventType).toBe('tool_delta');
    expect(state.getToolCallId).toHaveBeenCalledWith('', 0);
    expect((events[0] as { toolCallId: string }).toolCallId).toBe('tool-real');
  });

  it('message_stop clears state and emits message_complete with model', () => {
    state.getMessageId.mockReturnValue('msg-3');
    state.getCurrentModel.mockReturnValue('claude-sonnet');
    const sdk = {
      uuid: 'u-4',
      event: { type: 'message_stop' },
    } as never;

    const events = transformer.transform(
      sdk,
      state,
      helpers,
      'sess-4' as never,
    );
    expect(events[0].eventType).toBe('message_complete');
    expect((events[0] as { model?: string }).model).toBe('claude-sonnet');
    expect(state.clearMessageId).toHaveBeenCalledWith('');
    expect(state.clearCurrentModel).toHaveBeenCalledWith('');
    expect(state.clearToolCallIdsForContext).toHaveBeenCalledWith('');
  });

  it('text_delta emits text_delta only when a current message id exists', () => {
    state.getMessageId.mockReturnValue('msg-5');
    const sdk = {
      uuid: 'u-5',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hello' },
      },
    } as never;
    const events = transformer.transform(sdk, state, helpers);
    expect(events[0].eventType).toBe('text_delta');
    expect((events[0] as { delta: string }).delta).toBe('hello');
  });

  it('returns empty array for ping events', () => {
    const sdk = { uuid: 'u-6', event: { type: 'ping' } } as never;
    expect(transformer.transform(sdk, state, helpers)).toEqual([]);
  });

  it('clears active skill ids on message_start when set is non-empty', () => {
    state.activeSkillToolUseIdsCount.mockReturnValue(1);
    state.snapshotActiveSkillToolUseIds.mockReturnValue(['s1']);
    const sdk = {
      uuid: 'u-7',
      event: {
        type: 'message_start',
        message: { id: 'gen-2', model: 'claude-opus' },
      },
    } as never;
    transformer.transform(sdk, state, helpers);
    expect(state.clearActiveSkillToolUseIds).toHaveBeenCalled();
  });
});

describe('StreamEventTransformer - turn_state (TASK_2026_360)', () => {
  const GENERATING = {
    phase: 'generating',
    revision: 1,
    backgroundTasks: [],
    sessionCrons: [],
    terminalReason: null,
    timestamp: 1,
  };

  function rootMessageStart(parentToolUseId?: string): never {
    return {
      uuid: 'stream-u-1',
      parent_tool_use_id: parentToolUseId ?? null,
      event: {
        type: 'message_start',
        message: { id: 'gen-1', model: 'claude-opus' },
      },
    } as never;
  }

  it('PREPENDS a turn_state to the root message_start when the registry reports a new turn', () => {
    const transformer = new StreamEventTransformer();
    const helpers = makeHelpers();
    (helpers.turnState.markGenerating as jest.Mock).mockReturnValue(GENERATING);

    const events = transformer.transform(
      rootMessageStart(),
      makeState(),
      helpers,
      'sess-1' as never,
    );

    expect(events.map((e) => e.eventType)).toEqual([
      'turn_state',
      'message_start',
    ]);
    expect(events[0]).toMatchObject({
      phase: 'generating',
      revision: 1,
      sessionId: 'sess-1',
      messageId: 'turn-state-sess-1',
    });
    expect(helpers.turnState.markGenerating).toHaveBeenCalledWith('sess-1');
  });

  it('emits generating once per turn - a second root message_start carries no turn_state', () => {
    const transformer = new StreamEventTransformer();
    const state = makeState();
    const helpers = makeHelpers();
    (helpers.turnState.markGenerating as jest.Mock)
      .mockReturnValueOnce(GENERATING)
      .mockReturnValue(null);

    const first = transformer.transform(
      rootMessageStart(),
      state,
      helpers,
      'sess-1' as never,
    );
    const second = transformer.transform(
      rootMessageStart(),
      state,
      helpers,
      'sess-1' as never,
    );

    expect(first.map((e) => e.eventType)).toEqual([
      'turn_state',
      'message_start',
    ]);
    expect(second.map((e) => e.eventType)).toEqual(['message_start']);
  });

  it('does not consult the registry for a subagent message_start', () => {
    const transformer = new StreamEventTransformer();
    const helpers = makeHelpers();

    const events = transformer.transform(
      rootMessageStart('toolu_parent'),
      makeState(),
      helpers,
      'sess-1' as never,
    );

    expect(events.map((e) => e.eventType)).toEqual(['message_start']);
    expect(helpers.turnState.markGenerating).not.toHaveBeenCalled();
  });

  it('does not consult the registry when the session id is unknown', () => {
    const transformer = new StreamEventTransformer();
    const helpers = makeHelpers();

    const events = transformer.transform(
      rootMessageStart(),
      makeState(),
      helpers,
    );

    expect(events.map((e) => e.eventType)).toEqual(['message_start']);
    expect(helpers.turnState.markGenerating).not.toHaveBeenCalled();
  });
});
