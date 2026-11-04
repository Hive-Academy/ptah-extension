import 'reflect-metadata';
import type { RpcHandler, Logger } from '@ptah-extension/vscode-core';
import type {
  IReviewArtifactReader, IReviewQueryRepository, IReviewSecretPresence,
  IReviewSettingsStore, ReviewQueueService, ReviewOrchestratorService,
} from '@ptah-extension/review-core';
import type { IGitHubReviewPort } from '@ptah-extension/review-contracts';
import { ReviewRpcHandlers } from './review-rpc.handlers';

const settings = {
  repositories: [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false }],
  maintainerLogins: ['maintainer'], pollMinutes: 30, globalPublicationPaused: true,
  laneCapPerPr: 6, confidenceFloor: 0.8, maxNewInline: 10, fallbackFamilies: [],
} as const;

function suite() {
  const rpc = { registerMethod: jest.fn() } as Pick<RpcHandler, 'registerMethod'>;
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
  } as IReviewSettingsStore;
  const artifacts = { exportRun: jest.fn() } as IReviewArtifactReader;
  const secrets = { hasToken: jest.fn().mockResolvedValue(true) } as IReviewSecretPresence;
  const queue = { retry: jest.fn() } as Pick<ReviewQueueService, 'retry'>;
  const orchestrator = { discoveryHandler: jest.fn() } as Pick<ReviewOrchestratorService, 'discoveryHandler'>;
  const github = { getPull: jest.fn() } as Pick<IGitHubReviewPort, 'getPull'>;
  new ReviewRpcHandlers(logger, rpc, query, store, artifacts, secrets, queue, orchestrator, github).register();
  const calls = (rpc.registerMethod as jest.Mock).mock.calls as Array<[string, (params: unknown) => Promise<unknown>]>;
  const invoke = (name: string, params: unknown): Promise<unknown> => {
    const handler = calls.find(([method]) => method === name)?.[1];
    if (!handler) throw new Error(`Missing ${name}`);
    return handler(params);
  };
  return { invoke, calls, logger, query, store, artifacts, secrets };
}

describe('ReviewRpcHandlers', () => {
  it('registers exactly the P1 review methods', () => {
    const { calls } = suite();
    expect(calls.map(([name]) => name)).toEqual([...ReviewRpcHandlers.METHODS]);
  });

  it.each(ReviewRpcHandlers.METHODS)('%s rejects invalid params at the boundary', async (method) => {
    const { invoke } = suite();
    await expect(invoke(method, { unexpected: 'secret' })).rejects.toThrow('Invalid review request');
  });

  it('never returns or logs a token and rejects one in settings updates', async () => {
    const { invoke, logger, store } = suite();
    const result = await invoke('review:getSettings', {});
    expect(result).toEqual({ settings, hasToken: true });
    expect(JSON.stringify(result)).not.toContain('ghp_secret');
    await expect(invoke('review:updateSettings', { settings, token: 'ghp_secret' })).rejects.toThrow('Invalid review request');
    expect(store.updateSettings).not.toHaveBeenCalled();
    expect(JSON.stringify((logger.info as jest.Mock).mock.calls)).not.toContain('ghp_secret');
  });

  it('treats an unknown attempt safely', async () => {
    const { invoke, artifacts } = suite();
    expect(await invoke('review:getRun', { attemptId: 'missing' })).toBeNull();
    expect(await invoke('review:listFindings', { attemptId: 'missing' })).toEqual({ findings: [] });
    await expect(invoke('review:exportRun', { attemptId: 'missing' })).rejects.toThrow('Review run not found');
    expect(artifacts.exportRun).not.toHaveBeenCalled();
  });
});
