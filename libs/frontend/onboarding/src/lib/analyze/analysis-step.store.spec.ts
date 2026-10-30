import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { MultiPhaseAnalysisResponse, SetupGenerationRejection, SetupGenerationTabBinding } from '@ptah-extension/shared';
import { GenerationWorkflowStore, SetupWizardStateService, WizardAnalysisRunner, WizardRpcService } from '@ptah-extension/setup-wizard';
import { AnalysisStepStore } from './analysis-step.store';

const binding: SetupGenerationTabBinding = { tabId: 'tab', workspacePath: '/ws', workflow: 'setup-agent-generation' };
const completed = { isMultiPhase: true, manifest: { version: 3, runId: 'r', slug: 'saved', analyzedAt: '', updatedAt: '', lifecycle: 'completed', model: 'm', totalDurationMs: 1000,
  phases: { 'project-profile': { status: 'completed', file: 'profile.md', durationMs: 1000 } } }, phaseContents: { 'project-profile': 'Done' }, analysisDir: '/ws/.ptah/analysis/saved' } as MultiPhaseAnalysisResponse;
const unfinished = { ...completed, manifest: { ...completed.manifest, lifecycle: 'paused' as const } } as MultiPhaseAnalysisResponse;
const saved = [{ filename: 'saved', savedAt: '2026-01-01', projectType: 'Angular', phaseCount: 1, model: 'm', durationMs: 1000 }];

