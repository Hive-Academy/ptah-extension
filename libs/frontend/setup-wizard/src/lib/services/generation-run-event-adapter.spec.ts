import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import {
  ConfirmationDialogService,
  MODEL_REFRESH_CONTROL,
  TabManagerService,
} from '@ptah-extension/chat-state';
import type { SetupGenerationRunState } from '@ptah-extension/shared';
import {
  SessionId,
  createExecutionChatMessage,
  type ExecutionChatMessage,
} from '@ptah-extension/shared';
import {
  BatchedUpdateService,
  MessageFinalizationService,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import { GenerationRunEventAdapter } from './generation-run-event-adapter';
import { GenerationWorkflowStore } from './generation-workflow.store';
import { WizardRpcService } from './wizard-rpc.service';

const binding = {
  tabId: 'tab',
  workspacePath: '/ws',
  workflow: 'setup-agent-generation' as const,
  runId: 'generator-run',
};
const activeRun = {
  binding,
  status: 'running',
  source: { kind: 'verified-analysis', analysisDir: '/private/analysis' },
};

describe('GenerationRunEventAdapter', () => {
  const setup = (workspacePath: string | null = '/ws') => {
    const run = signal<typeof activeRun | null>(activeRun);
    const bound = signal<typeof binding | null>(binding);
    const busy = signal(true);
    const tab = {
      id: 'tab',
      workflow: 'setup-agent-generation',
      claudeSessionId: 'real-chat-session',
      lastTurnStateRevision: 42,
      queuedContent: null,
      status: 'loaded',
      streamingState: null as { currentMessageId: string | null } | null,
      pendingBackgroundTasks: ['real-task'],
      pendingSessionCrons: ['real-cron'],
      lastTerminalReason: 'end_turn',
      abortController: new AbortController(),
      messages: [] as ExecutionChatMessage[],
    };
    const processStreamEvent = jest.fn(
      (
        event: { eventType: string; messageId?: string },
        _tabId?: string,
        _sessionId?: string,
        _options?: { fanOut: boolean },
      ) => {
        if (event.eventType === 'message_start' && event.messageId)
          tab.streamingState = { currentMessageId: event.messageId };
        return null;
      },
    );
    const finalizeCurrentMessage = jest.fn(() => {
      tab.streamingState = null;
      busy.set(false);
    });
    const refresh = jest.fn();
    const getBoundRunState = jest.fn().mockResolvedValue(null);
    TestBed.configureTestingModule({
      providers: [
        GenerationRunEventAdapter,
        {
          provide: WizardRpcService,
          useValue: { getBoundRunState },
        },
        {
          provide: GenerationWorkflowStore,
          useValue: {
            binding: bound,
            run,
            isBound: () => busy(),
            refresh,
          },
        },
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([{ id: 'tab' }]),
            findTabByIdAcrossWorkspaces: () => ({ tab, workspacePath }),
            getWorkspaceTabs: () => [tab],
            setMessages: (_tabId: string, messages: ExecutionChatMessage[]) => {
              tab.messages = messages;
            },
          },
        },
        { provide: StreamingHandlerService, useValue: { processStreamEvent } },
        { provide: BatchedUpdateService, useValue: { flushSync: jest.fn() } },
        {
          provide: MessageFinalizationService,
          useValue: { finalizeCurrentMessage },
        },
      ],
    });
    const adapter = TestBed.inject(GenerationRunEventAdapter);
    TestBed.flushEffects();
    return {
      adapter,
      run,
      bound,
      busy,
      tab,
      processStreamEvent,
      finalizeCurrentMessage,
      refresh,
      getBoundRunState,
    };
  };

  it('routes sanitized text and tool labels to the exact tab with no nested or flat generator IDs', () => {
    const { adapter, processStreamEvent } = setup();
    const payload = {
      tabBinding: binding,
      kind: 'tool_start',
      content: '<b>/private/analysis</b>',
      toolName: '<img>Read</img>',
      sessionId: 'generator-sdk-session',
      runId: 'generator-run',
      flatEvent: { sessionId: 'nested-sdk-session', runId: 'generator-run' },
    };
    expect(adapter.accept(payload)).toBe(true);
    expect(processStreamEvent).toHaveBeenCalledTimes(2);
    for (const [event, tabId, sessionId, options] of processStreamEvent.mock
      .calls) {
      expect(tabId).toBe('tab');
      expect(sessionId).toBeUndefined();
      expect(options).toEqual({ fanOut: false });
      expect(JSON.stringify(event)).not.toMatch(
        /generator-run|generator-sdk-session|nested-sdk-session|private\/analysis/,
      );
    }
    expect(processStreamEvent.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        eventType: 'tool_start',
        toolName: 'Read',
      }),
    );
    expect(
      adapter.accept({
        ...payload,
        kind: 'text',
        content: '<i>/private/analysis</i>',
      }),
    ).toBe(true);
    expect(processStreamEvent.mock.calls[2][0]).toEqual(
      expect.objectContaining({
        eventType: 'text_delta',
        delta: '[analysis source]',
      }),
    );
  });

  it('ignores wrong tab, workspace, workflow and run, then ignores a late event after terminal', () => {
    const { adapter, run, busy, processStreamEvent } = setup();
    for (const change of [
      { tabId: 'other' },
      { workspacePath: '/other' },
      { workflow: 'setup-project-prompt' },
      { runId: 'other' },
    ]) {
      expect(
        adapter.accept({
          tabBinding: { ...binding, ...change },
          kind: 'text',
          content: 'bad',
        }),
      ).toBe(false);
    }
    expect(processStreamEvent).not.toHaveBeenCalled();
    expect(
      adapter.accept({ tabBinding: binding, kind: 'text', content: 'safe' }),
    ).toBe(true);
    run.set({ ...activeRun, status: 'completed' });
    TestBed.flushEffects();
    expect(busy()).toBe(false);
    expect(
      adapter.accept({ tabBinding: binding, kind: 'text', content: 'late' }),
    ).toBe(false);
  });

  it('finalizes only its own wizard message without changing real chat turn fields', () => {
    const {
      adapter,
      run,
      tab,
      busy,
      processStreamEvent,
      finalizeCurrentMessage,
    } = setup();
    expect(
      adapter.accept({
        tabBinding: binding,
        kind: 'text',
        content: 'generator output',
      }),
    ).toBe(true);
    run.set({ ...activeRun, status: 'cancelled' });
    TestBed.flushEffects();
    expect(busy()).toBe(false);
    expect(finalizeCurrentMessage).toHaveBeenCalledWith('tab', true);
    expect(
      processStreamEvent.mock.calls.some(
        ([event]) => event.eventType === 'turn_state',
      ),
    ).toBe(false);
    expect(tab.lastTurnStateRevision).toBe(42);
    expect(tab.status).toBe('loaded');
    expect(tab.queuedContent).toBeNull();
  });

  it('opens and finalizes a new message when a terminal run resumes with the same ID', () => {
    const { adapter, run, busy, processStreamEvent, finalizeCurrentMessage } =
      setup();
    expect(
      adapter.accept({ tabBinding: binding, kind: 'text', content: 'first' }),
    ).toBe(true);
    run.set({ ...activeRun, status: 'failed' });
    TestBed.flushEffects();
    busy.set(true);
    run.set({ ...activeRun, status: 'starting' });
    TestBed.flushEffects();
    expect(
      adapter.accept({ tabBinding: binding, kind: 'text', content: 'resumed' }),
    ).toBe(true);
    expect(
      processStreamEvent.mock.calls.filter(
        ([event]) => event.eventType === 'message_start',
      ),
    ).toHaveLength(2);
    run.set({ ...activeRun, status: 'completed' });
    TestBed.flushEffects();
    expect(finalizeCurrentMessage).toHaveBeenCalledTimes(2);
  });

  it('corrects an interrupted transcript after verified completion replaces finalization failure', () => {
    const { adapter, run, tab, processStreamEvent } = setup();
    expect(
      adapter.accept({ tabBinding: binding, kind: 'text', content: 'result' }),
    ).toBe(true);
    const messageId =
      processStreamEvent.mock.calls[0][0].messageId ?? 'missing';
    run.set({ ...activeRun, status: 'failed' });
    TestBed.flushEffects();
    tab.messages = [
      createExecutionChatMessage({
        id: messageId,
        role: 'assistant',
        streamingState: {
          id: messageId,
          type: 'message',
          status: 'interrupted',
          content: 'result',
          children: [],
          isCollapsed: false,
        },
      }),
    ];
    run.set({ ...activeRun, status: 'completed' });
    TestBed.flushEffects();
    expect(tab.messages[0].streamingState?.status).toBe('complete');
  });

  it('finalizes and corrects a VS Code null-partition message', () => {
    const { adapter, run, tab, processStreamEvent, finalizeCurrentMessage } =
      setup(null);
    expect(
      adapter.accept({ tabBinding: binding, kind: 'text', content: 'result' }),
    ).toBe(true);
    const messageId =
      processStreamEvent.mock.calls[0][0].messageId ?? 'missing';
    run.set({ ...activeRun, status: 'failed' });
    TestBed.flushEffects();
    expect(finalizeCurrentMessage).toHaveBeenCalledWith('tab', true);
    tab.messages = [
      createExecutionChatMessage({
        id: messageId,
        role: 'assistant',
        streamingState: {
          id: messageId,
          type: 'message',
          status: 'interrupted',
          content: 'result',
          children: [],
          isCollapsed: false,
        },
      }),
    ];
    run.set({ ...activeRun, status: 'completed' });
    TestBed.flushEffects();
    expect(tab.messages[0].streamingState?.status).toBe('complete');
  });

  it('accepts an owned terminal push from a VS Code null-partition tab', () => {
    const { adapter, bound, getBoundRunState } = setup(null);
    expect(
      adapter.accept({ tabBinding: binding, kind: 'text', content: 'result' }),
    ).toBe(true);
    bound.set(null);
    TestBed.flushEffects();
    adapter.handleMessage({
      type: 'setup-wizard:generation-complete',
      payload: { tabBinding: binding },
    });
    expect(getBoundRunState).toHaveBeenCalledWith(binding, binding.runId);
  });

  it('does not finalize a tab in another Electron workspace', () => {
    const { adapter, run, finalizeCurrentMessage } = setup('/other');
    expect(
      adapter.accept({ tabBinding: binding, kind: 'text', content: 'result' }),
    ).toBe(true);
    run.set({ ...activeRun, status: 'failed' });
    TestBed.flushEffects();
    expect(finalizeCurrentMessage).not.toHaveBeenCalled();
  });

  it('purges buffered activity when the workflow unbinds', () => {
    const { adapter, run, bound, processStreamEvent } = setup();
    run.set(null);
    TestBed.flushEffects();
    for (let i = 0; i < 105; i++) {
      expect(
        adapter.accept({
          tabBinding: binding,
          kind: 'text',
          content: `event ${i}`,
        }),
      ).toBe(true);
    }
    bound.set(null);
    TestBed.flushEffects();
    bound.set(binding);
    run.set(activeRun);
    TestBed.flushEffects();
    expect(processStreamEvent).not.toHaveBeenCalled();
  });

  it('replaces stale message ownership when a new run starts on the same tab', () => {
    const { adapter, run, processStreamEvent, finalizeCurrentMessage } =
      setup();
    expect(
      adapter.accept({ tabBinding: binding, kind: 'text', content: 'first' }),
    ).toBe(true);
    const nextBinding = { ...binding, runId: 'next-run' };
    run.set({ ...activeRun, binding: nextBinding });
    TestBed.flushEffects();
    expect(
      adapter.accept({
        tabBinding: nextBinding,
        kind: 'text',
        content: 'second',
      }),
    ).toBe(true);
    expect(finalizeCurrentMessage).toHaveBeenCalledWith('tab', true);
    expect(
      processStreamEvent.mock.calls.filter(
        ([event]) => event.eventType === 'message_start',
      ),
    ).toHaveLength(2);
  });

  it('buffers early stream events until the accepted run ID is known', () => {
    const { adapter, run, processStreamEvent } = setup();
    run.set(null);
    TestBed.flushEffects();
    expect(
      adapter.accept({ tabBinding: binding, kind: 'text', content: 'early' }),
    ).toBe(true);
    expect(processStreamEvent).not.toHaveBeenCalled();
    run.set(activeRun);
    TestBed.flushEffects();
    expect(
      processStreamEvent.mock.calls.some(
        ([event]) => event.eventType === 'text_delta',
      ),
    ).toBe(true);
  });

  it('leaves a restored terminal on a real-session tab untouched', () => {
    const {
      adapter,
      run,
      tab,
      refresh,
      processStreamEvent,
      finalizeCurrentMessage,
    } = setup();
    tab.status = 'streaming';
    const original = { ...tab };
    adapter.handleMessage({
      type: 'setup-wizard:generation-complete',
      payload: { tabBinding: binding },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(
      adapter.accept({ tabBinding: binding, kind: 'text', content: 'late' }),
    ).toBe(false);
    run.set({ ...activeRun, status: 'failed' });
    TestBed.flushEffects();
    expect(processStreamEvent).not.toHaveBeenCalled();
    expect(finalizeCurrentMessage).not.toHaveBeenCalled();
    expect(tab).toEqual(original);
  });

  it.each([
    ['completed', false],
    ['failed', true],
    ['cancelled', true],
    ['timed-out', true],
  ] as const)('finalizes %s with isAborted=%s', (status, isAborted) => {
    const { adapter, run, finalizeCurrentMessage } = setup();
    expect(
      adapter.accept({ tabBinding: binding, kind: 'text', content: 'output' }),
    ).toBe(true);
    run.set({ ...activeRun, status });
    TestBed.flushEffects();
    expect(finalizeCurrentMessage).toHaveBeenCalledTimes(1);
    expect(finalizeCurrentMessage).toHaveBeenCalledWith('tab', isAborted);
  });
});

