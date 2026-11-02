import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { LoggingService } from '@ptah-extension/core';
import { WizardRpcService } from '@ptah-extension/setup-wizard';
import { AnalysisStepStore } from '../analyze/analysis-step.store';
import { OnboardingWorkspaceStore } from '../shell/onboarding-workspace.store';
import { AnalysisFoundCardComponent, analysisAge } from './analysis-found-card.component';

const now = Date.parse('2026-11-01T12:00:00.000Z');
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

describe('analysisAge', () => {
  it('uses relative age and the semantic 7/30 day boundaries', () => {
    expect(analysisAge(daysAgo(0), now)).toMatchObject({ label: 'today', bucket: 'success' });
    expect(analysisAge(daysAgo(1), now)).toMatchObject({ label: '1 day ago', bucket: 'success' });
    expect(analysisAge(daysAgo(7), now)?.bucket).toBe('success');
    expect(analysisAge(daysAgo(8), now)?.bucket).toBe('warning');
    expect(analysisAge(daysAgo(12), now)?.label).toBe('12 days ago');
    expect(analysisAge(daysAgo(30), now)?.bucket).toBe('warning');
    expect(analysisAge(daysAgo(31), now)?.bucket).toBe('error');
    expect(analysisAge('invalid', now)).toBeNull();
  });
});

describe('AnalysisFoundCardComponent', () => {
  const activePath = signal<string | null>('/workspace');
  const readyForActivePath = signal(true);
  const getAnalysisStatus = jest.fn();
  const useAnalysis = jest.fn();
  const clearSelection = jest.fn();
  const navigate = jest.fn();
  const warn = jest.fn();
  beforeEach(() => {
    activePath.set('/workspace');
    readyForActivePath.set(true);
    getAnalysisStatus.mockReset();
    useAnalysis.mockReset();
    clearSelection.mockReset();
    navigate.mockReset();
    warn.mockReset();
    TestBed.configureTestingModule({ providers: [
      { provide: WizardRpcService, useValue: { getAnalysisStatus } },
      { provide: AnalysisStepStore, useValue: { useAnalysis, clearSelection } },
      { provide: OnboardingWorkspaceStore, useValue: { activePath, readyForActivePath } },
      { provide: Router, useValue: { navigate } },
      { provide: LoggingService, useValue: { warn } },
    ] });
  });
  it('hides missing status and loads a found slug on Use it', async () => {
    getAnalysisStatus.mockResolvedValueOnce({ state: 'missing' });
    const fixture = TestBed.createComponent(AnalysisFoundCardComponent);
    fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="analysis-found-card"]')).toBeNull();
    getAnalysisStatus.mockResolvedValueOnce({ state: 'fresh', reason: 'ok', analysisDir: '.ptah/analysis/slug', analyzedAt: daysAgo(1), sharing: 'ignored-by-gitignore' });
    activePath.set('/other'); fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Analysis found · fresh');
    expect(element.textContent).toContain('!.ptah/analysis/');
    useAnalysis.mockResolvedValue('loaded');
    (element.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(useAnalysis).toHaveBeenCalledWith('slug');
    expect(navigate).toHaveBeenCalledWith(['/onboarding', 'analyze', 'done']);
  });
  it('waits for the backend switch and ignores a late response from the old folder', async () => {
    let resolveA!: (value: unknown) => void;
    getAnalysisStatus.mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }));
    getAnalysisStatus.mockResolvedValueOnce({ state: 'fresh', reason: 'ok', analysisDir: '.ptah/analysis/B', analyzedAt: daysAgo(1) });
    const fixture = TestBed.createComponent(AnalysisFoundCardComponent);
    fixture.detectChanges();
    expect(getAnalysisStatus).toHaveBeenCalledTimes(1);
    readyForActivePath.set(false);
    activePath.set('/B');
    fixture.detectChanges();
    expect(getAnalysisStatus).toHaveBeenCalledTimes(1);
    resolveA({ state: 'fresh', reason: 'ok', analysisDir: '.ptah/analysis/A', analyzedAt: daysAgo(1) });
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Analysis found');
    readyForActivePath.set(true);
    fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    expect(getAnalysisStatus).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain('Analysis found');
    useAnalysis.mockResolvedValue('loaded');
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(useAnalysis).toHaveBeenCalledWith('B');
  });
  it('shows a retryable status failure and logs it without displaying raw details', async () => {
    getAnalysisStatus.mockRejectedValueOnce(new Error('secret RPC detail'));
    getAnalysisStatus.mockResolvedValueOnce({ state: 'fresh', reason: 'ok', analysisDir: '.ptah/analysis/retry', analyzedAt: daysAgo(12) });
    const fixture = TestBed.createComponent(AnalysisFoundCardComponent);
    fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Could not check for a saved analysis');
    expect(element.textContent).not.toContain('secret RPC detail');
    expect(warn).toHaveBeenCalledWith('AnalysisFoundCard', 'Could not check saved analysis', expect.anything());
    (element.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(element.textContent).toContain('12 days ago');
    expect(element.textContent).toContain('consider re-running');
    expect(element.textContent).not.toContain('Could not check for a saved analysis');
  });
  it('clears a load failure on switch and sends Re-run to a fresh analysis', async () => {
    getAnalysisStatus.mockResolvedValue({ state: 'fresh', reason: 'ok', analysisDir: '.ptah/analysis/saved', analyzedAt: daysAgo(1) });
    useAnalysis.mockResolvedValueOnce('failed');
    const fixture = TestBed.createComponent(AnalysisFoundCardComponent);
    fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    (element.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(element.textContent).toContain('Could not load this analysis');
    readyForActivePath.set(false);
    activePath.set('/other');
    fixture.detectChanges();
    readyForActivePath.set(true);
    fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    expect(element.textContent).not.toContain('Could not load this analysis');
    (element.querySelectorAll('button')[1] as HTMLButtonElement).click();
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/onboarding', 'analyze'], { queryParams: { rerun: '1' } });
  });
});
