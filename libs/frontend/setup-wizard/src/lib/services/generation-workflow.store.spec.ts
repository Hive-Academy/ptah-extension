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
    getBoundRunState
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
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