describe('GenerationRunEventAdapter with real chat state and streaming', () => {
  it('streams and finalizes a resumed terminal run under the same run ID', async () => {
    localStorage.clear();
    let currentRun: SetupGenerationRunState | null = null;
    const accepted = {
      runId: 'same-run',
      status: 'starting',
      source: { kind: 'workspace-discovery', reason: 'missing' },
      effectiveProvider: 'unknown',
      effectiveModel: 'unknown',
    };
    TestBed.configureTestingModule({
      providers: [
        TabManagerService,
        GenerationWorkflowStore,
        GenerationRunEventAdapter,
        { provide: SURFACE_ACTIVE, useValue: signal(true) },
        {
          provide: ConfirmationDialogService,
          useValue: { confirm: jest.fn() },
        },
        {
          provide: MODEL_REFRESH_CONTROL,
          useValue: { refreshModels: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: WizardRpcService,
          useValue: {
            startBoundAgents: jest.fn().mockImplementation(async () => {
              if (currentRun)
                currentRun = {
                  ...currentRun,
                  status: 'starting',
                  interrupted: false,
                };
              return { success: true, accepted };
            }),
            getBoundRunState: jest
              .fn()
              .mockImplementation(async () => currentRun),
          },
        },
      ],
    });
    const tabs = TestBed.inject(TabManagerService);
    tabs.switchWorkspace('/ws');
    const tabId = tabs.createTab('Generation');
    tabs.setWorkflow(tabId, 'setup-agent-generation');
    const binding = {
      tabId,
      workspacePath: '/ws',
      workflow: 'setup-agent-generation' as const,
      runId: 'same-run',
    };
    currentRun = {
      binding,
      status: 'running',
      source: accepted.source,
      effectiveProvider: 'unknown',
      effectiveModel: 'unknown',
    };
    const store = TestBed.inject(GenerationWorkflowStore);
    const adapter = TestBed.inject(GenerationRunEventAdapter);
    const finalize = jest.spyOn(
      TestBed.inject(MessageFinalizationService),
      'finalizeCurrentMessage',
    );
    store.bind(binding);
    await store.refresh();
    TestBed.flushEffects();
    expect(
      adapter.accept({ tabBinding: binding, kind: 'text', content: 'first' }),
    ).toBe(true);
    const firstMessage =
      tabs.findTabByIdAcrossWorkspaces(tabId)?.tab.streamingState
        ?.currentMessageId;
    currentRun = { ...currentRun, status: 'failed', interrupted: true };
    await store.refresh();
    TestBed.flushEffects();
    expect(store.run()?.status).toBe('failed');
    expect(finalize).toHaveBeenCalledWith(tabId, true);
    await Promise.resolve();
    expect(
      tabs.findTabByIdAcrossWorkspaces(tabId)?.tab.streamingState
        ?.currentMessageId,
    ).toBeFalsy();
    await store.resumeBoundAgents();
    TestBed.flushEffects();
    currentRun = { ...currentRun, status: 'running', interrupted: false };
    await store.refresh();
    TestBed.flushEffects();
    expect(
      adapter.accept({ tabBinding: binding, kind: 'text', content: 'resumed' }),
    ).toBe(true);
    expect(
      tabs.findTabByIdAcrossWorkspaces(tabId)?.tab.streamingState
        ?.currentMessageId,
    ).not.toBe(firstMessage);
    currentRun = { ...currentRun, status: 'completed' };
    await store.refresh();
    TestBed.flushEffects();
    await Promise.resolve();
    expect(
      tabs.findTabByIdAcrossWorkspaces(tabId)?.tab.streamingState
        ?.currentMessageId,
    ).toBeFalsy();
  });
  it('finalizes tab A after a terminal lookup on return without closing tab B', async () => {
    localStorage.clear();
    const runs = new Map<string, SetupGenerationRunState>();
    const startBoundAgents = jest.fn().mockResolvedValue({
      success: true,
      accepted: {
        runId: 'run-a-next',
        status: 'starting',
        source: { kind: 'workspace-discovery', reason: 'missing' },
        effectiveProvider: 'unknown',
        effectiveModel: 'unknown',
      },
    });
    TestBed.configureTestingModule({
      providers: [
        TabManagerService,
        GenerationWorkflowStore,
        GenerationRunEventAdapter,
        {
          provide: WizardRpcService,
          useValue: { getBoundRunState: jest.fn().mockResolvedValue(null) },
        },
        { provide: SURFACE_ACTIVE, useValue: signal(true) },
        {
          provide: ConfirmationDialogService,
          useValue: { confirm: jest.fn() },
        },
        {
          provide: MODEL_REFRESH_CONTROL,
          useValue: { refreshModels: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: WizardRpcService,
          useValue: {
            startBoundAgents,
            getBoundRunState: jest
              .fn()
              .mockImplementation(
                async (bound: { tabId: string }) =>
                  runs.get(bound.tabId) ?? null,
              ),
          },
        },
      ],
    });
    const tabs = TestBed.inject(TabManagerService);
    tabs.switchWorkspace('/ws');
    const tabA = tabs.createTab('Agents');
    tabs.setWorkflow(tabA, 'setup-agent-generation');
    const tabB = tabs.createTab('Guidance');
    tabs.setWorkflow(tabB, 'setup-project-prompt');
    const runA: SetupGenerationRunState = {
      binding: {
        tabId: tabA,
        workspacePath: '/ws',
        workflow: 'setup-agent-generation',
        runId: 'run-a',
      },
      status: 'running',
      source: { kind: 'workspace-discovery', reason: 'missing' },
      effectiveProvider: 'unknown',
      effectiveModel: 'unknown',
    };
    const runB: SetupGenerationRunState = {
      ...runA,
      binding: {
        tabId: tabB,
        workspacePath: '/ws',
        workflow: 'setup-project-prompt',
        runId: 'run-b',
      },
    };
    runs.set(tabA, runA);
    runs.set(tabB, runB);
    const store = TestBed.inject(GenerationWorkflowStore);
    const adapter = TestBed.inject(GenerationRunEventAdapter);
    const finalization = jest.spyOn(
      TestBed.inject(MessageFinalizationService),
      'finalizeCurrentMessage',
    );
    store.bind(runA.binding);
    await store.refresh();
    TestBed.flushEffects();
    expect(
      adapter.accept({ tabBinding: runA.binding, kind: 'text', content: 'A' }),
    ).toBe(true);
    store.bind(runB.binding);
    await store.refresh();
    TestBed.flushEffects();
    expect(
      adapter.accept({ tabBinding: runB.binding, kind: 'text', content: 'B' }),
    ).toBe(true);
    const ownedB =
      tabs.findTabByIdAcrossWorkspaces(tabB)?.tab.streamingState
        ?.currentMessageId;
    runs.set(tabA, { ...runA, status: 'completed' });
    adapter.handleMessage({
      type: 'setup-wizard:generation-complete',
      payload: { tabBinding: runA.binding },
    });
    await Promise.resolve();
    await Promise.resolve();
    tabs.switchTab(tabA);
    expect(
      tabs.findTabByIdAcrossWorkspaces(tabA)?.tab.streamingState
        ?.currentMessageId,
    ).toBeFalsy();
    expect(tabs.isTabStreaming(tabA)).toBe(false);

    store.bind(runA.binding);
    await store.refresh();
    TestBed.flushEffects();
    await Promise.resolve();
    expect(
      tabs.findTabByIdAcrossWorkspaces(tabA)?.tab.streamingState
        ?.currentMessageId,
    ).toBeFalsy();
    expect(tabs.findTabByIdAcrossWorkspaces(tabA)?.tab.status).toBe('loaded');
    expect(tabs.isTabStreaming(tabA)).toBe(false);
    expect(finalization).toHaveBeenCalledTimes(1);
    expect(finalization).toHaveBeenCalledWith(tabA, false);
    expect(
      tabs.findTabByIdAcrossWorkspaces(tabB)?.tab.streamingState
        ?.currentMessageId,
    ).toBe(ownedB);
    await store.startAgents(['agent']);
    expect(startBoundAgents).toHaveBeenCalledTimes(1);
    expect(store.chatTurnRejection()).toBeNull();
    expect(
      tabs.findTabByIdAcrossWorkspaces(tabB)?.tab.streamingState
        ?.currentMessageId,
    ).toBe(ownedB);
  });

  it('finalizes two consecutive never-chatted runs and admits a third start', async () => {
    localStorage.clear();
    let currentRun: SetupGenerationRunState | null = null;
    let nextRunId = 0;
    const startBoundAgents = jest.fn().mockImplementation(async () => ({
      success: true,
      accepted: {
        runId: `run-${++nextRunId}`,
        status: 'starting',
        source: { kind: 'workspace-discovery', reason: 'missing' },
        effectiveProvider: 'unknown',
        effectiveModel: 'unknown',
      },
    }));
    TestBed.configureTestingModule({
      providers: [
        TabManagerService,
        GenerationWorkflowStore,
        GenerationRunEventAdapter,
        {
          provide: WizardRpcService,
          useValue: { getBoundRunState: jest.fn().mockResolvedValue(null) },
        },
        { provide: SURFACE_ACTIVE, useValue: signal(true) },
        {
          provide: ConfirmationDialogService,
          useValue: { confirm: jest.fn() },
        },
        {
          provide: MODEL_REFRESH_CONTROL,
          useValue: {
            refreshModels: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: WizardRpcService,
          useValue: {
            startBoundAgents,
            getBoundRunState: jest
              .fn()
              .mockImplementation(async () => currentRun),
          },
        },
      ],
    });
    const tabs = TestBed.inject(TabManagerService);
    tabs.switchWorkspace('/ws');
    const tabId = tabs.createTab('Generation');
    tabs.setWorkflow(tabId, 'setup-agent-generation');
    const store = TestBed.inject(GenerationWorkflowStore);
    store.bind({
      tabId,
      workspacePath: '/ws',
      workflow: 'setup-agent-generation',
    });
    const adapter = TestBed.inject(GenerationRunEventAdapter);
    for (let index = 0; index < 2; index++) {
      await store.startAgents(['agent']);
      currentRun = {
        binding: {
          tabId,
          workspacePath: '/ws',
          workflow: 'setup-agent-generation',
          runId: `run-${index + 1}`,
        },
        status: 'running',
        source: { kind: 'workspace-discovery', reason: 'missing' },
        effectiveProvider: 'unknown',
        effectiveModel: 'unknown',
      };
      await store.refresh();
      TestBed.flushEffects();
      expect(
        adapter.accept({
          tabBinding: currentRun.binding,
          kind: 'text',
          content: `output ${index}`,
        }),
      ).toBe(true);
      currentRun = { ...currentRun, status: 'completed' };
      await store.refresh();
      TestBed.flushEffects();
      await Promise.resolve();
      const tab = tabs.findTabByIdAcrossWorkspaces(tabId)?.tab;
      expect(tab?.streamingState?.currentMessageId).toBeFalsy();
      expect(tab?.status).toBe('loaded');
      expect(tabs.isTabStreaming(tabId)).toBe(false);
      expect(tab?.claudeSessionId).toBeNull();
    }
    await store.startAgents(['agent']);
    expect(startBoundAgents).toHaveBeenCalledTimes(3);
    expect(store.chatTurnRejection()).toBeNull();

    currentRun = {
      binding: {
        tabId,
        workspacePath: '/ws',
        workflow: 'setup-agent-generation',
        runId: 'run-3',
      },
      status: 'completed',
      source: { kind: 'workspace-discovery', reason: 'missing' },
      effectiveProvider: 'unknown',
      effectiveModel: 'unknown',
    };
    await store.refresh();
    TestBed.flushEffects();
    tabs.attachSession(tabId, SessionId.create());
    tabs.setStatus(tabId, 'streaming');
    const abortSignal = tabs.createAbortController(tabId);
    const realTurn = tabs.findTabByIdAcrossWorkspaces(tabId)?.tab;
    store.unbind();
    TestBed.flushEffects();
    store.bind({
      tabId,
      workspacePath: '/ws',
      workflow: 'setup-agent-generation',
    });
    await store.refresh();
    TestBed.flushEffects();
    expect(tabs.findTabByIdAcrossWorkspaces(tabId)?.tab).toEqual(realTurn);
    expect(tabs.getAbortSignal(tabId)).toBe(abortSignal);
  });
});
