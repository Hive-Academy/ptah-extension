import 'reflect-metadata';
import { UserMessageTransformer } from './user-message.transformer';
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
  } as unknown as jest.Mocked<TransformerHelpers>;
}

describe('UserMessageTransformer', () => {
  let transformer: UserMessageTransformer;
  let state: jest.Mocked<TransformerState>;
  let helpers: jest.Mocked<TransformerHelpers>;

  beforeEach(() => {
    transformer = new UserMessageTransformer();
    state = makeState();
    helpers = makeHelpers();
  });

  it('extracts tool_result blocks and returns them without text events', () => {
    const msg = {
      uuid: 'u-1',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: 'output',
            is_error: false,
          },
        ],
      },
    } as never;

    const events = transformer.transform(
      msg,
      state,
      helpers,
      'sess-1' as never,
    );

    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('tool_result');
    expect((events[0] as { toolCallId: string }).toolCallId).toBe('tool-1');
  });

  it('emits background_agent_started when tool_result matches a tracked background task', () => {
    state.hasBackgroundTaskToolUseId.mockReturnValue(true);
    const msg = {
      uuid: 'u-2',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-bg-2',
            content: 'started\noutput_file: /tmp/x.log\n',
            is_error: false,
          },
        ],
      },
    } as never;

    const events = transformer.transform(msg, state, helpers);
    expect(state.removeBackgroundTaskToolUseId).toHaveBeenCalledWith(
      'tool-bg-2',
    );
    expect(events.some((e) => e.eventType === 'background_agent_started')).toBe(
      true,
    );
  });

  it('emits message_start + text_delta + message_complete for a string text message', () => {
    const msg = {
      uuid: 'u-3',
      message: { content: 'hello world' },
    } as never;

    const events = transformer.transform(
      msg,
      state,
      helpers,
      'sess-3' as never,
    );
    expect(events.map((e) => e.eventType)).toEqual([
      'message_start',
      'text_delta',
      'message_complete',
    ]);
    expect((events[1] as { delta: string }).delta).toBe('hello world');
  });

  it('skips empty user messages (no text, no tool_result)', () => {
    const msg = {
      uuid: 'u-4',
      message: { content: '   ' },
    } as never;
    const events = transformer.transform(msg, state, helpers);
    expect(events).toEqual([]);
  });

  it('concatenates text blocks with newlines and includes parentToolUseId', () => {
    const msg = {
      uuid: 'u-5',
      parent_tool_use_id: 'parent-tool',
      message: {
        content: [
          { type: 'text', text: 'line1' },
          { type: 'text', text: 'line2' },
        ],
      },
    } as never;
    const events = transformer.transform(msg, state, helpers);
    expect((events[1] as { delta: string }).delta).toBe('line1\nline2');
    expect((events[0] as { parentToolUseId?: string }).parentToolUseId).toBe(
      'parent-tool',
    );
  });
});
