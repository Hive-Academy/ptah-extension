import type { DependencyContainer } from 'tsyringe';

import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { CRON_TOKENS } from '@ptah-extension/cron-scheduler';

import { startThothCron } from './start-thoth-cron';
import { emptyThothRuntimeRefs, type ThothRuntimeRefs } from './types';

type Entry = readonly [unknown, unknown];

function makeContainer(entries: Entry[]): DependencyContainer {
  const map = new Map<unknown, unknown>(entries);
  return {
    isRegistered: (token: unknown) => map.has(token),
    resolve: (token: unknown) => {
      if (!map.has(token)) {
        throw new Error(`not registered: ${String(token)}`);
      }
      return map.get(token);
    },
  } as unknown as DependencyContainer;
}

function makeWorkspaceProvider(overrides: Record<string, unknown> = {}) {
  return {
    getConfiguration: jest.fn(
      (_section: string, key: string, defaultValue: unknown) =>
        key in overrides ? overrides[key] : defaultValue,
    ),
  };
}

function refsWithSqlite(): ThothRuntimeRefs {
  const refs = emptyThothRuntimeRefs();
  refs.sqliteConnection = {
    isOpen: true,
    db: { pragma: jest.fn() },
  } as unknown as ThothRuntimeRefs['sqliteConnection'];
  return refs;
}

