import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import type { MemberLessonProgress } from '@ptah-contracts/community';

import { NOT_DELETED } from '../common/soft-delete';
import { buildLessonCourseVisibilityWhere } from '../common/visibility';

import {
  clampPositionSeconds,
  completionThresholdSeconds,
  hasUsableDuration,
  isAutoComplete,
  isImplausiblePosition,
} from './completion';

/**
 * ProgressService — R2.3, §4.6, NFR-S4, NFR-P5.
 *
 * 🔴 EVERY READ AND EVERY WRITE IN THIS FILE KEYS ON `{ userId: ctx.userId,
 * lessonId }`, AND NO PUBLIC METHOD TAKES A `userId` ARGUMENT (NFR-S4,
 * R2.3.7). That is checkable rather than reviewed: `progress.service.spec.ts`
 * asserts the signatures. Plan §1.4 makes the same point from the schema side
 * by REJECTING `@@index([lessonId])` — there is no efficient way to ask "who
 * else completed this lesson", so no member endpoint accidentally can. Both
 * halves should exist; "expensive" is a speed bump and "there is no parameter
 * to put it in" is not.
 *
 * 🔴 COMPLETION IS COMPUTED SERVER-SIDE AND THE CLIENT HAS NO WAY TO CLAIM IT
 * (§4.6.6). {@link updateProgress} takes a POSITION and nothing else — not an
 * object with an optional `completed`, a plain number — so a completion flag is
 * UNREPRESENTABLE at this boundary rather than merely ignored. The DTO 9C binds
 * to this method inherits that shape.
 *
 * ⚠️ THE THREE UNITS AND WHERE THEY MEET. This file compares a POSITION to a
 * DURATION exactly once, through `completion.ts`, and it never computes a
 * PERCENTAGE — that is a third quantity derived from LESSON COUNTS and owned by
 * `CourseReadService` (RISK-O). There is no `* 0.9` anywhere below.
 *
 * ⚠️ MONOTONICITY IS ENFORCED BY POSTGRES, NOT BY JAVASCRIPT (R2.3.1). Written
 * as read-then-compare-then-write, the comparison and the write see two
 * different snapshots, and two tabs playing the same lesson is an ORDINARY
 * case rather than a theoretical one: the later-arriving lower position would
 * overwrite the higher. Both advancing writes below are `updateMany`s whose
 * `where` carries the comparison, so the database evaluates it against the
 * committed row in the same statement that performs the update. Forum's
 * `ReadStateService` made the same call for the same reason (D-6.10a).
 *
 * ⚠️ `upsert` ON THE COMPOSITE PRIMARY KEY IS THE RIGHT WRITE SHAPE HERE.
 * Nothing observes create-vs-update — unlike Batch 8's seed, where the branch
 * taken WAS the observable — and a read-then-insert races two tabs into a
 * duplicate-key error on a member's ordinary playback.
 *
 * ⚠️ THIS FILE MUST NOT IMPORT `@ptah-api/youtube` (NFR-P6, RISK-P). Every
 * duration it reads is the persisted `Lesson.videoDurationSeconds` column;
 * persistence IS the cache (plan §4.5). Task 9.17 asserts the importer set by
 * name.
 *
 * ⚠️ THROTTLING IS THE CLIENT'S JOB (NFR-P5, §4.6.4 — at most one `PUT` per
 * 15 s). The server carries the `PROGRESS_WRITES` throttle tier, which Batch 6C
 * set at 60/min because 10/min rate-limits ordinary use; 9C's controller
 * applies it. Nothing in this service assumes a rate.
 *
 * ⚠️ WHAT THIS SERVICE DELIBERATELY DOES NOT DO: EVALUATE THE MODULE LOCK.
 * Plan §3.4 annotates both progress routes with `403`, which is
 * `ModuleLockService`'s verdict, and the controller composes it exactly as it
 * does for `GET :slug/lessons/:lessonSlug` — the lock is a property of the
 * MODULE and evaluating it needs the course tree and the member's completed
 * lessons, which this service has no reason to fetch on a write that is one row
 * wide. Task 9.13's stated dependency is Task 9.8 alone. The exposure if a
 * controller forgets is bounded and stated: a member who hand-crafted the
 * request could record a watch position on a lesson they cannot read, which
 * discloses nothing and is corrected by the read path refusing them.
 */
