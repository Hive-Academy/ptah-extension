import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type {
  FlatStreamEventUnion,
  MessageStartEvent,
  TextDeltaEvent,
  ToolStartEvent,
} from '@ptah-extension/shared';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import { StreamingAccumulatorCore } from './accumulator-core.service';
import { AgentMonitorStore, type SubagentRecord } from './agent-monitor.store';
import { BackgroundAgentStore } from './background-agent.store';
import { BatchedUpdateService } from './batched-update.service';
import { EventDeduplicationService } from './event-deduplication.service';
import { ExecutionTreeBuilderService } from './execution-tree-builder.service';
import { SessionManager } from './session-manager.service';
import { SubagentExecutionStore } from './subagent-execution.store';

const sessionId = 'session-1';
const start = (
  messageId: string,
  parentToolUseId = 'agent-a',
  source: 'stream' | 'history' | 'complete' = 'stream',
): MessageStartEvent => ({
  id: `${source}-start-${messageId}`,
  eventType: 'message_start',
  timestamp: 1,
  sessionId,
  messageId,
  parentToolUseId,
  role: 'assistant',
  source,
});
const delta = (
  messageId: string,
  value: string,
  id: string,
  source: 'stream' | 'history' | 'complete' = 'stream',
): TextDeltaEvent => ({
  id,
  eventType: 'text_delta',
  timestamp: 2,
  sessionId,
  messageId,
  parentToolUseId: 'agent-a',
  blockIndex: 0,
  delta: value,
  source,
});
const record = (
  key: string,
  status: SubagentRecord['status'] = 'running',
): SubagentRecord => ({
  parentToolUseId: key,
  parentSessionId: sessionId,
  status,
});
const page = (
  events: FlatStreamEventUnion[],
  nextCursor: string | null = null,
) => ({
  isSuccess: () => true,
  data: {
    status: 'ok',
    agentId: 'agent-id',
    events,
    nextCursor,
    done: nextCursor === null,
    truncated: false,
    clippedEvents: 0,
  },
});

