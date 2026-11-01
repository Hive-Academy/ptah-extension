import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { VSCodeService } from '@ptah-extension/core';
import { HarnessBuilderRecordsService } from '@ptah-extension/harness-builder';
import { WizardRpcService } from '@ptah-extension/setup-wizard';
import { OnboardingResumeStore } from './onboarding-resume.store';

describe('OnboardingResumeStore', () => {
  const rpc = { getResumableRun: jest.fn(), getBoundRunState: jest.fn() };
  const tabs = { activeWorkspacePath: '/work', getWorkspaceTabs: jest.fn() };
  const records = { readDraft: jest.fn(), readSession: jest.fn() };
  let store: OnboardingResumeStore;

  beforeEach(() => {
    jest.clearAllMocks();
    tabs.activeWorkspacePath = '/work';
    tabs.getWorkspaceTabs.mockReturnValue([]);
    rpc.getResumableRun.mockResolvedValue({ analysis: null, generation: null });
    rpc.getBoundRunState.mockResolvedValue(null);
    records.readDraft.mockReturnValue(null);
    records.readSession.mockReturnValue(null);
    TestBed.configureTestingModule({
      providers: [
        OnboardingResumeStore,
        { provide: WizardRpcService, useValue: rpc },
        { provide: TabManagerService, useValue: tabs },
        { provide: HarnessBuilderRecordsService, useValue: records },
        {
          provide: VSCodeService,
          useValue: { config: () => ({ workspaceRoot: '/work' }) },
        },
      ],
    });
    store = TestBed.inject(OnboardingResumeStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('shows the latest analysis and generation checkpoint pair with a bound tab', async () => {
    tabs.getWorkspaceTabs.mockReturnValue([
      { id: 'tab-generation', workflow: 'setup-agent-generation' },
    ]);
    rpc.getResumableRun.mockResolvedValue({
      analysis: { manifest: { lifecycle: 'paused' } },
      generation: {
        lifecycle: 'paused',
        runId: 'latest-run',
        agents: [{ status: 'written' }],
      },
    });
    await store.refresh();
    expect(store.items().map((item) => item.id)).toEqual([
      'analysis',
      'generation:tab-generation',
    ]);
    expect(store.items()[1].target).toEqual({
      subPath: ['analyze', 'agents'],
      queryParams: { tab: 'tab-generation', run: 'latest-run' },
    });
  });

  it('limits bound tabs and harness records to one item per workflow or mode', async () => {
    tabs.getWorkspaceTabs.mockReturnValue([
      { id: 'agent-1', workflow: 'setup-agent-generation' },
      { id: 'agent-2', workflow: 'setup-agent-generation' },
      { id: 'guidance-1', workflow: 'setup-project-prompt' },
      { id: 'harness-1', workflow: 'harness-new-project' },
      { id: 'harness-2', workflow: 'harness-new-project' },
    ]);
    rpc.getBoundRunState.mockImplementation(
      async ({ tabId }: { tabId: string }) => ({
        status: 'running',
        binding: { runId: `run-${tabId}` },
      }),
    );
    records.readSession.mockImplementation((_root: string, tabId: string) =>
      tabId === 'harness-1' ? { lastRevisionId: 'rev-1' } : null,
    );
    await store.refresh();
    expect(store.items().map((item) => item.id)).toEqual([
      'generation:agent-1',
      'generation:guidance-1',
      'harness:new-project',
    ]);
    expect(store.items()[2].target).toEqual({
      subPath: ['new-project', 'workspace'],
      queryParams: { tab: 'harness-1' },
    });
  });

  it('does not advertise unbound generation or harness records', async () => {
    rpc.getResumableRun.mockResolvedValue({
      analysis: null,
      generation: { lifecycle: 'paused', runId: 'orphan', agents: [] },
    });
    tabs.getWorkspaceTabs.mockReturnValue([
      { id: 'orphan-tab', workflow: 'setup-project-prompt' },
    ]);
    records.readDraft.mockReturnValue({ tabId: 'orphan-tab' });
    await store.refresh();
    expect(store.items()).toEqual([]);
  });

  it('keeps the newer workspace result when an older refresh finishes last', async () => {
    let finishOld!: (value: {
      analysis: { manifest: { lifecycle: 'paused' } };
      generation: null;
    }) => void;
    rpc.getResumableRun
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce({ analysis: null, generation: null });

    const oldRefresh = store.refresh();
    tabs.activeWorkspacePath = '/new';
    await store.refresh();
    expect(store.items()).toEqual([]);

    finishOld({
      analysis: { manifest: { lifecycle: 'paused' } },
      generation: null,
    });
    await oldRefresh;
    expect(store.items()).toEqual([]);
    expect(tabs.getWorkspaceTabs).toHaveBeenNthCalledWith(1, '/work');
    expect(tabs.getWorkspaceTabs).toHaveBeenNthCalledWith(2, '/new');
  });
  it('clears old actions and rejects an in-flight result while the backend switches', async () => {
    let finish!: (value: { analysis: { manifest: { lifecycle: 'paused' } }; generation: null }) => void;
    rpc.getResumableRun.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = store.refresh();
    store.clear();
    expect(store.items()).toEqual([]);
    finish({ analysis: { manifest: { lifecycle: 'paused' } }, generation: null });
    await pending;
    expect(store.items()).toEqual([]);
  });
});
