import 'reflect-metadata';
import type { RpcHandler, Logger } from '@ptah-extension/vscode-core';
import type {
  IReviewArtifactReader,
  IReviewQueryRepository,
  IReviewSecretPresence,
  IReviewSettingsStore,
  ReviewQueueService,
  ReviewOrchestratorService,
} from '@ptah-extension/review-core';
import type { IGitHubReviewPort } from '@ptah-extension/review-contracts';
import { ReviewPollDisabledError, ReviewRepositoryUnavailableError } from '@ptah-extension/review-core';
import {
  ReviewPolicyService,
  type ReviewStageEnvironment,
} from '@ptah-extension/review-core';
import type { ISecretStorage } from '@ptah-extension/platform-core';
import { ReviewRpcHandlers } from './review-rpc.handlers';

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
} as const;

function suite() {
  const rpc = { registerMethod: jest.fn() } as Pick<
    RpcHandler,
    'registerMethod'
  >;
  const logger = { info: jest.fn() } as Pick<Logger, 'info'>;
  const query = {
    listRuns: jest.fn().mockResolvedValue({ runs: [], nextCursor: null }),
    getRun: jest.fn().mockResolvedValue(null),
    listFindings: jest.fn().mockResolvedValue([]),
  } as IReviewQueryRepository;
  const store = {
    getSettings: jest.fn().mockResolvedValue(settings),
    updateSettings: jest.fn().mockResolvedValue(settings),
    listRepositories: jest.fn().mockResolvedValue(settings.repositories),
    setPublicationPause: jest.fn().mockResolvedValue(undefined),
    getLiveGate: jest.fn().mockResolvedValue(null),
    setLiveGate: jest.fn().mockResolvedValue(undefined),
  } as IReviewSettingsStore;
  const artifacts = { exportRun: jest.fn() } as IReviewArtifactReader;
  const secrets = {
    hasToken: jest.fn().mockResolvedValue(true),
  } as IReviewSecretPresence;
  const queue = { retry: jest.fn() } as Pick<ReviewQueueService, 'retry'>;
  const orchestrator = { pollAndRecord: jest.fn() } as Pick<
    ReviewOrchestratorService,
    'pollAndRecord'
  >;
  const github = { getPull: jest.fn() } as Pick<IGitHubReviewPort, 'getPull'>;
  const tokenStorage = {
    get: jest.fn().mockResolvedValue(undefined),
    store: jest.fn(),
    delete: jest.fn(),
  } as Pick<ISecretStorage, 'get' | 'store' | 'delete'>;
  const fetcher = jest.fn() as typeof fetch;
  const environment = { baseConfig: jest.fn().mockResolvedValue(null) } as Pick<
    ReviewStageEnvironment,
    'baseConfig'
  >;
  new ReviewRpcHandlers(
    logger,
    rpc,
    query,
    store,
    artifacts,
    secrets,
    queue,
    orchestrator,
    github,
    tokenStorage as ISecretStorage,
    fetcher,
    new ReviewPolicyService(),
    environment as ReviewStageEnvironment,
  ).register();
  const calls = (rpc.registerMethod as jest.Mock).mock.calls as Array<
    [string, (params: unknown) => Promise<unknown>]
  >;
  const invoke = (name: string, params: unknown): Promise<unknown> => {
    const handler = calls.find(([method]) => method === name)?.[1];
    if (!handler) throw new Error(`Missing ${name}`);
    return handler(params);
  };
  return {
    invoke,
    calls,
    logger,
    query,
    store,
    artifacts,
    secrets,
    queue,
    github,
    orchestrator,
    tokenStorage,
    fetcher,
  };
}

