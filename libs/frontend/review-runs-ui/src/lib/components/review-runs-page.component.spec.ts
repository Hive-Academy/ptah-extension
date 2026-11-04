import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { ReviewRunsStore } from '../review-runs.store';
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
          }], nextCursor: null, poll: { status: null, error: null, lastSuccessAt: null, lastErrorAt: null } },
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

  it('uses the header Refresh action to retry a failed poll', async () => {
    const call = jest.fn().mockImplementation((method: string) => Promise.resolve({
      isSuccess: () => true,
      data: method === 'review:listRepositories'
        ? [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false }]
        : method === 'review:listRuns'
          ? { runs: [], nextCursor: null, poll: { status: 'failed', error: 'poll failed', lastSuccessAt: null, lastErrorAt: null } }
          : method === 'review:refresh' ? { ok: true } : { settings: null, hasToken: false },
    }));
    TestBed.configureTestingModule({ imports: [ReviewRunsPageComponent], providers: [{ provide: ClaudeRpcService, useValue: { call } }] });
    const fixture = TestBed.createComponent(ReviewRunsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Retry with Refresh');
    call.mockClear();
    (fixture.nativeElement.querySelector('[aria-label="Refresh review runs"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(call.mock.calls.map(([method]) => method)).toEqual(['review:refresh', 'review:listRepositories', 'review:listRuns']);
  });

  it('routes failed-poll Retry to refresh and history-error Retry to load', async () => {
    const call = jest.fn().mockImplementation((method: string) => Promise.resolve({ isSuccess: () => true,
      data: method === 'review:listRepositories' ? [] : method === 'review:listRuns'
        ? { runs: [], nextCursor: null, poll: { status: 'failed', error: 'github-poll-failed', lastSuccessAt: null, lastErrorAt: null } }
        : { settings: null, hasToken: false } }));
    TestBed.configureTestingModule({ imports: [ReviewRunsPageComponent], providers: [{ provide: ClaudeRpcService, useValue: { call } }] });
    const fixture = TestBed.createComponent(ReviewRunsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const store = TestBed.inject(ReviewRunsStore);
    const refresh = jest.spyOn(store, 'refresh').mockResolvedValue();
    const load = jest.spyOn(store, 'load').mockResolvedValue();
    fixture.detectChanges();
    const buttons = () => Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>);
    buttons().find((button) => button.textContent?.includes('Retry with Refresh'))?.click();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
    store.poll.set(null);
    store.state.set('error');
    fixture.detectChanges();
    buttons().find((button) => button.textContent?.trim() === 'Retry')?.click();
    expect(load).toHaveBeenCalledTimes(1);
  });
});

