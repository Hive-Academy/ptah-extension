import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TabManagerService } from '@ptah-extension/chat-state';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import { VSCodeService } from '@ptah-extension/core';
import type { SetupGenerationRejection, SetupGenerationRunState } from '@ptah-extension/shared';
import { GenerationPreviewStore, GenerationWorkflowStore } from '@ptah-extension/setup-wizard';
import { AnalysisStepStore } from './analysis-step.store';
import { ChooseAgentsPage } from './choose-agents.page';

const binding = { tabId: 'tab', workspacePath: '/ws', workflow: 'setup-agent-generation' as const };
const decisions = { previewToken: 'token', fileDecisions: { 'agent.md': 'replace' as const }, target: 'harness-root' as const };

describe('ChooseAgentsPage', () => {
  let page: ChooseAgentsPage;
  let fixture: ComponentFixture<ChooseAgentsPage>;
  const state = signal<'idle' | 'running'>('idle');
  const run = signal<SetupGenerationRunState | null>(null);
  const rejection = signal<SetupGenerationRejection | null>(null);
  const selection = signal<ReadonlySet<string>>(new Set(['agent-a']));
  const preview = {
    isOpen: signal(false), loading: signal(false), preview: signal(null), decisions: signal(null), changed: signal(false), error: signal(null),
    open: jest.fn(), confirm: jest.fn(), cancel: jest.fn(), changeTarget: jest.fn(), setRowDecision: jest.fn(), setAllRowDecisions: jest.fn(),
  };
  const store = {
    recommendations: signal([]), selection, loaded: signal({ manifest: { lifecycle: 'completed' } }),
    listAnalyses: jest.fn(), selectAnalysis: jest.fn(), loadRecommendations: jest.fn(), submit: jest.fn(),
    toggleAgent: jest.fn(), selectRecommended: jest.fn(), clearAgents: jest.fn(),
  };
  const generation = { bind: jest.fn(), refresh: jest.fn(), state, run, rejection, provider: signal(null), model: signal(null) };
  const router = { navigate: jest.fn(), getCurrentNavigation: jest.fn() };
  const launcher = { open: jest.fn() };
  const tabs = { activeWorkspacePath: '/ws', findTabByIdAcrossWorkspaces: jest.fn(), getWorkspaceTabs: jest.fn() };
  const params: Record<string, string> = { source: 'catalog', tab: 'tab' };

  beforeEach(() => {
    jest.clearAllMocks();
    state.set('idle'); run.set(null); rejection.set(null); selection.set(new Set(['agent-a']));
    params['source'] = 'catalog'; params['tab'] = 'tab'; delete params['analysis'];
    preview.open.mockResolvedValue(undefined); preview.confirm.mockResolvedValue({ submit: true, decisions });
    store.loadRecommendations.mockResolvedValue(undefined); store.listAnalyses.mockResolvedValue(undefined);
    store.selectAnalysis.mockResolvedValue('loaded'); store.submit.mockResolvedValue({ runId: 'new-run' });
    store.clearAgents.mockImplementation(() => selection.set(new Set()));
    store.toggleAgent.mockImplementation((id: string) => selection.set(new Set([...selection()].filter((value) => value !== id).concat(selection().has(id) ? [] : [id]))));
    generation.refresh.mockResolvedValue(undefined); router.navigate.mockResolvedValue(true);
    router.getCurrentNavigation.mockReturnValue(null);
    launcher.open.mockResolvedValue({ outcome: 'landed', tabId: 'new-tab' });
    tabs.findTabByIdAcrossWorkspaces.mockReturnValue({ workspacePath: '/ws', tab: { id: 'tab', workflow: 'setup-agent-generation' } });
    tabs.getWorkspaceTabs.mockReturnValue([{ id: 'tab', workflow: 'setup-agent-generation' }]);
    TestBed.configureTestingModule({ providers: [
      { provide: AnalysisStepStore, useValue: store },
      { provide: GenerationPreviewStore, useValue: preview },
      { provide: GenerationWorkflowStore, useValue: generation },
      { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: { snapshot: { get queryParamMap() { return convertToParamMap(params); }, get queryParams() { return { ...params }; } } } },
      { provide: TabManagerService, useValue: tabs },
      { provide: GenerationWorkflowLauncherService, useValue: launcher },
      { provide: VSCodeService, useValue: { isElectron: true, config: () => ({ workspaceRoot: '/ws' }) } },
    ] });
    TestBed.overrideComponent(ChooseAgentsPage, { set: { template: '', imports: [], providers: [] } });
    fixture = TestBed.createComponent(ChooseAgentsPage);
    page = fixture.componentInstance;
  });
  afterEach(() => TestBed.resetTestingModule());

  it('loads catalog recommendations and submits the reviewed token, Replace choice and target', async () => {
    await page.ngOnInit();
    expect(store.loadRecommendations).toHaveBeenCalledWith(binding, 'catalog');
    const actions = page as unknown as { openPreview(): Promise<void>; confirmPreview(): Promise<void> };
    await actions.openPreview();
    expect(preview.open).toHaveBeenCalledWith(['agent-a'], false, binding);
    await actions.confirmPreview();
    expect(preview.confirm).toHaveBeenCalledWith(['agent-a']);
    expect(store.submit).toHaveBeenCalledWith(binding, decisions, undefined);
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding', 'analyze', 'generate'], expect.objectContaining({ queryParams: expect.objectContaining({ tab: 'tab', run: 'new-run' }) }));
  });

  it('submits only the previewed row without changing the selection', async () => {
    await page.ngOnInit();
    const actions = page as unknown as { openPreview(agentId: string): Promise<void>; confirmPreview(): Promise<void> };
    await actions.openPreview('agent-b');
    expect(preview.open).toHaveBeenCalledWith(['agent-b'], false, binding);
    await actions.confirmPreview();
    expect(preview.confirm).toHaveBeenCalledWith(['agent-b']);
    expect(store.submit).toHaveBeenCalledWith(binding, decisions, ['agent-b']);
    expect([...selection()]).toEqual(['agent-a']);
    expect(store.clearAgents).not.toHaveBeenCalled();
    expect(store.toggleAgent).not.toHaveBeenCalled();
  });

  it('keeps selection and clears row state when a row preview is dismissed', async () => {
    await page.ngOnInit();
    await page['openPreview']('agent-b');
    page['dismissPreview']();
    expect(preview.cancel).toHaveBeenCalledTimes(1);
    expect(page['previewIds']()).toEqual([]);
    expect(page['previewingRow']()).toBe(false);
    expect([...selection()]).toEqual(['agent-a']);
    expect(store.submit).not.toHaveBeenCalled();
  });

  it('keeps selection when row submission returns an error', async () => {
    await page.ngOnInit();
    store.submit.mockResolvedValueOnce({ error: 'Generation failed' });
    await page['openPreview']('agent-b');
    await page['confirmPreview']();
    expect(store.submit).toHaveBeenCalledWith(binding, decisions, ['agent-b']);
    expect([...selection()]).toEqual(['agent-a']);
    expect(page['submitError']()).toBeTruthy();
  });

  it('keeps selection when a changed row preview cannot submit yet', async () => {
    await page.ngOnInit();
    preview.confirm.mockResolvedValueOnce({ submit: false });
    await page['openPreview']('agent-b');
    await page['confirmPreview']();
    expect(preview.confirm).toHaveBeenCalledWith(['agent-b']);
    expect(store.submit).not.toHaveBeenCalled();
    expect([...selection()]).toEqual(['agent-a']);
  });

  it('keeps selection and reports a thrown row submission failure', async () => {
    await page.ngOnInit();
    store.submit.mockRejectedValueOnce(new Error('Generation failed'));
    await page['openPreview']('agent-b');
    await page['confirmPreview']();
    expect([...selection()]).toEqual(['agent-a']);
    expect(page['submitError']()).toBeTruthy();
  });

  it('reopens preview with the chosen root when the host requires another review', async () => {
    await page.ngOnInit();
    store.submit.mockResolvedValueOnce({ rejection: { reason: 'preview-required' } });
    const actions = page as unknown as { confirmPreview(): Promise<void> };
    await actions.confirmPreview();
    expect(preview.open).toHaveBeenCalledWith(['agent-a'], true, binding);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('shows the owner banner state after a blocked submit', async () => {
    await page.ngOnInit();
    store.submit.mockImplementationOnce(async () => { rejection.set({ reason: 'blocked', ownerTabId: 'tab' }); return { rejection: rejection() }; });
    const actions = page as unknown as { confirmPreview(): Promise<void>; ownerConflict(): boolean };
    await actions.confirmPreview();
    expect(actions.ownerConflict()).toBe(true);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('forwards a non-idle run except after an explicit back navigation', async () => {
    state.set('running');
    run.set({ binding: { ...binding, runId: 'running-run' }, status: 'running' } as SetupGenerationRunState);
    await page.ngOnInit();
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding', 'analyze', 'generate'], expect.objectContaining({ queryParams: expect.objectContaining({ run: 'running-run' }) }));
    router.navigate.mockClear();
    router.getCurrentNavigation.mockReturnValue({ extras: { state: { explicitBack: true } } });
    const backPage = TestBed.createComponent(ChooseAgentsPage).componentInstance;
    await backPage.ngOnInit();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(store.loadRecommendations).toHaveBeenCalled();
  });

  it('creates a missing tab and writes it back with replaceUrl', async () => {
    tabs.findTabByIdAcrossWorkspaces.mockReturnValue(null);
    await page.ngOnInit();
    expect(launcher.open).toHaveBeenCalledWith(expect.objectContaining({ workflow: 'setup-agent-generation', focus: false }));
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { tab: 'new-tab' }, replaceUrl: true }));
  });
  it('does not navigate or bind a tab after launcher reply arrives on a destroyed page', async () => {
    tabs.findTabByIdAcrossWorkspaces.mockReturnValue(null);
    let reply!: (value: { outcome: 'landed'; tabId: string }) => void;
    launcher.open.mockImplementationOnce(() => new Promise((resolve) => { reply = resolve; }));
    const pending = page.ngOnInit();
    fixture.destroy(); reply({ outcome: 'landed', tabId: 'late-tab' }); await pending;
    expect(router.navigate).not.toHaveBeenCalled();
    expect(generation.bind).not.toHaveBeenCalled();
  });
  it('does not navigate after a submit resolves on a destroyed page', async () => {
    await page.ngOnInit();
    let reply!: (value: { runId: string }) => void;
    store.submit.mockImplementationOnce(() => new Promise((resolve) => { reply = resolve; }));
    const pending = page['confirmPreview']();
    await Promise.resolve();
    fixture.destroy(); reply({ runId: 'late-run' }); await pending;
    expect(router.navigate).not.toHaveBeenCalled();
  });
  it('re-lists, selects, and loads recommendations when Retry follows a saved-list failure', async () => {
    params['source'] = 'analysis'; params['analysis'] = 'saved';
    store.listAnalyses.mockRejectedValueOnce(new Error('offline'));
    await page.ngOnInit();
    expect(page['loadError']()).toBe('The analysis could not be loaded. Try again.');
    expect(store.selectAnalysis).not.toHaveBeenCalled();
    await page['retryLoad']();
    expect(store.listAnalyses).toHaveBeenCalledTimes(2);
    expect(store.selectAnalysis).toHaveBeenCalledWith('saved');
    expect(store.loadRecommendations).toHaveBeenCalledWith(binding, 'analysis');
    expect(page['loadError']()).toBeNull();
  });

  it('makes a failed analysis load retryable through list and selection', async () => {
    params['source'] = 'analysis'; params['analysis'] = 'saved';
    store.selectAnalysis.mockResolvedValueOnce('failed');
    await page.ngOnInit();
    expect(page['loadError']()).toBe('The analysis could not be loaded. Try again.');
    expect(store.loadRecommendations).not.toHaveBeenCalled();
    await page['retryLoad']();
    expect(store.listAnalyses).toHaveBeenCalledTimes(2);
    expect(store.selectAnalysis).toHaveBeenCalledTimes(2);
    expect(store.loadRecommendations).toHaveBeenCalledWith(binding, 'analysis');
    expect(page['loadError']()).toBeNull();
  });

  it('keeps the no-longer-available copy for a missing analysis', async () => {
    params['source'] = 'analysis'; params['analysis'] = 'saved';
    store.selectAnalysis.mockResolvedValueOnce('not-found');
    await page.ngOnInit();
    expect(page['loadError']()).toBe('That analysis is no longer available. Analyze the workspace again.');
    expect(store.loadRecommendations).not.toHaveBeenCalled();
  });

  it('retries only recommendations after selection succeeds', async () => {
    params['source'] = 'analysis'; params['analysis'] = 'saved';
    store.loadRecommendations.mockRejectedValueOnce(new Error('offline'));
    await page.ngOnInit();
    expect(page['loadError']()).toBeTruthy();
    await page['retryLoad']();
    expect(store.listAnalyses).toHaveBeenCalledTimes(1);
    expect(store.selectAnalysis).toHaveBeenCalledTimes(1);
    expect(store.loadRecommendations).toHaveBeenCalledTimes(2);
  });
});
