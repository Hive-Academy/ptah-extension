import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaService } from '@ptah-api/core';
import type {
  AdminModuleSchedule,
  AdminModuleScheduleEntry,
} from '@ptah-contracts/community';

import { NOT_DELETED } from '../common/soft-delete';
import { DETERMINISTIC_ORDER_BY } from '../common/sort-order';
import {
  ScheduleInputError,
  computeWeekdaySchedule,
} from '../common/weekday-schedule';

import { mapPrismaError } from './courses.service';

/**
 * `CourseScheduleService` — C4: one cohort start date, every module's
 * `releaseAt`.
 *
 * ⚠️ A NEW `@Injectable()`, NOT A METHOD ON `CoursesService` (already ~1100
 * lines). The precedent is `ReorderService`: a bulk, course-scoped write with
 * one audit row and its arithmetic in a pure sibling helper
 * (`common/weekday-schedule.ts`, mirroring `common/sort-order.ts`).
 *
 * ── 🔴 ONE METHOD, ONE RETURN TYPE, `apply` AS A FLAG (R10) ───────────────
 * `/preview` and `/schedule` run the SAME code down to the write loop. Two code
 * paths would let the preview and the apply drift, which would make the
 * rehearsal a LIE — and the rehearsal is the whole guard against a mis-typed
 * start date silently shifting ten member-visible dates. `AdminModuleSchedule`
 * is one type for both, distinguished by `applied`.
 *
 * ── 🔴 A TOTAL RE-SCHEDULE, NEVER A MERGE ────────────────────────────────
 * Every live module of the course is given a date. **Skipping modules that
 * already carry one was rejected**: that leaves a course whose modules sit on
 * two different schedules, half from this action and half from an earlier hand
 * edit — silent, partial, and member-visible, which is the exact failure class
 * this design exists to prevent. **Overwriting silently was also rejected** —
 * that is the harm itself. So it overwrites, and it shows you what it will
 * overwrite first, through three mechanisms rather than one:
 *
 *   1. The preview returns `currentReleaseAt` for EVERY module plus a `changed`
 *      flag and a `changedCount`, so the manual dates about to move are visible
 *      before anything is written.
 *   2. The apply writes ONLY the changed entries. An unchanged row is not
 *      touched, so its `updatedAt` does not move — which is what makes "a
 *      second identical apply reports `changedCount: 0` and issues zero
 *      updates" an assertable observable, the same shape as the seed's "second
 *      run, zero creates".
 *   3. The audit row's metadata records `{ slug, from, to }` for every changed
 *      module. `CourseModule` has no column holding a previous `releaseAt`, so
 *      that row is the ONLY thing that makes a wrong re-schedule recoverable.
 *
 * A per-module override through `PATCH /v1/admin/course-modules/:id` keeps
 * working afterwards, because concrete instants are written, and is only ever
 * clobbered by the NEXT deliberate re-schedule — which is what "deliberate"
 * means. That is C4's stated constraint, satisfied.
 *
 * ── ⚠️ WHAT THIS FILE DOES NOT TOUCH, AND THAT IS THE DESIGN ─────────────
 * `ModuleLockService` is unchanged: computing release dates at READ time from a
 * course-level start date was considered and REJECTED, because it moves unlock
 * logic into the read path and fights per-module admin overrides. The seed's
 * `releaseAt` exclusion (`community-seed.ts:589-592`) is unchanged and is now
 * MORE important, not less — the seed and this service are two writers of one
 * column and only one of them owns it. And `PATCH :id` is unchanged.
 */
