import { TestBed } from '@angular/core/testing';
import { ReviewRunSchema } from '@ptah-extension/review-contracts';
import { ReviewRunsStore } from '../review-runs.store';
import { ReviewRunDetailComponent } from './review-run-detail.component';
import { ReviewRunsListComponent } from './review-runs-list.component';

const run = ReviewRunSchema.parse({
  repo: { owner: 'Hive-Academy', name: 'PtahCode' }, prNumber: 1, headSha: 'a'.repeat(40), attemptId: 'attempt-1',
  trigger: 'manual', configHash: null, status: 'failed', createdAt: '2026-11-05T00:00:00.000Z',
  startedAt: null, completedAt: null, deadlineAt: null, coverage: [], stages: [],
  failure: { stage: 'context', code: 'checkout-missing', message: 'Checkout unavailable' },
});

describe('review failure display', () => {
  it('shows the safe failure on the runs list', async () => {
    await TestBed.configureTestingModule({ imports: [ReviewRunsListComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ReviewRunsListComponent);
    fixture.componentRef.setInput('runs', [run]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('context: Checkout unavailable');
  });

  it('shows the stage, message, and code in run details', async () => {
    await TestBed.configureTestingModule({ imports: [ReviewRunDetailComponent], providers: [{ provide: ReviewRunsStore, useValue: { rerunState: () => 'idle', hasToken: () => false, settings: () => null } }] }).compileComponents();
    const fixture = TestBed.createComponent(ReviewRunDetailComponent);
    fixture.componentRef.setInput('run', run);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Failed in context: Checkout unavailable (checkout-missing)');
  });
});
