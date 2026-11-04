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
    TestBed.configureTestingModule({ imports: [ReviewRunDetailComponent] });
    const fixture = TestBed.createComponent(ReviewRunDetailComponent);
    fixture.componentRef.setInput('run', run);
    const close = jest.fn(); fixture.componentInstance.closed.subscribe(close);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Coverage limited');
    expect(fixture.nativeElement.textContent).toContain('Weaker evidence');
    fixture.nativeElement.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
