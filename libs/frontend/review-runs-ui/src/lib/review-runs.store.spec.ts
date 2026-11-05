import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import type { ReviewRun } from '@ptah-extension/review-contracts';
import { ReviewRunsStore } from './review-runs.store';

const run: ReviewRun = {
  repo: { owner: 'Hive-Academy', name: 'PtahCode' },
  prNumber: 428,
  headSha: 'a'.repeat(40),
  attemptId: 'rvw-428-01',
  trigger: 'poll',
  configHash: 'b'.repeat(40),
  status: 'queued',
  createdAt: '2026-11-03T10:00:00.000Z',
  startedAt: null,
  completedAt: null,
  deadlineAt: '2026-11-03T11:00:00.000Z',
  coverage: [],
  stages: [],
};

describe('ReviewRunsStore', () => {
  const call = jest.fn();
  let store: ReviewRunsStore;

  beforeEach(() => {
    call.mockReset();
    TestBed.configureTestingModule({
      providers: [
        ReviewRunsStore,
        { provide: ClaudeRpcService, useValue: { call } },
      ],
    });
    store = TestBed.inject(ReviewRunsStore);
  });

  it('loads parsed data, filters states, and retains cache when refresh fails', async () => {
    call.mockImplementation((method: string) =>
      Promise.resolve({
        isSuccess: () => true,
        data:
          method === 'review:listRepositories'
            ? [
                {
                  owner: 'Hive-Academy',
                  name: 'PtahCode',
                  enabled: true,
                  dryRun: true,
                  publicationPaused: false,
                },
              ]
            : {
                runs: [run],
                nextCursor: null,
                poll: {
                  status: 'failed',
                  error: 'github-poll-failed',
                  lastSuccessAt: null,
                  lastErrorAt: '2026-11-03T10:00:00.000Z',
                },
              },
      }),
    );
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

  it('polls before reloading review runs and exposes a failed poll', async () => {
    const repositories = [
      {
        owner: 'Hive-Academy',
        name: 'PtahCode',
        enabled: true,
        dryRun: true,
        publicationPaused: false,
      },
    ];
    const list = {
      runs: [run],
      nextCursor: null,
      poll: {
        status: 'succeeded',
        error: null,
        lastSuccessAt: null,
        lastErrorAt: null,
      },
    };
    let refreshed = false;
    call.mockImplementation((method: string) =>
      Promise.resolve({
        isSuccess: () => true,
        data:
          method === 'review:listRepositories'
            ? repositories
            : method === 'review:listRuns'
              ? { ...list, poll: { ...list.poll, lastSuccessAt: refreshed ? '2026-11-03T10:00:00.000Z' : null } }
              : (refreshed = true, { ok: true }),
      }),
    );
    await store.load();
    call.mockClear();
    await store.refresh();
    expect(call.mock.calls.map(([method]) => method)).toEqual([
      'review:refresh',
      'review:listRepositories',
      'review:listRuns',
    ]);
    expect(call).toHaveBeenCalledWith(
      'review:refresh',
      { repo: { owner: 'Hive-Academy', name: 'PtahCode' } },
      { timeout: 120_000 },
    );
    expect(store.state()).toBe('ready');

    call.mockClear();
    call.mockImplementationOnce(() =>
      Promise.resolve({ isSuccess: () => false, data: null }),
    );
    await store.refresh();
    expect(call.mock.calls.map(([method]) => method)).toEqual([
      'review:refresh',
      'review:listRepositories',
      'review:listRuns',
    ]);
    expect(store.state()).toBe('ready');
    expect(store.refreshError()).toBe(true);
    expect(store.runs()).toEqual([run]);
    expect(store.isRefreshing()).toBe(false);
  });

  it('reloads again when a non-blocking refresh poll completes', async () => {
    jest.useFakeTimers();
    let listCalls = 0;
    call.mockImplementation((method: string) => Promise.resolve({
      isSuccess: () => true,
      data: method === 'review:listRepositories'
        ? [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false }]
        : method === 'review:refresh' ? { ok: true } : {
          runs: ++listCalls >= 3 ? [run] : [], nextCursor: null,
          poll: { status: 'succeeded', error: null,
            lastSuccessAt: listCalls >= 3 ? '2026-11-03T10:00:00.000Z' : null, lastErrorAt: null },
        },
    }));
    try {
      await store.load();
      const refresh = store.refresh();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(1_000);
      await refresh;
      expect(store.runs()).toEqual([run]);
      expect(listCalls).toBe(3);
    } finally { jest.useRealTimers(); }
  });

  it('reloads after a timed-out Refresh and keeps the failed poll visible', async () => {
    const poll = {
      status: 'failed',
      error: 'github-poll-failed',
      lastSuccessAt: null,
      lastErrorAt: null,
    };
    call.mockImplementation((method: string) =>
      Promise.resolve({
        isSuccess: () => true,
        data:
          method === 'review:listRepositories'
            ? [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false }]
            : { runs: [], nextCursor: null, poll },
      }),
    );
    await store.load();
    call.mockClear();
    call.mockRejectedValueOnce(new Error('timeout'));
    await store.refresh();
    expect(call.mock.calls.map(([method]) => method)).toEqual([
      'review:refresh',
      'review:listRepositories',
      'review:listRuns',
    ]);
    expect(store.poll()?.status).toBe('failed');
    expect(store.refreshError()).toBe(true);
    expect(store.state()).toBe('ready');
  });

  it('shows a safe error when bot verification fails', async () => {
    call.mockResolvedValue({ isSuccess: () => false, errorCode: 'REVIEW_DISABLED', error: 'secret token' });
    await store.loadBotIdentity();
    expect(store.botIdentity()).toBeNull();
    expect(store.botIdentityError()).toContain('Could not verify the bot token:');
    expect(store.botIdentityError()).not.toContain('secret token');
  });

  it('shows a repository-specific checkout error after Refresh', async () => {
    const repository = { owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false };
    call.mockImplementation((method: string) => Promise.resolve({
      isSuccess: () => true,
      data: method === 'review:listRepositories' ? [repository]
        : method === 'review:listRuns' ? { runs: [], nextCursor: null, poll: {
          status: 'failed', error: 'No local checkout of Hive-Academy/PtahCode is open in Ptah. Add its folder as a workspace.',
          lastSuccessAt: null, lastErrorAt: new Date().toISOString(),
        } } : { ok: true },
    }));
    await store.load();
    await store.refresh();
    expect(store.refreshErrorMessage()).toContain('No local checkout of Hive-Academy/PtahCode');
    expect(store.refreshError()).toBe(true);
  });

  it('reads settings from the token-presence response without exposing a credential', async () => {
    const settings = {
      repositories: [
        {
          owner: 'Hive-Academy',
          name: 'PtahCode',
          enabled: true,
          dryRun: true,
          publicationPaused: false,
        },
      ],
      maintainerLogins: ['maintainer'],
      pollMinutes: 30,
      globalPublicationPaused: true,
      laneCapPerPr: 6,
      confidenceFloor: 0.8,
      maxNewInline: 10,
      fallbackFamilies: [],
    };
    call.mockResolvedValue({
      isSuccess: () => true,
      data: { settings, hasToken: true, tokenStorage: 'encrypted' },
    });
    await store.loadSettings();
    expect(store.settingsState()).toBe('ready');
    expect(store.settings()).toEqual(settings);
  });

  it('saves global publication pause and reflects the persisted state', async () => {
    const settings = {
      repositories: [
        {
          owner: 'Hive-Academy',
          name: 'PtahCode',
          enabled: true,
          dryRun: true,
          publicationPaused: false,
        },
      ],
      maintainerLogins: ['maintainer'],
      pollMinutes: 30,
      globalPublicationPaused: false,
      laneCapPerPr: 6,
      confidenceFloor: 0.8,
      maxNewInline: 10,
      fallbackFamilies: [],
    };
    call
      .mockResolvedValueOnce({
        isSuccess: () => true,
        data: { settings, hasToken: true, tokenStorage: 'encrypted' },
      })
      .mockResolvedValueOnce({ isSuccess: () => true, data: null })
      .mockResolvedValueOnce({ isSuccess: () => true, data: { ok: true } });
    await store.loadSettings();
    await store.setPublicationPause(true);
    expect(call).toHaveBeenLastCalledWith(
      'review:setPublicationPause',
      { paused: true },
      { timeout: 5_000 },
    );
    expect(store.settings()?.globalPublicationPaused).toBe(true);
    expect(store.pauseError()).toBe(false);
  });

  it('keeps the old pause state and exposes a failed save', async () => {
    const settings = {
      repositories: [
        {
          owner: 'Hive-Academy',
          name: 'PtahCode',
          enabled: true,
          dryRun: true,
          publicationPaused: false,
        },
      ],
      maintainerLogins: ['maintainer'],
      pollMinutes: 30,
      globalPublicationPaused: false,
      laneCapPerPr: 6,
      confidenceFloor: 0.8,
      maxNewInline: 10,
      fallbackFamilies: [],
    };
    const logger = TestBed.inject(LoggingService);
    const logged = jest
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    call
      .mockResolvedValueOnce({
        isSuccess: () => true,
        data: { settings, hasToken: true, tokenStorage: 'encrypted' },
      })
      .mockResolvedValueOnce({ isSuccess: () => true, data: null })
      .mockRejectedValueOnce(new Error('offline'));
    await store.loadSettings();
    await store.setPublicationPause(true);
    expect(store.settings()?.globalPublicationPaused).toBe(false);
    expect(store.pauseError()).toBe(true);
    expect(logged).toHaveBeenCalledWith(
      'ReviewRunsStore',
      'Publication pause update failed',
      expect.any(Error),
    );
  });
  it('sends only repository identity for a publication pause', async () => {
    const repo = { owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false };
    const settings = { repositories: [repo], maintainerLogins: ['maintainer'], pollMinutes: 30,
      globalPublicationPaused: false, laneCapPerPr: 6, confidenceFloor: 0.8,
      maxNewInline: 10, fallbackFamilies: [] };
    call.mockResolvedValueOnce({ isSuccess: () => true,
      data: { settings, hasToken: true, tokenStorage: 'encrypted' } })
      .mockResolvedValueOnce({ isSuccess: () => true, data: null })
      .mockResolvedValueOnce({ isSuccess: () => true, data: { ok: true } });
    await store.loadSettings();
    await store.setPublicationPause(true, true, repo);
    expect(call).toHaveBeenLastCalledWith('review:setPublicationPause',
      { paused: true, repo: { owner: repo.owner, name: repo.name } }, { timeout: 5_000 });
    expect(store.settings()?.repositories[0].publicationPaused).toBe(true);
  });
  it('does not turn publication pause off without explicit confirmation', async () => {
    const settings = {
      repositories: [
        {
          owner: 'Hive-Academy',
          name: 'PtahCode',
          enabled: true,
          dryRun: true,
          publicationPaused: false,
        },
      ],
      maintainerLogins: ['maintainer'],
      pollMinutes: 30,
      globalPublicationPaused: true,
      laneCapPerPr: 6,
      confidenceFloor: 0.8,
      maxNewInline: 10,
      fallbackFamilies: [],
    };
    call
      .mockResolvedValueOnce({
        isSuccess: () => true,
        data: { settings, hasToken: true, tokenStorage: 'encrypted' },
      })
      .mockResolvedValueOnce({ isSuccess: () => true, data: null })
      .mockResolvedValueOnce({ isSuccess: () => true, data: { ok: true } });
    await store.loadSettings();
    call.mockClear();
    await store.setPublicationPause(false);
    expect(call).not.toHaveBeenCalled();
    expect(store.settings()?.globalPublicationPaused).toBe(true);
    await store.setPublicationPause(false, true);
    expect(call).toHaveBeenCalledWith(
      'review:setPublicationPause',
      { paused: false },
      { timeout: 5_000 },
    );
    expect(store.settings()?.globalPublicationPaused).toBe(false);
  });
  it('saves first-run settings without sending a token', async () => {
    call.mockResolvedValueOnce({
      isSuccess: () => true,
      data: { settings: null, hasToken: false, tokenStorage: 'encrypted' },
    });
    await store.loadSettings();
    expect(store.settingsState()).toBe('ready');
    expect(store.hasToken()).toBe(false);
    store.updateDraft({ maintainerLogins: ['maintainer'] });
    expect(store.draftSettings().repositories).toEqual([]);
    const saved = store.draftSettings();
    call.mockResolvedValueOnce({ isSuccess: () => true, data: saved });
    await store.saveSettings();
    expect(call).toHaveBeenLastCalledWith(
      'review:updateSettings',
      { settings: saved },
      { timeout: 5_000 },
    );
    expect(store.settings()).toEqual(saved);
    expect(JSON.stringify(call.mock.calls)).not.toContain('token');
  });
  it('sends a token only to the write RPC and keeps it out of read state', async () => {
    call
      .mockResolvedValueOnce({ isSuccess: () => true, data: { ok: true } })
      .mockResolvedValueOnce({
        isSuccess: () => true,
        data: {
          login: 'ptah-bot',
          scopes: ['pull_requests:read', 'issues:write'],
          connectedAt: '2026-11-04T00:00:00Z',
          verifiedAt: null,
          tokenStorage: 'encrypted',
        },
      });
    expect(await store.setBotToken('secret-token')).toBe(true);
    expect(call.mock.calls[0][0]).toBe('review:setBotToken');
    expect(call.mock.calls[0][1]).toEqual({ token: 'secret-token' });
    expect(store.botIdentity()?.login).toBe('ptah-bot');
    expect(
      JSON.stringify({
        identity: store.botIdentity(),
        settings: store.settings(),
      }),
    ).not.toContain('secret-token');
  });
  it('requests a rerun with an explicit dry-run choice', async () => {
    call
      .mockResolvedValueOnce({
        isSuccess: () => true,
        data: { attemptId: 'next-attempt' },
      })
      .mockRejectedValueOnce(new Error('offline'));
    await store.rerun('old-attempt', false);
    expect(call.mock.calls[0][0]).toBe('review:rerun');
    expect(call.mock.calls[0][1]).toEqual({
      attemptId: 'old-attempt',
      dryRun: false,
    });
  });
});

describe('review settings defaults', () => {
  it('does not invent a repository and blocks live saves without a bot', async () => {
    const call = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        ReviewRunsStore,
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: LoggingService, useValue: { error: jest.fn() } },
      ],
    });
    const store = TestBed.inject(ReviewRunsStore);
    expect(store.draftSettings().repositories).toEqual([]);
    store.updateDraft({
      repositories: [
        {
          owner: 'Acme',
          name: 'Widget',
          enabled: false,
          dryRun: false,
          publicationPaused: false,
        },
      ],
    });
    await store.saveSettings();
    expect(call).not.toHaveBeenCalled();
    expect(store.settingsSaveError()).toContain('bot token');
  });
});
