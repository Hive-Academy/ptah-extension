import 'reflect-metadata';
import type {
  MessageStartEvent,
  ToolStartEvent,
  ToolDeltaEvent,
  ThinkingStartEvent,
  MessageCompleteEvent,
} from '@ptah-extension/shared';
import { StreamEventTransformer } from './stream-event.transformer';
import { SessionTurnStateRegistry } from '../helpers/session-turn-state.registry';
import type { SDKPartialAssistantMessage } from '../types/sdk-types/claude-sdk.types';
import type { TransformerState } from './transformer-state';
import type { TransformerHelpers } from './transformer-helpers';

function makeState(): jest.Mocked<TransformerState> {
  const messageIds = new Map<string, string>();
  const models = new Map<string, string>();
  const toolCallIds = new Map<string, Map<number, string>>();
  const activeSkills = new Set<string>();
  const synthesized = new Set<string>();

  return {
    getMessageId: jest
      .fn()
      .mockImplementation((ctx: string) => messageIds.get(ctx)),
    getCurrentModel: jest
      .fn()
      .mockImplementation((ctx: string) => models.get(ctx)),
    getToolCallId: jest
      .fn()
      .mockImplementation((ctx: string, idx: number) =>
        toolCallIds.get(ctx)?.get(idx),
      ),
    hasBackgroundTaskToolUseId: jest.fn().mockReturnValue(false),
    getBackgroundTaskInfo: jest.fn().mockReturnValue(undefined),
    getTaskParentToolUseId: jest.fn().mockReturnValue(undefined),
    isTaskStartedEmitted: jest.fn().mockReturnValue(false),
    isNonAgentTask: jest.fn().mockReturnValue(false),
    hasActiveSkillToolUseId: jest
      .fn()
      .mockImplementation((id: string) => activeSkills.has(id)),
    activeSkillToolUseIdsCount: jest
      .fn()
      .mockImplementation(() => activeSkills.size),
    snapshotActiveSkillToolUseIds: jest
      .fn()
      .mockImplementation(() => Array.from(activeSkills)),
    getWorkflowRun: jest.fn().mockReturnValue(undefined),
    registerWorkflowRunRoot: jest.fn(),
    associateWorkflowRunChild: jest.fn(),
    isMessageSynthesized: jest
      .fn()
      .mockImplementation((ctx: string) => synthesized.has(ctx)),
    setMessageId: jest.fn().mockImplementation((ctx: string, id: string) => {
      messageIds.set(ctx, id);
    }),
    clearMessageId: jest.fn().mockImplementation((ctx: string) => {
      messageIds.delete(ctx);
      synthesized.delete(ctx);
    }),
    markMessageSynthesized: jest.fn().mockImplementation((ctx: string) => {
      synthesized.add(ctx);
    }),
    clearMessageSynthesized: jest.fn().mockImplementation((ctx: string) => {
      synthesized.delete(ctx);
    }),
    setCurrentModel: jest
      .fn()
      .mockImplementation((ctx: string, model: string) => {
        models.set(ctx, model);
      }),
    clearCurrentModel: jest.fn().mockImplementation((ctx: string) => {
      models.delete(ctx);
    }),
    setToolCallId: jest
      .fn()
      .mockImplementation((ctx: string, idx: number, id: string) => {
        let map = toolCallIds.get(ctx);
        if (!map) {
          map = new Map<number, string>();
          toolCallIds.set(ctx, map);
        }
        map.set(idx, id);
      }),
    clearToolCallIdsForContext: jest.fn().mockImplementation((ctx: string) => {
      toolCallIds.delete(ctx);
    }),
    addBackgroundTaskToolUseId: jest.fn(),
    removeBackgroundTaskToolUseId: jest.fn(),
    setTaskParent: jest.fn(),
    clearTaskParent: jest.fn(),
    markTaskStartedEmitted: jest.fn(),
    markNonAgentTask: jest.fn(),
    addActiveSkillToolUseId: jest.fn().mockImplementation((id: string) => {
      activeSkills.add(id);
    }),
    clearActiveSkillToolUseIds: jest.fn().mockImplementation(() => {
      activeSkills.clear();
    }),
    clearStreamingState: jest.fn(),
  } as unknown as jest.Mocked<TransformerState>;
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

describe('StreamEventTransformer - synthesized message_start (C5c, D-5c)', () => {
  let transformer: StreamEventTransformer;
  let state: jest.Mocked<TransformerState>;
  let helpers: jest.Mocked<TransformerHelpers>;

  beforeEach(() => {
    transformer = new StreamEventTransformer();
    state = makeState();
    helpers = makeHelpers();
  });

  it('content_block_start with a tool_use block and no prior message_start emits [message_start, tool_start], not [], and state.getMessageId(ctx) is set afterwards', () => {
    const sdkMessage = {
      uuid: '11111111-1111-1111-1111-111111111111',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tool-call-1',
          name: 'Bash',
        },
      },
    } as unknown as SDKPartialAssistantMessage;

    expect(state.getMessageId('')).toBeUndefined();

    const events = transformer.transform(
      sdkMessage,
      state,
      helpers,
      'sess-1' as never,
    );

    expect(events.map((e) => e.eventType)).toEqual([
      'message_start',
      'tool_start',
    ]);
    const messageStart = events[0] as MessageStartEvent;
    const toolStart = events[1] as ToolStartEvent;

    expect(messageStart.messageId).toBe('11111111-1111-1111-1111-111111111111');
    expect(messageStart.sessionId).toBe('sess-1');
    expect(toolStart.toolCallId).toBe('tool-call-1');
    expect(toolStart.toolName).toBe('Bash');
    expect(toolStart.messageId).toBe('11111111-1111-1111-1111-111111111111');

    expect(state.getMessageId('')).toBe('11111111-1111-1111-1111-111111111111');
    expect(state.getToolCallId('', 0)).toBe('tool-call-1');
  });

  it('content_block_start with a text block and no prior message_start emits [message_start], not [], and sets messageId in state', () => {
    const sdkMessage = {
      uuid: '22222222-2222-2222-2222-222222222222',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'text',
          text: '',
        },
      },
    } as unknown as SDKPartialAssistantMessage;

    expect(state.getMessageId('')).toBeUndefined();

    const events = transformer.transform(
      sdkMessage,
      state,
      helpers,
      'sess-1' as never,
    );

    expect(events.map((e) => e.eventType)).toEqual(['message_start']);
    const messageStart = events[0] as MessageStartEvent;
    expect(messageStart.messageId).toBe('22222222-2222-2222-2222-222222222222');
    expect(state.getMessageId('')).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('content_block_start with a thinking block and no prior message_start emits [message_start, thinking_start], not [], and sets messageId in state', () => {
    const sdkMessage = {
      uuid: '33333333-3333-3333-3333-333333333333',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'thinking',
        },
      },
    } as unknown as SDKPartialAssistantMessage;

    expect(state.getMessageId('')).toBeUndefined();

    const events = transformer.transform(
      sdkMessage,
      state,
      helpers,
      'sess-1' as never,
    );

    expect(events.map((e) => e.eventType)).toEqual([
      'message_start',
      'thinking_start',
    ]);
    const messageStart = events[0] as MessageStartEvent;
    const thinkingStart = events[1] as ThinkingStartEvent;
    expect(messageStart.messageId).toBe('33333333-3333-3333-3333-333333333333');
    expect(thinkingStart.messageId).toBe(
      '33333333-3333-3333-3333-333333333333',
    );
    expect(thinkingStart.blockIndex).toBe(0);
    expect(state.getMessageId('')).toBe('33333333-3333-3333-3333-333333333333');
  });

  it('logger.warn is NOT called and logger.debug IS called when synthesizing message_start', () => {
    const sdkMessage = {
      uuid: '44444444-4444-4444-4444-444444444444',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tool-call-dbg',
          name: 'read_file',
        },
      },
    } as unknown as SDKPartialAssistantMessage;

    transformer.transform(sdkMessage, state, helpers, 'sess-1' as never);

    expect(helpers.logger.warn).not.toHaveBeenCalled();
    expect(helpers.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining(
        'content_block_start arrived before message_start; synthesizing one so the block is not dropped',
      ),
      expect.objectContaining({
        context: 'root',
        blockType: 'tool_use',
      }),
    );
  });

  it('synthesize, then a real message_start, then message_stop: exactly one message_complete and tool_start fires once', () => {
    const synthesizedToolStart = {
      uuid: '55555555-5555-5555-5555-555555555555',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tool-call-1',
          name: 'Bash',
        },
      },
    } as unknown as SDKPartialAssistantMessage;

    const realMessageStart = {
      uuid: '66666666-6666-6666-6666-666666666666',
      event: {
        type: 'message_start',
        message: {
          id: 'real-msg-id',
          model: 'claude-3-7-sonnet',
        },
      },
    } as unknown as SDKPartialAssistantMessage;

    const messageStop = {
      uuid: '66666666-6666-6666-6666-666666666666',
      event: {
        type: 'message_stop',
      },
    } as unknown as SDKPartialAssistantMessage;

    const events1 = transformer.transform(
      synthesizedToolStart,
      state,
      helpers,
      'sess-1' as never,
    );
    const events2 = transformer.transform(
      realMessageStart,
      state,
      helpers,
      'sess-1' as never,
    );
    const events3 = transformer.transform(
      messageStop,
      state,
      helpers,
      'sess-1' as never,
    );

    const allEvents = [...events1, ...events2, ...events3];

    const toolStartEvents = allEvents.filter(
      (e) => e.eventType === 'tool_start',
    );
    expect(toolStartEvents).toHaveLength(1);

    const messageCompleteEvents = allEvents.filter(
      (e) => e.eventType === 'message_complete',
    );
    expect(messageCompleteEvents).toHaveLength(1);
    const complete = messageCompleteEvents[0] as MessageCompleteEvent;
    // The real start reconciles into the synthesized message, so the kept id
    // is the synthesized one. The model it carried is still folded in.
    expect(complete.messageId).toBe('55555555-5555-5555-5555-555555555555');
    expect(complete.model).toBe('claude-3-7-sonnet');

    // After message_stop, the context messageId is cleared
    expect(state.getMessageId('')).toBeUndefined();
  });

  it('no-regression: the normal order message_start then content_block_start emits no synthesized prelude', () => {
    const realMessageStart = {
      uuid: '77777777-7777-7777-7777-777777777777',
      event: {
        type: 'message_start',
        message: {
          id: 'normal-msg-id',
          model: 'claude-3-7-sonnet',
        },
      },
    } as unknown as SDKPartialAssistantMessage;

    const startEvents = transformer.transform(
      realMessageStart,
      state,
      helpers,
      'sess-1' as never,
    );
    expect(startEvents.map((e) => e.eventType)).toEqual(['message_start']);
    expect(state.getMessageId('')).toBe('normal-msg-id');

    // content_block_start tool_use: emits ONLY tool_start (no prelude)
    const toolBlockStart = {
      uuid: '77777777-7777-7777-7777-777777777777',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tool-call-normal',
          name: 'read_file',
        },
      },
    } as unknown as SDKPartialAssistantMessage;
    const toolEvents = transformer.transform(
      toolBlockStart,
      state,
      helpers,
      'sess-1' as never,
    );
    expect(toolEvents.map((e) => e.eventType)).toEqual(['tool_start']);

    // content_block_start text: emits [] (no prelude)
    const textBlockStart = {
      uuid: '77777777-7777-7777-7777-777777777777',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'text',
          text: '',
        },
      },
    } as unknown as SDKPartialAssistantMessage;
    const textEvents = transformer.transform(
      textBlockStart,
      state,
      helpers,
      'sess-1' as never,
    );
    expect(textEvents).toEqual([]);

    // content_block_start thinking: emits ONLY thinking_start (no prelude)
    const thinkingBlockStart = {
      uuid: '77777777-7777-7777-7777-777777777777',
      event: {
        type: 'content_block_start',
        index: 2,
        content_block: {
          type: 'thinking',
        },
      },
    } as unknown as SDKPartialAssistantMessage;
    const thinkingEvents = transformer.transform(
      thinkingBlockStart,
      state,
      helpers,
      'sess-1' as never,
    );
    expect(thinkingEvents.map((e) => e.eventType)).toEqual(['thinking_start']);

    // No synthesize debug log was emitted
    expect(helpers.logger.debug).not.toHaveBeenCalledWith(
      expect.stringContaining(
        'content_block_start arrived before message_start; synthesizing one so the block is not dropped',
      ),
      expect.anything(),
    );
  });

  it('synthesizes root-context turn-phase flip when turnState is active', () => {
    const GENERATING = {
      phase: 'generating' as const,
      revision: 1,
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: null,
      timestamp: 1,
    };
    (helpers.turnState.markGenerating as jest.Mock).mockReturnValue(GENERATING);

    const sdkMessage = {
      uuid: '88888888-8888-8888-8888-888888888888',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tool-call-gen',
          name: 'Bash',
        },
      },
    } as unknown as SDKPartialAssistantMessage;

    const events = transformer.transform(
      sdkMessage,
      state,
      helpers,
      'sess-1' as never,
    );

    expect(events.map((e) => e.eventType)).toEqual([
      'turn_state',
      'message_start',
      'tool_start',
    ]);
    expect(helpers.turnState.markGenerating).toHaveBeenCalledWith('sess-1');
  });

  it('synthesizes message_start for subagent context (parentToolUseId set) without flipping root turn-phase', () => {
    const sdkMessage = {
      uuid: '99999999-9999-9999-9999-999999999999',
      parent_tool_use_id: 'tool-parent-sub',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tool-call-child',
          name: 'read_file',
        },
      },
    } as unknown as SDKPartialAssistantMessage;

    const events = transformer.transform(
      sdkMessage,
      state,
      helpers,
      'sess-1' as never,
    );

    expect(events.map((e) => e.eventType)).toEqual([
      'message_start',
      'tool_start',
    ]);
    expect(events[0].parentToolUseId).toBe('tool-parent-sub');
    expect(events[1].parentToolUseId).toBe('tool-parent-sub');
    expect(helpers.turnState.markGenerating).not.toHaveBeenCalled();
    expect(state.getMessageId('tool-parent-sub')).toBe(
      '99999999-9999-9999-9999-999999999999',
    );
  });

  describe('F1 regression: a real message_start reconciles with a synthesized one', () => {
    function toolBlockStart(
      uuid: string,
      toolCallId: string,
      toolName: string,
      parentToolUseId?: string,
    ): SDKPartialAssistantMessage {
      return {
        uuid,
        ...(parentToolUseId ? { parent_tool_use_id: parentToolUseId } : {}),
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: toolCallId, name: toolName },
        },
      } as unknown as SDKPartialAssistantMessage;
    }

    function realStart(
      uuid: string,
      parentToolUseId?: string,
    ): SDKPartialAssistantMessage {
      return {
        uuid,
        ...(parentToolUseId ? { parent_tool_use_id: parentToolUseId } : {}),
        event: {
          type: 'message_start',
          message: { id: 'real-msg-id', model: 'claude-3-7-sonnet' },
        },
      } as unknown as SDKPartialAssistantMessage;
    }

    function jsonDelta(
      uuid: string,
      partialJson: string,
      parentToolUseId?: string,
    ): SDKPartialAssistantMessage {
      return {
        uuid,
        ...(parentToolUseId ? { parent_tool_use_id: parentToolUseId } : {}),
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: partialJson },
        },
      } as unknown as SDKPartialAssistantMessage;
    }

    function stop(
      uuid: string,
      parentToolUseId?: string,
    ): SDKPartialAssistantMessage {
      return {
        uuid,
        ...(parentToolUseId ? { parent_tool_use_id: parentToolUseId } : {}),
        event: { type: 'message_stop' },
      } as unknown as SDKPartialAssistantMessage;
    }

    it('root: early tool_use then real message_start then input_json_delta then message_stop keeps ONE message and ONE tool-call id', () => {
      const synthesizedId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

      const events = [
        ...transformer.transform(
          toolBlockStart(synthesizedId, 'tool-call-1', 'Bash'),
          state,
          helpers,
          'sess-1' as never,
        ),
        ...transformer.transform(
          realStart('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
          state,
          helpers,
          'sess-1' as never,
        ),
        ...transformer.transform(
          jsonDelta('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '{"comm'),
          state,
          helpers,
          'sess-1' as never,
        ),
        ...transformer.transform(
          stop('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
          state,
          helpers,
          'sess-1' as never,
        ),
      ];

      const starts = events.filter((e) => e.eventType === 'message_start');
      const completes = events.filter(
        (e) => e.eventType === 'message_complete',
      );
      expect(starts).toHaveLength(1);
      expect(completes).toHaveLength(1);

      const toolStart = events.find(
        (e) => e.eventType === 'tool_start',
      ) as ToolStartEvent;
      const toolDelta = events.find(
        (e) => e.eventType === 'tool_delta',
      ) as ToolDeltaEvent;
      expect(toolStart).toBeDefined();
      expect(toolDelta).toBeDefined();

      expect(toolDelta.toolCallId).toBe('tool-call-1');
      expect(toolDelta.toolCallId).not.toBe('tool-block-0');
      expect(toolDelta.toolCallId).toBe(toolStart.toolCallId);
      expect(toolDelta.messageId).toBe(toolStart.messageId);
      expect(toolStart.messageId).toBe(synthesizedId);
      expect((starts[0] as MessageStartEvent).messageId).toBe(synthesizedId);
      expect((completes[0] as MessageCompleteEvent).messageId).toBe(
        synthesizedId,
      );
      expect((completes[0] as MessageCompleteEvent).model).toBe(
        'claude-3-7-sonnet',
      );
      expect(state.getMessageId('')).toBeUndefined();
    });

    it('subagent: the same sequence under a parentToolUseId keeps ONE message and ONE tool-call id', () => {
      const parent = 'tool-parent-sub';
      const synthesizedId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

      const events = [
        ...transformer.transform(
          toolBlockStart(synthesizedId, 'tool-call-1', 'Bash', parent),
          state,
          helpers,
          'sess-1' as never,
        ),
        ...transformer.transform(
          realStart('dddddddd-dddd-dddd-dddd-dddddddddddd', parent),
          state,
          helpers,
          'sess-1' as never,
        ),
        ...transformer.transform(
          jsonDelta('dddddddd-dddd-dddd-dddd-dddddddddddd', '{"comm', parent),
          state,
          helpers,
          'sess-1' as never,
        ),
        ...transformer.transform(
          stop('dddddddd-dddd-dddd-dddd-dddddddddddd', parent),
          state,
          helpers,
          'sess-1' as never,
        ),
      ];

      const starts = events.filter((e) => e.eventType === 'message_start');
      const completes = events.filter(
        (e) => e.eventType === 'message_complete',
      );
      expect(starts).toHaveLength(1);
      expect(completes).toHaveLength(1);

      const toolStart = events.find(
        (e) => e.eventType === 'tool_start',
      ) as ToolStartEvent;
      const toolDelta = events.find(
        (e) => e.eventType === 'tool_delta',
      ) as ToolDeltaEvent;

      expect(toolDelta.toolCallId).toBe('tool-call-1');
      expect(toolDelta.toolCallId).not.toBe('tool-block-0');
      expect(toolDelta.messageId).toBe(toolStart.messageId);
      expect(toolStart.messageId).toBe(synthesizedId);
      expect(toolDelta.parentToolUseId).toBe(parent);
      expect((completes[0] as MessageCompleteEvent).messageId).toBe(
        synthesizedId,
      );
      expect(helpers.turnState.markGenerating).not.toHaveBeenCalled();
      expect(state.getMessageId(parent)).toBeUndefined();
    });

    it('an early Skill tool_use stays tracked across the real message_start', () => {
      transformer.transform(
        toolBlockStart(
          'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
          'skill-tool-1',
          'Skill',
        ),
        state,
        helpers,
        'sess-1' as never,
      );

      expect(state.hasActiveSkillToolUseId('skill-tool-1')).toBe(true);

      transformer.transform(
        realStart('ffffffff-ffff-ffff-ffff-ffffffffffff'),
        state,
        helpers,
        'sess-1' as never,
      );

      expect(state.hasActiveSkillToolUseId('skill-tool-1')).toBe(true);
      expect(state.activeSkillToolUseIdsCount()).toBe(1);
      expect(state.clearActiveSkillToolUseIds).not.toHaveBeenCalled();
    });

    it('with the REAL SessionTurnStateRegistry, a synthesized start plus a real start emit exactly one generating turn_state', () => {
      const registry = new SessionTurnStateRegistry();
      const realTurnStateHelpers: TransformerHelpers = {
        ...makeHelpers(),
        turnState: registry,
      };

      const events = [
        ...transformer.transform(
          toolBlockStart(
            '10101010-1010-1010-1010-101010101010',
            'tool-call-1',
            'Bash',
          ),
          state,
          realTurnStateHelpers,
          'sess-1' as never,
        ),
        ...transformer.transform(
          realStart('20202020-2020-2020-2020-202020202020'),
          state,
          realTurnStateHelpers,
          'sess-1' as never,
        ),
      ];

      const generating = events.filter(
        (e) => e.eventType === 'turn_state' && e.phase === 'generating',
      );
      expect(generating).toHaveLength(1);
      expect(
        events.filter((e) => e.eventType === 'message_start'),
      ).toHaveLength(1);
    });

    it('a synthesized start followed directly by message_stop completes the synthesized message and clears the id', () => {
      const synthesizedId = '30303030-3030-3030-3030-303030303030';

      const events = [
        ...transformer.transform(
          toolBlockStart(synthesizedId, 'tool-call-1', 'Bash'),
          state,
          helpers,
          'sess-1' as never,
        ),
        ...transformer.transform(
          stop(synthesizedId),
          state,
          helpers,
          'sess-1' as never,
        ),
      ];

      const completes = events.filter(
        (e) => e.eventType === 'message_complete',
      );
      expect(completes).toHaveLength(1);
      expect((completes[0] as MessageCompleteEvent).messageId).toBe(
        synthesizedId,
      );
      expect(state.getMessageId('')).toBeUndefined();
      expect(state.isMessageSynthesized('')).toBe(false);
    });
  });
});