@Injectable()
export class CourseScheduleService {
  private readonly logger = new Logger(CourseScheduleService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Compute a cohort schedule, and write it when `apply` is true.
   *
   * @param audit supplied ONLY when `apply` is true — a preview writes no row.
   */
  async schedule(
    input: ScheduleInput,
    apply: boolean,
    audit?: ScheduleAuditHook,
  ): Promise<AdminModuleSchedule> {
    const result = await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        const course = await tx.course.findFirst({
          where: { id: input.courseId, ...NOT_DELETED },
          select: { id: true, slug: true },
        });
        if (!course) throw new NotFoundException('Course not found');

        // 🔴 `DETERMINISTIC_ORDER_BY`, NEVER `slug`. "Day order" is the order
        // every member read uses, and a course authored through the admin API
        // has slugs derived from TITLES, not `day-NN` — a slug sort would be
        // arbitrary there, and C4 must work for such a course. `sortOrder`
        // alone is not a total order, which is why the shared tuple is spread
        // rather than a bare `{ sortOrder: 'asc' }`.
        const modules = await tx.courseModule.findMany({
          where: { ...NOT_DELETED, courseId: course.id },
          orderBy: [...DETERMINISTIC_ORDER_BY],
          select: {
            id: true,
            slug: true,
            title: true,
            sortOrder: true,
            releaseAt: true,
          },
        });

        if (modules.length === 0) {
          throw new BadRequestException(
            'This course has no live modules to schedule.',
          );
        }

        // 🔴 `count` COMES FROM THE ROWS, NEVER FROM A LITERAL. This is where
        // C4's reusability clause is enforced: a twelve-module cohort 2 gets
        // twelve dates with no code change.
        const slots = this.computeSlots({ ...input, count: modules.length });

        const entries: AdminModuleScheduleEntry[] = modules.map(
          (row, index) => {
            const slot = slots[index];
            const releaseAt = slot.instant.toISOString();
            const currentReleaseAt = row.releaseAt
              ? row.releaseAt.toISOString()
              : null;
            return {
              moduleId: row.id,
              slug: row.slug,
              title: row.title,
              sortOrder: row.sortOrder,
              day: slot.day,
              weekday: slot.weekday,
              localDate: slot.localDate,
              releaseAt,
              currentReleaseAt,
              changed: currentReleaseAt !== releaseAt,
            };
          },
        );

        const changed = entries.filter((entry) => entry.changed);
        const lastReleaseDate = slots[slots.length - 1].localDate;

        if (apply) {
          // ⚠️ CHECKED INSIDE THE TRANSACTION, AGAINST THE SAME SNAPSHOT THE
          // WRITES SEE — `reorder.service.ts:49-54` (D-6.6a) makes exactly this
          // call for exactly this reason. Checked outside, a module created by
          // another admin between the check and the writes would be scheduled
          // without ever having appeared in the request the admin confirmed.
          this.assertEcho(input, modules.length, lastReleaseDate);

          for (const entry of changed) {
            await tx.courseModule.update({
              where: { id: entry.moduleId },
              data: { releaseAt: new Date(entry.releaseAt) },
            });
          }

          // ONE row for the whole schedule, never one per module, and it
          // carries what the previous dates WERE — see `ScheduleAuditHook`.
          await audit?.(
            tx,
            changed.map((entry) => ({
              slug: entry.slug,
              from: entry.currentReleaseAt,
              to: entry.releaseAt,
            })),
          );
        }

        return {
          courseId: course.id,
          courseSlug: course.slug,
          timeZone: input.timeZone,
          startDate: input.startDate,
          timeOfDay: input.timeOfDay,
          moduleCount: modules.length,
          lastReleaseDate,
          changedCount: changed.length,
          entries,
          applied: apply,
        } satisfies AdminModuleSchedule;
      }),
    );

    this.logger.log(
      `${apply ? 'Applied' : 'Previewed'} cohort schedule: courseId=${result.courseId} ` +
        `modules=${result.moduleCount} changed=${result.changedCount} ` +
        `start=${result.startDate} last=${result.lastReleaseDate} tz=${result.timeZone}`,
    );
    return result;
  }

  /* ---------------------------------------------------------------------- */

  /**
   * The pure helper, with its typed error translated at the boundary.
   *
   * 🔴 NEVER `error.message` VERBATIM TO A CLIENT (CLAUDE.md / the NestJS
   * rules). `ScheduleInputError`'s message is written for the LOG — it names
   * the raw input — and each case gets a sentence an operator can act on
   * instead. The original is logged at `warn` so the two are correlatable.
   */
  private computeSlots(input: ScheduleInput & { count: number }) {
    try {
      return computeWeekdaySchedule(input);
    } catch (error: unknown) {
      if (error instanceof ScheduleInputError) {
        this.logger.warn(
          `Rejected cohort schedule input for courseId=${input.courseId}: ${error.message}`,
        );
        throw new BadRequestException(clientMessageFor(error));
      }
      throw error;
    }
  }

  /**
   * 🔴 THE ECHO GUARD — the load-bearing half of this endpoint.
   *
   * Both values are compared against the schedule just computed from the rows
   * this transaction read. A mismatch is a `400` naming EXPECTED and RECEIVED
   * for the failing field, thrown BEFORE any write, so a wrong confirmation
   * leaves the course exactly as it was.
   *
   * ⚠️ `confirmModuleCount` IS CHECKED FIRST, DELIBERATELY. If the course has a
   * different number of modules than the admin believes, the computed last date
   * is also different — reporting the date mismatch first would send him to
   * correct a date that is not the real problem.
   */
  private assertEcho(
    input: ScheduleInput,
    moduleCount: number,
    lastReleaseDate: string,
  ): void {
    if (input.confirmModuleCount !== moduleCount) {
      throw new BadRequestException(
        `confirmModuleCount does not match this course: expected ${moduleCount} ` +
          `live module(s), received ${input.confirmModuleCount}. Run the preview ` +
          'endpoint and confirm the schedule it returns.',
      );
    }
    if (input.confirmLastReleaseDate !== lastReleaseDate) {
      throw new BadRequestException(
        `confirmLastReleaseDate does not match the computed schedule: expected ` +
          `${lastReleaseDate}, received ${input.confirmLastReleaseDate}. Run the ` +
          'preview endpoint and confirm the schedule it returns.',
      );
    }
  }

  private async withMappedPrismaErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error: unknown) {
      throw mapPrismaError(error);
    }
  }
}

