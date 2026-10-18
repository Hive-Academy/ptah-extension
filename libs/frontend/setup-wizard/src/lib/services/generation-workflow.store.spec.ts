import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { WizardRpcService } from './wizard-rpc.service';
import { GenerationWorkflowStore } from './generation-workflow.store';

const binding = {
  tabId: 'tab',
  workspacePath: '/ws',
  workflow: 'setup-agent-generation' as const,
};
const active = {
  binding: { ...binding, runId: 'run' },
  status: 'running' as const,
  source: { kind: 'workspace-discovery' as const, reason: 'missing' as const },
  effectiveProvider: 'unknown',
  effectiveModel: 'unknown',
};
const idleTab = {
  status: 'loaded',
  streamingState: null,
  queuedContent: null,
  queuedOptions: null,
};
const tabProvider = {
  provide: TabManagerService,
  useValue: {
    findTabByIdAcrossWorkspaces: () => ({ tab: idleTab, workspacePath: '/ws' }),
    isTabStreaming: () => false,
  },
};

describe('GenerationWorkflowStore', () => {
  it('finds its own guidance run after a lost start response without claiming a model cause', async () => {
    const guidanceBinding = {
      ...binding,
      workflow: 'setup-project-prompt' as const,
    };
    const ownRun = {
      ...active,
      binding: { ...guidanceBinding, runId: 'guidance' },
    };
    const getBoundRunState = jest.fn().mockResolvedValue(null);
    const startBoundGuidance = jest
      .fn()
      .mockRejectedValueOnce(new Error('lost response'))
      .mockRejectedValueOnce(
        new Error('The selected model is not available for this provider.'),
      );
    TestBed.configureTestingModule({
      providers: [
        GenerationWorkflowStore,
        tabProvider,
        {
          provide: WizardRpcService,
          useValue: { getBoundRunState, startBoundGuidance },
        },
      ],
    });
    const store = TestBed.inject(GenerationWorkflowStore);
    store.bind(guidanceBinding);
    await store.startGuidance();
    expect(getBoundRunState).toHaveBeenCalledWith(guidanceBinding, undefined);
    expect(store.run()).toBeNull();
    getBoundRunState.mockResolvedValueOnce(ownRun);
    await store.refresh();
    expect(store.run()?.binding.runId).toBe('guidance');
    store.unbind();
    getBoundRunState.mockResolvedValue(null);
    store.bind(guidanceBinding);
    await store.startGuidance();
    expect(store.startError()).toBeNull();
  });
  it.each([
    ['finalization failure', true, 'failed', true],
    ['other failure', false, 'failed', false],
    ['completed terminal', false, 'completed', false],
  ] as const)(
    'allows verified lookup correction only for %s',
    async (_name, finalizationFailed, priorStatus, shouldCorrect) => {
      const previous = {
        ...active,
        status: priorStatus,
        result: {
          status: priorStatus,
          success: priorStatus === 'completed',
          source: active.source,
          effectiveProvider: 'unknown',
          effectiveModel: 'unknown',
          ...(finalizationFailed ? { finalizationFailed: true } : {}),
        },
      };
      const verified = {
        ...active,
        status: 'completed' as const,
        result: {
          status: 'completed' as const,
          success: true,
          source: active.source,
          effectiveProvider: 'unknown',
          effectiveModel: 'unknown',
          counts: {
            total: 1,
            written: 1,
            unchanged: 0,
            failed: 0,
            skipped: 0,
            rejected: 0,
          },
          agentOutcomes: [],
        },
      };
      const getBoundRunState = jest
        .fn()
        .mockResolvedValueOnce(previous)
        .mockResolvedValue(verified);
      TestBed.configureTestingModule({
        providers: [
          GenerationWorkflowStore,
          tabProvider,
          { provide: WizardRpcService, useValue: { getBoundRunState } },
        ],
      });
      const store = TestBed.inject(GenerationWorkflowStore);
      store.bind(binding);
      await Promise.resolve();
      await store.refresh();
      expect(store.run()).toEqual(shouldCorrect ? verified : previous);
    },
  );
  it('keeps a terminal result when a stale running read arrives', async () => {
    const terminal = {
      ...active,
      status: 'completed' as const,
      result: {
        status: 'completed' as const,
        success: true,
        source: active.source,
        effectiveProvider: 'unknown',
        effectiveModel: 'unknown',
      },
    };
    const getBoundRunState = jest
      .fn()
      .mockResolvedValueOnce(terminal)
      .mockResolvedValueOnce(active)
      .mockResolvedValue({ ...terminal, result: undefined });
    TestBed.configureTestingModule({
      providers: [
        GenerationWorkflowStore,
        tabProvider,
        { provide: WizardRpcService, useValue: { getBoundRunState } },
      ],
    });
    const store = TestBed.inject(GenerationWorkflowStore);
    store.bind(binding);
    await Promise.resolve();
    await store.refresh();
    await store.refresh();
    await store.refresh();
    expect(store.run()).toEqual(terminal);
    expect(store.state()).toBe('completed');
  });

  it('retries a lost status read with a bounded watchdog', async () => {
    jest.useFakeTimers();
    const getBoundRunState = jest
      .fn()
      .mockResolvedValueOnce(active)
      .mockRejectedValue(new Error('offline'));
    TestBed.configureTestingModule({
      providers: [
        GenerationWorkflowStore,
        tabProvider,
        { provide: WizardRpcService, useValue: { getBoundRunState } },
      ],
    });
    const store = TestBed.inject(GenerationWorkflowStore);
    store.bind(binding);
    await Promise.resolve();
    await store.refresh();
    await jest.advanceTimersByTimeAsync(7000);
    expect(getBoundRunState).toHaveBeenCalledTimes(5);
    store.unbind();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it('restores the lookup watchdog for a newly accepted binding after exhaustion', async () => {
    jest.useFakeTimers();
    const getBoundRunState = jest
      .fn()
      .mockResolvedValueOnce(active)
      .mockRejectedValue(new Error('offline'));
    const startBoundAgents = jest.fn().mockResolvedValue({
      accepted: {
        runId: 'second-run',
        source: active.source,
        effectiveProvider: 'unknown',
        effectiveModel: 'unknown',
      },
    });
    TestBed.configureTestingModule({
      providers: [
        GenerationWorkflowStore,
        tabProvider,
        {
          provide: WizardRpcService,
          useValue: { getBoundRunState, startBoundAgents },
        },
      ],
    });
    const store = TestBed.inject(GenerationWorkflowStore);
    store.bind(binding);
    await Promise.resolve();
    await store.refresh();
    await jest.advanceTimersByTimeAsync(7000);
    store.bind({ ...binding, tabId: 'second-tab' });
    await Promise.resolve();
    await store.startAgents(['a']);
    await store.refresh();
    expect(jest.getTimerCount()).toBe(1);
    store.unbind();
    jest.useRealTimers();
  });

  it('resumes an interrupted run through the bound submit and exposes rejection', async () => {
    const getBoundRunState = jest
      .fn()
      .mockResolvedValue({ ...active, status: 'failed', interrupted: true });
    const startBoundAgents = jest.fn().mockResolvedValue({
      rejection: { reason: 'blocked', ownerTabId: 'owner' },
    });
    TestBed.configureTestingModule({
      providers: [
        GenerationWorkflowStore,
        tabProvider,
        {
          provide: WizardRpcService,
          useValue: { getBoundRunState, startBoundAgents },
        },
      ],
    });
    const store = TestBed.inject(GenerationWorkflowStore);
    store.bind(binding);
    await store.refresh();
    await store.resumeBoundAgents();
    expect(startBoundAgents).toHaveBeenCalledWith(binding, [], true);
    expect(store.rejection()).toEqual({
      reason: 'blocked',
      ownerTabId: 'owner',
    });
  });

  it('resumes a saved checkpoint with this tab binding when no run is loaded', async () => {
    const startBoundAgents = jest.fn().mockResolvedValue({
      success: true,
      accepted: {
        runId: 'saved',
        source: active.source,
        effectiveProvider: 'unknown',
        effectiveModel: 'unknown',
      },
    });
    TestBed.configureTestingModule({
      providers: [
        GenerationWorkflowStore,
        tabProvider,
        { provide: WizardRpcService, useValue: {
          getBoundRunState: jest.fn().mockResolvedValue(null),
          startBoundAgents,
        } },
      ],
    });
    const store = TestBed.inject(GenerationWorkflowStore);
    store.bind(binding);
    await store.resumeCheckpoint();
    expect(startBoundAgents).toHaveBeenCalledWith(binding, [], true);
    expect(store.run()?.binding.runId).toBe('saved');
    expect(store.rejection()).toBeNull();
    store.unbind();
  });

  it('clears a previous rejection on a new start and on acceptance', async () => {
    const startBoundAgents = jest.fn()
      .mockResolvedValueOnce({ rejection: { reason: 'preview-required' } })
      .mockResolvedValueOnce({ success: true, accepted: {
        runId: 'run', source: active.source,
        effectiveProvider: 'unknown', effectiveModel: 'unknown',
      } });
    TestBed.configureTestingModule({ providers: [
      GenerationWorkflowStore, tabProvider,
      { provide: WizardRpcService, useValue: {
        getBoundRunState: jest.fn().mockResolvedValue(null), startBoundAgents,
      } },
    ] });
    const store = TestBed.inject(GenerationWorkflowStore);
    store.bind(binding);
    await store.startAgents(['agent']);
    expect(store.rejection()?.reason).toBe('preview-required');
    const second = store.startAgents(['agent']);
    expect(store.rejection()).toBeNull();
    await second;
    expect(store.run()?.binding.runId).toBe('run');
    expect(store.rejection()).toBeNull();
    store.unbind();
  });

  it.each(['agents', 'guidance', 'resume'] as const)(
    'releases the tab immediately for an explicit %s start failure', async (kind) => {
      const selectedBinding = kind === 'guidance'
        ? { ...binding, workflow: 'setup-project-prompt' as const }
        : binding;
      const error = 'Agent generation could not start. Please retry.';
      const response = { success: false, error };
      TestBed.configureTestingModule({ providers: [
        GenerationWorkflowStore, tabProvider,
        { provide: WizardRpcService, useValue: {
          getBoundRunState: jest.fn().mockResolvedValue(null),
          startBoundAgents: jest.fn().mockResolvedValue(response),
          startBoundGuidance: jest.fn().mockResolvedValue(response),
        } },
      ] });
      const store = TestBed.inject(GenerationWorkflowStore);
      store.bind(selectedBinding);
      if (kind === 'agents') await store.startAgents(['agent']);
      else if (kind === 'guidance') await store.startGuidance();
      else await store.resumeCheckpoint();
      expect(store.state()).toBe('idle');
      expect(store.isBound()).toBe(false);
      expect(store.startError()).toBe(error);
      store.unbind();
    },
  );

  it('releases a runless tab after unconfirmed start lookups are exhausted', async () => {
    jest.useFakeTimers();
    TestBed.configureTestingModule({ providers: [
      GenerationWorkflowStore, tabProvider,
      { provide: WizardRpcService, useValue: {
        getBoundRunState: jest.fn().mockResolvedValue(null),
        startBoundAgents: jest.fn().mockRejectedValue(new Error('Start unconfirmed')),
      } },
    ] });
    const store = TestBed.inject(GenerationWorkflowStore);
    store.bind(binding);
    await store.startAgents(['agent']);
    await jest.advanceTimersByTimeAsync(7000);
    expect(store.state()).toBe('idle');
    expect(store.isBound()).toBe(false);
    expect(store.startError()).toBe('Generation could not be started. Try again.');
    expect(jest.getTimerCount()).toBe(0);
    store.unbind();
    jest.useRealTimers();
  });
  it('queues Stop until exact accepted or looked-up run ID and hides unknown model', async () => {
    const getBoundRunState = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(active);
    const cancelBoundRun = jest.fn().mockResolvedValue(true);
    const startBoundAgents = jest.fn().mockResolvedValue({
      success: true,
      accepted: {
        runId: 'run',
        status: 'starting',
        source: active.source,
        effectiveProvider: 'unknown',
        effectiveModel: 'unknown',
      },
    });
    TestBed.configureTestingModule({
      providers: [
        GenerationWorkflowStore,
        tabProvider,
        {
          provide: WizardRpcService,
          useValue: { getBoundRunState, cancelBoundRun, startBoundAgents },
        },
      ],
    });
    const store = TestBed.inject(GenerationWorkflowStore);
    store.bind(binding);
    await Promise.resolve();
    const starting = store.startAgents(['agent']);
    store.stop();
    await starting;
    expect(cancelBoundRun).toHaveBeenCalledWith({ ...binding, runId: 'run' });
    expect(store.provider()).toBeNull();
    expect(store.model()).toBeNull();
  });

  it('takes terminal truth only from lookup', async () => {
    const getBoundRunState = jest.fn().mockResolvedValue({
      ...active,
      status: 'timed-out',
      committedState: 'unknown',
    });
    TestBed.configureTestingModule({
      providers: [
        GenerationWorkflowStore,
        tabProvider,
        { provide: WizardRpcService, useValue: { getBoundRunState } },
      ],
    });
    const store = TestBed.inject(GenerationWorkflowStore);
    store.bind(binding);
    await store.refresh();
    expect(store.state()).toBe('timed-out');
  });

  it('rejects a generation start while chat is busy or has queued content', async () => {
    const tab = { ...idleTab, status: 'streaming', queuedContent: 'later' };
    const startBoundAgents = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        GenerationWorkflowStore,
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: () => ({ tab, workspacePath: '/ws' }),
            isTabStreaming: () => false,
          },
        },
        {
          provide: WizardRpcService,
          useValue: {
            getBoundRunState: jest.fn().mockResolvedValue(null),
            startBoundAgents,
          },
        },
      ],
    });
    const store = TestBed.inject(GenerationWorkflowStore);
    store.bind(binding);
    await store.startAgents(['agent']);
    expect(store.chatTurnRejection()).toBe('Finish this chat reply first');
    expect(startBoundAgents).not.toHaveBeenCalled();
    tab.status = 'loaded';
    await store.startAgents(['agent']);
    expect(startBoundAgents).not.toHaveBeenCalled();
    tab.queuedContent = '';
    startBoundAgents.mockResolvedValue({
      rejection: { reason: 'preview-required' },
    });
    await store.startAgents(['agent']);
    expect(startBoundAgents).toHaveBeenCalledTimes(1);
    expect(store.chatTurnRejection()).toBeNull();
    expect(store.rejection()?.reason).toBe('preview-required');
  });

  it('preserves an unconfirmed Stop and rereads the exact run', async () => {
    const getBoundRunState = jest.fn().mockResolvedValue(active);
    const cancelBoundRun = jest
      .fn()
      .mockRejectedValue(new Error('lost response'));
    TestBed.configureTestingModule({
      providers: [
        GenerationWorkflowStore,
        tabProvider,
        {
          provide: WizardRpcService,
          useValue: { getBoundRunState, cancelBoundRun },
        },
      ],
    });
    const store = TestBed.inject(GenerationWorkflowStore);
    store.bind(binding);
    await store.refresh();
    expect(store.state()).toBe('running');
    store.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelBoundRun).toHaveBeenCalledWith({ ...binding, runId: 'run' });
    expect(store.state()).toBe('stop-unconfirmed');
    getBoundRunState.mockResolvedValue({
      ...active,
      status: 'cancelled',
      interrupted: true,
    });
    await store.refresh();
    expect(store.state()).toBe('cancelled');
    expect(store.run()?.interrupted).toBe(true);
  });

  it('keeps a blocked owner and discards pending Stop after a rejected start', async () => {
    let resolveStart!: (value: {
      rejection: { reason: 'blocked'; ownerTabId: string };
    }) => void;
    const startBoundAgents = jest.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );
    const cancelBoundRun = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        GenerationWorkflowStore,
        tabProvider,
        {
          provide: WizardRpcService,
          useValue: {
            getBoundRunState: jest.fn().mockResolvedValue(null),
            startBoundAgents,
            cancelBoundRun,
          },
        },
      ],
    });
    const store = TestBed.inject(GenerationWorkflowStore);
    store.bind(binding);
    const starting = store.startAgents(['agent']);
    expect(store.state()).toBe('starting');
    store.stop();
    expect(store.state()).toBe('cancelling');
    resolveStart({ rejection: { reason: 'blocked', ownerTabId: 'other-tab' } });
    await starting;
    expect(store.state()).toBe('idle');
    expect(store.rejection()).toEqual({
      reason: 'blocked',
      ownerTabId: 'other-tab',
    });
    expect(cancelBoundRun).not.toHaveBeenCalled();
  });

  it('marks a lost lookup stop-unknown and never cancels an unrelated run', async () => {
    const getBoundRunState = jest.fn().mockResolvedValue(active);
    const cancelBoundRun = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        GenerationWorkflowStore,
        tabProvider,
        {
          provide: WizardRpcService,
          useValue: { getBoundRunState, cancelBoundRun },
        },
      ],
    });
    const store = TestBed.inject(GenerationWorkflowStore);
    store.bind(binding);
    await store.refresh();
    getBoundRunState.mockResolvedValueOnce(null).mockResolvedValue({
      ...active,
      binding: { ...binding, runId: 'foreign' },
    });
    store.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.state()).toBe('stop-unknown');
    await store.refresh();
    expect(cancelBoundRun).not.toHaveBeenCalled();
    expect(store.run()?.binding.runId).toBe('run');
  });
});
