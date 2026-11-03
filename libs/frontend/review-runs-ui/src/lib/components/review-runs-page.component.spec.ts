import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { ReviewRunsPageComponent } from './review-runs-page.component';

describe('ReviewRunsPageComponent', () => {
  it('filters the visible list through labelled selects', async () => {
    const call = jest.fn().mockImplementation((method: string) => Promise.resolve({
      isSuccess: () => true,
      data: method === 'review:listRepositories'
        ? [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false }]
        : { runs: [{
            repo: { owner: 'Hive-Academy', name: 'PtahCode' }, prNumber: 428,
            headSha: 'a'.repeat(40), attemptId: 'rvw-428', trigger: 'poll', configHash: 'b'.repeat(40),
            status: 'queued', createdAt: '2026-11-03T10:00:00.000Z', startedAt: null,
            completedAt: null, deadlineAt: '2026-11-03T11:00:00.000Z', coverage: [], stages: [],
          }], nextCursor: null },
    }));
    TestBed.configureTestingModule({ imports: [ReviewRunsPageComponent], providers: [{ provide: ClaudeRpcService, useValue: { call } }] });
    const fixture = TestBed.createComponent(ReviewRunsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[role="listitem"]')).toHaveLength(1);
    const stateFilter = fixture.nativeElement.querySelector('#review-state-filter') as HTMLSelectElement;
    stateFilter.value = 'failed';
    stateFilter.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No matching runs');
    const clear = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((button) => button.textContent?.includes('Clear filters'));
    clear?.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[role="listitem"]')).toHaveLength(1);
  });
});
