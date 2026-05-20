import 'reflect-metadata';

import type { Logger } from '../../logging';
import type {
  FlatStreamEventUnion,
  AgentStartEvent,
  ToolResultEvent,
} from '@ptah-extension/shared';
import { SubagentStateStore } from './subagent-state-store';
import { SubagentHistoryRegistrar } from './subagent-history-registrar';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function makeAgentStart(
  overrides: Partial<AgentStartEvent> = {},
): AgentStartEvent {
  return {
    eventType: 'agent_start',
    toolCallId: 'tc-default',
    agentType: 'test-agent',
    agentId: 'agent-abc',
    sessionId: 'sess-1',
    timestamp: Date.now(),
    ...overrides,
  } as AgentStartEvent;
}

function makeToolResult(toolCallId: string): ToolResultEvent {
  return {
    eventType: 'tool_result',
    toolCallId,
    output: {},
    isError: false,
    sessionId: 'sess-1',
    timestamp: Date.now(),
  } as unknown as ToolResultEvent;
}

describe('SubagentHistoryRegistrar', () => {
  let logger: jest.Mocked<Logger>;
  let store: SubagentStateStore;
  let registrar: SubagentHistoryRegistrar;

  beforeEach(() => {
    logger = makeLogger();
    store = new SubagentStateStore(logger);
    registrar = new SubagentHistoryRegistrar(store, logger);
  });

  it('returns 0 and logs when there are no agent_start events', () => {
    const events: FlatStreamEventUnion[] = [
      makeToolResult('tc-other') as unknown as FlatStreamEventUnion,
    ];

    const count = registrar.register(events, 'parent-1');

    expect(count).toBe(0);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('No agent_start events found'),
      expect.objectContaining({ parentSessionId: 'parent-1' }),
    );
  });

  it('registers a single interrupted agent that has no tool_result', () => {
    const events: FlatStreamEventUnion[] = [
      makeAgentStart({
        toolCallId: 'tc-1',
        agentId: 'a1',
      }) as unknown as FlatStreamEventUnion,
    ];

    const count = registrar.register(events, 'parent-1');

    expect(count).toBe(1);
    expect(store.has('tc-1')).toBe(true);
    const record = store.getRaw('tc-1');
    expect(record?.status).toBe('interrupted');
    expect(record?.agentId).toBe('a1');
    expect(record?.parentSessionId).toBe('parent-1');
  });

  it('skips agent_start when a matching tool_result exists (completed agent)', () => {
    const events: FlatStreamEventUnion[] = [
      makeAgentStart({
        toolCallId: 'tc-done',
        agentId: 'a-done',
      }) as unknown as FlatStreamEventUnion,
      makeToolResult('tc-done') as unknown as FlatStreamEventUnion,
    ];

    const count = registrar.register(events, 'parent-1');

    expect(count).toBe(0);
    expect(store.has('tc-done')).toBe(false);
  });

  it('skips agents already in the store', () => {
    const start = makeAgentStart({
      toolCallId: 'tc-existing',
      agentId: 'a-exist',
    });
    store.set('tc-existing', {
      toolCallId: 'tc-existing',
      sessionId: 'sess-1',
      agentType: 'test-agent',
      status: 'running',
      startedAt: Date.now(),
      parentSessionId: 'parent-1',
      agentId: 'a-exist',
    });

    const events: FlatStreamEventUnion[] = [
      start as unknown as FlatStreamEventUnion,
    ];
    const count = registrar.register(events, 'parent-1');

    expect(count).toBe(0);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('already registered'),
      expect.anything(),
    );
  });

  it('skips agents that were previously injected', () => {
    const start = makeAgentStart({
      toolCallId: 'tc-injected',
      agentId: 'a-inj',
    });
    store.markInjected('tc-injected');

    const events: FlatStreamEventUnion[] = [
      start as unknown as FlatStreamEventUnion,
    ];
    const count = registrar.register(events, 'parent-1');

    expect(count).toBe(0);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('injected into context'),
      expect.anything(),
    );
  });

  it('skips agents without agentId', () => {
    const start = makeAgentStart({
      toolCallId: 'tc-no-id',
      agentId: undefined,
    });
    const events: FlatStreamEventUnion[] = [
      start as unknown as FlatStreamEventUnion,
    ];

    const count = registrar.register(events, 'parent-1');

    expect(count).toBe(0);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('without agentId'),
      expect.anything(),
    );
  });

  it('marks earlier tool calls as superseded when a later one for the same agentId completed', () => {
    const events: FlatStreamEventUnion[] = [
      makeAgentStart({
        toolCallId: 'tc-first',
        agentId: 'agent-resume',
      }) as unknown as FlatStreamEventUnion,
      makeAgentStart({
        toolCallId: 'tc-second',
        agentId: 'agent-resume',
      }) as unknown as FlatStreamEventUnion,
      makeToolResult('tc-second') as unknown as FlatStreamEventUnion,
    ];

    const count = registrar.register(events, 'parent-1');

    expect(count).toBe(0);
    expect(store.has('tc-first')).toBe(false);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('superseded'),
      expect.anything(),
    );
  });

  it('logs info when at least one agent is registered', () => {
    const events: FlatStreamEventUnion[] = [
      makeAgentStart({
        toolCallId: 'tc-a',
        agentId: 'a1',
      }) as unknown as FlatStreamEventUnion,
      makeAgentStart({
        toolCallId: 'tc-b',
        agentId: 'a2',
      }) as unknown as FlatStreamEventUnion,
    ];

    const count = registrar.register(events, 'parent-x');

    expect(count).toBe(2);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Registered interrupted agents from history'),
      expect.objectContaining({ registeredCount: 2 }),
    );
  });

  it('handles mixed completed and interrupted agents', () => {
    const events: FlatStreamEventUnion[] = [
      makeAgentStart({
        toolCallId: 'tc-done',
        agentId: 'a-done',
      }) as unknown as FlatStreamEventUnion,
      makeAgentStart({
        toolCallId: 'tc-interrupted',
        agentId: 'a-int',
      }) as unknown as FlatStreamEventUnion,
      makeToolResult('tc-done') as unknown as FlatStreamEventUnion,
    ];

    const count = registrar.register(events, 'parent-1');

    expect(count).toBe(1);
    expect(store.has('tc-done')).toBe(false);
    expect(store.has('tc-interrupted')).toBe(true);
  });

  it('skips agent_start with agentId=undefined even if it has a toolCallId', () => {
    const start: FlatStreamEventUnion = {
      eventType: 'agent_start',
      toolCallId: 'tc-no-agentid',
      agentType: 'some-agent',
      sessionId: 'sess-1',
      timestamp: Date.now(),
    } as unknown as FlatStreamEventUnion;

    const count = registrar.register([start], 'parent-1');

    expect(count).toBe(0);
  });
});