describe('AnalysisStepStore', () => {
  let store: AnalysisStepStore;
  const live = signal<MultiPhaseAnalysisResponse | null>(null);
  const running = signal(false);
  const phases = signal<{ id: string; status: string }[]>([]);
  const current = signal<number | null>(null);
  const total = signal<number | null>(null);
  const stream = signal<{ kind: 'text'; content: string; timestamp: number }[]>([]);
  const rpc = { listAnalyses: jest.fn(), loadAnalysis: jest.fn(), recommendAgents: jest.fn() };
  const catalogCall = jest.fn();
  const bound = signal<SetupGenerationTabBinding | null>(null);
  const generation = { bind: jest.fn((value: SetupGenerationTabBinding) => bound.set(value)), binding: bound,
    startAgents: jest.fn(), acceptedRun: signal<{ runId: string; revision: number } | null>(null),
    rejection: signal<SetupGenerationRejection | null>(null), startError: signal<string | null>(null) };
  beforeEach(() => {
    live.set(null); running.set(false); phases.set([]); current.set(null); total.set(null); stream.set([]);
    jest.clearAllMocks(); rpc.listAnalyses.mockResolvedValue(saved); rpc.loadAnalysis.mockResolvedValue(completed); rpc.recommendAgents.mockResolvedValue([]);
    catalogCall.mockResolvedValue({ isSuccess: () => true, data: [] });
    bound.set(null); generation.acceptedRun.set(null); generation.rejection.set(null); generation.startError.set(null);
    TestBed.configureTestingModule({ providers: [AnalysisStepStore,
      { provide: WizardRpcService, useValue: rpc }, { provide: ClaudeRpcService, useValue: { call: catalogCall } },
      { provide: SetupWizardStateService, useValue: { multiPhaseResult: live, phaseStatuses: phases, currentPhaseNumber: current, totalPhaseCount: total, analysisStream: stream } },
      { provide: WizardAnalysisRunner, useValue: { isRunning: running } }, { provide: GenerationWorkflowStore, useValue: generation },
    ] });
    store = TestBed.inject(AnalysisStepStore);
  });
  it('loads a listed completed analysis and reports a missing filename', async () => {
    await store.listAnalyses();
    expect(await store.selectAnalysis('saved')).toBe('loaded');
    expect(store.selected()).toBe('saved');
    expect(store.loaded()).toEqual(completed);
    expect(await store.selectAnalysis('missing')).toBe('not-found');
    expect(rpc.loadAnalysis).toHaveBeenCalledTimes(1);
  });
  it('never substitutes an unfinished live run for the selected analysis', async () => {
    await store.listAnalyses(); await store.selectAnalysis('saved'); live.set(unfinished);
    expect(store.loaded()).toEqual(completed);
    store.clearSelection(); expect(store.loaded()).toBeNull();
  });
  it('uses the chosen analysis for recommendations and the catalog RPC for catalog mode', async () => {
    await store.listAnalyses(); await store.selectAnalysis('saved');
    await store.loadRecommendations(binding, 'analysis');
    expect(rpc.recommendAgents).toHaveBeenCalledWith(completed);
    await store.loadRecommendations(binding, 'catalog');
    expect(catalogCall).toHaveBeenCalledWith('wizard:recommend-agents', { mode: 'workspace-catalog', tabBinding: binding }, { timeout: 60_000 });
  });
  it('shows stream counts only while attached', () => {
    running.set(true); stream.set([{ kind: 'text', content: 'x', timestamp: 1 }]);
    expect(store.streamCounts()).toBeNull();
    store.attachStream(); expect(store.streamCounts()?.total).toBe(1);
    store.detachStream(); expect(store.streamCounts()).toBeNull();
  });
  it('does not forward a previously accepted run when a new start fails', async () => {
    generation.acceptedRun.set({ runId: 'old-run', revision: 1 });
    generation.startAgents.mockImplementationOnce(async () => generation.startError.set('Could not start'));
    expect(await store.submit(binding)).toEqual({ error: 'Could not start' });
    generation.startAgents.mockImplementationOnce(async () => {
      generation.acceptedRun.set({ runId: 'new-run', revision: 2 });
    });
    expect(await store.submit(binding)).toEqual({ runId: 'new-run' });
  });
  it('submits explicit row ids without changing the selected agents', async () => {
    store.toggleAgent('agent-a');
    await store.submit(binding, undefined, ['agent-b']);
    expect(generation.startAgents).toHaveBeenCalledWith(['agent-b'], undefined);
    expect([...store.selection()]).toEqual(['agent-a']);
  });
  it('does not reuse a stale blocked or preview-required rejection when start exits early', async () => {
    for (const reason of ['blocked', 'preview-required'] as const) {
      generation.rejection.set({ reason });
      generation.startAgents.mockResolvedValueOnce(undefined);
      expect(await store.submit(binding)).toEqual({ error: 'Generation could not start. Try again.' });
    }
  });
  it('fails with fixed copy when the generation binding was not accepted', async () => {
    generation.bind.mockImplementationOnce(() => undefined);
    expect(await store.submit(binding)).toEqual({ error: 'Generation tab is unavailable. Try again.' });
    expect(generation.startAgents).not.toHaveBeenCalled();
  });
  it('distinguishes a saved-list failure from an empty list', async () => {
    rpc.listAnalyses.mockRejectedValueOnce(new Error('offline'));
    await expect(store.listAnalyses()).rejects.toThrow('offline');
    expect(store.saved()).toEqual([]);
    await store.listAnalyses();
    expect(rpc.listAnalyses).toHaveBeenCalledWith({ throwOnError: true });
  });
  it('normalizes catalog rows with missing criteria and drops malformed rows', async () => {
    catalogCall.mockResolvedValueOnce({ isSuccess: () => true, data: [
      { agentId: 'a', agentName: 'Agent A', relevanceScore: 75, recommended: true, category: 'development' },
      { agentId: 'bad', recommended: true },
    ] });
    await store.loadRecommendations(binding, 'catalog');
    expect(store.recommendations()).toEqual([expect.objectContaining({ agentId: 'a', matchedCriteria: [] })]);
    expect([...store.selection()]).toEqual(['a']);
    catalogCall.mockResolvedValueOnce({ isSuccess: () => true, data: {} });
    await expect(store.loadRecommendations(binding, 'catalog')).rejects.toThrow('Catalog unavailable');
  });
});