describe('startThothCron', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing when SQLite is unavailable', async () => {
    const scheduler = { start: jest.fn() };
    const refs = emptyThothRuntimeRefs();
    const container = makeContainer([[CRON_TOKENS.CRON_SCHEDULER, scheduler]]);

    await startThothCron(container, refs);

    expect(scheduler.start).not.toHaveBeenCalled();
    expect(refs.cronScheduler).toBeNull();
  });

  it('starts the scheduler with ptah.cron.* configuration values', async () => {
    const scheduler = { start: jest.fn().mockResolvedValue(undefined) };
    const refs = refsWithSqlite();
    const container = makeContainer([
      [CRON_TOKENS.CRON_SCHEDULER, scheduler],
      [
        PLATFORM_TOKENS.WORKSPACE_PROVIDER,
        makeWorkspaceProvider({
          'cron.enabled': true,
          'cron.maxConcurrentJobs': 7,
          'cron.catchupWindowMs': 1234,
        }),
      ],
    ]);

    await startThothCron(container, refs);

    expect(scheduler.start).toHaveBeenCalledWith({
      enabled: true,
      maxConcurrentJobs: 7,
      catchupWindowMs: 1234,
    });
    expect(refs.cronScheduler).toBe(scheduler);
  });

  it('falls back to the documented defaults when configuration is undefined', async () => {
    const scheduler = { start: jest.fn().mockResolvedValue(undefined) };
    const container = makeContainer([
      [CRON_TOKENS.CRON_SCHEDULER, scheduler],
      [
        PLATFORM_TOKENS.WORKSPACE_PROVIDER,
        { getConfiguration: jest.fn(() => undefined) },
      ],
    ]);

    await startThothCron(container, refsWithSqlite());

    expect(scheduler.start).toHaveBeenCalledWith({
      enabled: true,
      maxConcurrentJobs: 3,
      catchupWindowMs: 86_400_000,
    });
  });

  it('registers the daily backup handler and upserts the @ptah/daily-backup job', async () => {
    const handlers = new Map<string, () => Promise<{ summary: string }>>();
    const handlerRegistry = {
      has: (name: string) => handlers.has(name),
      register: jest.fn(
        (name: string, fn: () => Promise<{ summary: string }>) => {
          handlers.set(name, fn);
        },
      ),
    };
    const jobStore = { upsert: jest.fn() };
    const backupService = {
      backup: jest.fn().mockResolvedValue('/backups/daily.db'),
      rotate: jest.fn(),
    };
    const refs = refsWithSqlite();
    const container = makeContainer([
      [CRON_TOKENS.CRON_SCHEDULER, { start: jest.fn() }],
      [CRON_TOKENS.CRON_JOB_STORE, jobStore],
      [CRON_TOKENS.CRON_HANDLER_REGISTRY, handlerRegistry],
      [PERSISTENCE_TOKENS.BACKUP_SERVICE, backupService],
      [PLATFORM_TOKENS.WORKSPACE_PROVIDER, makeWorkspaceProvider()],
    ]);

    await startThothCron(container, refs);

    expect(handlerRegistry.register).toHaveBeenCalledWith(
      'backup:daily',
      expect.any(Function),
    );
    expect(jobStore.upsert).toHaveBeenCalledWith({
      id: '@ptah/daily-backup',
      name: 'Daily SQLite Backup',
      cronExpr: '0 3 * * *',
      timezone: 'UTC',
      prompt: 'handler:backup:daily',
      enabled: true,
    });

    const handler = handlers.get('backup:daily');
    expect(handler).toBeDefined();
    const result = await (handler as () => Promise<{ summary: string }>)();

    expect(backupService.backup).toHaveBeenCalledWith(
      refs.sqliteConnection?.db,
      'daily',
    );
    expect(backupService.rotate).toHaveBeenCalledWith('daily', 7);
    const pragma = refs.sqliteConnection?.db.pragma as jest.Mock;
    expect(pragma).toHaveBeenCalledWith('incremental_vacuum(100)');
    expect(pragma).toHaveBeenCalledWith('optimize');
    expect(result.summary).toBe('backup written to /backups/daily.db');
  });

  it('backup handler is a no-op when the connection was torn down before the run', async () => {
    const handlers = new Map<string, () => Promise<{ summary: string }>>();
    const refs = refsWithSqlite();
    const container = makeContainer([
      [CRON_TOKENS.CRON_SCHEDULER, { start: jest.fn() }],
      [CRON_TOKENS.CRON_JOB_STORE, { upsert: jest.fn() }],
      [
        CRON_TOKENS.CRON_HANDLER_REGISTRY,
        {
          has: (name: string) => handlers.has(name),
          register: (name: string, fn: () => Promise<{ summary: string }>) => {
            handlers.set(name, fn);
          },
        },
      ],
      [PLATFORM_TOKENS.WORKSPACE_PROVIDER, makeWorkspaceProvider()],
    ]);

    await startThothCron(container, refs);
    refs.sqliteConnection = null;

    const handler = handlers.get('backup:daily') as () => Promise<{
      summary: string;
    }>;
    await expect(handler()).resolves.toEqual({
      summary: 'skipped: no sqlite connection',
    });
  });

  it('does not re-register the backup handler when it already exists', async () => {
    const handlerRegistry = { has: jest.fn(() => true), register: jest.fn() };
    const container = makeContainer([
      [CRON_TOKENS.CRON_SCHEDULER, { start: jest.fn() }],
      [CRON_TOKENS.CRON_JOB_STORE, { upsert: jest.fn() }],
      [CRON_TOKENS.CRON_HANDLER_REGISTRY, handlerRegistry],
      [PLATFORM_TOKENS.WORKSPACE_PROVIDER, makeWorkspaceProvider()],
    ]);

    await startThothCron(container, refsWithSqlite());

    expect(handlerRegistry.register).not.toHaveBeenCalled();
  });

  it('nulls the scheduler ref when start() throws', async () => {
    const refs = refsWithSqlite();
    const container = makeContainer([
      [
        CRON_TOKENS.CRON_SCHEDULER,
        { start: jest.fn().mockRejectedValue(new Error('croner missing')) },
      ],
      [PLATFORM_TOKENS.WORKSPACE_PROVIDER, makeWorkspaceProvider()],
    ]);

    await expect(startThothCron(container, refs)).resolves.toBeUndefined();
    expect(refs.cronScheduler).toBeNull();
  });
});
