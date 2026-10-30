import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SetupWizardStateService, WizardAnalysisRunner, WizardRpcService } from '@ptah-extension/setup-wizard';
import { AnalysisStepStore } from './analysis-step.store';
import { AnalyzeWorkspacePage } from './analyze-workspace.page';

describe('AnalyzeWorkspacePage', () => {
  const selected = signal<string | null>(null);
  const loaded = signal(null);
  const saved = signal([{ filename: 'saved', projectType: 'Angular', savedAt: '', durationMs: 1000 }]);
  const store = { selected, loaded, saved, hidden: signal(new Set<string>()), listAnalyses: jest.fn(), selectAnalysis: jest.fn(), detachStream: jest.fn() };
  const rpc = { getResumableRun: jest.fn() };
  const navigate = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks(); selected.set(null); loaded.set(null);
    store.listAnalyses.mockResolvedValue(undefined); store.selectAnalysis.mockResolvedValue('loaded');
    rpc.getResumableRun.mockResolvedValue({ analysis: null, generation: null });
    navigate.mockResolvedValue(true);
    TestBed.configureTestingModule({ providers: [
      { provide: AnalysisStepStore, useValue: store }, { provide: WizardRpcService, useValue: rpc },
      { provide: WizardAnalysisRunner, useValue: { isRunning: signal(false), isCanceling: signal(false), errorMessage: signal(null) } },
      { provide: SetupWizardStateService, useValue: { reset: jest.fn() } },
      { provide: Router, useValue: { navigate } },
    ] });
    TestBed.overrideComponent(AnalyzeWorkspacePage, { set: { template: '' } });
  });
  it('selects a saved analysis from the query without substituting a resumable run', async () => {
    rpc.getResumableRun.mockResolvedValue({ analysis: { manifest: { lifecycle: 'paused' } }, generation: null });
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.componentRef.setInput('analysis', 'saved'); fixture.detectChanges();
    await fixture.componentInstance.ngOnInit();
    expect(store.selectAnalysis).toHaveBeenCalledWith('saved');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { analysis: 'saved' } }));
  });
  it('carries the selected analysis and clears explicitBack on forward navigation', async () => {
    selected.set('saved');
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    await fixture.componentInstance['chooseAgents']();
    expect(navigate).toHaveBeenCalledWith(['/onboarding', 'analyze', 'agents'], expect.objectContaining({ queryParams: { analysis: 'saved' }, state: { explicitBack: false } }));
  });
  it('does not turn a saved-analysis navigation failure into a list error', async () => {
    navigate.mockRejectedValueOnce(new Error('navigation failed'));
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.componentRef.setInput('analysis', 'saved');
    await expect(fixture.componentInstance.ngOnInit()).resolves.toBeUndefined();
    expect(store.listAnalyses).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance['savedError']()).toBe(false);
    expect(fixture.componentInstance['selectError']()).toBeTruthy();
    expect(rpc.getResumableRun).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });
});
