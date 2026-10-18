import { TestBed } from '@angular/core/testing';
import type { FlatStreamEventUnion, MessageStartEvent, TextDeltaEvent, ToolStartEvent } from '@ptah-extension/shared';
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
const start = (messageId: string, parentToolUseId = 'agent-a', source: 'stream' | 'history' | 'complete' = 'stream'): MessageStartEvent => ({
  id: `${source}-start-${messageId}`, eventType: 'message_start', timestamp: 1,
  sessionId, messageId, parentToolUseId, role: 'assistant', source,
});
const delta = (messageId: string, value: string, id: string, source: 'stream' | 'history' | 'complete' = 'stream'): TextDeltaEvent => ({
  id, eventType: 'text_delta', timestamp: 2, sessionId, messageId,
  parentToolUseId: 'agent-a', blockIndex: 0, delta: value, source,
});
const record = (key: string, status: SubagentRecord['status'] = 'running'): SubagentRecord => ({
  parentToolUseId: key, parentSessionId: sessionId, status,
});
const page = (events: FlatStreamEventUnion[], nextCursor: string | null = null) => ({
  isSuccess: () => true,
  data: { status: 'ok', agentId: 'agent-id', events, nextCursor, done: nextCursor === null, truncated: false, clippedEvents: 0 },
});

