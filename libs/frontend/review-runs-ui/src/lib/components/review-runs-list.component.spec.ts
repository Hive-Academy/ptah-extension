import { TestBed } from '@angular/core/testing';
import type { ReviewRun } from '@ptah-extension/review-contracts';
import { ReviewRunsListComponent } from './review-runs-list.component';

function makeRun(attemptId: string, status: ReviewRun['status']): ReviewRun {
  return {
    repo: { owner: 'Hive-Academy', name: 'PtahCode' }, prNumber: 428,
    headSha: 'a'.repeat(40), attemptId, trigger: 'poll', configHash: 'b'.repeat(40),
    status, createdAt: '2026-11-03T10:00:00.000Z', startedAt: null,
    completedAt: null, deadlineAt: '2026-11-03T11:00:00.000Z', coverage: [], stages: [],
  };
}

describe('ReviewRunsListComponent', () => {
  it('labels contract statuses and moves keyboard focus between rows', () => {
    TestBed.configureTestingModule({ imports: [ReviewRunsListComponent] });
    const fixture = TestBed.createComponent(ReviewRunsListComponent);
    fixture.componentRef.setInput('runs', [makeRun('a', 'queued'), makeRun('b', 'partial'), makeRun('c', 'succeeded')]);
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('[role="listitem"] button') as NodeListOf<HTMLButtonElement>;
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toContain('Partial / coverage limited');
    expect(rows[2].textContent).toContain('Completed');
    rows[0].focus();
    rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(rows[1]);
    rows[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(rows[0]);
  });
});