@Injectable()
export class ProgressService {
  private readonly logger = new Logger(ProgressService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Record a playback position — R2.3.1, R2.3.2, §4.6.5, §4.6.6.
   *
   * ⚠️ THE SECOND PARAMETER IS A LESSON ID AND THE THIRD IS A POSITION IN
   * SECONDS. It is never a duration; the duration comes from the persisted
   * `Lesson` row read below and is the only duration the 90% rule may use
   * (ASSUMPTION-8).
   *
   * Steps, in order, and each of them is a decision:
   *  1. Resolve the lesson through the VISIBILITY clause, so an invisible or
   *     draft course is `404` by the same mechanism as everywhere else and this
   *     write cannot become an existence oracle for content the member cannot
   *     read.
   *  2. Refuse a negative position with `400`. It is a malformed argument, not
   *     an overshoot, and the DTO's `@Min(0)` should already have caught it —
   *     reaching here with one means the boundary was bypassed, and silently
   *     coercing it to `0` would hide that.
   *  3. CLAMP a position past the end rather than reject it. See
   *     `clampPositionSeconds` — refusing the overshoot would prevent the final
   *     write from ever completing the lesson.
   *  4. Advance the stored position IF AND ONLY IF the submitted one is
   *     greater, in the database, in one statement.
   *  5. Mark auto-complete if the threshold is now met AND the lesson is not
   *     already complete — so a manual completion's timestamp and source
   *     survive a subsequent play-through.
   */
  async updateProgress(
    ctx: MemberContext,
    lessonId: string,
    positionSeconds: number,
  ): Promise<MemberLessonProgress> {
    if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
      throw new BadRequestException(
        'positionSeconds must be a non-negative number of seconds',
      );
    }

    const lesson = await this.requireVisibleLesson(ctx, lessonId);
    const duration = lesson.videoDurationSeconds;

    const submitted = Math.floor(positionSeconds);
    const position = clampPositionSeconds(submitted, duration);

    if (isImplausiblePosition(submitted, duration)) {
      // Logged, not refused — the value is clamped either way, and a client
      // reporting nonsense is worth knowing about without breaking a member's
      // playback over it. No member identifier in the line (NFR-S4).
      this.logger.warn(
        `Implausible progress position for lesson=${lessonId}: submitted=${submitted} ` +
          `duration=${duration ?? 'null'} — clamped to ${position}`,
      );
    }

    const now = new Date();

    const row = await this.prisma.$transaction(async (tx) => {
      // (a) Create the row if this member has never opened the lesson. An EMPTY
      //     `update` is the literal statement of "never go backwards": when the
      //     row already exists this is a no-op and step (b) decides.
      await tx.lessonProgress.upsert({
        where: { userId_lessonId: { userId: ctx.userId, lessonId } },
        create: {
          userId: ctx.userId,
          lessonId,
          furthestPositionSeconds: position,
          completedAt: isAutoComplete(position, duration) ? now : null,
          completionSource: isAutoComplete(position, duration)
            ? AUTO_COMPLETION
            : null,
        },
        update: {},
      });

      // (b) Advance ONLY if the submitted position is greater. The comparison
      //     is in the `where`, so Postgres evaluates it against the committed
      //     row — two tabs cannot interleave a lower value over a higher one.
      await tx.lessonProgress.updateMany({
        where: {
          userId: ctx.userId,
          lessonId,
          furthestPositionSeconds: { lt: position },
        },
        data: { furthestPositionSeconds: position },
      });

      // (c) Auto-completion, also as a conditional statement.
      //
      //     `completedAt: null` is what makes a manual completion survive: a
      //     member who ticked the box at 10% and then watched to the end keeps
      //     `completionSource: 'manual'` and their original timestamp, rather
      //     than having the record silently rewritten to 'auto'.
      //
      //     Skipped entirely when the duration cannot support a threshold
      //     (ASSUMPTION-8 + the `0` case) — there is no query to issue, which is
      //     also why a manual-only lesson costs one round trip less.
      if (hasUsableDuration(duration)) {
        await tx.lessonProgress.updateMany({
          where: {
            userId: ctx.userId,
            lessonId,
            completedAt: null,
            furthestPositionSeconds: {
              gte: completionThresholdSeconds(duration),
            },
          },
          data: { completedAt: now, completionSource: AUTO_COMPLETION },
        });
      }

      // (d) Read the committed row back. The two conditional writes report a
      //     COUNT, not a row, and composing the response from what we hoped
      //     they did would be a third snapshot of the same state.
      return tx.lessonProgress.findUnique({
        where: { userId_lessonId: { userId: ctx.userId, lessonId } },
      });
    });

    return toMemberLessonProgress(row);
  }

