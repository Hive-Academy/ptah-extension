import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import { GenerationHandoffStore } from './generation-handoff.store';
import { WizardRpcService } from './wizard-rpc.service';

describe('GenerationHandoffStore', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it('ignores a late failure from a superseded guidance handoff', async () => {
    let rejectFirst!: (error: Error) => void;
    const startBoundGuidance = jest.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce({ accepted: { runId: 'new-run' } });
    TestBed.configureTestingModule({ providers: [
      GenerationHandoffStore,
      { provide: TabManagerService, useValue: {
        tabs: signal([{ id: 'agent' }]),
        getWorkspaceTabs: () => [{ id: 'agent' }, { id: 'guidance' }],
        findTabByIdAcrossWorkspaces: () => ({ workspacePath: '/ws', tab: {
          id: 'guidance', workflow: 'setup-project-prompt', status: 'loaded',
          streamingState: null, queuedContent: null, queuedOptions: null,
        } }),
        isTabStreaming: () => false,
      } },
      { provide: GenerationWorkflowLauncherService, useValue: {
        open: jest.fn().mockResolvedValue({ outcome: 'landed', tabId: 'guidance' }),
      } },
      { provide: WizardRpcService, useValue: { startBoundGuidance } },
    ] });
    const store = TestBed.inject(GenerationHandoffStore);
    const first = store.manualContinue('/ws');
    expect(store.inFlight()).toBe(true);
    await Promise.resolve();
    expect(store.openedTab()).toEqual({ tabId: 'guidance', workspacePath: '/ws' });
    expect(startBoundGuidance).toHaveBeenCalledTimes(1);
    await store.manualContinue('/ws');
    expect(store.inFlight()).toBe(false);
    expect(store.outcome()).toBe('started');
    rejectFirst(new Error('late failure'));
    await first;
    expect(store.outcome()).toBe('started');
    expect(store.started()?.runId).toBe('new-run');
  });
  it('uses one absolute deadline and cancels when the source tab closes', async () => {
    const open = jest
      .fn()
      .mockResolvedValue({ outcome: 'landed', tabId: 'guidance' });
    TestBed.configureTestingModule({
      providers: [
        GenerationHandoffStore,
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([]),
            getWorkspaceTabs: () => [{ id: 'agent' }],
            findTabByIdAcrossWorkspaces: () => ({
              workspacePath: '/ws',
              tab: {
                status: 'loaded',
                streamingState: null,
                queuedContent: null,
                queuedOptions: null,
              },
            }),
            isTabStreaming: () => false,
          },
        },
        { provide: GenerationWorkflowLauncherService, useValue: { open } },
        {
          provide: WizardRpcService,
          useValue: {
            startBoundGuidance: jest
              .fn()
              .mockResolvedValue({ accepted: { runId: 'run' } }),
          },
        },
      ],
    });
    const store = TestBed.inject(GenerationHandoffStore);
    store.schedule('agent', '/ws');
    const deadline = store.pending()?.guidanceStartDeadline;
    jest.advanceTimersByTime(3000);
    expect(store.pending()?.guidanceStartDeadline).toBe(deadline);
    store.tabClosed('agent');
    jest.advanceTimersByTime(3000);
    expect(open).not.toHaveBeenCalled();
    store.schedule('agent', '/ws');
    await jest.advanceTimersByTimeAsync(5000);
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: 'setup-project-prompt',
        focus: false,
      }),
    );
    expect(store.outcome()).toBe('started');
    expect(store.started()).toEqual({ tabId: 'guidance', workspacePath: '/ws', workflow: 'setup-project-prompt', runId: 'run' });
  });

  it('submits once from Start now and once from a later deadline without a mounted shell', async () => {
    const open = jest
      .fn()
      .mockResolvedValue({ outcome: 'landed', tabId: 'guidance' });
    const startBoundGuidance = jest
      .fn()
      .mockResolvedValue({ accepted: { runId: 'run' } });
    TestBed.configureTestingModule({
      providers: [
        GenerationHandoffStore,
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([{ id: 'agent' }]),
            getWorkspaceTabs: () => [{ id: 'agent' }],
            findTabByIdAcrossWorkspaces: () => ({
              workspacePath: '/ws',
              tab: {
                status: 'loaded',
                streamingState: null,
                queuedContent: null,
                queuedOptions: null,
              },
            }),
            isTabStreaming: () => false,
          },
        },
        { provide: GenerationWorkflowLauncherService, useValue: { open } },
        { provide: WizardRpcService, useValue: { startBoundGuidance } },
      ],
    });
    const store = TestBed.inject(GenerationHandoffStore);
    store.schedule('agent', '/ws');
    await store.startNow();
    expect(store.outcome()).toBe('started');
    expect(store.started()?.runId).toBe('run');
    await jest.advanceTimersByTimeAsync(5000);
    expect(startBoundGuidance).toHaveBeenCalledTimes(1);
    store.schedule('agent', '/ws');
    await jest.advanceTimersByTimeAsync(5000);
    expect(startBoundGuidance).toHaveBeenCalledTimes(2);
    expect(store.outcome()).toBe('started');
  });

  it('starts guidance after landing in the VS Code null-partition tab set', async () => {
    const guidanceTab = {
      id: 'guidance',
      status: 'loaded',
      streamingState: null,
      queuedContent: null,
      queuedOptions: null,
    };
    const startBoundGuidance = jest.fn().mockResolvedValue({
      accepted: { runId: 'run' },
    });
    TestBed.configureTestingModule({
      providers: [
        GenerationHandoffStore,
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([{ id: 'agent' }]),
            getWorkspaceTabs: () => [{ id: 'agent' }, guidanceTab],
            findTabByIdAcrossWorkspaces: () => ({
              workspacePath: null,
              tab: guidanceTab,
            }),
            isTabStreaming: () => false,
          },
        },
        {
          provide: GenerationWorkflowLauncherService,
          useValue: {
            open: jest.fn().mockResolvedValue({
              outcome: 'landed',
              tabId: 'guidance',
            }),
          },
        },
        { provide: WizardRpcService, useValue: { startBoundGuidance } },
      ],
    });
    const store = TestBed.inject(GenerationHandoffStore);
    store.schedule('agent', '/ws');
    await store.startNow();
    expect(startBoundGuidance).toHaveBeenCalledWith({
      workspacePath: '/ws',
      tabId: 'guidance',
      workflow: 'setup-project-prompt',
    });
    expect(store.outcome()).toBe('started');
  });

  it('keeps the deadline across a tab switch, clears it on reload, and offers manual recovery', async () => {
    const tabs = signal([{ id: 'agent' }]);
    const open = jest.fn().mockResolvedValue({ outcome: 'failed' });
    const providers = [
      GenerationHandoffStore,
      {
        provide: TabManagerService,
        useValue: {
          tabs,
          getWorkspaceTabs: () => [{ id: 'agent' }],
          findTabByIdAcrossWorkspaces: () => ({
            workspacePath: '/ws',
            tab: {
              status: 'loaded',
              streamingState: null,
              queuedContent: null,
              queuedOptions: null,
            },
          }),
          isTabStreaming: () => false,
        },
      },
      { provide: GenerationWorkflowLauncherService, useValue: { open } },
      {
        provide: WizardRpcService,
        useValue: { startBoundGuidance: jest.fn() },
      },
    ];
    TestBed.configureTestingModule({ providers });
    const store = TestBed.inject(GenerationHandoffStore);
    store.schedule('agent', '/ws');
    const deadline = store.pending()?.guidanceStartDeadline;
    tabs.set([{ id: 'other' }]);
    TestBed.flushEffects();
    expect(store.pending()?.guidanceStartDeadline).toBe(deadline);
    store.skip();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers });
    const reloaded = TestBed.inject(GenerationHandoffStore);
    expect(reloaded.pending()).toBeNull();
    reloaded.skip();
    expect(reloaded.outcome()).toBe('skipped');
    await reloaded.manualContinue('/ws');
    expect(reloaded.outcome()).toBe('manual-recovery');
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ focus: true }));
  });

  it('retains manual recovery after the automatic launch fails at the absolute deadline', async () => {
    const open = jest
      .fn()
      .mockResolvedValueOnce({ outcome: 'failed' })
      .mockResolvedValueOnce({ outcome: 'landed', tabId: 'guidance' });
    const startBoundGuidance = jest.fn().mockResolvedValue({
      accepted: { runId: 'guidance-run' },
    });
    TestBed.configureTestingModule({
      providers: [
        GenerationHandoffStore,
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([{ id: 'agent' }]),
            getWorkspaceTabs: () => [{ id: 'agent' }],
            findTabByIdAcrossWorkspaces: () => ({
              workspacePath: '/ws',
              tab: {
                status: 'loaded',
                streamingState: null,
                queuedContent: null,
                queuedOptions: null,
              },
            }),
            isTabStreaming: () => false,
          },
        },
        { provide: GenerationWorkflowLauncherService, useValue: { open } },
        { provide: WizardRpcService, useValue: { startBoundGuidance } },
      ],
    });
    const store = TestBed.inject(GenerationHandoffStore);
    store.schedule('agent', '/ws');
    const deadline = store.pending()?.guidanceStartDeadline;
    jest.advanceTimersByTime(2000);
    expect(store.pending()?.guidanceStartDeadline).toBe(deadline);
    await jest.advanceTimersByTimeAsync(3000);
    expect(store.outcome()).toBe('manual-recovery');
    expect(startBoundGuidance).not.toHaveBeenCalled();
    await store.manualContinue('/ws');
    expect(store.outcome()).toBe('started');
    expect(startBoundGuidance).toHaveBeenCalledWith({
      workspacePath: '/ws',
      tabId: 'guidance',
      workflow: 'setup-project-prompt',
    });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('does not start guidance into a busy chat tab', async () => {
    const startBoundGuidance = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        GenerationHandoffStore,
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([{ id: 'agent' }]),
            getWorkspaceTabs: () => [{ id: 'agent' }],
            findTabByIdAcrossWorkspaces: () => ({
              workspacePath: '/ws',
              tab: {
                status: 'streaming',
                streamingState: { currentMessageId: 'chat' },
                queuedContent: null,
              },
            }),
            isTabStreaming: () => true,
          },
        },
        {
          provide: GenerationWorkflowLauncherService,
          useValue: {
            open: jest
              .fn()
              .mockResolvedValue({ outcome: 'landed', tabId: 'guidance' }),
          },
        },
        { provide: WizardRpcService, useValue: { startBoundGuidance } },
      ],
    });
    const store = TestBed.inject(GenerationHandoffStore);
    await store.manualContinue('/ws');
    expect(startBoundGuidance).not.toHaveBeenCalled();
    expect(store.outcome()).toBe('manual-recovery');
  });
});
