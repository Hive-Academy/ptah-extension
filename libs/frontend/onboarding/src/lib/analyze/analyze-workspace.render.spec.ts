import { Component, OnDestroy, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { AnalysisTranscriptComponent, SetupWizardStateService, WizardAnalysisRunner, WizardRpcService } from '@ptah-extension/setup-wizard';
import { DetailsLogComponent, type DetailsLogStreamCounts } from '../shared/details-log.component';
import { AnalysisStepStore } from './analysis-step.store';
import { AnalyzeWorkspacePage } from './analyze-workspace.page';

const transcriptDestroyed = jest.fn();

@Component({
  selector: 'ptah-analysis-transcript',
  standalone: true,
  template: '<div data-testid="analysis-transcript-stub"></div>',
})
class AnalysisTranscriptStubComponent implements OnDestroy {
  ngOnDestroy(): void { transcriptDestroyed(); }
}

describe('AnalyzeWorkspacePage rendered actions', () => {
  const loaded = signal<{ manifest: { slug: string; totalDurationMs: number }; phaseContents: Record<string, string> } | null>(null);
  const selected = signal<string | null>(null);
  const running = signal(false);
  const canceling = signal(false);
  const error = signal<string | null>(null);
  const phaseHeader = signal<{ current: number; total: number } | null>(null);
  const phaseRows = signal([{ id: 'project-profile', label: 'Project profile', status: 'completed' as const, durationMs: 1000 }]);
  const store = { loaded, selected, phaseHeader, phaseRows, streamCounts: signal<DetailsLogStreamCounts | null>(null), saved: signal([{ filename: 'saved', projectType: 'Angular', savedAt: '', durationMs: 1000 }]),
    hidden: signal(new Set<string>()), listAnalyses: jest.fn(), selectAnalysis: jest.fn(), clearSelection: jest.fn(), hideAnalysis: jest.fn(), attachStream: jest.fn(), detachStream: jest.fn() };
  const runner = { isRunning: running, isCanceling: canceling, errorMessage: error, statusText: signal('Analyzing'),
    startFreshAnalysis: jest.fn(), resumeAnalysis: jest.fn(), cancel: jest.fn(), reset: jest.fn() };
  const rpc = { getResumableRun: jest.fn() };
  const router = { navigate: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks(); loaded.set(null); selected.set(null); running.set(false); canceling.set(false); error.set(null); phaseHeader.set(null); store.streamCounts.set(null);
    store.hidden.set(new Set()); store.saved.set([{ filename: 'saved', projectType: 'Angular', savedAt: '', durationMs: 1000 }]);
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
    TestBed.overrideComponent(DetailsLogComponent, {
      remove: { imports: [AnalysisTranscriptComponent] },
      add: { imports: [AnalysisTranscriptStubComponent] },
    });
  });

  it('shows a selected saved analysis ahead of an interrupted run and keeps Continue', async () => {
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.componentRef.setInput('analysis', 'saved'); fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Analysis complete');
    expect(text).not.toContain('Continue previous run');
    const continueButton = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Choose agents');
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

  it('formats saved dates in the current locale and gives actions a narrow row', async () => {
    store.saved.set([{ filename: 'saved', projectType: 'Angular', savedAt: '2026-10-29T09:00:00.000Z', durationMs: 1000 }]);
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const metadata = root.querySelector('li p.text-xs') as HTMLElement;
    expect(metadata.textContent).not.toContain('2026-10-29T09:00:00.000Z');
    expect(metadata.textContent).toContain('2026');
    expect(root.querySelector('li > div')?.className).toContain('w-full');
    fixture.destroy();
  });

  it('hides the saved card when no visible saved analyses or error remain', async () => {
    store.saved.set([]);
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Saved analyses');
    fixture.destroy();
  });

  it('does not apply a stale query analysis after a fresh run follows a failed list', async () => {
    store.saved.set([{ filename: 'saved', projectType: 'Angular', savedAt: '', durationMs: 1000 }]);
    store.listAnalyses.mockRejectedValueOnce(new Error('offline'));
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.componentRef.setInput('analysis', 'saved');
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    await fixture.componentInstance['startFresh']();
    expect(store.selectAnalysis).not.toHaveBeenCalled();
    fixture.destroy();
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

  it('shows recovery actions if Stop cannot be confirmed', async () => {
    loaded.set({ manifest: { slug: 'saved', totalDurationMs: 1000 }, phaseContents: { 'project-profile': 'Done' } });
    selected.set('saved');
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    runner.cancel.mockRejectedValueOnce(new Error('private'));
    await fixture.componentInstance['stop'](); fixture.detectChanges();
    expect(root.textContent).toContain('The stop could not be confirmed');
    expect(root.textContent).toContain('Start over');
    [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Retry')?.click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(runner.resumeAnalysis).toHaveBeenCalledTimes(1);
    expect(root.textContent).not.toContain('The stop could not be confirmed');
  });

  it('does not render Manual adjust or its alert when analysis is done', async () => {
    loaded.set({ manifest: { slug: 'saved', totalDurationMs: 1000 }, phaseContents: { 'project-profile': 'Done' } });
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="analyze-workspace"]')).not.toBeNull();
    expect(root.textContent).toContain('Phase details');
    expect(root.textContent).not.toContain('Manual adjust');
    expect(root.querySelectorAll('dialog')).toHaveLength(1);
  });

  it('mounts a live, non-collapsible pane log before the running card', async () => {
    running.set(true);
    phaseHeader.set({ current: 2, total: 4 });
    store.streamCounts.set({ total: 3, text: 1, thinking: 1, tool: 1, errors: 0 });
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const layout = root.querySelector('ptah-live-run-layout') as HTMLElement;
    const log = layout.querySelector('[data-testid="details-log"]') as HTMLElement;
    expect(layout.querySelector('.run-log')?.contains(log)).toBe(true);
    expect(layout.querySelector('.run-results')?.textContent).toContain('Analyzing workspace');
    expect(log.compareDocumentPosition(layout.querySelector('ptah-run-panel') as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(log.querySelector('summary')).toBeNull();
    expect(log.querySelector('[role="log"]')).not.toBeNull();
    expect(log.querySelector('[data-testid="analysis-transcript-stub"]')).not.toBeNull();
    expect(log.querySelector('[data-testid="details-log-counts"]')?.textContent).toContain('3 events');
    expect(log.textContent).toContain('Streaming analysis output. Read-only.');
    expect(root.querySelector('[data-testid="phase-header"]')?.textContent).toContain('Phase 2 of 4');
    expect(root.textContent).toContain('The analysis keeps running.');
    fixture.destroy();
  });

  it('renders the real transcript in pane mode without a collapse toggle', async () => {
    TestBed.overrideComponent(DetailsLogComponent, {
      remove: { imports: [AnalysisTranscriptStubComponent] },
      add: { imports: [AnalysisTranscriptComponent] },
    });
    TestBed.overrideProvider(SetupWizardStateService, { useValue: {
      reset: jest.fn(), analysisStream: signal([]), phaseStreamingStates: signal([]),
      scanProgress: signal(null), phaseStatuses: signal([]),
    } });
    TestBed.overrideProvider(ExecutionTreeBuilderService, { useValue: { buildTree: jest.fn() } });
    running.set(true);
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const transcript = root.querySelector('ptah-analysis-transcript') as HTMLElement;
    expect(transcript).not.toBeNull();
    expect(transcript.querySelector('button[aria-controls="analysis-transcript-content"]')).toBeNull();
    expect(transcript.querySelector('div')?.classList.contains('max-h-[70vh]')).toBe(false);
    fixture.destroy();
  });

  it('keeps the same pane transcript and width while cancelling', async () => {
    running.set(true);
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const transcript = root.querySelector('ptah-analysis-transcript');
    running.set(false); canceling.set(true); fixture.detectChanges();
    expect(root.querySelector('[data-testid="analyze-workspace"]')?.classList.contains('max-w-[1120px]')).toBe(true);
    expect(root.querySelector('ptah-analysis-transcript')).toBe(transcript);
    expect(root.querySelector('[data-testid="details-log"]')?.textContent).toContain('Stopped');
    expect(root.textContent).toContain('Waiting for the run to stop.');
    fixture.destroy();
  });

  it('detaches the stream and destroys the transcript with the page', async () => {
    running.set(true);
    const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="analysis-transcript-stub"]')).not.toBeNull();
    fixture.destroy();
    expect(store.detachStream).toHaveBeenCalledTimes(1);
    expect(transcriptDestroyed).toHaveBeenCalledTimes(1);
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

  it('shows 0s, not a negative time, when a run starts after the page was created', async () => {
    jest.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(AnalyzeWorkspacePage);
      jest.advanceTimersByTime(5000);
      await fixture.componentInstance['startFresh']();
      expect(fixture.componentInstance['elapsedSeconds']()).toBe(0);
      fixture.destroy();
    } finally { jest.useRealTimers(); }
  });
});
