import 'reflect-metadata';
import { container } from 'tsyringe';
import { CRON_TOKENS } from '@ptah-extension/cron-scheduler';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { REVIEW_CORE_TOKENS } from '@ptah-extension/review-core';
import { startReviewWorker } from './review-worker.activation';

describe('review worker activation', () => {
  afterEach(() => jest.useRealTimers());

  it('registers a named cron handler and stops its timer on abort', async () => {
    jest.useFakeTimers();
    const scope = container.createChildContainer();
    const handlers = new Map<string, (context: { signal: AbortSignal }) => Promise<unknown>>();
    const upsert = jest.fn();
    const drain = jest.fn(async () => 0);
    const startupPoll = jest.fn(async () => 0);
    const resolve = jest.fn(async () => ({ repoRoot: '/repo', attemptsRoot: '/attempts' }));
    const controller = new AbortController();
    scope.register(REVIEW_CORE_TOKENS.ORCHESTRATOR, {
      useValue: { drain, startupPoll, discoveryHandler: async () => ({ summary: 'Enqueued 0 review heads' }) },
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
    scope.register(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {
      useValue: { db: { prepare: () => ({ get: () => null, run: jest.fn() }) } },
    });
    const handle = await startReviewWorker(scope, controller.signal, { error: jest.fn() });
    expect(handle).not.toBeNull();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'handler:review:discover' }));
    expect(handlers.has('review:discover')).toBe(true);
    expect(drain).toHaveBeenCalledTimes(1);
    controller.abort();
    jest.advanceTimersByTime(60_000);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(handlers.has('review:discover')).toBe(false);
    await expect(handle?.awaitStopped()).resolves.toBeUndefined();
    handle?.dispose();
  });
});
