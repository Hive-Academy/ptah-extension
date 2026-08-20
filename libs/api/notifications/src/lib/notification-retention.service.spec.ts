import { ConfigModule } from '@nestjs/config';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '@ptah-api/core';

import {
  NotificationRetentionService,
  PRUNE_JOB_NAME,
  PRUNE_SCHEDULE,
  RETENTION_DAYS,
} from './notification-retention.service';
import { NotificationsModule } from './notifications.module';

/**
 * `NotificationRetentionService` — R10.6, NFR-M3, **RISK-AE**, ASSUMPTION-23.
 *
 * THREE GROUPS, AND THE THIRD IS THE ONE THAT MATTERS:
 *
 *   1. the window — read + older than 90 days is deleted;
 *   2. the survivors, asserted INDIVIDUALLY — unread+ancient (the clause that
 *      matters), read+recent, unread+recent, and the row sitting exactly on the
 *      cutoff;
 *   3. 🔴 THE WIRING. A spec that only calls `prune()` passes forever against a
 *      decorator nobody wired. `@nestjs/schedule` was installed in this repo and
 *      imported NOWHERE before this batch, so "the `@Cron` is inert" is not a
 *      hypothetical failure mode — it is the default one. Group 3 boots a real
 *      injector and reads the job out of `SchedulerRegistry`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-10T04:00:00.000Z');

interface Row {
  id: string;
  readAt: Date | null;
  createdAt: Date;
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

/**
 * A double that applies the two-clause `where` the service issues.
 *
 * It models exactly what the query needs — `readAt: { not: null }` and
 * `createdAt: { lt: cutoff }` — and nothing more. An implementation that
 * DROPPED the `readAt` clause would produce a `where` this still understands and
 * would delete the unread rows, which is precisely the failure the survivor
 * assertions below are looking for. An implementation that reached for an
 * operator this does not model would throw rather than pass.
 */
function createStore(seed: Row[]) {
  const rows: Row[] = seed.map((r) => ({ ...r }));

  const deleteMany = jest.fn(
    async (args: {
      where: {
        readAt?: { not: null };
        createdAt?: { lt: Date };
      };
    }) => {
      const { readAt, createdAt } = args.where;
      const doomed = rows.filter((row) => {
        if (readAt !== undefined) {
          if (!('not' in readAt) || readAt.not !== null) {
            throw new Error(
              `Unmodelled readAt clause: ${JSON.stringify(readAt)}`,
            );
          }
          if (row.readAt === null) return false;
        }
        if (createdAt !== undefined) {
          if (!('lt' in createdAt)) {
            throw new Error(
              `Unmodelled createdAt clause: ${JSON.stringify(createdAt)}`,
            );
          }
          if (!(row.createdAt.getTime() < createdAt.lt.getTime())) return false;
        }
        return true;
      });

      for (const row of doomed) rows.splice(rows.indexOf(row), 1);
      return { count: doomed.length };
    },
  );

  const prisma = { notification: { deleteMany } } as unknown as PrismaService;
  return { prisma, rows, deleteMany };
}

/** The four survivors plus the one casualty, as one fixture set. */
const FIXTURES: Row[] = [
  { id: 'read-ancient', readAt: daysAgo(1), createdAt: daysAgo(91) },
  { id: 'unread-ancient', readAt: null, createdAt: daysAgo(91) },
  { id: 'read-recent', readAt: daysAgo(1), createdAt: daysAgo(89) },
  { id: 'unread-recent', readAt: null, createdAt: daysAgo(89) },
  {
    id: 'read-exactly-at-cutoff',
    readAt: daysAgo(1),
    createdAt: daysAgo(RETENTION_DAYS),
  },
];