  /**
   * Manual completion — R2.3.3. Reversible, and independent of position.
   *
   * ⚠️ IT DOES NOT TOUCH `furthestPositionSeconds`, IN EITHER DIRECTION. Where a
   * member watched to is a different fact from what they claim to have
   * finished: resetting the position on an un-complete would lose their resume
   * point, and setting it to the duration on a complete would fabricate a
   * playback that never happened (and would then make the lesson
   * auto-complete again, permanently, defeating the reversal).
   *
   * ⚠️ REVERSING CLEARS BOTH `completedAt` AND `completionSource`, per the
   * task's wording — so the row returns to "not complete, by no particular
   * mechanism". THE CONSEQUENCE, STATED SO IT IS NOT DISCOVERED LATER: a member
   * who un-completes a lesson they have already watched past the threshold and
   * then plays it again WILL be auto-completed by the next progress write. That
   * is the honest reading of a rule derived from position — the alternative, a
   * sticky "manually marked incomplete" state, needs a column plan §1.4 does
   * not have and migration 4 would have to add. In practice the client stops
   * sending positions when playback stops, so the reversal holds for a member
   * who simply un-ticks the box.
   */
  async setCompletion(
    ctx: MemberContext,
    lessonId: string,
    complete: boolean,
  ): Promise<MemberLessonProgress> {
    await this.requireVisibleLesson(ctx, lessonId);

    const now = new Date();
    const completion = complete
      ? { completedAt: now, completionSource: MANUAL_COMPLETION }
      : { completedAt: null, completionSource: null };

    const row = await this.prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId: ctx.userId, lessonId } },
      // A member can complete a lesson they have never played (R2.3.3 — "manual,
      // regardless of position"), so the created row starts at position 0.
      create: { userId: ctx.userId, lessonId, ...completion },
      update: completion,
    });

    return toMemberLessonProgress(row);
  }

  /**
   * THIS member's progress across a set of lessons, as a map — the read
   * `CourseReadService` composes an outline from.
   *
   * ⚠️ ONE QUERY FOR THE WHOLE SET, NEVER ONE PER LESSON. A course outline is
   * where an N+1 naturally appears in this lib ("for each lesson, fetch its
   * progress"), and the query budget in `course-read.service.spec.ts` counts
   * this call.
   *
   * ⚠️ IT TAKES A CONTEXT AND A LIST OF LESSONS, AND NEVER A `userId`. The
   * `where` is built here so there is exactly one construction site for "this
   * member's progress" in the lib — a caller cannot pass someone else's id
   * because there is no parameter for one.
   */
  async listProgressFor(
    ctx: MemberContext,
    lessonIds: readonly string[],
  ): Promise<Map<string, LessonProgressRow>> {
    if (lessonIds.length === 0) return new Map();

    const rows = await this.prisma.lessonProgress.findMany({
      where: { userId: ctx.userId, lessonId: { in: [...lessonIds] } },
      select: {
        lessonId: true,
        furthestPositionSeconds: true,
        completedAt: true,
        completionSource: true,
      },
    });

    return new Map(rows.map((row) => [row.lessonId, row]));
  }

  /**
   * Resolve one lesson id to a lesson THIS member may read, or `404`.
   *
   * ⚠️ THE VISIBILITY CLAUSE IS PART OF THE QUERY (`buildLessonCourseVisibilityWhere`
   * nests it through `module.course`), so a lesson in a draft or out-of-cohort
   * course is simply not found and `404` is the honest answer to the query that
   * ran. There is no branch here that could produce a `403`.
   *
   * ⚠️ `findFirst`, NOT `findUnique`. `Lesson` is soft-deletable and
   * `findUnique`'s `where` accepts unique fields only, so `{ id, ...NOT_DELETED }`
   * would not compile — it is the one read shape that can look filtered and not
   * be. `soft-delete-filter.spec.ts` bans it on this model.
   */
  private async requireVisibleLesson(
    ctx: MemberContext,
    lessonId: string,
  ): Promise<{ id: string; videoDurationSeconds: number | null }> {
    const lesson = await this.prisma.lesson.findFirst({
      where: {
        id: lessonId,
        ...NOT_DELETED,
        ...buildLessonCourseVisibilityWhere(ctx),
      },
      select: { id: true, videoDurationSeconds: true },
    });

    if (!lesson) {
      throw new NotFoundException('Lesson not found');
    }
    return lesson;
  }
}

/**
 * `LessonProgress.completionSource` values.
 *
 * The column is a Postgres `String`, not an enum (plan §1.4), so nothing at the
 * database layer catches a typo. Naming them once means the two writes and the
 * mapper below cannot disagree about the spelling.
 */
const AUTO_COMPLETION = 'auto';
const MANUAL_COMPLETION = 'manual';

/** The projection {@link ProgressService.listProgressFor} returns per lesson. */
export interface LessonProgressRow {
  readonly lessonId: string;
  readonly furthestPositionSeconds: number;
  readonly completedAt: Date | null;
  readonly completionSource: string | null;
}

/**
 * A stored row (or its absence) as the wire type — the ONE mapper.
 *
 * ⚠️ A MISSING ROW IS THE "NEVER OPENED" SIGNAL, and it maps to position `0`
 * rather than to an error or a `null` progress object. No row is written by a
 * read, so this branch is the normal state for most lessons.
 *
 * ⚠️ `completionSource` IS NARROWED, NOT CAST BLINDLY. The column is a Postgres
 * `String`; a value outside the two this service writes is data corruption, and
 * reporting it as `null` (not complete by any known mechanism) is safer than
 * passing an unknown string to a client that switches on it.
 */
export function toMemberLessonProgress(
  row: {
    furthestPositionSeconds: number;
    completedAt: Date | null;
    completionSource: string | null;
  } | null,
): MemberLessonProgress {
  if (!row) {
    return {
      furthestPositionSeconds: 0,
      completedAt: null,
      completionSource: null,
    };
  }

  const source =
    row.completionSource === AUTO_COMPLETION ||
    row.completionSource === MANUAL_COMPLETION
      ? row.completionSource
      : null;

  return {
    furthestPositionSeconds: row.furthestPositionSeconds,
    completedAt: row.completedAt?.toISOString() ?? null,
    // A row with a source but no timestamp is not complete. Reporting the
    // source alone would render a completed badge with no date behind it.
    completionSource: row.completedAt === null ? null : source,
  };
}
