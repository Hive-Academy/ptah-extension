import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@ptah-api/core';

/**
 * The retention window — R10.6. Ninety days, named once.
 *
 * ⚠️ A CONSTANT RATHER THAN A LITERAL IN THE QUERY, because the number appears
 * in three places that must agree: the `where` below, this service's log line,
 * and its spec's fixtures. A literal `90` in the query and a `90` in a test is
 * two numbers that happen to match today.
 */
export const RETENTION_DAYS = 90;

/**
 * The scheduler's key for this job.
 *
 * 🔴 IT IS EXPORTED SO THE WIRING CAN BE ASSERTED. `notification-retention.
 * service.spec.ts` boots a real injector, resolves `SchedulerRegistry` and looks
 * this name up — see the class docblock for why a name nobody can look up is the
 * whole failure mode this batch is at risk of.
 */
export const PRUNE_JOB_NAME = 'notifications.retention.prune';

/** ASSUMPTION-23 — daily at an off-peak hour, not hourly. */
export const PRUNE_SCHEDULE = CronExpression.EVERY_DAY_AT_4AM;

/**
 * `NotificationRetentionService` — R10.6, NFR-M3, **RISK-AE**, ASSUMPTION-23.
 *
 * ── 🔴 THIS IS THE FIRST SCHEDULED JOB IN THIS SERVER, AND THE DECORATOR IS
 *    INERT WITHOUT `ScheduleModule.forRoot()` ───────────────────────────────
 * `@nestjs/schedule` was a dependency of this repo for months and was imported
 * NOWHERE — zero `ScheduleModule`, zero `@Cron`. A `@Cron` added without the
 * root registration compiles, passes every test that calls {@link prune}
 * directly, and NEVER RUNS. The failure is silent, it is unit-test-green
 * forever, and it does not become visible until the table is years old and
 * someone asks why R10.6 was never satisfied.
 *
 * Two things stop that here, and neither is a comment:
 *   1. `ScheduleModule.forRoot()` is registered in `app.module.ts`, in the same
 *      change that created this lib (Task 14.9);
 *   2. this service's spec boots a real injector, resolves `SchedulerRegistry`
 *      and asserts a cron job named {@link PRUNE_JOB_NAME} is REGISTERED — not
 *      that `prune()` is callable, which proves nothing about the schedule.
 *
 * ── 🔴 THE `where` HAS TWO CLAUSES AND BOTH ARE THE REQUIREMENT ────────────
 * R10.6 says "older than a retention window **and already read**". The
 * conjunction is not a detail: dropping `readAt: { not: null }` deletes a
 * member's UNREAD BACKLOG, which is the one thing an inbox exists to hold, and
 * it does so on a schedule, at 4am, with no request to trace it to. An unread
 * notification from three years ago still survives this job. A read one from
 * yesterday does too.
 *
 * ── `now` IS A PARAMETER, NOT `new Date()` INSIDE THE QUERY ───────────────
 * The cron calls it with no argument and the default applies; the spec passes an
 * explicit instant and gets a deterministic cutoff. A `new Date()` buried in the
 * `where` makes every boundary assertion depend on wall-clock time and turns the
 * one test that matters — the row sitting exactly on the cutoff — into a flake.
 *
 * ── IT NEVER THROWS ───────────────────────────────────────────────────────
 * A failure is caught and logged. A cron that throws takes nothing useful with
 * it — there is no request to fail and no caller to inform — and a noisy log
 * that recurs tomorrow is strictly better than an unhandled rejection whose only
 * effect is to make the next tick less likely.
 */
@Injectable()
export class NotificationRetentionService {
  private readonly logger = new Logger(NotificationRetentionService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Delete READ notifications older than {@link RETENTION_DAYS} — R10.6.
   *
   * ⚠️ THE CUTOFF IS EXCLUSIVE (`lt`), SO A ROW CREATED EXACTLY AT IT SURVIVES.
   * Stated rather than left to be discovered: at the boundary the honest default
   * is to keep, because the two errors are not symmetrical — keeping a row one
   * day too long costs a row, deleting it one day too early loses it forever.
   *
   * Served by `@@index([createdAt])`, the second index plan §1.6 adds for
   * exactly this sweep: the `userId`-leading composite index cannot serve a
   * global scan with no `userId` in the `where`.
   */
  @Cron(PRUNE_SCHEDULE, { name: PRUNE_JOB_NAME })
  async prune(now: Date = new Date()): Promise<{ deleted: number }> {
    const cutoff = new Date(
      now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    try {
      const { count } = await this.prisma.notification.deleteMany({
        where: {
          // 🔴 BOTH CLAUSES. See the class docblock — dropping either one turns
          // a retention sweep into data loss.
          readAt: { not: null },
          createdAt: { lt: cutoff },
        },
      });

      this.logger.log(
        `Notification retention prune: deleted ${count} read notification(s) ` +
          `created before ${cutoff.toISOString()} (${RETENTION_DAYS} days).`,
      );
      return { deleted: count };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Notification retention prune failed and was NOT retried: ${message}. ` +
          `The next scheduled run will attempt the same window.`,
      );
      return { deleted: 0 };
    }
  }
}
