import 'reflect-metadata';
import { container } from 'tsyringe';
import { CRON_TOKENS } from '@ptah-extension/cron-scheduler';
import { REVIEW_CORE_TOKENS } from '@ptah-extension/review-core';
import { startReviewWorker } from './review-worker.activation';

describe('review worker activation', () => {
  afterEach(() => jest.useRealTimers());

  it('registers a named cron handler and stops its timer on abort', async () => {
    jest.useFakeTimers();
    const scope = container.createChildContainer();
    const handlers = new Map<string, (context: { signal: AbortSignal }) => Promise<unknown>>();
    const upsert = jest.fn();
    let finishDrain!: (count: number) => void;
    const drain = jest.fn((_owner: string, _deadline: number, _signal: AbortSignal) =>
      new Promise<number>((resolve) => { finishDrain = resolve; }));
    const startupPoll = jest.fn(async () => 0);
    const resolve = jest.fn(async () => ({ repoRoot: '/repo', attemptsRoot: '/attempts' }));
    const controller = new AbortController();
    scope.register(REVIEW_CORE_TOKENS.ORCHESTRATOR, {
      useValue: { drain, startupPoll, lastPollAt: async () => null, pollAndRecord: async () => 0 },
    });
    scope.register(REVIEW_CORE_TOKENS.ENVIRONMENT, { useValue: { resolve } });
    scope.register(REVIEW_CORE_TOKENS.SETTINGS_STORE, { useValue: { getSettings: async () => null } });
    scope.register(CRON_TOKENS.CRON_JOB_STORE, { useValue: { upsert } });
    scope.register(CRON_TOKENS.CRON_HANDLER_REGISTRY, {
      useValue: {
        has: (name: string) => handlers.has(name),
        register: (name: string, fn: (context: { signal: AbortSignal }) => Promise<unknown>) => { handlers.set(name, fn); },
        unregister: (name: string) => { handlers.delete(name); },
      },
    });
    const handle = await startReviewWorker(scope, controller.signal, { error: jest.fn() });
    expect(handle).not.toBeNull();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'handler:review:discover' }));
    expect(handlers.has('review:discover')).toBe(true);
    expect(drain).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(drain.mock.calls[0][2].aborted).toBe(true);
    jest.advanceTimersByTime(60_000);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(handlers.has('review:discover')).toBe(false);
    let stopped = false;
    const waiting = handle?.awaitStopped().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finishDrain(0);
    await waiting;
    expect(stopped).toBe(true);
    handle?.dispose();
  });

  it('polls every enabled repository even when one fails', async () => {
    const repos = [
      { owner: 'One', name: 'Alpha', enabled: true },
      { owner: 'Two', name: 'Beta', enabled: true },
    ];
    const handlers = new Map<string, (context: { signal: AbortSignal }) => Promise<unknown>>();
    const pollAndRecord = jest.fn(async (repo: { owner: string }) => {
      if (repo.owner === 'One') throw new Error('poll failed');
      return 2;
    });
    const scope = container.createChildContainer();
    scope.register(REVIEW_CORE_TOKENS.ORCHESTRATOR, { useValue: {
      drain: async () => 0, startupPoll: async () => 0, lastPollAt: async () => null, pollAndRecord,
    } });
    scope.register(REVIEW_CORE_TOKENS.SETTINGS_STORE, { useValue: { getSettings: async () => ({ repositories: repos, pollMinutes: 10 }) } });
    scope.register(CRON_TOKENS.CRON_JOB_STORE, { useValue: { upsert: jest.fn() } });
    scope.register(CRON_TOKENS.CRON_HANDLER_REGISTRY, { useValue: {
      has: () => false, register: (name: string, fn: (context: { signal: AbortSignal }) => Promise<unknown>) => { handlers.set(name, fn); },
      unregister: jest.fn(),
    } });
    const logger = { error: jest.fn() };
    const handle = await startReviewWorker(scope, new AbortController().signal, logger);
    const handler = handlers.get('review:discover');
    expect(handler).toBeDefined();
    await handler?.({ signal: new AbortController().signal });
    // The worker passes strict identities, never the full settings entry.
    expect(pollAndRecord).toHaveBeenCalledWith({ owner: 'One', name: 'Alpha' });
    expect(pollAndRecord).toHaveBeenCalledWith({ owner: 'Two', name: 'Beta' });
    expect(logger.error).toHaveBeenCalled();
    handle?.dispose();
  });
  it('routes startup polling through the orchestrator and logs failure', async () => {
    const repo = { owner: 'Hive-Academy', name: 'PtahCode', enabled: true };
    const logger = { error: jest.fn() };
    const startupPoll = jest.fn(async () => { throw new Error('remote failure'); });
      const scope = container.createChildContainer();
      scope.register(REVIEW_CORE_TOKENS.ORCHESTRATOR, { useValue: {
        drain: async () => 0, startupPoll, lastPollAt: async () => null, pollAndRecord: async () => 0,
      } });
      scope.register(REVIEW_CORE_TOKENS.SETTINGS_STORE, { useValue: { getSettings: async () => ({ repositories: [repo] }) } });
      scope.register(CRON_TOKENS.CRON_JOB_STORE, { useValue: { upsert: jest.fn() } });
      scope.register(CRON_TOKENS.CRON_HANDLER_REGISTRY, { useValue: {
        has: () => false, register: jest.fn(), unregister: jest.fn(),
      } });
      const handle = await startReviewWorker(scope, new AbortController().signal, logger);
      handle?.dispose();
      await handle?.awaitStopped();
      expect(startupPoll).toHaveBeenCalledWith(null, { owner: repo.owner, name: repo.name });
      expect(logger.error).toHaveBeenCalledWith('Review startup poll failed', expect.any(Error));
  });
});
