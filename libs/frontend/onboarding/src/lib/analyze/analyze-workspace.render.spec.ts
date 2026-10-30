import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SetupWizardStateService, WizardAnalysisRunner, WizardRpcService } from '@ptah-extension/setup-wizard';
import { AnalysisStepStore } from './analysis-step.store';
import { AnalyzeWorkspacePage } from './analyze-workspace.page';

describe('AnalyzeWorkspacePage rendered actions', () => {
  const loaded = signal<{ manifest: { slug: string; totalDurationMs: number }; phaseContents: Record<string, string> } | null>(null);
  const selected = signal<string | null>(null);
  const running = signal(false);
  const canceling = signal(false);
  const error = signal<string | null>(null);
  const phaseHeader = signal<{ current: number; total: number } | null>(null);
  const phaseRows = signal([{ id: 'project-profile', label: 'Project profile', status: 'completed' as const, durationMs: 1000 }]);
  const store = { loaded, selected, phaseHeader, phaseRows, streamCounts: signal(null), saved: signal([{ filename: 'saved', projectType: 'Angular', savedAt: '', durationMs: 1000 }]),
    hidden: signal(new Set<string>()), listAnalyses: jest.fn(), selectAnalysis: jest.fn(), clearSelection: jest.fn(), hideAnalysis: jest.fn(), attachStream: jest.fn(), detachStream: jest.fn() };
  const runner = { isRunning: running, isCanceling: canceling, errorMessage: error, statusText: signal('Analyzing'),
    startFreshAnalysis: jest.fn(), resumeAnalysis: jest.fn(), cancel: jest.fn(), reset: jest.fn() };
  const rpc = { getResumableRun: jest.fn() };
  const router = { navigate: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks(); loaded.set(null); selected.set(null); running.set(false); canceling.set(false); error.set(null); phaseHeader.set(null);
    store.hidden.set(new Set());
    store.listAnalyses.mockResolvedValue(undefined);
    store.selectAnalysis.mockImplementation(async (filename: string) => { selected.set(filename); loaded.set({ manifest: { slug: filename, totalDurationMs: 1000 }, phaseContents: { 'project-profile': 'Done' } }); return 'loaded'; });
    store.clearSelection.mockImplementation(() => { selected.set(null); loaded.set(null); });
    runner.startFreshAnalysis.mockResolvedValue(undefined); runner.resumeAnalysis.mockResolvedValue(undefined); runner.cancel.mockResolvedValue(undefined);
    rpc.getResumableRun.mockResolvedValue({ analysis: { manifest: { lifecycle: 'paused' } } });
    router.navigate.mockResolvedValue(true);
    TestBed.configureTestingModule({ providers: [
      { provide: AnalysisStepStore, useValue: store }, { provide: WizardAnalysisRunner, useValue: runner },
      { provide: WizardRpcService, useValue: rpc }, { provide: SetupWizardStateService, useValue: { reset: jest.fn() } },
      { provide: Router, useValue: router },
    ] });
  });

  it('shows a selected saved analysis ahead of an interrupted run and keeps Continue', async () => {
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.componentRef.setInput('analysis', 'saved'); fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Analysis complete');
    expect(text).not.toContain('Continue previous run');
    const continueButton = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Continue');
    continueButton?.click();
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding', 'analyze', 'agents'], expect.objectContaining({ queryParams: { analysis: 'saved' } }));
  });

  it('shows interrupted actions and resumes or starts fresh from confirmation', async () => {
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Continue previous run');
    [...root.querySelectorAll('button')].find((button) => button.textContent?.includes('Continue previous run'))?.click();
    await fixture.whenStable();
    expect(runner.resumeAnalysis).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('starts fresh from the interrupted panel and hides a saved entry from the list', async () => {
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Hide from list')?.click();
    expect(store.hideAnalysis).toHaveBeenCalledWith('saved');
    [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Start fresh')?.click();
    await fixture.whenStable();
    expect(store.clearSelection).toHaveBeenCalledTimes(1);
    expect(runner.startFreshAnalysis).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('shows Retry when loading saved analyses fails', async () => {
    store.listAnalyses.mockRejectedValueOnce(new Error('offline'));
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Saved analyses could not be loaded');
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Retry')?.click();
    await fixture.whenStable();
    expect(store.listAnalyses).toHaveBeenCalledTimes(2);
  });

  it('applies the requested analysis after saved-list Retry succeeds', async () => {
    store.listAnalyses.mockRejectedValueOnce(new Error('offline'));
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.componentRef.setInput('analysis', 'saved');
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(store.selectAnalysis).not.toHaveBeenCalled();
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Retry')?.click();
    await fixture.whenStable();
    expect(store.selectAnalysis).toHaveBeenCalledWith('saved');
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { analysis: 'saved' } }));
  });

  it('does not navigate when a saved selection resolves after destroy', async () => {
    let resolveSelection!: (result: 'loaded') => void;
    store.selectAnalysis.mockImplementationOnce(() => new Promise((resolve) => { resolveSelection = resolve; }));
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.componentRef.setInput('analysis', 'saved');
    const pending = fixture.componentInstance.ngOnInit();
    await Promise.resolve();
    fixture.destroy();
    resolveSelection('loaded');
    await pending;
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('renders the phase header and confirms Stop through the modal', async () => {
    running.set(true); phaseHeader.set({ current: 2, total: 4 });
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="phase-header"]')?.textContent).toContain('Phase 2 of 4');
    const modal = root.querySelector('dialog') as HTMLDialogElement;
    modal.showModal = jest.fn(); modal.close = jest.fn();
    [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Stop')?.click();
    expect(modal.showModal).toHaveBeenCalledTimes(1);
    expect(runner.cancel).not.toHaveBeenCalled();
    [...modal.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Stop analysis')?.click();
    await fixture.whenStable();
    expect(runner.cancel).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('opens Manual adjust and shows recovery actions if Stop cannot be confirmed', async () => {
    loaded.set({ manifest: { slug: 'saved', totalDurationMs: 1000 }, phaseContents: { 'project-profile': 'Done' } });
    selected.set('saved');
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const manual = root.querySelectorAll('dialog')[1] as HTMLDialogElement;
    manual.showModal = jest.fn();
    [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Manual adjust')?.click();
    expect(manual.showModal).toHaveBeenCalledTimes(1);
    runner.cancel.mockRejectedValueOnce(new Error('private'));
    await fixture.componentInstance['stop'](); fixture.detectChanges();
    expect(root.textContent).toContain('The stop could not be confirmed');
    expect(root.textContent).toContain('Start over');
    [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Retry')?.click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(runner.resumeAnalysis).toHaveBeenCalledTimes(1);
    expect(root.textContent).not.toContain('The stop could not be confirmed');
  });

  it('stops the elapsed timer after the run reaches a terminal state', async () => {
    jest.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
      await fixture.componentInstance['startFresh']();
      expect(jest.getTimerCount()).toBeGreaterThan(0);
      running.set(false);
      jest.advanceTimersByTime(1000);
      expect(jest.getTimerCount()).toBe(0);
      fixture.destroy();
    } finally { jest.useRealTimers(); }
  });
});
