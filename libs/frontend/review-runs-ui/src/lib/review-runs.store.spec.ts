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
        : { runs: [run], nextCursor: null, poll: { status: 'failed', error: 'github-poll-failed',
          lastSuccessAt: null, lastErrorAt: '2026-11-03T10:00:00.000Z' } },
    }));
    await store.load();
    expect(store.state()).toBe('ready');
    expect(store.queuedCount()).toBe(1);
    expect(store.poll()?.status).toBe('failed');
    store.setStateFilter('failed');
    expect(store.filteredRuns()).toEqual([]);
    store.clearFilters();
    expect(store.filteredRuns()).toHaveLength(1);
    call.mockRejectedValue(new Error('offline'));
    await store.load();
    expect(store.state()).toBe('offline');
    expect(store.runs()).toEqual([run]);
    expect(store.poll()?.error).toBe('github-poll-failed');
  });

  it('shows initial failure and explicit no-lanes state without a clean result', async () => {
    call.mockRejectedValue(new Error('unavailable'));
    await store.load();
    expect(store.state()).toBe('error');
    store.setNoLanesAvailable();
    expect(store.state()).toBe('no-lanes');
  });

  it('reads settings from the token-presence response without exposing a credential', async () => {
    const settings = {
      repositories: [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false }],
      maintainerLogins: ['maintainer'], pollMinutes: 30, globalPublicationPaused: true,
      laneCapPerPr: 6, confidenceFloor: 0.8, maxNewInline: 10, fallbackFamilies: [],
    };
    call.mockResolvedValue({ isSuccess: () => true, data: { settings, hasToken: true } });
    await store.loadSettings();
    expect(store.settingsState()).toBe('ready');
    expect(store.settings()).toEqual(settings);
  });

  it('saves global publication pause and reflects the persisted state', async () => {
    const settings = {
      repositories: [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false }],
      maintainerLogins: ['maintainer'], pollMinutes: 30, globalPublicationPaused: false,
      laneCapPerPr: 6, confidenceFloor: 0.8, maxNewInline: 10, fallbackFamilies: [],
    };
    call.mockResolvedValueOnce({ isSuccess: () => true, data: { settings, hasToken: true } })
      .mockResolvedValueOnce({ isSuccess: () => true, data: { ok: true } });
    await store.loadSettings();
    await store.setPublicationPause(true);
    expect(call).toHaveBeenLastCalledWith('review:setPublicationPause', { paused: true }, { timeout: 5_000 });
    expect(store.settings()?.globalPublicationPaused).toBe(true);
    expect(store.pauseError()).toBe(false);
  });

  it('keeps the old pause state and exposes a failed save', async () => {
    const settings = {
      repositories: [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false }],
      maintainerLogins: ['maintainer'], pollMinutes: 30, globalPublicationPaused: false,
      laneCapPerPr: 6, confidenceFloor: 0.8, maxNewInline: 10, fallbackFamilies: [],
    };
    call.mockResolvedValueOnce({ isSuccess: () => true, data: { settings, hasToken: true } })
      .mockRejectedValueOnce(new Error('offline'));
    await store.loadSettings();
    await store.setPublicationPause(true);
    expect(store.settings()?.globalPublicationPaused).toBe(false);
    expect(store.pauseError()).toBe(true);
  });
  it('saves first-run settings without sending a token', async () => {
    call.mockResolvedValueOnce({ isSuccess: () => true, data: { settings: null, hasToken: false } });
    await store.loadSettings();
    expect(store.settingsState()).toBe('ready');
    expect(store.hasToken()).toBe(false);
    store.updateDraft({ maintainerLogins: ['maintainer'] });
    store.setRepositoryEnabled(true);
    const saved = store.draftSettings();
    call.mockResolvedValueOnce({ isSuccess: () => true, data: saved });
    await store.saveSettings();
    expect(call).toHaveBeenLastCalledWith('review:updateSettings', { settings: saved }, { timeout: 5_000 });
    expect(store.settings()).toEqual(saved);
    expect(JSON.stringify(call.mock.calls)).not.toContain('token');
  });
});
