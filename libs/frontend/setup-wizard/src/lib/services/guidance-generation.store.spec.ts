import { TestBed } from '@angular/core/testing';
import type { SetupGenerationRunState } from '@ptah-extension/shared';
import { GuidanceGenerationStore } from './guidance-generation.store';
import { WizardRpcService } from './wizard-rpc.service';

const binding = {
  tabId: 'own',
  workspacePath: '/ws',
  workflow: 'setup-project-prompt' as const,
};
const accepted = {
  runId: 'r1',
  status: 'starting' as const,
  source: { kind: 'workspace-discovery' as const, reason: 'missing' as const },
  effectiveProvider: 'unknown',
  effectiveModel: 'unknown',
};
const run = (
  status: SetupGenerationRunState['status'],
  committedState?: SetupGenerationRunState['committedState'],
): SetupGenerationRunState => ({
  binding: { ...binding, runId: 'r1' },
  status,
  committedState,
  source: accepted.source,
  effectiveProvider: 'unknown',
  effectiveModel: 'unknown',
});

describe('GuidanceGenerationStore', () => {
  let rpc: {
    getBoundRunState: jest.Mock;
    startBoundGuidance: jest.Mock;
    cancelBoundRun: jest.Mock;
    getEnhancedPromptsStatus: jest.Mock;
    regenerateBoundGuidance: jest.Mock;
    toggleEnhancedPrompts: jest.Mock;
    getEnhancedPromptContent: jest.Mock;
    downloadEnhancedPrompt: jest.Mock;
  };
  let store: GuidanceGenerationStore;
  beforeEach(() => {
    rpc = {
      getBoundRunState: jest.fn().mockResolvedValue(null),
      startBoundGuidance: jest.fn().mockResolvedValue({ accepted }),
      cancelBoundRun: jest.fn().mockResolvedValue(true),
      getEnhancedPromptsStatus: jest
        .fn()
        .mockResolvedValue({ hasGeneratedPrompt: false }),
      regenerateBoundGuidance: jest.fn(),
      toggleEnhancedPrompts: jest.fn(),
      getEnhancedPromptContent: jest.fn(),
      downloadEnhancedPrompt: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        GuidanceGenerationStore,
        { provide: WizardRpcService, useValue: rpc },
      ],
    });
    store = TestBed.inject(GuidanceGenerationStore);
  });

  it('starts without analysis and labels only verified latest analysis', async () => {
    store.bind(binding);
    await store.start();
    expect(rpc.startBoundGuidance).toHaveBeenCalledWith(binding);
    expect(store.source()).toBe('Workspace discovery (missing)');
    expect(store.snapshot()?.provider).toBeNull();
    rpc.getBoundRunState.mockResolvedValue({
      ...run('running'),
      source: {
        kind: 'verified-analysis',
        analysisRunId: 'a',
        analysisDir: '/secret',
      },
    });
    store.unbind();
    store.bind(binding);
    await store.refresh();
    expect(store.source()).toBe('Verified latest analysis');
    expect(JSON.stringify(store.snapshot())).not.toContain('/secret');
  });

  it('does not mark a trace-write failure successful', async () => {
    store.bind(binding);
    await store.start();
    rpc.getBoundRunState.mockResolvedValue(run('completed', 'unknown'));
    await store.refresh();
    expect(store.status()).toBe('failed');
  });

  it('keeps an unchanged completed run successful after an active run', async () => {
    store.bind(binding);
    await store.start();
    rpc.getBoundRunState.mockResolvedValue(run('completed', 'unchanged'));
    await store.refresh();
    expect(store.status()).toBe('completed');
  });

  it('shows committed guidance with neutral status after reload unless cancellation is verified', async () => {
    rpc.getBoundRunState.mockResolvedValue(run('completed', 'committed'));
    rpc.getEnhancedPromptsStatus.mockResolvedValue({
      hasGeneratedPrompt: true,
      generatedAt: 'saved',
      enabled: true,
      cacheValid: true,
    });
    store.bind(binding);
    await store.refresh();
    expect(store.status()).toBe('idle');
    expect(store.result()?.generatedAt).toBe('saved');
    rpc.getBoundRunState.mockResolvedValue(run('cancelled', 'unchanged'));
    await store.refresh();
    expect(store.status()).toBe('cancelled');
  });

  it('cancels the exact run before commit and rereads after a lost stop response', async () => {
    rpc.getBoundRunState.mockResolvedValue(run('running'));
    rpc.cancelBoundRun.mockRejectedValue(new Error('private transport error'));
    store.bind(binding);
    await store.refresh();
    store.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rpc.cancelBoundRun).toHaveBeenCalledWith({
      ...binding,
      runId: 'r1',
    });
    expect(store.status()).not.toBe('completed');
  });

  it('looks up the own tab after a lost start response and ignores another tab', async () => {
    rpc.startBoundGuidance.mockRejectedValue(new Error('lost'));
    rpc.getBoundRunState.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...run('running'),
      binding: { ...binding, tabId: 'other', runId: 'r1' },
    });
    store.bind(binding);
    await store.start();
    expect(rpc.getBoundRunState).toHaveBeenCalledWith(binding, undefined);
    expect(store.run()).toBeNull();
  });

  it('loads only the committed metadata and supports enabled/content/download actions', async () => {
    rpc.getEnhancedPromptsStatus.mockResolvedValue({
      hasGeneratedPrompt: true,
      generatedAt: 'now',
      enabled: true,
      cacheValid: false,
    });
    rpc.toggleEnhancedPrompts.mockResolvedValue(undefined);
    rpc.getEnhancedPromptContent.mockResolvedValue('saved text');
    rpc.downloadEnhancedPrompt.mockResolvedValue({ success: true });
    store.bind(binding);
    await store.refreshCommitted();
    await store.setEnabled(false);
    await store.loadContent();
    await store.download();
    expect(store.result()?.generatedAt).toBe('now');
    expect(store.content()).toBe('saved text');
    expect(store.actionFailed()).toBe(false);
  });
});