describe('SubagentExecutionStore', () => {
  let store: SubagentExecutionStore;
  const rpc = { call: jest.fn() };
  const logger = { error: jest.fn(), warn: jest.fn() };
  const builder = {
    buildTree: jest.fn().mockReturnValue([]),
    clearCache: jest.fn(),
  };
  const subagents = signal<ReadonlyMap<string, SubagentRecord>>(new Map());

  beforeEach(() => {
    rpc.call.mockReset();
    builder.buildTree.mockClear();
    builder.clearCache.mockClear();
    logger.error.mockClear();
    logger.warn.mockClear();
    subagents.set(new Map());
    TestBed.configureTestingModule({
      providers: [
        SubagentExecutionStore,
        StreamingAccumulatorCore,
        EventDeduplicationService,
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: LoggingService, useValue: logger },
        { provide: ExecutionTreeBuilderService, useValue: builder },
        {
          provide: SessionManager,
          useValue: { registerAgent: jest.fn().mockReturnValue([]) },
        },
        { provide: BatchedUpdateService, useValue: {} },
        { provide: BackgroundAgentStore, useValue: {} },
        {
          provide: AgentMonitorStore,
          useValue: {
            subagents,
            onSubagentMessageComplete: jest.fn(),
            onAgentStart: jest.fn(),
          },
        },
      ],
    });
    store = TestBed.inject(SubagentExecutionStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('finalizes when the monitor publishes a terminal record', () => {
    const completed = record('agent-a', 'completed');
    store.claim(start('m'));
    subagents.set(new Map([['agent-a', completed]]));
    TestBed.flushEffects();
    expect(store.entries().get('agent-a')?.live).toBe(false);
  });

  it('keeps root agent starts in the tab and claims owned and nested events', () => {
    const root: FlatStreamEventUnion = {
      id: 'root',
      eventType: 'agent_start',
      timestamp: 0,
      sessionId,
      messageId: 'parent',
      toolCallId: 'agent-a',
      agentType: 'general',
    };
    expect(store.claim(root)).toBe(false);
    expect(store.entries().has('agent-a')).toBe(true);
    expect(store.claim(start('m-a'))).toBe(true);
    const tool: ToolStartEvent = {
      id: 'tool',
      eventType: 'tool_start',
      timestamp: 2,
      sessionId,
      messageId: 'm-a',
      toolCallId: 'nested',
      toolName: 'Task',
      isTaskTool: true,
    };
    expect(store.claim(tool)).toBe(true);
    expect(store.claim(start('m-nested', 'nested'))).toBe(true);
    expect(store.entries().get('agent-a')?.state?.events.size).toBe(3);
    expect(
      store.claim({
        id: 'progress',
        eventType: 'agent_progress',
        timestamp: 3,
        sessionId,
        messageId: 'm-a',
        parentToolUseId: 'agent-a',
        taskId: 'task',
        description: 'Working',
        totalTokens: 0,
        toolUses: 0,
        durationMs: 0,
      }),
    ).toBe(false);
  });

  it('isolates concurrent agents and keeps events across parent turns', () => {
    store.syncRecord(record('agent-a'));
    store.syncRecord(record('agent-b'));
    store.claim(start('a1'));
    store.claim(start('b1', 'agent-b'));
    store.claim(delta('a1', 'one', 'a-delta'));
    expect(store.entries().get('agent-a')?.state?.textAccumulators.size).toBe(
      1,
    );
    expect(store.entries().get('agent-b')?.state?.textAccumulators.size).toBe(
      0,
    );
    store.claim(delta('a1', ' two', 'late'));
    expect([
      ...store.entries().get('agent-a')!.state!.textAccumulators.values(),
    ]).toContain('one two');
  });

  it('finalizes once and opens a fresh state for a late event', () => {
    store.syncRecord(record('agent-a'));
    store.claim(start('m'));
    store.finalize('agent-a');
    expect(store.entries().get('agent-a')?.state).toBeNull();
    expect(store.claim(delta('m', 'late', 'late'))).toBe(true);
    const fresh = store.entries().get('agent-a')?.state;
    expect(fresh?.events.size).toBe(2); // retained start plus late delta
    expect(fresh?.messageEventIds).toEqual(['m']);
    expect([...fresh!.textAccumulators.values()]).toContain('late');
    store.treeFor('agent-a');
    expect(builder.buildTree).toHaveBeenCalledWith(fresh, 'subagent-agent-a', {
      rootParentToolUseId: 'agent-a',
    });
  });

  it('evicts the least recently read finalized entry and respects pins', () => {
    store.retain('agent-0');
    store.syncRecord(record('agent-0', 'completed'));
    for (let n = 1; n <= 21; n++) {
      const key = `agent-${n}`;
      store.syncRecord(record(key, 'completed'));
      if (n === 1) store.treeFor(key);
    }
    expect(store.entries().has('agent-0')).toBe(true);
    expect(store.entries().has('agent-2')).toBe(false);
    store.release('agent-0');
    store.clearSession(sessionId);
    expect(store.entries().size).toBe(0);
  });

  it('merges a same-id live prefix while a history page is pending', async () => {
    store.syncRecord(record('agent-a'));
    let resolve!: (value: ReturnType<typeof page>) => void;
    rpc.call.mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof page>>((r) => {
          resolve = r;
        }),
    );
    const loading = store.ensureHistory('agent-a');
    store.claim(start('m'));
    store.claim(delta('m', 'tail', 'tail'));
    resolve(
      page([
        start('m', 'agent-a', 'history'),
        delta('m', 'full prefix', 'history-text', 'history'),
      ]),
    );
    await loading;
    const entry = store.entries().get('agent-a')!;
    expect(entry.history).toBe('loaded');
    expect([...entry.state!.textAccumulators.values()]).toContain(
      'full prefix',
    );
    expect(entry.state!.messageEventIds).toHaveLength(1);
    expect(rpc.call).toHaveBeenCalledTimes(1);
  });

  it('keeps unmatched text-only live messages and repeated deltas', async () => {
    store.syncRecord(record('agent-a'));
    store.claim(start('synth'));
    store.claim(delta('synth', 'same', 'd1'));
    store.claim(delta('synth', 'same', 'd2'));
    rpc.call.mockResolvedValue(
      page([
        start('real', 'agent-a', 'history'),
        delta('real', 'same', 'h', 'history'),
      ]),
    );
    await store.ensureHistory('agent-a');
    const entry = store.entries().get('agent-a')!;
    expect(entry.state!.messageEventIds).toEqual(['real', 'synth']);
    expect([...entry.state!.textAccumulators.values()]).toContain('samesame');
    store.claim(delta('synth', 'more', 'd3'));
    expect([...entry.state!.textAccumulators.values()]).toContain(
      'samesamemore',
    );
  });

  it('aborts paging and ignores a late first response after clearSession', async () => {
    store.syncRecord(record('agent-a'));
    let resolve!: (value: ReturnType<typeof page>) => void;
    rpc.call.mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof page>>((r) => {
          resolve = r;
        }),
    );
    const loading = store.ensureHistory('agent-a');
    store.clearSession(sessionId);
    resolve(page([start('m', 'agent-a', 'history')], 'next'));
    await loading;
    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(store.entries().has('agent-a')).toBe(false);
  });

  it('shares a pending history request and aborts on the last release', async () => {
    store.syncRecord(record('agent-a'));
    store.retain('agent-a');
    let resolve!: (value: ReturnType<typeof page>) => void;
    rpc.call.mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof page>>((r) => {
          resolve = r;
        }),
    );
    const first = store.ensureHistory('agent-a');
    const second = store.ensureHistory('agent-a');
    expect(rpc.call).toHaveBeenCalledTimes(1);
    store.release('agent-a');
    resolve(page([start('m', 'agent-a', 'history')], 'next'));
    await Promise.all([first, second]);
    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(store.entries().get('agent-a')?.history).toBe('idle');
    expect(store.entries().get('agent-a')?.state).toBeNull();
  });

  it('starts a new request when a released view reopens before the old response', async () => {
    store.syncRecord(record('agent-a'));
    store.retain('agent-a');
    let resolveOld!: (value: ReturnType<typeof page>) => void;
    rpc.call
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof page>>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce(page([start('fresh', 'agent-a', 'history')]));
    const oldLoad = store.ensureHistory('agent-a');
    store.release('agent-a');
    store.retain('agent-a');
    await store.ensureHistory('agent-a');
    resolveOld(page([start('stale', 'agent-a', 'history')]));
    await oldLoad;
    expect(rpc.call).toHaveBeenCalledTimes(2);
    expect(store.entries().get('agent-a')?.history).toBe('loaded');
    expect(store.entries().get('agent-a')?.state?.messageEventIds).toEqual([
      'fresh',
    ]);
  });

  it('aborts after page two starts and ignores its late response', async () => {
    store.syncRecord(record('agent-a'));
    store.retain('agent-a');
    let resolveSecond!: (value: ReturnType<typeof page>) => void;
    rpc.call
      .mockResolvedValueOnce(
        page([start('first', 'agent-a', 'history')], 'next'),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof page>>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const loading = store.ensureHistory('agent-a');
    await Promise.resolve();
    await Promise.resolve();
    store.release('agent-a');
    resolveSecond(page([start('second', 'agent-a', 'history')]));
    await loading;
    expect(rpc.call).toHaveBeenCalledTimes(2);
    expect(store.entries().get('agent-a')?.history).toBe('idle');
    expect(store.entries().get('agent-a')?.state).toBeNull();
  });

  it('reloads a loaded truncated entry on demand', async () => {
    store.syncRecord(record('agent-a'));
    rpc.call
      .mockResolvedValueOnce({
        ...page([]),
        data: { ...page([]).data, truncated: true },
      })
      .mockResolvedValueOnce(page([]));
    await store.ensureHistory('agent-a');
    await store.ensureHistory('agent-a');
    expect(rpc.call).toHaveBeenCalledTimes(2);
  });

  it('claims late events after the owner index evicts their message id', () => {
    store.syncRecord(record('agent-a'));
    for (let index = 0; index <= 4000; index++) {
      store.claim(start(`message-${index}`));
    }
    expect(
      store.claim({
        ...delta('message-0', 'late', 'late-owner'),
        parentToolUseId: undefined,
      }),
    ).toBe(true);
  });

  it('keeps an owned event out of the tab when accumulation throws', () => {
    store.syncRecord(record('agent-a'));
    store.claim(start('m'));
    const accumulator = TestBed.inject(StreamingAccumulatorCore);
    jest.spyOn(accumulator, 'process').mockImplementationOnce(() => {
      throw new Error('bad owned event');
    });
    expect(store.claim(delta('m', 'failed', 'failed'))).toBe(true);
    expect(store.entries().get('agent-a')?.truncated).toBe(true);
    expect(logger.error).toHaveBeenCalled();
  });

  it('spills at the total live cap and aborts history for the spilled entry', async () => {
    store.syncRecord(record('agent-a'));
    store.claim(start('first'));
    let resolve!: (value: ReturnType<typeof page>) => void;
    rpc.call.mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof page>>((done) => {
          resolve = done;
        }),
    );
    const loading = store.ensureHistory('agent-a');
    for (let agent = 0; agent < 6; agent++) {
      const key = `spill-${agent}`;
      store.syncRecord(record(key));
      for (let index = 0; index < 1800; index++) {
        store.claim(start(`${key}-${index}`, key));
      }
    }
    expect(store.entries().get('agent-a')?.spilled).toBe(true);
    resolve(page([start('old', 'agent-a', 'history')]));
    await loading;
    expect(store.entries().get('agent-a')?.history).toBe('idle');
    expect(store.entries().get('agent-a')?.state).toBeNull();
    const total = [...store.entries().values()].reduce(
      (count, entry) => count + (entry.state?.events.size ?? 0),
      0,
    );
    expect(total).toBeLessThanOrEqual(10000);
  });

  it('aliases a live tool message to its snapshot id and keeps a new tail block', async () => {
    store.syncRecord(record('agent-a'));
    store.claim(start('synth'));
    const tool: ToolStartEvent = {
      id: 'live-tool',
      eventType: 'tool_start',
      timestamp: 2,
      sessionId,
      messageId: 'synth',
      parentToolUseId: 'agent-a',
      toolCallId: 'toolu_same',
      toolName: 'Read',
      isTaskTool: false,
      source: 'stream',
    };
    store.claim(tool);
    store.claim({ ...delta('synth', 'tail', 'tail'), blockIndex: 1 });
    rpc.call.mockResolvedValue(
      page([
        start('real', 'agent-a', 'history'),
        { ...tool, id: 'history-tool', messageId: 'real', source: 'history' },
      ]),
    );
    await store.ensureHistory('agent-a');
    const entry = store.entries().get('agent-a')!;
    expect(entry.state?.messageEventIds).toEqual(['real']);
    expect([...entry.state!.textAccumulators.values()]).toContain('tail');
  });

  it('takes snapshot output into finalized when there is no live state', async () => {
    store.syncRecord(record('agent-a', 'completed'));
    rpc.call.mockResolvedValue(page([start('real', 'agent-a', 'history')]));
    await store.ensureHistory('agent-a');
    expect(store.entries().get('agent-a')?.state).toBeNull();
    expect(builder.buildTree).toHaveBeenCalled();
  });

  it.each(['not-found', 'unresolved'] as const)(
    'exposes %s distinctly',
    async (status) => {
      store.syncRecord(record('agent-a'));
      rpc.call.mockResolvedValue({
        isSuccess: () => true,
        data: { ...page([]).data, status },
      });
      await store.ensureHistory('agent-a');
      expect(store.entries().get('agent-a')?.history).toBe(status);
    },
  );

  it('distinguishes loaded empty from error and permits a retry', async () => {
    store.syncRecord(record('agent-a'));
    rpc.call.mockResolvedValueOnce({
      isSuccess: () => false,
      error: 'offline',
    });
    await store.ensureHistory('agent-a');
    expect(store.entries().get('agent-a')?.history).toBe('error');
    rpc.call.mockResolvedValueOnce(page([]));
    await store.ensureHistory('agent-a');
    expect(store.entries().get('agent-a')?.history).toBe('loaded');
    expect(store.entries().get('agent-a')?.state?.events.size).toBe(0);
  });

  it('stops paging and records an error when a cursor repeats', async () => {
    store.syncRecord(record('agent-a'));
    rpc.call.mockResolvedValue(page([], 'same'));
    await store.ensureHistory('agent-a');
    expect(rpc.call).toHaveBeenCalledTimes(2);
    expect(store.entries().get('agent-a')).toMatchObject({
      history: 'error',
      historyError: 'Agent history cursor did not advance',
    });
    expect(logger.warn).toHaveBeenCalled();
  });
});