describe('SubagentExecutionStore', () => {
  let store: SubagentExecutionStore;
  const rpc = { call: jest.fn() };
  const logger = { error: jest.fn(), warn: jest.fn() };
  const builder = { buildTree: jest.fn().mockReturnValue([]), clearCache: jest.fn() };

  beforeEach(() => {
    rpc.call.mockReset();
    builder.buildTree.mockClear();
    builder.clearCache.mockClear();
    logger.error.mockClear();
    logger.warn.mockClear();
    TestBed.configureTestingModule({ providers: [
      SubagentExecutionStore, StreamingAccumulatorCore, EventDeduplicationService,
      { provide: ClaudeRpcService, useValue: rpc },
      { provide: LoggingService, useValue: logger },
      { provide: ExecutionTreeBuilderService, useValue: builder },
      { provide: SessionManager, useValue: { registerAgent: jest.fn().mockReturnValue([]) } },
      { provide: BatchedUpdateService, useValue: {} },
      { provide: BackgroundAgentStore, useValue: {} },
      { provide: AgentMonitorStore, useValue: { onSubagentMessageComplete: jest.fn(), onAgentStart: jest.fn() } },
    ] });
    store = TestBed.inject(SubagentExecutionStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('keeps root agent starts in the tab and claims owned and nested events', () => {
    const root: FlatStreamEventUnion = { id: 'root', eventType: 'agent_start', timestamp: 0,
      sessionId, messageId: 'parent', toolCallId: 'agent-a', agentType: 'general' };
    expect(store.claim(root)).toBe(false);
    expect(store.entries().has('agent-a')).toBe(true);
    expect(store.claim(start('m-a'))).toBe(true);
    const tool: ToolStartEvent = { id: 'tool', eventType: 'tool_start', timestamp: 2,
      sessionId, messageId: 'm-a', toolCallId: 'nested', toolName: 'Task', isTaskTool: true };
    expect(store.claim(tool)).toBe(true);
    expect(store.claim(start('m-nested', 'nested'))).toBe(true);
    expect(store.entries().get('agent-a')?.state?.events.size).toBe(3);
    expect(store.claim({ id: 'progress', eventType: 'agent_progress', timestamp: 3,
      sessionId, messageId: 'm-a', parentToolUseId: 'agent-a', taskId: 'task',
      description: 'Working', totalTokens: 0, toolUses: 0, durationMs: 0 })).toBe(false);
  });

  it('isolates concurrent agents and keeps events across parent turns', () => {
    store.syncRecord(record('agent-a'));
    store.syncRecord(record('agent-b'));
    store.claim(start('a1'));
    store.claim(start('b1', 'agent-b'));
    store.claim(delta('a1', 'one', 'a-delta'));
    expect(store.entries().get('agent-a')?.state?.textAccumulators.size).toBe(1);
    expect(store.entries().get('agent-b')?.state?.textAccumulators.size).toBe(0);
    store.claim(delta('a1', ' two', 'late'));
    expect([...store.entries().get('agent-a')!.state!.textAccumulators.values()]).toContain('one two');
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
    expect(builder.buildTree).toHaveBeenCalledWith(fresh, 'subagent-agent-a', { rootParentToolUseId: 'agent-a' });
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
    rpc.call.mockImplementationOnce(() => new Promise<ReturnType<typeof page>>(r => { resolve = r; }));
    const loading = store.ensureHistory('agent-a');
    store.claim(start('m'));
    store.claim(delta('m', 'tail', 'tail'));
    resolve(page([start('m', 'agent-a', 'history'), delta('m', 'full prefix', 'history-text', 'history')]));
    await loading;
    const entry = store.entries().get('agent-a')!;
    expect(entry.history).toBe('loaded');
    expect([...entry.state!.textAccumulators.values()]).toContain('full prefix');
    expect(entry.state!.messageEventIds).toHaveLength(1);
    expect(rpc.call).toHaveBeenCalledTimes(1);
  });

  it('keeps unmatched text-only live messages and repeated deltas', async () => {
    store.syncRecord(record('agent-a'));
    store.claim(start('synth'));
    store.claim(delta('synth', 'same', 'd1'));
    store.claim(delta('synth', 'same', 'd2'));
    rpc.call.mockResolvedValue(page([start('real', 'agent-a', 'history'), delta('real', 'same', 'h', 'history')]));
    await store.ensureHistory('agent-a');
    const entry = store.entries().get('agent-a')!;
    expect(entry.state!.messageEventIds).toEqual(['real', 'synth']);
    expect([...entry.state!.textAccumulators.values()]).toContain('samesame');
    store.claim(delta('synth', 'more', 'd3'));
    expect([...entry.state!.textAccumulators.values()]).toContain('samesamemore');
  });

  it('aborts paging and ignores a late first response after clearSession', async () => {
    store.syncRecord(record('agent-a'));
    let resolve!: (value: ReturnType<typeof page>) => void;
    rpc.call.mockImplementationOnce(() => new Promise<ReturnType<typeof page>>(r => { resolve = r; }));
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
    rpc.call.mockImplementationOnce(() => new Promise<ReturnType<typeof page>>(r => { resolve = r; }));
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

  it('aliases a live tool message to its snapshot id and keeps a new tail block', async () => {
    store.syncRecord(record('agent-a'));
    store.claim(start('synth'));
    const tool: ToolStartEvent = { id: 'live-tool', eventType: 'tool_start', timestamp: 2,
      sessionId, messageId: 'synth', parentToolUseId: 'agent-a', toolCallId: 'toolu_same',
      toolName: 'Read', isTaskTool: false, source: 'stream' };
    store.claim(tool);
    store.claim({ ...delta('synth', 'tail', 'tail'), blockIndex: 1 });
    rpc.call.mockResolvedValue(page([
      start('real', 'agent-a', 'history'),
      { ...tool, id: 'history-tool', messageId: 'real', source: 'history' },
    ]));
    await store.ensureHistory('agent-a');
    const entry = store.entries().get('agent-a')!;
    expect(entry.idAlias.get('synth')).toBe('real');
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

  it.each(['not-found', 'unresolved'] as const)('exposes %s distinctly', async status => {
    store.syncRecord(record('agent-a'));
    rpc.call.mockResolvedValue({ isSuccess: () => true, data: { ...page([]).data, status } });
    await store.ensureHistory('agent-a');
    expect(store.entries().get('agent-a')?.history).toBe(status);
  });

  it('distinguishes loaded empty from error and permits a retry', async () => {
    store.syncRecord(record('agent-a'));
    rpc.call.mockResolvedValueOnce({ isSuccess: () => false, error: 'offline' });
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
      history: 'error', historyError: 'Agent history cursor did not advance',
    });
    expect(logger.warn).toHaveBeenCalled();
  });
});
