import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { ReviewRun } from '@ptah-extension/review-contracts';
import { ReviewRunsStore } from './review-runs.store';

const run: ReviewRun = {
  repo: { owner: 'Hive-Academy', name: 'PtahCode' }, prNumber: 428,
  headSha: 'a'.repeat(40), attemptId: 'rvw-428-01', trigger: 'poll',
  configHash: 'b'.repeat(40), status: 'queued',
  createdAt: '2026-11-03T10:00:00.000Z', startedAt: null, completedAt: null,
  deadlineAt: '2026-11-03T11:00:00.000Z', coverage: [], stages: [],
};

describe('ReviewRunsStore', () => {
  const call = jest.fn();
  let store: ReviewRunsStore;

  beforeEach(() => {
    call.mockReset();
    TestBed.configureTestingModule({ providers: [ReviewRunsStore, { provide: ClaudeRpcService, useValue: { call } }] });
    store = TestBed.inject(ReviewRunsStore);
  });

  it('loads parsed data, filters states, and retains cache when refresh fails', async () => {
    call.mockImplementation((method: string) => Promise.resolve({
      isSuccess: () => true,
      data: method === 'review:listRepositories'
        ? [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false }]
        : { runs: [run], nextCursor: null },
    }));
    await store.load();
    expect(store.state()).toBe('ready');
    expect(store.queuedCount()).toBe(1);
    store.setStateFilter('failed');
    expect(store.filteredRuns()).toEqual([]);
    store.clearFilters();
    expect(store.filteredRuns()).toHaveLength(1);
    call.mockRejectedValue(new Error('offline'));
    await store.load();
    expect(store.state()).toBe('offline');
    expect(store.runs()).toEqual([run]);
  });

  it('shows initial failure and explicit no-lanes state without a clean result', async () => {
    call.mockRejectedValue(new Error('unavailable'));
    await store.load();
    expect(store.state()).toBe('error');
    store.setNoLanesAvailable();
    expect(store.state()).toBe('no-lanes');
  });
});