describe('ReviewRpcHandlers', () => {
  it('verifies a bot on a fresh install without adding a repository', async () => {
    const { invoke, store, tokenStorage, fetcher } = suite();
    (store.getSettings as jest.Mock).mockResolvedValue(null);
    (tokenStorage.get as jest.Mock).mockResolvedValue('secret');
    (fetcher as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ login: 'ptah-bot' }),
      headers: { get: () => null },
    });
    expect(await invoke('review:getBotIdentity', {})).toMatchObject({
      login: 'ptah-bot',
    });
    expect(store.setLiveGate).not.toHaveBeenCalled();
  });

  it('verifies a saved OAuth bot with an empty maintainer allowlist', async () => {
    const { invoke, store, tokenStorage, fetcher } = suite();
    (store.getSettings as jest.Mock).mockResolvedValue({ ...settings, maintainerLogins: [] });
    (tokenStorage.get as jest.Mock).mockResolvedValue('gho_test_token');
    (fetcher as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ login: 'Ptah-Bot' }),
      headers: { get: () => 'repo' },
    });
    await expect(invoke('review:getBotIdentity', {})).resolves.toMatchObject({
      login: 'Ptah-Bot', scopes: ['repo'],
    });
    expect(store.setLiveGate).toHaveBeenCalledWith(expect.objectContaining({
      login: 'Ptah-Bot',
    }));
  });

  it.each([401, 403])('reports GitHub %i without exposing the bot token', async (status) => {
    const { invoke, tokenStorage, fetcher } = suite();
    (tokenStorage.get as jest.Mock).mockResolvedValue('gho_test_token');
    (fetcher as jest.Mock).mockResolvedValue({ ok: false, status });
    await expect(invoke('review:getBotIdentity', {})).rejects.toThrow('GitHub rejected the bot token');
  });

  it('reports a verification timeout safely', async () => {
    const { invoke, tokenStorage, fetcher } = suite();
    (tokenStorage.get as jest.Mock).mockResolvedValue('gho_test_token');
    (fetcher as jest.Mock).mockRejectedValue(Object.assign(new Error('secret'), { name: 'AbortError' }));
    await expect(invoke('review:getBotIdentity', {})).rejects.toThrow('GitHub bot verification timed out');
  });

  it('persists first live settings before recording attestation', async () => {
    const { invoke, store, tokenStorage, fetcher } = suite();
    const gate = {
      repo: { owner: 'Hive-Academy', name: 'PtahCode' },
      login: 'ptah-bot',
      connectedAt: '2026-11-04T00:00:00.000Z',
      verifiedAt: '2026-11-04T00:00:00.000Z',
      attestation: null,
    };
    (store.getSettings as jest.Mock).mockResolvedValue(null);
    (store.getLiveGate as jest.Mock).mockResolvedValue(gate);
    (tokenStorage.get as jest.Mock).mockResolvedValue('secret');
    (fetcher as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ login: 'ptah-bot' }),
    });
    const live = {
      ...settings,
      globalPublicationPaused: false,
      repositories: [{ ...settings.repositories[0], dryRun: false }],
    };
    await invoke('review:updateSettings', {
      settings: live,
      attestation: {
        who: 'maintainer',
        permissions: [
          'Pull requests: Read and write',
          'Contents: Read',
          'Metadata: Read',
        ],
      },
    });
    expect(
      (store.updateSettings as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(
      (store.setLiveGate as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(store.setLiveGate).toHaveBeenCalledWith(
      expect.objectContaining({
        attestation: expect.objectContaining({ who: 'maintainer' }),
      }),
    );
  });
  it('creates a gate on first live enable and rebinds it for a new repository', async () => {
    const { invoke, store, tokenStorage, fetcher } = suite();
    (store.getSettings as jest.Mock).mockResolvedValue(null);
    (tokenStorage.get as jest.Mock).mockResolvedValue('token');
    (fetcher as jest.Mock).mockResolvedValue({ ok: true, text: async () => JSON.stringify({ login: 'review-bot' }) });
    const attestation = { who: 'maintainer', permissions: ['Pull requests: Read and write', 'Contents: Read', 'Metadata: Read'] };
    const first = { ...settings, repositories: [{ ...settings.repositories[0], dryRun: false }], globalPublicationPaused: false };
    await invoke('review:updateSettings', { settings: first, attestation });
    expect(store.setLiveGate).toHaveBeenCalledWith(expect.objectContaining({
      repo: { owner: 'Hive-Academy', name: 'PtahCode' },
      attestation: expect.objectContaining({ who: 'maintainer' }),
    }));
    const oldGate = (store.setLiveGate as jest.Mock).mock.calls[0][0];
    (store.getLiveGate as jest.Mock).mockResolvedValue(oldGate);
    const second = { ...first, repositories: [
      { ...first.repositories[0], dryRun: true },
      { owner: 'Other', name: 'Review', enabled: true, dryRun: false, publicationPaused: false },
    ] };
    await expect(invoke('review:updateSettings', { settings: second })).rejects.toThrow(
      'Permission attestation required for this repository',
    );
    await invoke('review:updateSettings', { settings: second, attestation });
    expect(store.setLiveGate).toHaveBeenLastCalledWith(expect.objectContaining({
      repo: { owner: 'Other', name: 'Review' },
    }));
  });
  it('reports a missing local checkout for the requested repository', async () => {
    const { invoke, orchestrator } = suite();
    (orchestrator.pollAndRecord as jest.Mock).mockRejectedValue(new ReviewRepositoryUnavailableError());
    await expect(invoke('review:refresh', { repo: { owner: 'Hive-Academy', name: 'PtahCode' } }))
      .resolves.toEqual({ ok: true });
  });

  it('clears a failed poll after successful Refresh', async () => {
    const { invoke, orchestrator } = suite();
    (orchestrator.pollAndRecord as jest.Mock)
      .mockRejectedValueOnce(new Error('secret remote error'))
      .mockResolvedValueOnce(0);
    const params = { repo: { owner: 'Hive-Academy', name: 'PtahCode' } };
    await expect(invoke('review:refresh', params)).resolves.toEqual({ ok: true });
    await Promise.resolve();
    expect(await invoke('review:refresh', params)).toEqual({ ok: true });
    expect(orchestrator.pollAndRecord).toHaveBeenCalledWith(params.repo);
  });

  it('rejects manual Refresh while disabled without changing poll state', async () => {
    const { invoke, orchestrator } = suite();
    (orchestrator.pollAndRecord as jest.Mock).mockRejectedValue(
      new ReviewPollDisabledError(),
    );
    await expect(
      invoke('review:refresh', {
        repo: { owner: 'Hive-Academy', name: 'PtahCode' },
      }),
    ).resolves.toEqual({ ok: true });
    expect(orchestrator.pollAndRecord).toHaveBeenCalledTimes(1);
  });
  it('returns the queued manual attempt id', async () => {
    const { invoke, github, queue } = suite();
    (github.getPull as jest.Mock).mockResolvedValue({
      headSha: 'a'.repeat(40),
    });
    const result = await invoke('review:retryHead', {
      repo: { owner: 'Hive-Academy', name: 'PtahCode' },
      prNumber: 1,
    });
    expect(result).toEqual({ ok: true, attemptId: expect.any(String) });
    expect(queue.retry).toHaveBeenCalledWith(
      expect.objectContaining({ headSha: 'a'.repeat(40) }),
      (result as { attemptId: string }).attemptId,
    );
  });
  it('registers exactly the review methods', () => {
    const { calls } = suite();
    expect(calls.map(([name]) => name)).toEqual([...ReviewRpcHandlers.METHODS]);
  });
  it('refuses live settings without a verified identity and attestation', async () => {
    const { invoke, store, tokenStorage, fetcher } = suite();
    const liveSettings = {
      settings: {
        ...settings,
        globalPublicationPaused: false,
        repositories: [{ ...settings.repositories[0], dryRun: false }],
      },
    };
    await expect(invoke('review:updateSettings', liveSettings)).rejects.toThrow(
      'Connect a bot token before enabling live publication',
    );
    (tokenStorage.get as jest.Mock).mockResolvedValue('token');
    (fetcher as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ login: 'review-bot' }),
    });
    await expect(invoke('review:updateSettings', liveSettings)).rejects.toThrow(
      'attestation required',
    );
    expect(store.updateSettings).not.toHaveBeenCalled();
  });

  it('clears the live gate when the token changes', async () => {
    const { invoke, store } = suite();
    await invoke('review:setBotToken', { token: 'new-secret' });
    expect(store.setLiveGate).toHaveBeenCalledWith(null);
    await invoke('review:clearBotToken', {});
    expect(store.setLiveGate).toHaveBeenCalledTimes(2);
  });

  it.each(ReviewRpcHandlers.METHODS)(
    '%s rejects invalid params at the boundary',
    async (method) => {
      const { invoke } = suite();
      await expect(invoke(method, { unexpected: 'secret' })).rejects.toThrow(
        'Invalid review request',
      );
    },
  );

  it('stores and removes a bot token without echoing it', async () => {
    const { invoke, tokenStorage, logger } = suite();
    expect(await invoke('review:setBotToken', { token: 'ghp_secret' })).toEqual(
      { ok: true },
    );
    expect(tokenStorage.store).toHaveBeenCalledWith(
      'ptah.review.githubToken',
      'ghp_secret',
    );
    expect(await invoke('review:clearBotToken', {})).toEqual({ ok: true });
    expect(tokenStorage.delete).toHaveBeenCalledWith('ptah.review.githubToken');
    expect(JSON.stringify((logger.info as jest.Mock).mock.calls)).not.toContain(
      'ghp_secret',
    );
  });

  it('blocks live rerun while publication is paused and does not queue', async () => {
    const { invoke, query, github, queue } = suite();
    (query.getRun as jest.Mock).mockResolvedValue({
      attemptId: 'prior',
      repo: { owner: 'Hive-Academy', name: 'PtahCode' },
      prNumber: 1,
      headSha: 'a'.repeat(40),
    });
    (github.getPull as jest.Mock).mockResolvedValue({
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      state: 'open',
      draft: false,
      authorLogin: 'maintainer',
      headIsFork: false,
      headRepoId: 1,
      baseRepoId: 1,
    });
    await expect(
      invoke('review:rerun', { attemptId: 'prior', dryRun: false }),
    ).rejects.toThrow('unavailable');
    expect(queue.retry).not.toHaveBeenCalled();
  });

  it('never returns or logs a token and rejects one in settings updates', async () => {
    const { invoke, logger, store } = suite();
    const result = await invoke('review:getSettings', {});
    expect(result).toEqual({
      settings,
      hasToken: true,
      tokenStorage: 'encrypted',
    });
    expect(JSON.stringify(result)).not.toContain('ghp_secret');
    await expect(
      invoke('review:updateSettings', { settings, token: 'ghp_secret' }),
    ).rejects.toThrow('Invalid review request');
    expect(store.updateSettings).not.toHaveBeenCalled();
    expect(JSON.stringify((logger.info as jest.Mock).mock.calls)).not.toContain(
      'ghp_secret',
    );
  });

  it('returns unconfigured settings so the first save can proceed', async () => {
    const { invoke, store } = suite();
    (store.getSettings as jest.Mock).mockResolvedValue(null);
    expect(await invoke('review:getSettings', {})).toEqual({
      settings: null,
      hasToken: true,
      tokenStorage: 'encrypted',
    });
  });

  it('treats an unknown attempt safely', async () => {
    const { invoke, artifacts } = suite();
    expect(await invoke('review:getRun', { attemptId: 'missing' })).toBeNull();
    expect(
      await invoke('review:listFindings', { attemptId: 'missing' }),
    ).toEqual({ findings: [] });
    await expect(
      invoke('review:exportRun', { attemptId: 'missing' }),
    ).rejects.toThrow('Review run not found');
    expect(artifacts.exportRun).not.toHaveBeenCalled();
  });
});

describe('review repository settings RPC', () => {
  it('rejects live publication without a bot token', async () => {
    const { invoke, secrets, store } = suite();
    (secrets.hasToken as jest.Mock).mockResolvedValue(false);
    const live = {
      ...settings,
      repositories: [{ ...settings.repositories[0], dryRun: false }],
    };
    await expect(
      invoke('review:updateSettings', { settings: live }),
    ).rejects.toThrow('Connect a bot token');
    expect(store.updateSettings).not.toHaveBeenCalled();
  });
});