describe('NotificationRetentionService', () => {
  describe('R10.6 — 90 days, READ rows only', () => {
    it('deletes a READ notification older than the window', async () => {
      const store = createStore(FIXTURES);
      const service = new NotificationRetentionService(store.prisma);

      const result = await service.prune(NOW);

      expect(result).toEqual({ deleted: 1 });
      expect(store.rows.map((r) => r.id)).not.toContain('read-ancient');
    });

    it('🔴 an UNREAD notification survives no matter how old it is', async () => {
      // THE CLAUSE THAT MATTERS. Dropping `readAt: { not: null }` deletes a
      // member's unread backlog — the one thing the inbox exists to hold — on a
      // schedule, at 4am, with no request to trace it to.
      const store = createStore(FIXTURES);
      const service = new NotificationRetentionService(store.prisma);

      await service.prune(NOW);

      expect(store.rows.map((r) => r.id)).toContain('unread-ancient');
    });

    it('a READ notification inside the window survives', async () => {
      const store = createStore(FIXTURES);
      const service = new NotificationRetentionService(store.prisma);

      await service.prune(NOW);

      expect(store.rows.map((r) => r.id)).toContain('read-recent');
    });

    it('an UNREAD notification inside the window survives', async () => {
      const store = createStore(FIXTURES);
      const service = new NotificationRetentionService(store.prisma);

      await service.prune(NOW);

      expect(store.rows.map((r) => r.id)).toContain('unread-recent');
    });

    it('the cutoff is EXCLUSIVE — a row created exactly at it survives', async () => {
      // Pinned rather than left to be discovered. At the boundary the two
      // errors are not symmetrical: keeping a row a day too long costs a row,
      // deleting it a day too early loses it forever.
      const store = createStore(FIXTURES);
      const service = new NotificationRetentionService(store.prisma);

      await service.prune(NOW);

      expect(store.rows.map((r) => r.id)).toContain('read-exactly-at-cutoff');
    });

    it('exactly ONE of the five fixtures is deleted', async () => {
      const store = createStore(FIXTURES);
      const service = new NotificationRetentionService(store.prisma);

      await service.prune(NOW);

      expect(store.rows.map((r) => r.id).sort()).toEqual([
        'read-exactly-at-cutoff',
        'read-recent',
        'unread-ancient',
        'unread-recent',
      ]);
    });

    it('issues BOTH clauses, with the cutoff derived from the supplied `now`', async () => {
      const store = createStore([]);
      const service = new NotificationRetentionService(store.prisma);

      await service.prune(NOW);

      expect(store.deleteMany).toHaveBeenCalledWith({
        where: {
          readAt: { not: null },
          createdAt: { lt: new Date(NOW.getTime() - RETENTION_DAYS * DAY_MS) },
        },
      });
    });

    it('`now` defaults to the wall clock, so the cron needs no argument', async () => {
      const store = createStore([]);
      const service = new NotificationRetentionService(store.prisma);

      const before = Date.now();
      await service.prune();
      const after = Date.now();

      const args = store.deleteMany.mock.calls[0]?.[0] as {
        where: { createdAt: { lt: Date } };
      };
      const cutoff = args.where.createdAt.lt.getTime();
      expect(cutoff).toBeGreaterThanOrEqual(before - RETENTION_DAYS * DAY_MS);
      expect(cutoff).toBeLessThanOrEqual(after - RETENTION_DAYS * DAY_MS);
    });

    it('the window is NINETY days and is a named constant', () => {
      expect(RETENTION_DAYS).toBe(90);
    });
  });

  describe('a cron that throws helps nobody', () => {
    it('catches, logs and reports zero rather than rejecting', async () => {
      // There is no request to fail and no caller to inform. An unhandled
      // rejection out of a scheduled tick makes the next tick less likely and
      // achieves nothing else.
      const store = createStore([]);
      store.deleteMany.mockRejectedValueOnce(new Error('connection reset'));
      const service = new NotificationRetentionService(store.prisma);

      await expect(service.prune(NOW)).resolves.toEqual({ deleted: 0 });
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 RISK-AE — THE WIRING                                                 */
  /* ---------------------------------------------------------------------- */

  describe('🔴 RISK-AE — the job is REGISTERED, not merely callable', () => {
    let moduleRef: TestingModule;
    let registry: SchedulerRegistry;
    let bootError: unknown;
    /** The booted graph's Prisma double — proof of what the tick actually ran. */
    const bootDeleteMany = jest.fn().mockResolvedValue({ count: 0 });

    beforeAll(async () => {
      // `PkceService` and `MagicLinkService` (reached through `IdentityModule`)
      // both start a `setInterval` in their CONSTRUCTOR, and `.init()` below
      // additionally STARTS the cron job. Fake timers keep all of that off
      // Jest's real event loop; this is a test-runner concern and touches no
      // part of the DI graph.
      jest.useFakeTimers();

      // Hermetic, and assigned BEFORE `ConfigModule.forRoot()` runs: dotenv
      // does not overwrite keys already in `process.env`, so this makes the
      // test read the same in CI (no `.env`) and on a developer machine (a
      // `.env` full of real secrets). These are constructor arguments to SDK
      // clients; no socket is opened.
      process.env['JWT_SECRET'] = 'retention-spec-jwt-secret-not-a-real-key';
      process.env['WORKOS_API_KEY'] = 'sk_test_retention_spec';
      process.env['WORKOS_CLIENT_ID'] = 'client_retention_spec';
      process.env['RESEND_API_KEY'] = 're_retention_spec';

      try {
        moduleRef = await Test.createTestingModule({
          imports: [
            ConfigModule.forRoot({ isGlobal: true }),
            // The line under test, in the form the app registers it.
            ScheduleModule.forRoot(),
            NotificationsModule,
          ],
        })
          .overrideProvider(PrismaService)
          .useValue({ notification: { deleteMany: bootDeleteMany } })
          .compile();

        // 🔴 `.init()`, NOT JUST `.compile()`. `ScheduleExplorer` discovers the
        // decorated method in `onModuleInit` and `SchedulerOrchestrator` mounts
        // it into `SchedulerRegistry` in `onApplicationBootstrap`. `compile()`
        // runs neither, so a test that stopped there would pass against a
        // `ScheduleModule` that was never registered — which is the exact bug
        // this describe block exists to catch.
        await moduleRef.init();
        registry = moduleRef.get(SchedulerRegistry);
      } catch (error: unknown) {
        // Captured rather than rethrown, so the assertion below reports Nest's
        // own message — which names the unresolvable provider.
        bootError = error;
      }
    });

    afterAll(async () => {
      await moduleRef?.close();
      jest.useRealTimers();
    });

    it('the module graph boots at all', () => {
      const message =
        bootError instanceof Error ? bootError.message : String(bootError);

      expect(bootError ? message : null).toBeNull();
    });

    it('🔴 a cron job named PRUNE_JOB_NAME is in the SchedulerRegistry', () => {
      // THE ASSERTION. Delete `ScheduleModule.forRoot()` from the imports above
      // — or from `app.module.ts` — and this is the one test that goes red.
      expect(registry.doesExist('cron', PRUNE_JOB_NAME)).toBe(true);
      expect(() => registry.getCronJob(PRUNE_JOB_NAME)).not.toThrow();
    });

    it('the registered job is the ONLY cron in this module', () => {
      // Named individually, so a second job added later is a visible decision
      // rather than a silent one.
      expect([...registry.getCronJobs().keys()]).toEqual([PRUNE_JOB_NAME]);
    });

    it('🔴 firing the registered job runs THE PRUNE, with both clauses', async () => {
      // The registry could hold a job with the right NAME and the wrong body,
      // so the name assertion above is necessary and not sufficient. Asserted
      // through the booted graph's OWN Prisma double rather than a spy on the
      // instance: `SchedulerOrchestrator` binds the method reference at
      // registration time, so a `jest.spyOn(service, 'prune')` applied
      // afterwards is not what the job holds — and a test built on one would
      // report a false negative here and, worse, a false POSITIVE if it were
      // written the other way round.
      bootDeleteMany.mockClear();

      await registry.getCronJob(PRUNE_JOB_NAME).fireOnTick();

      expect(bootDeleteMany).toHaveBeenCalledTimes(1);
      const where = (
        bootDeleteMany.mock.calls[0]?.[0] as {
          where: { readAt: unknown; createdAt: { lt: Date } };
        }
      ).where;
      expect(where.readAt).toEqual({ not: null });
      expect(where.createdAt.lt).toBeInstanceOf(Date);
    });

    it('ASSUMPTION-23 — it runs DAILY at 04:00, not hourly', () => {
      // 90 days is the window; sweeping more than once a day buys nothing and
      // puts a global `deleteMany` on a schedule.
      //
      // ⚠️ FIVE FIELDS, NOT SIX. `CronExpression.EVERY_DAY_AT_4AM` is
      // `'0 04 * * *'` — minute-resolution — where much of `@nestjs/schedule`'s
      // vocabulary is second-resolution. Pinned as a literal so an "obvious"
      // edit to a six-field string that happens to parse as something else is
      // caught here rather than at 4am in production.
      expect(PRUNE_SCHEDULE).toBe('0 04 * * *');
      expect(registry.getCronJob(PRUNE_JOB_NAME).cronTime.source).toBe(
        PRUNE_SCHEDULE,
      );
    });

    /**
     * 🔴 THE DELIBERATE FAILURE, MADE PERMANENT AND AUTOMATIC.
     *
     * Every assertion above is conditional on `ScheduleModule.forRoot()` being
     * in the imports, and a green suite proves nothing about that unless the
     * NEGATIVE is also demonstrated. This boots the identical graph with the one
     * line removed and asserts the registry is EMPTY — so "the job registers"
     * and "the job registers BECAUSE of that line" are both facts rather than
     * one fact and one assumption.
     *
     * ⚠️ IT DOES NOT PROVE `app.module.ts` STILL CARRIES THE LINE. This lib
     * supplies its own `forRoot()` here, so deleting the app's registration
     * leaves every test in this file green. That half is asserted in
     * `apps/ptah-license-server/src/app/app.module.spec.ts`, and the two
     * together are what closes RISK-AE.
     */
    it('🔴 WITHOUT ScheduleModule.forRoot() the job is registered NOWHERE', async () => {
      const withoutSchedule = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          // ScheduleModule.forRoot() DELIBERATELY ABSENT.
          NotificationsModule,
        ],
        // `SchedulerRegistry` has no dependencies of its own, so it can be
        // provided directly. Resolved from the app's own scope it would be the
        // one the orchestrator writes into; here there is no orchestrator, and
        // that is the point.
        providers: [SchedulerRegistry],
      })
        .overrideProvider(PrismaService)
        .useValue({ notification: { deleteMany: jest.fn() } })
        .compile();

      await withoutSchedule.init();

      const emptyRegistry = withoutSchedule.get(SchedulerRegistry);
      expect([...emptyRegistry.getCronJobs().keys()]).toEqual([]);
      expect(emptyRegistry.doesExist('cron', PRUNE_JOB_NAME)).toBe(false);
      // And the service is still perfectly callable — which is exactly why a
      // spec that only calls `prune()` would stay green forever.
      await expect(
        withoutSchedule.get(NotificationRetentionService).prune(NOW),
      ).resolves.toEqual({ deleted: 0 });

      await withoutSchedule.close();
    });

    it('the retention service is NOT exported from the module', () => {
      // `prune()` is a GLOBAL `deleteMany` with no `userId` in its `where`. A
      // lib that could inject it could delete another member's notifications
      // from a request handler.
      const exports = (Reflect.getMetadata('exports', NotificationsModule) ??
        []) as Array<{ name?: string }>;

      expect(exports.map((e) => e?.name ?? String(e))).not.toContain(
        'NotificationRetentionService',
      );
    });
  });
});
