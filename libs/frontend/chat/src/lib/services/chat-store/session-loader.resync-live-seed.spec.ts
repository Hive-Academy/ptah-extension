import { TestBed } from '@angular/core/testing';
import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  ConfirmationDialogService,
  ConversationRegistry,
  MODEL_REFRESH_CONTROL,
  SessionLivenessRegistry,
  TabManagerService,
  TabSessionBinding,
  TabWorkspacePartitionService,
} from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  BackgroundAgentStore,
  BatchedUpdateService,
  EventDeduplicationService,
  ExecutionTreeBuilderService,
  HistoryMessageBuilder,
  MessageFinalizationService,
  PermissionHandlerService,
  SessionManager,
  StreamingAccumulatorCore,
  StreamingHandlerService,
  TurnStateApplier,
} from '@ptah-extension/chat-streaming';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import { SessionId, TabId } from '@ptah-extension/shared';
import { HistoryPagingService } from './history-paging.service';
import { SessionHistoryReplayer } from './session-history-replayer.service';
import { SessionLivenessReconcilerService } from './session-liveness-reconciler.service';
import { SessionLoaderService } from './session-loader.service';
import { StreamViewportController } from '../stream-viewport-controller.service';
import { summarizeTodos } from '@ptah-extension/chat-ui';

