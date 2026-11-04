import { signal } from '@angular/core';
import { ReviewRunsStore } from '../review-runs.store';
import { TestBed } from '@angular/core/testing';
import type { ReviewRun } from '@ptah-extension/review-contracts';
import { ReviewRunDetailComponent } from './review-run-detail.component';

const run: ReviewRun = {
  repo: { owner: 'Hive-Academy', name: 'PtahCode' }, prNumber: 428, headSha: 'a'.repeat(40),
  attemptId: 'attempt-1', trigger: 'poll', configHash: 'b'.repeat(40), status: 'partial',
  createdAt: '2026-11-03T10:00:00.000Z', startedAt: null, completedAt: null, deadlineAt: '2026-11-03T11:00:00.000Z',
  coverage: ['High-risk paths sampled'], stages: [
    { name: 'lenses', status: 'partial', family: 'Codex', scope: null, durationMs: 1000, error: null, artifactPath: null },
    { name: 'verification', status: 'succeeded', family: 'Codex', scope: null, durationMs: 300, error: null, artifactPath: null },
  ],
};

describe('ReviewRunDetailComponent', () => {
  it('labels partial coverage and same-family verification, and closes on Escape', () => {
    TestBed.configureTestingModule({ imports: [ReviewRunDetailComponent], providers: [{ provide: ReviewRunsStore, useValue: { rerunState: signal('idle'), hasToken: signal(false), settings: signal(null), rerun: jest.fn() } }] });
    const fixture = TestBed.createComponent(ReviewRunDetailComponent);
    fixture.componentRef.setInput('run', run);
    const close = jest.fn(); fixture.componentInstance.closed.subscribe(close);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Coverage limited');
    expect(fixture.nativeElement.textContent).toContain('Weaker evidence');
    fixture.nativeElement.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('asks before starting a live rerun', () => {
    TestBed.configureTestingModule({ imports: [ReviewRunDetailComponent], providers: [{ provide: ReviewRunsStore, useValue: {
      rerunState: signal('idle'), hasToken: signal(true), settings: signal({ globalPublicationPaused: false }), rerun: jest.fn(),
    } }] });
    const fixture = TestBed.createComponent(ReviewRunDetailComponent);
    fixture.componentRef.setInput('run', run);
    fixture.detectChanges();
    const store = TestBed.inject(ReviewRunsStore);
    const live = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.includes('Rerun live'));
    live?.click(); fixture.detectChanges();
    expect(store.rerun).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Start live rerun?');
    const acknowledgement = fixture.nativeElement.querySelector('#review-live-rerun-confirm')?.parentElement?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    acknowledgement.click(); fixture.detectChanges();
    fixture.nativeElement.querySelector('#review-live-rerun-confirm')?.parentElement?.querySelectorAll('button')[1]?.click();
    expect(store.rerun).toHaveBeenCalledWith(run.attemptId, false);
  });
});
