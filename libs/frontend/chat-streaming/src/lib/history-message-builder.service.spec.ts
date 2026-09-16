import { TestBed } from '@angular/core/testing';
import {
  type ExecutionNode,
  type FlatStreamEventUnion,
} from '@ptah-extension/shared';
import { type StreamingState } from '@ptah-extension/chat-types';
import { AgentMonitorStore } from './agent-monitor.store';
import { BackgroundAgentStore } from './background-agent.store';
import { BatchedUpdateService } from './batched-update.service';
import { EventDeduplicationService } from './event-deduplication.service';
import { ExecutionTreeBuilderService } from './execution-tree-builder.service';
import { HistoryMessageBuilder } from './history-message-builder.service';
import { SessionManager } from './session-manager.service';
import { StreamingAccumulatorCore } from './accumulator-core.service';

function historyState(): StreamingState {
  const state = TestBed.inject(HistoryMessageBuilder).createPageState();
  const userStart = {
    id: 'user-start',
    eventType: 'message_start',
    messageId: 'user-1',
    role: 'user',
    timestamp: 1,
    source: 'history',
  } as FlatStreamEventUnion;
  const assistantStart = {
    id: 'assistant-tree',
    eventType: 'message_start',
    messageId: 'assistant-1',
    role: 'assistant',
    timestamp: 2,
    source: 'history',
  } as FlatStreamEventUnion;
  const assistantComplete = {
    id: 'assistant-complete',
    eventType: 'message_complete',
    messageId: 'assistant-1',
    timestamp: 3,
    source: 'history',
    tokenUsage: { input: 2, output: 3 },
  } as FlatStreamEventUnion;
  state.events.set(userStart.id, userStart);
  state.events.set(assistantStart.id, assistantStart);
  state.events.set(assistantComplete.id, assistantComplete);
  state.messageEventIds.push('user-1', 'assistant-1');
  state.textAccumulators.set('user-1-block-0', 'hello');
  return state;
}

describe('HistoryMessageBuilder', () => {
  let builder: HistoryMessageBuilder;
  let treeBuilder: {
    buildTree: jest.Mock;
    clearCache: jest.Mock;
  };
  let batchedUpdate: {
    scheduleUpdate: jest.Mock;
    flushSync: jest.Mock;
  };
  let monitoredAgents: Map<string, unknown>;
  let backgroundAgents: Map<string, unknown>;

  beforeEach(() => {
    const tree: ExecutionNode = {
      id: 'assistant-tree',
      type: 'message',
      status: 'complete',
      content: 'answer',
      children: [],
    };
    treeBuilder = {
      buildTree: jest.fn().mockReturnValue([tree]),
      clearCache: jest.fn(),
    };
    batchedUpdate = {
      scheduleUpdate: jest.fn(),
      flushSync: jest.fn(),
    };
    monitoredAgents = new Map();
    backgroundAgents = new Map();
    const agentMonitorStore = {
      onAgentStart: jest.fn((event: { toolCallId: string }) => {
        monitoredAgents.set(event.toolCallId, event);
      }),
      getSubagent: jest.fn().mockReturnValue(undefined),
      onTaskToolResult: jest.fn(),
      onAgentProgress: jest.fn(),
      onAgentStatus: jest.fn(),
      onAgentCompleted: jest.fn(),
    };
    const backgroundAgentStore = {
      onStarted: jest.fn((event: { toolCallId: string }) => {
        backgroundAgents.set(event.toolCallId, event);
      }),
      onCompleted: jest.fn(),
      onStopped: jest.fn(),
      isBackgroundAgent: jest.fn().mockReturnValue(false),
    };
    const sessionManager = {
      registerAgent: jest.fn().mockReturnValue([]),
    };

    TestBed.configureTestingModule({
      providers: [
        HistoryMessageBuilder,
        StreamingAccumulatorCore,
        EventDeduplicationService,
        {
          provide: ExecutionTreeBuilderService,
          useValue: treeBuilder,
        },
        { provide: BatchedUpdateService, useValue: batchedUpdate },
        { provide: AgentMonitorStore, useValue: agentMonitorStore },
        { provide: BackgroundAgentStore, useValue: backgroundAgentStore },
        { provide: SessionManager, useValue: sessionManager },
      ],
    });
    builder = TestBed.inject(HistoryMessageBuilder);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('builds the same messages for a tab tail and a scratch older page', () => {
    const state = historyState();

    const tail = builder.build(state, {
      cacheKey: 'tab-tab-1',
      releaseCacheAfterBuild: false,
      sessionId: 'session-1',
    });
    const page = builder.build(state, {
      cacheKey: 'history-page-tab-1',
      releaseCacheAfterBuild: true,
      sessionId: 'session-1',
    });

    expect(page).toEqual(tail);
    expect(page.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-tree',
    ]);
    expect(treeBuilder.clearCache).toHaveBeenCalledWith('history-page-tab-1');
  });

  it('accumulates without scheduling a tab update and registers repeated agent events idempotently', () => {
    const state = builder.createPageState();
    const agentStart = {
      id: 'agent-start-1',
      eventType: 'agent_start',
      messageId: 'assistant-1',
      timestamp: 1,
      source: 'history',
      toolCallId: 'tool-1',
      agentId: 'agent-1',
      agentType: 'Explore',
      agentDescription: 'inspect',
    } as FlatStreamEventUnion;
    const backgroundStarted = {
      id: 'background-start-1',
      eventType: 'background_agent_started',
      messageId: 'assistant-1',
      timestamp: 2,
      source: 'history',
      toolCallId: 'tool-1',
      agentId: 'agent-1',
      agentType: 'Explore',
      agentDescription: 'inspect',
    } as FlatStreamEventUnion;

    builder.accumulate(
      state,
      [agentStart, agentStart, backgroundStarted, backgroundStarted],
      'session-1',
    );

    expect(batchedUpdate.scheduleUpdate).not.toHaveBeenCalled();
    expect(monitoredAgents.size).toBe(1);
    expect(backgroundAgents.size).toBe(1);
  });

  it('propagates a throwing event without returning a partial list and releases the scratch key', () => {
    const accumulator = TestBed.inject(StreamingAccumulatorCore);
    jest.spyOn(accumulator, 'process').mockImplementation(() => {
      throw new Error('bad history event');
    });
    const cacheKey = 'history-page-tab-1';
    let result: unknown;

    expect(() => {
      try {
        const state = builder.accumulate(
          builder.createPageState(),
          [
            {
              id: 'bad',
              eventType: 'message_start',
              messageId: 'bad',
              role: 'user',
              timestamp: 1,
              source: 'history',
            } as FlatStreamEventUnion,
          ],
          'session-1',
        );
        result = builder.build(state, {
          cacheKey,
          releaseCacheAfterBuild: true,
          sessionId: 'session-1',
        });
      } finally {
        builder.clearCache(cacheKey);
      }
    }).toThrow('bad history event');
    expect(result).toBeUndefined();
    expect(treeBuilder.clearCache).toHaveBeenCalledWith(cacheKey);
  });

  it('clears a scratch key when tree construction throws', () => {
    treeBuilder.buildTree.mockImplementation(() => {
      throw new Error('tree failed');
    });

    expect(() =>
      builder.build(historyState(), {
        cacheKey: 'history-page-tab-1',
        releaseCacheAfterBuild: true,
        sessionId: 'session-1',
      }),
    ).toThrow('tree failed');
    expect(treeBuilder.clearCache).toHaveBeenCalledWith('history-page-tab-1');
  });
});