describe('SessionLoaderService resync live seed (R-F4)', () => {
  const workspacePath = 'D:/repo';
  const historicalMessageId = '4b1f2d30-14c9-4d42-94c4-e0068200a100';
  const liveMessageId = 'S';
  const taskToolCallId = 'toolu_task_in_history';
  let rpcCall: jest.Mock;
  let loader: SessionLoaderService;
  let replayer: SessionHistoryReplayer;
  let streamingHandler: StreamingHandlerService;
  let tabManager: TabManagerService;
  let batchedUpdate: BatchedUpdateService;
  let treeBuilder: ExecutionTreeBuilderService;
  let finishResume: ((reply: unknown) => void) | undefined;

  function event(
    sessionId: SessionId,
    id: string,
    eventType: FlatStreamEventUnion['eventType'],
    messageId: string,
    details: Record<string, unknown> = {},
  ): FlatStreamEventUnion {
    return {
      id,
      eventType,
      timestamp: Date.now(),
      sessionId,
      messageId,
      source: 'stream',
      ...details,
    } as FlatStreamEventUnion;
  }

  function generating(sessionId: SessionId, revision: number): FlatStreamEventUnion {
    return event(sessionId, `generating-${revision}`, 'turn_state',
      `turn-state-${sessionId}`, {
        phase: 'generating', revision, backgroundTasks: [], sessionCrons: [],
        terminalReason: null,
      });
  }

  function history(sessionId: SessionId): FlatStreamEventUnion[] {
    return [
      event(sessionId, 'history-start', 'message_start', historicalMessageId,
        { role: 'assistant' }),
      event(sessionId, 'history-text', 'text_delta', historicalMessageId,
        { blockIndex: 0, delta: 'persisted history' }),
      event(sessionId, 'history-complete', 'message_complete', historicalMessageId,
        { stopReason: 'end_turn' }),
    ];
  }

  function tab(tabId: TabId) {
    return tabManager.tabs().find((candidate) => candidate.id === tabId)!;
  }

  function accumulatedText(tabId: TabId, messageId: string): string {
    return [...(tab(tabId).streamingState?.textAccumulators ?? new Map()).entries()]
      .filter(([key]) => key.startsWith(`${messageId}-`))
      .map(([, value]) => value)
      .join('');
  }

  function deliverLive(
    streamEvent: FlatStreamEventUnion,
    tabId: TabId,
    sessionId: SessionId,
  ): boolean {
    const deliver = (): void => {
      streamingHandler.processStreamEvent(streamEvent, tabId, sessionId,
        { fanOut: false });
    };
    const deferred = replayer.deferLiveEvent(streamEvent, tabId, sessionId, deliver);
    if (!deferred) deliver();
    return deferred;
  }

  function seed(
    events: FlatStreamEventUnion[],
    tabId: TabId,
    sessionId: SessionId,
  ) {
    return {
      events,
      apply: (kept: readonly FlatStreamEventUnion[]): void => {
        for (const streamEvent of kept) {
          streamingHandler.processStreamEvent(streamEvent, tabId, sessionId,
            { fanOut: false });
        }
      },
    };
  }

  async function waitForResume(): Promise<void> {
    for (let i = 0; i < 20 &&
      !rpcCall.mock.calls.some(([method]) => method === 'chat:resume'); i++) {
      await Promise.resolve();
    }
    expect(rpcCall).toHaveBeenCalledWith('chat:resume',
      expect.anything(), expect.anything());
  }

  beforeEach(() => {
    localStorage.clear();
    const resumeReply = new Promise<unknown>((resolve) => { finishResume = resolve; });
    rpcCall = jest.fn((method: string) => {
      if (method === 'chat:resume') return resumeReply;
      if (method === 'session:status') {
        return Promise.resolve({ success: true, data: {
          isActive: true,
          turnState: {
            phase: 'generating', revision: 12, backgroundTasks: [],
            sessionCrons: [], terminalReason: null,
          },
        } });
      }
      return Promise.resolve({ success: true, data: {} });
    });
    TestBed.configureTestingModule({
      providers: [
        provideSurfaceActiveTesting(),
        SessionLoaderService,
        SessionHistoryReplayer,
        SessionLivenessReconcilerService,
        HistoryPagingService,
        TabManagerService,
        TabWorkspacePartitionService,
        ConversationRegistry,
        TabSessionBinding,
        SessionLivenessRegistry,
        BatchedUpdateService,
        StreamingHandlerService,
        StreamingAccumulatorCore,
        EventDeduplicationService,
        MessageFinalizationService,
        HistoryMessageBuilder,
        ExecutionTreeBuilderService,
        TurnStateApplier,
        PermissionHandlerService,
        SessionManager,
        BackgroundAgentStore,
        AgentMonitorStore,
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        { provide: VSCodeService, useValue: {
          isElectron: true,
          config: () => ({ workspaceRoot: workspacePath }),
        } },
        { provide: ConfirmationDialogService, useValue: {
          confirm: jest.fn().mockResolvedValue(true),
        } },
        { provide: MODEL_REFRESH_CONTROL, useValue: {
          refreshModels: jest.fn().mockResolvedValue(undefined),
        } },
        { provide: StreamViewportController, useValue: {
          requestStreamResync: jest.fn().mockResolvedValue(undefined),
        } },
      ],
    });
    loader = TestBed.inject(SessionLoaderService);
    replayer = TestBed.inject(SessionHistoryReplayer);
    streamingHandler = TestBed.inject(StreamingHandlerService);
    tabManager = TestBed.inject(TabManagerService);
    batchedUpdate = TestBed.inject(BatchedUpdateService);
    treeBuilder = TestBed.inject(ExecutionTreeBuilderService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  function openStreamingTab(sessionId: SessionId): TabId {
    tabManager.switchWorkspace(workspacePath);
    const tabId = tabManager.openSessionTab(sessionId, 'Live session') as TabId;
    streamingHandler.processStreamEvent(
      event(sessionId, 'old-start', 'message_start', liveMessageId,
        { role: 'assistant' }), tabId, sessionId, { fanOut: false });
    streamingHandler.processStreamEvent(
      event(sessionId, 'old-text', 'text_delta', liveMessageId,
        { blockIndex: 0, delta: 'old' }), tabId, sessionId, { fanOut: false });
    batchedUpdate.flushSync();
    tabManager.markStreaming(tabId);
    expect(tab(tabId).status).toBe('streaming');
    return tabId;
  }

  it('R-F4 restores the seeded start and hidden text before a fenced live delta', async () => {
    const sessionId = SessionId.create();
    const tabId = openStreamingTab(sessionId);
    const pending = loader.switchSession(sessionId, {
      reason: 'resync', targetTabId: tabId,
      liveSeed: seed([
        generating(sessionId, 11),
        event(sessionId, 'seed-start', 'message_start', liveMessageId,
          { role: 'assistant' }),
        event(sessionId, 'seed-hidden', 'text_delta', liveMessageId,
          { blockIndex: 0, delta: 'hidden' }),
      ], tabId, sessionId),
    });
    await waitForResume();
    expect(deliverLive(event(sessionId, 'live-delta', 'text_delta', liveMessageId,
      { blockIndex: 0, delta: 'live' }), tabId, sessionId)).toBe(true);
    finishResume?.({ success: true, data: { events: history(sessionId) } });
    await expect(pending).resolves.toEqual({ staleSnapshot: false });
    batchedUpdate.flushSync();

    const target = tab(tabId);
    expect(target.streamingState?.eventsByMessage.get(liveMessageId))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'seed-start', eventType: 'message_start' }),
      ]));
    expect(accumulatedText(tabId, liveMessageId)).toBe('hiddenlive');
    expect(target.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'history-start', role: 'assistant' }),
    ]));
    expect(target.status).toBe('streaming');
    expect(target.lastTurnStateRevision).toBe(11);
    expect(rpcCall).not.toHaveBeenCalledWith('session:status', expect.anything());
  });

  it('R-F4 status variant probes a missing seed turn state and restores streaming', async () => {
    const sessionId = SessionId.create();
    const tabId = openStreamingTab(sessionId);
    const pending = loader.switchSession(sessionId, {
      reason: 'resync', targetTabId: tabId,
      liveSeed: seed([
        event(sessionId, 'seed-start', 'message_start', liveMessageId,
          { role: 'assistant' }),
        event(sessionId, 'seed-hidden', 'text_delta', liveMessageId,
          { blockIndex: 0, delta: 'hidden' }),
      ], tabId, sessionId),
    });
    await waitForResume();
    finishResume?.({ success: true, data: { events: history(sessionId) } });
    await expect(pending).resolves.toEqual({ staleSnapshot: false });
    for (let i = 0; i < 20 && tab(tabId).status !== 'streaming'; i++) {
      await Promise.resolve();
    }

    expect(rpcCall).toHaveBeenCalledWith('session:status', { sessionId });
    expect(tab(tabId).status).toBe('streaming');
    expect(tab(tabId).lastTurnStateRevision).toBe(12);
  });

  it('A-2 keeps the Task owner live through a seeded subagent continuation', async () => {
    const sessionId = SessionId.create();
    const tabId = openStreamingTab(sessionId);
    const taskHistory: FlatStreamEventUnion[] = [
      event(sessionId, 'task-history-start', 'message_start', historicalMessageId,
        { role: 'assistant' }),
      event(sessionId, 'task-history-tool', 'tool_start', historicalMessageId, {
        toolCallId: taskToolCallId, toolName: 'Task', isTaskTool: true,
        agentType: 'researcher', agentDescription: 'Research topic',
      }),
      event(sessionId, 'task-history-complete', 'message_complete',
        historicalMessageId, { stopReason: 'end_turn' }),
    ];
    const pending = loader.switchSession(sessionId, {
      reason: 'resync', targetTabId: tabId,
      liveSeed: seed([
        generating(sessionId, 11),
        event(sessionId, 'seed-agent-start', 'agent_start', 'subagent-message', {
          parentToolUseId: taskToolCallId, toolCallId: taskToolCallId,
          agentType: 'researcher', agentDescription: 'Research topic',
          agentId: 'agent-seeded',
        }),
        event(sessionId, 'seed-subagent-start', 'message_start',
          'subagent-message', { role: 'assistant', parentToolUseId: taskToolCallId }),
        event(sessionId, 'seed-subagent-text', 'text_delta',
          'subagent-message', { blockIndex: 0, delta: 'subagent live text' }),
      ], tabId, sessionId),
    });
    await waitForResume();
    finishResume?.({ success: true, data: { events: taskHistory } });
    await expect(pending).resolves.toEqual({ staleSnapshot: false });
    deliverLive(event(sessionId, 'later-subagent-text', 'text_delta',
      'subagent-message', { blockIndex: 0, delta: ' and later' }), tabId, sessionId);
    batchedUpdate.flushSync();

    const target = tab(tabId);
    expect(target.messages.some((message) => message.id === 'task-history-start')).toBe(false);
    expect(target.streamingState?.messageEventIds).toContain(historicalMessageId);
    expect(target.streamingState?.eventsByMessage.get('subagent-message'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'seed-subagent-start',
          parentToolUseId: taskToolCallId }),
      ]));
    const liveState = target.streamingState;
    if (!liveState) throw new Error('A-2: the Task owner has no live streaming state');
    const roots = treeBuilder.buildTree(liveState, `tab-${tabId}-assert`);
    expect(roots.map((root) => root.id)).toEqual(['task-history-start']);
    const taskNode = roots[0].children.find(
      (node) => node.toolCallId === taskToolCallId,
    );
    expect(taskNode).toBeDefined();
    const rendered = JSON.stringify(taskNode?.children);
    expect(rendered.match(/subagent live text/g)).toHaveLength(1);
    expect(rendered.match(/and later/g)).toHaveLength(1);
    expect(target.messages.filter((message) => message.id === roots[0].id)).toHaveLength(0);
    TestBed.inject(MessageFinalizationService).finalizeCurrentMessage(tabId);
    const finalized = tab(tabId).messages;
    expect(finalized.filter((message) => message.id === 'task-history-start')).toHaveLength(1);
    expect(JSON.stringify(finalized.find((message) => message.id === 'task-history-start'))
      .match(/subagent live text/g)).toHaveLength(1);
  });

  it('resync renders a nested Task seed once beneath its materialized root', async () => {
    const sessionId = SessionId.create();
    const tabId = openStreamingTab(sessionId);
    const root = 'nested-root';
    const outer = 'toolu_outer';
    const inner = 'toolu_inner';
    const taskHistory = [
      event(sessionId, 'nested-root-start', 'message_start', root, { role: 'assistant' }),
      event(sessionId, 'nested-outer-tool', 'tool_start', root,
        { toolCallId: outer, toolName: 'Task', isTaskTool: true }),
      event(sessionId, 'nested-sub-start', 'message_start', 'nested-sub',
        { role: 'assistant', parentToolUseId: outer }),
      event(sessionId, 'nested-inner-tool', 'tool_start', 'nested-sub',
        { toolCallId: inner, toolName: 'Task', isTaskTool: true }),
    ];
    const pending = loader.switchSession(sessionId, {
      reason: 'resync', targetTabId: tabId,
      liveSeed: seed([
        generating(sessionId, 11),
        event(sessionId, 'nested-agent', 'agent_start', 'nested-leaf',
          { parentToolUseId: inner, toolCallId: inner, agentId: 'nested-agent-id' }),
        event(sessionId, 'nested-leaf-start', 'message_start', 'nested-leaf',
          { role: 'assistant', parentToolUseId: inner }),
        event(sessionId, 'nested-leaf-text', 'text_delta', 'nested-leaf',
          { blockIndex: 0, delta: 'nested live tail' }),
      ], tabId, sessionId),
    });
    await waitForResume();
    finishResume?.({ success: true, data: { events: taskHistory } });
    await expect(pending).resolves.toEqual({ staleSnapshot: false });
    batchedUpdate.flushSync();
    const target = tab(tabId);
    expect(target.messages.some((message) => message.id === 'nested-root-start')).toBe(false);
    const state = target.streamingState;
    if (!state) throw new Error('nested Task owner has no live state');
    const roots = treeBuilder.buildTree(state, `nested-${tabId}`);
    expect(roots.map((node) => node.id)).toEqual(['nested-root-start']);
    expect(JSON.stringify(roots).match(/nested live tail/g)).toHaveLength(1);
  });

  it('resync keeps two seeded Task owners live and renders each tail once', async () => {
    const sessionId = SessionId.create();
    const tabId = openStreamingTab(sessionId);
    const taskHistory = ['first', 'second'].flatMap((name) => [
      event(sessionId, `${name}-start`, 'message_start', `${name}-root`, { role: 'assistant' }),
      event(sessionId, `${name}-tool`, 'tool_start', `${name}-root`,
        { toolCallId: `${name}-task`, toolName: 'Task', isTaskTool: true }),
      ...(name === 'first' ? [event(sessionId, 'between-users', 'message_start',
        'between-users', { role: 'user' })] : []),
    ]);
    const liveEvents = ['first', 'second'].flatMap((name) => [
      event(sessionId, `${name}-agent`, 'agent_start', `${name}-sub`,
        { parentToolUseId: `${name}-task`, toolCallId: `${name}-task`, agentId: `${name}-agent-id` }),
      event(sessionId, `${name}-sub-start`, 'message_start', `${name}-sub`,
        { role: 'assistant', parentToolUseId: `${name}-task` }),
      event(sessionId, `${name}-sub-text`, 'text_delta', `${name}-sub`,
        { blockIndex: 0, delta: `${name} live tail` }),
    ]);
    const pending = loader.switchSession(sessionId, {
      reason: 'resync', targetTabId: tabId,
      liveSeed: seed([generating(sessionId, 11), ...liveEvents], tabId, sessionId),
    });
    await waitForResume();
    finishResume?.({ success: true, data: { events: taskHistory } });
    await expect(pending).resolves.toEqual({ staleSnapshot: false });
    batchedUpdate.flushSync();
    const state = tab(tabId).streamingState;
    if (!state) throw new Error('two Task owners have no live state');
    const roots = treeBuilder.buildTree(state, `two-${tabId}`);
    expect(state.messageEventIds).toEqual(expect.arrayContaining(['first-root', 'second-root']));
    expect(roots.map((node) => node.id)).toEqual(['first-start', 'second-start']);
    expect(tab(tabId).messages.map((message) => message.id)).toEqual(['between-users']);
    for (const name of ['first', 'second']) {
      expect(JSON.stringify(roots).match(new RegExp(`${name} live tail`, 'g'))).toHaveLength(1);
    }
    TestBed.inject(MessageFinalizationService).finalizeCurrentMessage(tabId);
    expect(tab(tabId).messages.map((message) => message.id))
      .toEqual(['first-start', 'between-users', 'second-start']);
  });

  it('finalizes a non-last Task owner before later frozen rows', async () => {
    const sessionId = SessionId.create();
    const tabId = openStreamingTab(sessionId);
    const base = Date.now() - 10_000;
    const taskHistory = [
      event(sessionId, 'user-1-start', 'message_start', 'user-1',
        { role: 'user', timestamp: base + 100 }),
      event(sessionId, 'owner-start', 'message_start', 'owner',
        { role: 'assistant', timestamp: base + 200 }),
      event(sessionId, 'owner-tool', 'tool_start', 'owner',
        { toolCallId: 'owner-task', toolName: 'Task', isTaskTool: true, timestamp: base + 210 }),
      event(sessionId, 'user-2-start', 'message_start', 'user-2',
        { role: 'user', timestamp: base + 300 }),
      event(sessionId, 'assistant-2-start', 'message_start', 'assistant-2',
        { role: 'assistant', timestamp: base + 400 }),
      event(sessionId, 'assistant-2-text', 'text_delta', 'assistant-2',
        { blockIndex: 0, delta: 'later reply', timestamp: base + 410 }),
    ];
    const pending = loader.switchSession(sessionId, {
      reason: 'resync', targetTabId: tabId,
      liveSeed: seed([
        generating(sessionId, 11),
        event(sessionId, 'owner-agent', 'agent_start', 'owner-sub',
          { parentToolUseId: 'owner-task', toolCallId: 'owner-task', agentId: 'owner-agent-id' }),
        event(sessionId, 'owner-sub-start', 'message_start', 'owner-sub',
          { role: 'assistant', parentToolUseId: 'owner-task' }),
        event(sessionId, 'owner-sub-text', 'text_delta', 'owner-sub',
          { blockIndex: 0, delta: 'live owner' }),
      ], tabId, sessionId),
    });
    await waitForResume();
    finishResume?.({ success: true, data: { events: taskHistory } });
    await expect(pending).resolves.toEqual({ staleSnapshot: false });
    TestBed.inject(MessageFinalizationService).finalizeCurrentMessage(tabId);
    const ids = tab(tabId).messages.map((message) => message.id);
    expect(ids).toEqual(['user-1', 'owner-start', 'user-2', 'assistant-2-start']);
    expect(ids.filter((id) => id === 'owner-start')).toHaveLength(1);
  });

  it('keeps earlier finalized TodoWrite visible while a later Task owner streams', async () => {
    const sessionId = SessionId.create();
    const tabId = openStreamingTab(sessionId);
    const taskHistory = [
      event(sessionId, 'todo-root-start', 'message_start', 'todo-root', { role: 'assistant' }),
      event(sessionId, 'todo-tool', 'tool_start', 'todo-root', {
        toolCallId: 'todo-call', toolName: 'TodoWrite',
        toolInput: { todos: [{ content: 'Ship fix', activeForm: 'Shipping fix', status: 'in_progress' }] },
      }),
      event(sessionId, 'todo-root-complete', 'message_complete', 'todo-root',
        { stopReason: 'end_turn' }),
      event(sessionId, 'todo-owner-start', 'message_start', 'todo-owner', { role: 'assistant' }),
      event(sessionId, 'todo-owner-task', 'tool_start', 'todo-owner',
        { toolCallId: 'later-task', toolName: 'Task', isTaskTool: true }),
    ];
    const pending = loader.switchSession(sessionId, {
      reason: 'resync', targetTabId: tabId,
      liveSeed: seed([
        generating(sessionId, 11),
        event(sessionId, 'later-agent', 'agent_start', 'later-sub',
          { parentToolUseId: 'later-task', toolCallId: 'later-task', agentId: 'later-agent-id' }),
        event(sessionId, 'later-sub-start', 'message_start', 'later-sub',
          { role: 'assistant', parentToolUseId: 'later-task' }),
      ], tabId, sessionId),
    });
    await waitForResume();
    finishResume?.({ success: true, data: { events: taskHistory } });
    await expect(pending).resolves.toEqual({ staleSnapshot: false });
    batchedUpdate.flushSync();
    expect(tab(tabId).streamingState?.latestTodoWrite).toBeUndefined();
    expect(summarizeTodos(tab(tabId).messages, tab(tabId).streamingState))
      .toEqual({ kind: 'known', done: 0, total: 1, active: 'Shipping fix' });
  });
});
