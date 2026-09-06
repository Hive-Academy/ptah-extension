import type { DependencyContainer } from 'tsyringe';

import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { CRON_TOKENS } from '@ptah-extension/cron-scheduler';
import type { JobHandler } from '@ptah-extension/cron-scheduler';
import { SKILL_SYNTHESIS_TOKENS } from '@ptah-extension/skill-synthesis';
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

  describe('skill synthesis drain jobs (B0.6.2)', () => {
    function makeDrainContainer(
      opts: {
        settings?: Record<string, unknown>;
        onBattery?: boolean;
        withDrain?: boolean;
      } = {},
    ) {
      const handlers = new Map<string, JobHandler>();
      const handlerRegistry = {
        has: (name: string) => handlers.has(name),
        register: jest.fn((name: string, fn: JobHandler) => {
          if (handlers.has(name)) {
            // Mirrors the real HandlerRegistry, which THROWS on a duplicate —
            // the whole reason the production code guards with has().
            throw new Error(`duplicate handler '${name}'`);
          }
          handlers.set(name, fn);
        }),
        unregister: jest.fn(),
        resolve: (name: string) => handlers.get(name),
      };
      const jobStore = { upsert: jest.fn() };
      const drain = {
        drain: jest.fn().mockResolvedValue({
          tier: 'frequent',
          skipped: false,
          reaped: 0,
          workspacesVisited: 1,
          claimed: 2,
          lostClaims: 0,
          done: 2,
          failed: 0,
          unscored: 0,
          skippedItems: 0,
          budgetDeferred: 0,
          budgetExhausted: false,
          durationMs: 5,
        }),
      };
      const powerMonitor = {
        isOnBattery: jest.fn(() => opts.onBattery ?? false),
        onResume: jest.fn(() => ({ dispose: () => undefined })),
        onSuspend: jest.fn(() => ({ dispose: () => undefined })),
      };
      const entries: Entry[] = [
        [CRON_TOKENS.CRON_SCHEDULER, { start: jest.fn() }],
        [CRON_TOKENS.CRON_JOB_STORE, jobStore],
        [CRON_TOKENS.CRON_HANDLER_REGISTRY, handlerRegistry],
        [CRON_TOKENS.CRON_POWER_MONITOR, powerMonitor],
        [
          PLATFORM_TOKENS.WORKSPACE_PROVIDER,
          makeWorkspaceProvider(opts.settings ?? {}),
        ],
      ];
      if (opts.withDrain !== false) {
        entries.push([SKILL_SYNTHESIS_TOKENS.SKILL_DRAIN_SERVICE, drain]);
      }
      return {
        container: makeContainer(entries),
        handlers,
        handlerRegistry,
        jobStore,
        drain,
        powerMonitor,
      };
    }

    function upsertedIds(jobStore: { upsert: jest.Mock }): string[] {
      return jobStore.upsert.mock.calls.map(
        (call) => (call[0] as { id: string }).id,
      );
    }

    it('upserts the three fixed drain job ids with the documented defaults', async () => {
      const { container, jobStore } = makeDrainContainer();

      await startThothCron(container, refsWithSqlite());

      expect(jobStore.upsert).toHaveBeenCalledWith({
        id: '@ptah/skills-drain-frequent',
        name: 'Skill Synthesis Drain (frequent)',
        cronExpr: '*/15 * * * *',
        timezone: 'UTC',
        prompt: 'handler:skills:drain:frequent',
        enabled: true,
      });
      expect(jobStore.upsert).toHaveBeenCalledWith({
        id: '@ptah/skills-drain-nightly',
        name: 'Skill Synthesis Drain (nightly)',
        cronExpr: '0 3 * * *',
        timezone: 'UTC',
        prompt: 'handler:skills:drain:nightly',
        enabled: true,
      });
      expect(jobStore.upsert).toHaveBeenCalledWith({
        id: '@ptah/skills-drain-weekly',
        name: 'Skill Synthesis Drain (weekly)',
        cronExpr: '0 4 * * 0',
        timezone: 'UTC',
        prompt: 'handler:skills:drain:weekly',
        enabled: true,
      });
    });

    it('reads each cron expression from its skillSynthesis.drain.* setting', async () => {
      const { container, jobStore } = makeDrainContainer({
        settings: {
          'skillSynthesis.drain.cronExpr': '*/30 * * * *',
          'skillSynthesis.drain.nightlyCronExpr': '0 2 * * *',
          'skillSynthesis.drain.weeklyCronExpr': '0 5 * * 6',
        },
      });

      await startThothCron(container, refsWithSqlite());

      const exprById = new Map(
        jobStore.upsert.mock.calls.map((call) => {
          const job = call[0] as { id: string; cronExpr: string };
          return [job.id, job.cronExpr];
        }),
      );
      expect(exprById.get('@ptah/skills-drain-frequent')).toBe('*/30 * * * *');
      expect(exprById.get('@ptah/skills-drain-nightly')).toBe('0 2 * * *');
      expect(exprById.get('@ptah/skills-drain-weekly')).toBe('0 5 * * 6');
    });

    it('registers each handler exactly once across two startThothCron calls', async () => {
      const { container, handlerRegistry, jobStore } = makeDrainContainer();
      const refs = refsWithSqlite();

      await startThothCron(container, refs);
      await startThothCron(container, refs);

      const drainRegistrations = handlerRegistry.register.mock.calls.filter(
        (call) => String(call[0]).startsWith('skills:drain:'),
      );
      expect(drainRegistrations.map((call) => call[0]).sort()).toEqual([
        'skills:drain:frequent',
        'skills:drain:nightly',
        'skills:drain:weekly',
      ]);
      // Upsert is idempotent by definition, so the second pass repeats it.
      expect(
        upsertedIds(jobStore).filter((id) => id.startsWith('@ptah/skills-')),
      ).toEqual([
        '@ptah/skills-drain-frequent',
        '@ptah/skills-drain-nightly',
        '@ptah/skills-drain-weekly',
        '@ptah/skills-drain-frequent',
        '@ptah/skills-drain-nightly',
        '@ptah/skills-drain-weekly',
      ]);
    });

    it('each handler drains its own tier with the live battery reading', async () => {
      const { container, handlers, drain, powerMonitor } = makeDrainContainer({
        onBattery: true,
      });
      await startThothCron(container, refsWithSqlite());
      const signal = new AbortController().signal;

      for (const name of [
        'skills:drain:frequent',
        'skills:drain:nightly',
        'skills:drain:weekly',
      ]) {
        const handler = handlers.get(name);
        expect(handler).toBeDefined();
        await (handler as JobHandler)({
          job: { id: name } as never,
          scheduledFor: 0,
          signal,
        });
      }

      expect(drain.drain.mock.calls.map((call) => call[0].tier)).toEqual([
        'frequent',
        'nightly',
        'weekly',
      ]);
      for (const call of drain.drain.mock.calls) {
        expect(call[0]).toMatchObject({ onBattery: true, signal });
      }
      expect(powerMonitor.isOnBattery).toHaveBeenCalledTimes(3);
    });

    it('reports a gated tick as a skipped OUTCOME, not a success', async () => {
      const { container, handlers, drain } = makeDrainContainer();
      await startThothCron(container, refsWithSqlite());
      drain.drain.mockResolvedValue({
        tier: 'frequent',
        skipped: true,
        reason: 'on-battery',
        reaped: 0,
        workspacesVisited: 0,
        claimed: 0,
        lostClaims: 0,
        done: 0,
        failed: 0,
        unscored: 0,
        skippedItems: 0,
        budgetDeferred: 0,
        budgetExhausted: false,
        durationMs: 1,
      });

      const handler = handlers.get('skills:drain:frequent') as JobHandler;
      await expect(
        handler({
          job: { id: 'x' } as never,
          scheduledFor: 0,
          signal: new AbortController().signal,
        }),
        // The reason travels as a first-class field so `JobRunner` can call
        // `markSkipped`. It used to be prose inside `summary`, which the
        // runner had no way to read — every gated tick was recorded as
        // `succeeded` (TASK_2026_315 / C2).
      ).resolves.toEqual({ outcome: 'skipped', reason: 'on-battery' });
    });

    it('registers no drain jobs when the host has no SkillDrainService', async () => {
      const { container, handlerRegistry, jobStore } = makeDrainContainer({
        withDrain: false,
      });

      await startThothCron(container, refsWithSqlite());

      expect(
        handlerRegistry.register.mock.calls.filter((call) =>
          String(call[0]).startsWith('skills:drain:'),
        ),
      ).toHaveLength(0);
      expect(upsertedIds(jobStore)).toEqual(['@ptah/daily-backup']);
    });
  });

  /**
   * TASK_2026_380 component 5 — the integrity scheduling seam.
   *
   * The boot dispatch is asserted through a `setTimeout` SPY rather than Jest's
   * fake timers so every assertion is a call count or an argument, never a
   * timing: the delay is read off the spy's arguments and the callback is
   * invoked by hand.
   */
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
        // Not `0 3` (the daily backup) and not `0 4` (the weekly drain): a
        // whole-file read must not share a tick with a whole-file write.
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
