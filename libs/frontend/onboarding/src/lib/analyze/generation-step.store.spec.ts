import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { SetupGenerationRunState, SetupGenerationTabBinding } from '@ptah-extension/shared';
import { GenerationWorkflowStore, GuidanceGenerationStore, WizardRpcService } from '@ptah-extension/setup-wizard';
import { GenerationStepStore } from './generation-step.store';

const binding: SetupGenerationTabBinding = { tabId: 'tab-a', workspacePath: '/ws', workflow: 'setup-project-prompt' };
const run: SetupGenerationRunState = {
  binding: { ...binding, runId: 'A' }, status: 'completed', committedState: 'committed',
  source: { kind: 'workspace-discovery', reason: 'missing' }, effectiveProvider: 'unknown', effectiveModel: 'unknown',
};
const content = 'CORE\n## Project-Specific Guidance\n### Project Context\none\n### Framework Guidelines\ntwo\n### Coding Standards\nthree\n### Architecture Notes\nfour';
const status = { enabled: true, hasGeneratedPrompt: true, generatedAt: 'g0', detectedStack: null, cacheValid: true };

describe('GenerationStepStore', () => {
  let store: GenerationStepStore;
  const localBinding = signal<SetupGenerationTabBinding | null>(null);
  const localRun = signal<SetupGenerationRunState | null>(null);
  const localStatus = signal<string>('idle');
  const result = signal<{ generatedAt: string | null } | null>(null);
  const workflowRun = signal<SetupGenerationRunState | null>(null);
  const bindWorkflow = jest.fn();
  const bindGuidance = jest.fn((value: SetupGenerationTabBinding) => localBinding.set(value));
  const getBoundRunState = jest.fn<Promise<SetupGenerationRunState | null>, [SetupGenerationTabBinding, string?]>();
  const getEnhancedPromptsStatus = jest.fn();
  const getEnhancedPromptContent = jest.fn();
  const tabs = { findTabByIdAcrossWorkspaces: jest.fn(), getWorkspaceTabs: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    localBinding.set(binding); localRun.set(run); localStatus.set('completed'); result.set({ generatedAt: 'g0' }); workflowRun.set(null);
    getBoundRunState.mockResolvedValue(run);
    getEnhancedPromptsStatus.mockResolvedValue(status);
    getEnhancedPromptContent.mockResolvedValue(content);
    const tab = { id: binding.tabId, workflow: binding.workflow };
    tabs.findTabByIdAcrossWorkspaces.mockReturnValue({ tab, workspacePath: '/ws' });
    tabs.getWorkspaceTabs.mockReturnValue([tab]);
    TestBed.configureTestingModule({ providers: [GenerationStepStore,
      { provide: TabManagerService, useValue: tabs },
      { provide: GenerationWorkflowStore, useValue: { bind: bindWorkflow, run: workflowRun } },
      { provide: GuidanceGenerationStore, useValue: { bind: bindGuidance, binding: localBinding, run: localRun, status: localStatus, result } },
      { provide: WizardRpcService, useValue: { getBoundRunState, getEnhancedPromptsStatus, getEnhancedPromptContent } },
    ] });
    store = TestBed.inject(GenerationStepStore);
    TestBed.flushEffects();
  });

  it('captures the happy path with two runless identity checks and four rows', async () => {
    expect(await store.captureGuidanceSections(binding, 'A')).toBe('captured');
    expect(getBoundRunState).toHaveBeenCalledTimes(2);
    expect(getBoundRunState).toHaveBeenNthCalledWith(1, binding);
    expect(getBoundRunState).toHaveBeenNthCalledWith(2, binding);
    expect(store.guidanceSections('/ws', 'A', 'g0')?.sections).toHaveLength(4);
  });
  it('updates a computed from null when capture resolves without another signal change', async () => {
    const sections = computed(() => store.guidanceSections('/ws', 'A', 'g0'));
    expect(sections()).toBeNull();
    expect(await store.captureGuidanceSections(binding, 'A')).toBe('captured');
    expect(sections()?.sections).toHaveLength(4);
  });
  it('rejects B completed before the first read', async () => {
    getBoundRunState.mockResolvedValueOnce({ ...run, binding: { ...run.binding, runId: 'B' } });
    expect(await store.captureGuidanceSections(binding, 'A')).toBe('stale');
    expect(getBoundRunState).toHaveBeenCalledWith(binding);
    expect(getEnhancedPromptsStatus).not.toHaveBeenCalled();
  });
  it.each(['before', 'during'] as const)('rejects B active %s the capture', async (when) => {
    const activeB = { ...run, binding: { ...run.binding, runId: 'B' }, status: 'running' as const };
    if (when === 'before') getBoundRunState.mockResolvedValueOnce(activeB);
    else getBoundRunState.mockResolvedValueOnce(run).mockResolvedValueOnce(activeB);
    expect(await store.captureGuidanceSections(binding, 'A')).toBe('stale');
    expect(getBoundRunState).toHaveBeenCalledWith(binding);
    expect(getBoundRunState.mock.calls.every((args) => args.length === 1)).toBe(true);
  });
  it('rejects a service lock held by unbound generation', async () => {
    const lockOwnerTabId = 'other-tab';
    getBoundRunState.mockImplementationOnce(async (candidate) =>
      candidate.tabId === lockOwnerTabId ? run : null);
    expect(await store.captureGuidanceSections(binding, 'A')).toBe('stale');
    expect(getBoundRunState).toHaveBeenCalledWith(binding);
    expect(getEnhancedPromptsStatus).not.toHaveBeenCalled();
  });
  it('single-flights two concurrent captures for the same run', async () => {
    let release!: (value: SetupGenerationRunState | null) => void;
    getBoundRunState.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = store.captureGuidanceSections(binding, 'A');
    const second = store.captureGuidanceSections(binding, 'A');
    expect(getBoundRunState).toHaveBeenCalledTimes(1);
    release(run);
    expect(await Promise.all([first, second])).toEqual(['captured', 'captured']);
    expect(getBoundRunState).toHaveBeenCalledTimes(2);
  });
  it('rejects a new run in the same tab', async () => {
    getBoundRunState.mockResolvedValueOnce(run).mockResolvedValueOnce({ ...run, binding: { ...run.binding, runId: 'B' }, status: 'running' });
    expect(await store.captureGuidanceSections(binding, 'A')).toBe('stale');
  });
  it('rejects generatedAt moving between status reads', async () => {
    getEnhancedPromptsStatus.mockResolvedValueOnce(status).mockResolvedValueOnce({ ...status, generatedAt: 'g1' });
    expect(await store.captureGuidanceSections(binding, 'A')).toBe('stale');
    expect(store.guidanceSections('/ws', 'A', 'g0')).toBeNull();
  });
  it('rejects guidance disabled during capture', async () => {
    getEnhancedPromptsStatus.mockResolvedValueOnce(status).mockResolvedValueOnce({ ...status, enabled: false });
    expect(await store.captureGuidanceSections(binding, 'A')).toBe('stale');
  });
  it('returns unavailable for null content', async () => {
    getEnhancedPromptContent.mockResolvedValueOnce(null);
    expect(await store.captureGuidanceSections(binding, 'A')).toBe('unavailable');
  });
  it('returns unavailable when a run-state RPC throws', async () => {
    getBoundRunState.mockRejectedValueOnce(new Error('transport'));
    expect(await store.captureGuidanceSections(binding, 'A')).toBe('unavailable');
  });
  it('rejects a binding changed mid-capture', async () => {
    getEnhancedPromptContent.mockImplementationOnce(async () => { localBinding.set({ ...binding, tabId: 'B' }); return content; });
    expect(await store.captureGuidanceSections(binding, 'A')).toBe('stale');
  });
  it.each([
    ['workspace', { ...binding, workspacePath: '/other' }, run],
    ['run id', binding, { ...run, binding: { ...run.binding, runId: 'B' } }],
  ] as const)('rejects a %s changed mid-capture', async (_name, nextBinding, nextRun) => {
    getEnhancedPromptContent.mockImplementationOnce(async () => {
      localBinding.set(nextBinding);
      localRun.set(nextRun);
      return content;
    });
    expect(await store.captureGuidanceSections(binding, 'A')).toBe('stale');
    expect(store.guidanceSections('/ws', 'A', 'g0')).toBeNull();
  });
  it('hides captured sections when the workspace result advances while run A stays local', async () => {
    await store.captureGuidanceSections(binding, 'A');
    result.set({ generatedAt: 'g1' });
    expect(store.guidanceSections('/ws', 'A', 'g0')).toBeNull();
  });
  it('omits section counts after reload', () => {
    expect(store.guidanceSections('/ws', 'A', 'g0')).toBeNull();
  });
  it('never captures a completed run bound late', () => {
    localRun.set(null); localStatus.set('idle'); TestBed.flushEffects();
    localRun.set(run); localStatus.set('completed'); TestBed.flushEffects();
    expect(getBoundRunState).not.toHaveBeenCalled();
    expect(store.guidanceSections('/ws', 'A', 'g0')).toBeNull();
  });
  it('captures only after a live nonterminal to completed transition', async () => {
    localRun.set({ ...run, status: 'running' }); localStatus.set('running'); TestBed.flushEffects();
    localRun.set(run); localStatus.set('completed'); TestBed.flushEffects();
    await Promise.resolve(); await Promise.resolve();
    expect(getBoundRunState).toHaveBeenCalled();
  });
  it('validates the tab and forwards an expected run for recovery', () => {
    expect(store.bindGuidance(binding, 'A')).toBe('bound');
    expect(bindWorkflow).toHaveBeenCalledWith(binding, 'A');
    expect(bindGuidance).toHaveBeenCalledWith(binding);
    tabs.findTabByIdAcrossWorkspaces.mockReturnValueOnce(null);
    expect(store.bindGuidance(binding, 'A')).toBe('invalid-tab');
    tabs.findTabByIdAcrossWorkspaces.mockReturnValue({ tab: { id: 'tab-a', workflow: binding.workflow }, workspacePath: '/other' });
    expect(store.bindGuidance(binding, 'A')).toBe('workspace-mismatch');
  });
});
