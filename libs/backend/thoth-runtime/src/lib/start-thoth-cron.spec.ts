import type { DependencyContainer } from 'tsyringe';

import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { CRON_TOKENS } from '@ptah-extension/cron-scheduler';
import type { JobHandler } from '@ptah-extension/cron-scheduler';
import {
  MEMORY_RETENTION_LIMITS,
  MEMORY_TOKENS,
  MemoryRetentionService,
  RetentionRunBudget,
} from '@ptah-extension/memory-curator';
import { TOKENS } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES, isActivityEventPayload } from '@ptah-extension/shared';

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

    expect(backupService.backup).toHaveBeenCalledWith('daily');
    expect(backupService.rotate).toHaveBeenCalledWith('daily', 7);
    const pragma = refs.sqliteConnection?.db.pragma as jest.Mock;
    // TASK_2026_440: free pages are reclaimed by the retention job in bounded
    // steps; the backup handler no longer runs an unbounded vacuum.
    expect(pragma).not.toHaveBeenCalledWith(
      expect.stringContaining('incremental_vacuum'),
    );
    expect(pragma).toHaveBeenCalledWith('optimize');
    expect(pragma).toHaveBeenCalledTimes(1);
    expect(result.summary).toBe('backup written to /backups/daily.db');
  });

  // R-1 (TASK_2026_383). The connection check used to sit ABOVE the backup, so
  // a host whose connection was gone took no daily backup at all. The worker
  // opens the database file itself, so the backup no longer needs the handle
  // and the check now gates only the two write pragmas.
  it('still takes the backup when the connection was torn down before the run, and skips only the pragmas', async () => {
    const handlers = new Map<string, () => Promise<{ summary: string }>>();
    const backupService = {
      backup: jest.fn().mockResolvedValue('/backups/daily.db'),
      rotate: jest.fn(),
    };
    const refs = refsWithSqlite();
    const pragma = refs.sqliteConnection?.db.pragma as jest.Mock;
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
      [PERSISTENCE_TOKENS.BACKUP_SERVICE, backupService],
      [PLATFORM_TOKENS.WORKSPACE_PROVIDER, makeWorkspaceProvider()],
    ]);

    await startThothCron(container, refs);
    refs.sqliteConnection = null;

    const handler = handlers.get('backup:daily') as () => Promise<{
      summary: string;
    }>;
    await expect(handler()).resolves.toEqual({
      summary:
        'backup written to /backups/daily.db; pragmas skipped: no sqlite connection',
    });
    expect(backupService.backup).toHaveBeenCalledWith('daily');
    expect(backupService.rotate).toHaveBeenCalledWith('daily', 7);
    expect(pragma).not.toHaveBeenCalled();
  });

  it('reports the backup as not taken when the worker produced nothing and there is no connection', async () => {
    const handlers = new Map<string, () => Promise<{ summary: string }>>();
    const backupService = {
      backup: jest.fn().mockResolvedValue(null),
      rotate: jest.fn(),
    };
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
      [PERSISTENCE_TOKENS.BACKUP_SERVICE, backupService],
      [PLATFORM_TOKENS.WORKSPACE_PROVIDER, makeWorkspaceProvider()],
    ]);

    await startThothCron(container, refs);
    refs.sqliteConnection = null;

    const handler = handlers.get('backup:daily') as () => Promise<{
      summary: string;
    }>;
    await expect(handler()).resolves.toEqual({
      summary: 'backup not taken; pragmas skipped: no sqlite connection',
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

  describe('database integrity check job', () => {
    type CapturedTimer = {
      readonly fire: () => void;
      readonly delayMs: number;
      readonly unref: jest.Mock;
    };

    function captureTimers(): CapturedTimer[] {
      const captured: CapturedTimer[] = [];
      jest.spyOn(global, 'setTimeout').mockImplementation(((
        fn: () => void,
        ms: number,
      ) => {
        const unref = jest.fn();
        captured.push({ fire: fn, delayMs: ms, unref });
        return { unref } as unknown as NodeJS.Timeout;
      }) as unknown as typeof setTimeout);
      return captured;
    }

    function makeIntegrityContainer(opts: { withService?: boolean } = {}) {
      const handlers = new Map<string, JobHandler>();
      const handlerRegistry = {
        has: (name: string) => handlers.has(name),
        register: jest.fn((name: string, fn: JobHandler) => {
          handlers.set(name, fn);
        }),
      };
      const jobStore = { upsert: jest.fn() };
      const integrity = {
        isDue: jest.fn(() => true),
        dispatchIfDue: jest.fn().mockResolvedValue(undefined),
      };
      const entries: Entry[] = [
        [CRON_TOKENS.CRON_SCHEDULER, { start: jest.fn() }],
        [CRON_TOKENS.CRON_JOB_STORE, jobStore],
        [CRON_TOKENS.CRON_HANDLER_REGISTRY, handlerRegistry],
        [PLATFORM_TOKENS.WORKSPACE_PROVIDER, makeWorkspaceProvider()],
      ];
      if (opts.withService !== false) {
        entries.push([PERSISTENCE_TOKENS.SQLITE_INTEGRITY_SERVICE, integrity]);
      }
      return {
        container: makeContainer(entries),
        handlers,
        handlerRegistry,
        jobStore,
        integrity,
      };
    }

    it('upserts @ptah/db-integrity-check at 03:30 UTC', async () => {
      captureTimers();
      const { container, jobStore } = makeIntegrityContainer();

      await startThothCron(container, refsWithSqlite());

      expect(jobStore.upsert).toHaveBeenCalledWith({
        id: '@ptah/db-integrity-check',
        name: 'Database Integrity Check',
        // A whole-file read must not share a tick with the daily backup write.
        cronExpr: '30 3 * * *',
        timezone: 'UTC',
        prompt: 'handler:db:integrity',
        enabled: true,
      });
    });

    it('registers the handler once across two startThothCron calls', async () => {
      captureTimers();
      const { container, handlerRegistry, jobStore } = makeIntegrityContainer();
      const refs = refsWithSqlite();

      await startThothCron(container, refs);
      await startThothCron(container, refs);

      // `HandlerRegistry.register` throws on a duplicate name, so the `has()`
      // guard is what makes a re-activation safe.
      expect(
        handlerRegistry.register.mock.calls.filter(
          (call) => call[0] === 'db:integrity',
        ),
      ).toHaveLength(1);
      // `upsert` is idempotent by definition and is deliberately NOT guarded.
      expect(
        jobStore.upsert.mock.calls.filter(
          (call) =>
            (call[0] as { id: string }).id === '@ptah/db-integrity-check',
        ),
      ).toHaveLength(2);
    });

    it("arms exactly one unref'd boot dispatch at 60 s, across two calls", async () => {
      const timers = captureTimers();
      const { container, integrity } = makeIntegrityContainer();
      const refs = refsWithSqlite();

      await startThothCron(container, refs);
      await startThothCron(container, refs);

      expect(timers).toHaveLength(1);
      expect(timers[0].delayMs).toBe(60_000);
      // An integrity check must never be the reason a host refuses to quit.
      expect(timers[0].unref).toHaveBeenCalledTimes(1);
      // Nothing dispatches until the timer fires.
      expect(integrity.dispatchIfDue).not.toHaveBeenCalled();

      timers[0].fire();

      expect(integrity.dispatchIfDue).toHaveBeenCalledTimes(1);
    });

    it('swallows a boot-dispatch resolve failure instead of throwing on the timer', async () => {
      const timers = captureTimers();
      const { container } = makeIntegrityContainer();
      // A container that answers `isRegistered` but throws on `resolve` is the
      // shape a torn-down host takes; the timer fires on its own stack, where a
      // throw has nowhere to go.
      const resolve = container.resolve as unknown as (
        token: unknown,
      ) => unknown;
      jest.spyOn(container, 'resolve').mockImplementation(((token: unknown) => {
        if (token === PERSISTENCE_TOKENS.SQLITE_INTEGRITY_SERVICE) {
          throw new Error('container disposed');
        }
        return resolve(token);
      }) as never);

      await startThothCron(container, refsWithSqlite());

      expect(() => timers[0].fire()).not.toThrow();
    });

    it('dispatches without awaiting when the cron handler runs', async () => {
      captureTimers();
      const { container, handlers, integrity } = makeIntegrityContainer();
      // A dispatch that never settles: the handler must still return. The check
      // costs 20-26 s cold, so holding a cron job slot open for it would
      // reintroduce exactly the blocking this task removed.
      integrity.dispatchIfDue.mockReturnValue(
        new Promise<void>(() => undefined),
      );
      await startThothCron(container, refsWithSqlite());

      const handler = handlers.get('db:integrity') as JobHandler;

      await expect(
        handler({
          job: { id: '@ptah/db-integrity-check' } as never,
          scheduledFor: 0,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({
        summary: 'integrity check dispatched (runs out of process)',
      });
      expect(integrity.dispatchIfDue).toHaveBeenCalledTimes(1);
    });

    it('reports a not-due tick as a skipped OUTCOME and dispatches nothing', async () => {
      captureTimers();
      const { container, handlers, integrity } = makeIntegrityContainer();
      integrity.isDue.mockReturnValue(false);
      await startThothCron(container, refsWithSqlite());

      const handler = handlers.get('db:integrity') as JobHandler;

      await expect(
        handler({
          job: { id: '@ptah/db-integrity-check' } as never,
          scheduledFor: 0,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ outcome: 'skipped', reason: 'not-due' });
      expect(integrity.dispatchIfDue).not.toHaveBeenCalled();
    });

    it('threads the boot signal into the boot dispatch', async () => {
      // The signal reaches the CHILD PROCESS through this argument: a quit
      // while the check is running kills the worker instead of leaving it
      // reading the database behind a dying parent.
      const timers = captureTimers();
      const { container, integrity } = makeIntegrityContainer();
      const controller = new AbortController();

      await startThothCron(container, refsWithSqlite(), {
        signal: controller.signal,
      });
      timers[0].fire();

      expect(integrity.dispatchIfDue).toHaveBeenCalledWith({
        signal: controller.signal,
      });
    });

    it('arms no boot timer at all when the signal is ALREADY aborted', async () => {
      const timers = captureTimers();
      const { container, handlerRegistry, integrity } =
        makeIntegrityContainer();
      const controller = new AbortController();
      controller.abort();

      await startThothCron(container, refsWithSqlite(), {
        signal: controller.signal,
      });

      expect(timers).toHaveLength(0);
      expect(integrity.dispatchIfDue).not.toHaveBeenCalled();
      // The handler is still registered — the job is a nightly schedule and
      // outlives this boot; only the boot-window dispatch is abandoned.
      expect(
        handlerRegistry.register.mock.calls.filter(
          (call) => call[0] === 'db:integrity',
        ),
      ).toHaveLength(1);
    });

    it('reports a resolve failure in the HANDLER as a skipped outcome', async () => {
      // Same shape as the boot timer's guard: `isRegistered` was true at
      // registration and the resolve happens hours later, so a torn-down
      // container must produce a skipped run, not a thrown one.
      captureTimers();
      const { container, handlers, integrity } = makeIntegrityContainer();
      await startThothCron(container, refsWithSqlite());

      const passthrough = container.resolve as unknown as (
        token: unknown,
      ) => unknown;
      jest.spyOn(container, 'resolve').mockImplementation(((token: unknown) => {
        if (token === PERSISTENCE_TOKENS.SQLITE_INTEGRITY_SERVICE) {
          throw new Error('container disposed');
        }
        return passthrough(token);
      }) as never);

      const handler = handlers.get('db:integrity') as JobHandler;

      await expect(
        handler({
          job: { id: '@ptah/db-integrity-check' } as never,
          scheduledFor: 0,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({
        outcome: 'skipped',
        reason: 'integrity-service-unavailable',
      });
      expect(integrity.dispatchIfDue).not.toHaveBeenCalled();
    });

    it('registers nothing and throws nothing without SqliteIntegrityService', async () => {
      const timers = captureTimers();
      const { container, handlerRegistry, jobStore } = makeIntegrityContainer({
        withService: false,
      });

      await expect(
        startThothCron(container, refsWithSqlite()),
      ).resolves.toBeUndefined();

      expect(
        handlerRegistry.register.mock.calls.filter(
          (call) => call[0] === 'db:integrity',
        ),
      ).toHaveLength(0);
      expect(
        jobStore.upsert.mock.calls.map(
          (call) => (call[0] as { id: string }).id,
        ),
      ).toEqual(['@ptah/daily-backup']);
      // No service means no boot timer either — nothing to unref, nothing to
      // keep an exiting host alive.
      expect(timers).toHaveLength(0);
    });
  });

  /**
   * TASK_2026_440 component 11 item 1 — reachability, not only registration.
   *
   * The token comes from `@ptah-extension/memory-curator` and is never
   * re-declared here, so a rename breaks this spec.
   */
  describe('memory retention job', () => {
    const RETENTION_UPSERT = {
      id: '@ptah/memory-retention',
      name: 'Memory Retention',
      cronExpr: '17 * * * *',
      timezone: 'UTC',
      prompt: 'handler:memory:retention',
      enabled: true,
    };

    function makeRealRetentionService() {
      const runStep = jest.fn().mockResolvedValue({
        archived: 4,
        deleted: 2,
        evicted: 1,
        exhausted: true,
        stop: null,
        note: null,
        preview: null,
        readErrors: [],
      });
      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as ConstructorParameters<typeof MemoryRetentionService>[0];
      const sqlite = {
        db: {},
      } as ConstructorParameters<typeof MemoryRetentionService>[2];
      const reclaimer = {
        readPageStats: jest.fn(() => ({
          pageSize: 4096,
          pageCount: 1,
          freelistCount: 0,
          autoVacuumMode: 0,
        })),
      } as unknown as ConstructorParameters<typeof MemoryRetentionService>[3];
      const store = {
        purgeProcessedBatch: jest.fn(() => ({
          deleted: 0,
          nextCursor: '',
          exhausted: true,
        })),
        pruneLedger: jest.fn(() => ({ pruned: 0 })),
        readLiveStorage: jest.fn(() => ({
          pendingRows: 0,
          pendingBytes: 0,
          oldestPendingAt: null,
          stuckEligibleRows: 0,
          quarantineLedgerRows: 0,
          bootScanFailuresPending: 0,
          bootScanFailuresGivenUp: 0,
          readErrors: [],
        })),
        countTotalRows: jest.fn(() => 0),
        readState: jest.fn(() => null),
        writeRun: jest.fn(),
        writeSkip: jest.fn(),
      } as unknown as ConstructorParameters<typeof MemoryRetentionService>[4];
      const service = new MemoryRetentionService(
        logger,
        makeWorkspaceProvider() as unknown as ConstructorParameters<
          typeof MemoryRetentionService
        >[1],
        sqlite,
        reclaimer,
        store,
        { ...MEMORY_RETENTION_LIMITS, bootDeferralMs: 0 },
        { runStep } as unknown as ConstructorParameters<
          typeof MemoryRetentionService
        >[6],
        null,
      );
      return { service, runStep };
    }

    function makeRetentionContainer(
      opts: { withService?: boolean; service?: unknown } = {},
    ) {
      const handlers = new Map<string, JobHandler>();
      const handlerRegistry = {
        has: (name: string) => handlers.has(name),
        register: jest.fn((name: string, fn: JobHandler) => {
          if (handlers.has(name)) {
            throw new Error(`duplicate handler '${name}'`);
          }
          handlers.set(name, fn);
        }),
      };
      const jobStore = { upsert: jest.fn() };
      const retention = {
        run: jest.fn().mockResolvedValue({
          status: 'completed',
          reason: null,
          processedPurged: 3,
          stuckKept: 1,
          ledgerPruned: 0,
          freedBytes: 0,
          pagesReclaimed: 2,
          memoriesArchived: 0,
          memoriesDeleted: 0,
          memoriesEvicted: 0,
          lifecycleNote: null,
          backlogRemaining: false,
          durationMs: 1,
          error: null,
        }),
      };
      const entries: Entry[] = [
        [CRON_TOKENS.CRON_SCHEDULER, { start: jest.fn() }],
        [CRON_TOKENS.CRON_JOB_STORE, jobStore],
        [CRON_TOKENS.CRON_HANDLER_REGISTRY, handlerRegistry],
        [CRON_TOKENS.CRON_POWER_MONITOR, { isOnBattery: jest.fn(() => false) }],
        [PLATFORM_TOKENS.WORKSPACE_PROVIDER, makeWorkspaceProvider()],
      ];
      if (opts.withService !== false) {
        entries.push([
          MEMORY_TOKENS.MEMORY_RETENTION_SERVICE,
          opts.service ?? retention,
        ]);
      }
      return {
        container: makeContainer(entries),
        handlers,
        handlerRegistry,
        jobStore,
        retention,
      };
    }

    function retentionUpserts(jobStore: { upsert: jest.Mock }): unknown[] {
      return jobStore.upsert.mock.calls
        .map((call) => call[0] as { id: string })
        .filter((job) => job.id === '@ptah/memory-retention');
    }

    it('upserts the exact @ptah/memory-retention job and registers memory:retention', async () => {
      const { container, handlerRegistry, jobStore } = makeRetentionContainer();

      await startThothCron(container, refsWithSqlite());

      expect(jobStore.upsert).toHaveBeenCalledWith(RETENTION_UPSERT);
      expect(handlerRegistry.register).toHaveBeenCalledWith(
        'memory:retention',
        expect.any(Function),
      );
    });

    it('the registered handler reaches service.run with the cron signal', async () => {
      const { container, handlers, retention } = makeRetentionContainer();
      await startThothCron(container, refsWithSqlite());
      const controller = new AbortController();

      const handler = handlers.get('memory:retention') as JobHandler;
      const result = await handler({
        job: { id: '@ptah/memory-retention' } as never,
        scheduledFor: 0,
        signal: controller.signal,
      });

      expect(retention.run).toHaveBeenCalledTimes(1);
      expect(retention.run.mock.calls[0][0]).toMatchObject({
        signal: controller.signal,
      });
      expect(result).toEqual({
        summary:
          'purged 3 processed, kept 1 stuck unprocessed, archived 0 / deleted 0 / evicted 0 memories, reclaimed 2 pages',
      });
    });

    it('the registered handler runs the memory lifecycle step through a real MemoryRetentionService', async () => {
      const { service, runStep } = makeRealRetentionService();
      const { container, handlers } = makeRetentionContainer({ service });
      await startThothCron(container, refsWithSqlite());

      const handler = handlers.get('memory:retention') as JobHandler;
      const result = await handler({
        job: { id: '@ptah/memory-retention' } as never,
        scheduledFor: 0,
        signal: new AbortController().signal,
      });

      expect(runStep).toHaveBeenCalledTimes(1);
      expect(runStep).toHaveBeenCalledWith(
        expect.any(RetentionRunBudget),
        expect.any(Number),
      );
      expect(result).toMatchObject({
        summary: expect.stringContaining(
          'archived 4 / deleted 2 / evicted 1 memories',
        ),
      });
    });

    it('registers once and upserts twice across two startThothCron calls', async () => {
      const { container, handlerRegistry, jobStore } = makeRetentionContainer();
      const refs = refsWithSqlite();

      await startThothCron(container, refs);
      await startThothCron(container, refs);

      expect(
        handlerRegistry.register.mock.calls.filter(
          (call) => call[0] === 'memory:retention',
        ),
      ).toHaveLength(1);
      expect(retentionUpserts(jobStore)).toEqual([
        RETENTION_UPSERT,
        RETENTION_UPSERT,
      ]);
    });

    it('registers no retention job without the service and leaves other jobs alone', async () => {
      const { container, handlerRegistry, jobStore } = makeRetentionContainer({
        withService: false,
      });

      await startThothCron(container, refsWithSqlite());

      expect(retentionUpserts(jobStore)).toHaveLength(0);
      expect(
        handlerRegistry.register.mock.calls.filter(
          (call) => call[0] === 'memory:retention',
        ),
      ).toHaveLength(0);
      expect(
        jobStore.upsert.mock.calls.map(
          (call) => (call[0] as { id: string }).id,
        ),
      ).toEqual(['@ptah/daily-backup']);
      expect(handlerRegistry.register).toHaveBeenCalledWith(
        'backup:daily',
        expect.any(Function),
      );
    });
  });

  describe('back-office activity events (TASK_2026_380)', () => {
    /** Register the built-in jobs and hand back the handlers + broadcast spy. */
    async function bootWithWebview(
      webviewManager: unknown,
    ): Promise<Map<string, JobHandler>> {
      const handlers = new Map<string, JobHandler>();
      const entries: Entry[] = [
        [CRON_TOKENS.CRON_SCHEDULER, { start: jest.fn() }],
        [CRON_TOKENS.CRON_JOB_STORE, { upsert: jest.fn() }],
        [
          CRON_TOKENS.CRON_HANDLER_REGISTRY,
          {
            has: (name: string) => handlers.has(name),
            register: (name: string, fn: JobHandler) => {
              handlers.set(name, fn);
            },
          },
        ],
        [
          PERSISTENCE_TOKENS.BACKUP_SERVICE,
          {
            backup: jest.fn().mockResolvedValue('/backups/daily.db'),
            rotate: jest.fn(),
          },
        ],
        [PLATFORM_TOKENS.WORKSPACE_PROVIDER, makeWorkspaceProvider()],
      ];
      if (webviewManager !== undefined) {
        entries.push([TOKENS.WEBVIEW_MANAGER, webviewManager]);
      }

      await startThothCron(makeContainer(entries), refsWithSqlite());
      return handlers;
    }

    it('a wrapped handler returns its original value AND emits exactly one event', async () => {
      const broadcastMessage = jest.fn().mockResolvedValue(undefined);
      const handlers = await bootWithWebview({ broadcastMessage });

      const result = await (handlers.get('backup:daily') as JobHandler)(
        {} as never,
      );

      expect(result).toEqual({
        summary: 'backup written to /backups/daily.db',
      });
      const activity = broadcastMessage.mock.calls.filter(
        (call) => call[0] === MESSAGE_TYPES.ACTIVITY_EVENT,
      );
      expect(activity).toHaveLength(1);
      expect(isActivityEventPayload(activity[0][1])).toBe(true);
      expect(activity[0][1]).toMatchObject({
        source: 'cron',
        kind: 'backup:daily',
        summary: 'backup written to /backups/daily.db',
      });
    });

    it('runs the handler, emits zero and throws nothing without a WEBVIEW_MANAGER', async () => {
      // Every CLI and test host. A missing webview must cost the ticker a line,
      // never the cron run.
      const handlers = await bootWithWebview(undefined);

      await expect(
        (handlers.get('backup:daily') as JobHandler)({} as never),
      ).resolves.toEqual({ summary: 'backup written to /backups/daily.db' });
    });
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