/** One module whose date moved, as the audit metadata records it. */
export interface ScheduleChange {
  readonly slug: string;
  /** The date the row carried before, or `null` if it was unscheduled. */
  readonly from: string | null;
  readonly to: string;
}

/**
 * The audit writer for a schedule.
 *
 * ⚠️ NOT `CoursesService`'s `AuditHook`, AND THE DIFFERENCE IS THE WHOLE POINT.
 * `AuditHook` is `(tx, targetId)`, which suits a mutation with ONE subject row.
 * A schedule has none — its `targetId` is `undefined`, exactly like a reorder —
 * but it does have something a reorder does not: the set of dates it is about
 * to destroy. `CourseModule` has no column holding a previous `releaseAt`, so
 * if that set does not reach the audit row it is gone, and a re-schedule run
 * against a wrong start date is unrecoverable.
 *
 * The controller closes over `auditHook(...)` and passes `changed` straight
 * into its `metadata`, so the row still commits inside the mutation's own
 * transaction (PRE-6) and still uses one writer.
 */
export type ScheduleAuditHook = (
  tx: Prisma.TransactionClient,
  changed: readonly ScheduleChange[],
) => Promise<void>;

/**
 * The DTO fields the service works from.
 *
 * The two confirm fields are OPTIONAL here and REQUIRED on
 * `ApplyModuleScheduleDto`, because this one interface serves both routes —
 * the controller supplies them only on the apply, and {@link
 * CourseScheduleService.schedule} reads them only when `apply` is true.
 */
export interface ScheduleInput {
  readonly courseId: string;
  readonly startDate: string;
  readonly timeOfDay: string;
  readonly timeZone: string;
  readonly confirmModuleCount?: number;
  readonly confirmLastReleaseDate?: string;
}

/**
 * A written sentence per rejected input — never the raw message.
 *
 * The two cases an operator can actually hit are an unresolvable zone and a
 * weekend start; everything else the helper rejects (a shape the DTO already
 * enforces, a `count` the service computes) is a wiring fault rather than an
 * operator mistake, so it gets a general sentence and the log carries the
 * detail.
 */
function clientMessageFor(error: ScheduleInputError): string {
  if (error.message.includes('timeZone')) {
    return 'Unknown time zone. Use an IANA identifier such as "Europe/Berlin".';
  }
  if (error.message.includes('weekday')) {
    return 'The cohort start date falls on a weekend. Supply the first weekday of the cohort.';
  }
  if (error.message.includes('not a real calendar date')) {
    return 'That start date is not a real calendar date.';
  }
  return 'The cohort schedule could not be computed from those inputs.';
}
