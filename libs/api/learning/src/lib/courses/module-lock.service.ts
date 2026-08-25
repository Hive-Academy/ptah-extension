import { Injectable } from '@nestjs/common';
import type { LockReason } from '@ptah-contracts/community';

/**
 * ModuleLockService — R2.4.1 – R2.4.5, §8.2 P3 exit-gate clause 1.
 *
 * 🔴 EXIT-GATE CLAUSE 1: "A LOCKED MODULE RETURNS `403` FROM THE API, NOT A CSS
 * STATE." R2.4.5 requires the lock to be evaluated SERVER-SIDE on every lesson
 * read. A module hidden only by a padlock icon is a defect: the lesson body,
 * the video id and the comments are all still in the response, and the member
 * has to open dev tools rather than a course to reach them. This service is
 * where the decision lives; 9C's controller is where the `403` is produced; and
 * Task 9.17 is where it is proved live with `V-CURL`.
 *
 * 🔴 403 vs 404 — THE DISTINCTION, STATED SO NOBODY "HARMONISES" IT LATER.
 *
 * The forum's rule is *invisible ⇒ 404, never 403*, because a `403` confirms
 * existence (R1.1.3) and that is a membership oracle. THAT RULE STILL HOLDS
 * HERE, in `common/visibility.ts`: a draft course (R2.1.2) or one whose
 * cohort/visibility gate excludes the caller produces no row, so `404` is the
 * honest answer to the query that ran.
 *
 * A LOCKED MODULE IS A DIFFERENT CASE AND IT IS `403`. R2.4.4 says the member
 * MAY see the module title and its lesson titles — the existence is disclosed
 * DELIBERATELY, so they can see what is coming — and the course detail response
 * they just received contains that module. Answering `404` for a lesson inside
 * it would contradict the outline on the screen that issued the request.
 * Visible-but-forbidden is precisely what `403` is for.
 *
 * The two rules are consistent and they are about different questions:
 *   - "does this course exist FOR YOU?"  -> `common/visibility.ts`, 404 when no;
 *   - "is a module you can already see open yet?" -> here, 403 when no.
 *
 * ⚠️ THE `403` BODY CARRIES THE MACHINE `reason` AND `unlocksAt`, NEVER A
 * SENTENCE. `LOCK_REASONS` in `@ptah-contracts/community` is the shared
 * vocabulary and the UI matches on the value; Batch 6C's `{ reason:
 * 'topic_locked' }` is the precedent and its carried item 5 says exactly this.
 * A copy edit to a server message must never change which screen a member sees.
 *
 * 🔴 IT IS A PURE FUNCTION OVER DATA ALREADY FETCHED, NOT A SERVICE THAT
 * QUERIES. That is what lets `CourseReadService` evaluate EVERY module in a
 * course inside its query budget — a service that fetched the preceding
 * module's lessons itself would be an N+1 with a `@Injectable()` on it — and it
 * is what makes this spec a table of cases rather than a mock ceremony. It
 * injects nothing and touches no clock: `now` is a parameter, so "the module
 * unlocks at midnight" is a testable fact rather than a flaky one.
 */
@Injectable()
export class ModuleLockService {
  /**
   * Is this module locked for this member, at this instant?
   *
   * TWO RULES, AND ONLY TWO:
   *
   *  1. **R2.4.1 — date.** `releaseAt` in the future ⇒ locked,
   *     `reason: 'not_released'`, `unlocksAt: releaseAt`.
   *
   *  2. **R2.4.2 — sequential.** `course.sequential === true` AND the
   *     PRECEDING module in `DETERMINISTIC_ORDER_BY` has at least one lesson
   *     the member has not completed ⇒ locked,
   *     `reason: 'previous_module_incomplete'`, `unlocksAt: null`.
   *
   * **R2.4.3: when `sequential === false`, ONLY the date rule applies.** The
   * seeded curriculum course is `sequential: false` (§7.3), so the sequential
   * branch has NO LIVE DATA BEHIND IT in this workspace — which is exactly why
   * its spec cases matter more, not less.
   *
   * ⚠️ PRECEDENCE WHEN BOTH WOULD FIRE: DATE FIRST. `unlocksAt` is a fact the
   * UI can render ("opens Tuesday"); "finish the previous module" is not
   * actionable on a module that has not been released, and telling a member to
   * do work that would not open it anyway is worse than saying nothing.
   *
   * ⚠️ `releaseAt === now` IS **UNLOCKED**. The boundary is closed on the open
   * side, matching the forum's `EDIT_WINDOW_MS` convention (at the boundary the
   * window is closed — the event has happened). A strict future comparison is
   * also the only reading under which "released at 09:00" is true at 09:00
   * rather than at 09:00.001.
   *
   * ⚠️ THE FIRST MODULE OF A COURSE IS NEVER LOCKED BY THE SEQUENTIAL RULE.
   * There is no preceding module. An off-by-one here locks the entire
   * curriculum for every member, on every course, with no error anywhere — the
   * single most expensive mistake available in this file, and it has its own
   * spec case.
   *
   * ⚠️ AN EMPTY PRECEDING MODULE (ZERO LESSONS) DOES NOT LOCK THE NEXT ONE.
   * "Every lesson in the preceding module is complete" is VACUOUSLY TRUE of a
   * module with no lessons. The alternative is a course an admin can
   * permanently brick by adding an empty module — an unfinishable prerequisite
   * with nothing in it to finish.
   *
   * ⚠️ ONLY THE IMMEDIATELY PRECEDING MODULE IS CONSULTED, NOT EVERY EARLIER
   * ONE. R2.4.2's words are "the preceding module", and the transitive reading
   * is unnecessary in the ordinary case: a member cannot complete module 2
   * while it is locked by module 1, so module 3 stays shut by induction. The
   * one case where the two differ is a member who MANUALLY completed module 2's
   * lessons (R2.3.3 is available regardless of position) while module 1 was
   * still open and unfinished — and unlocking module 3 for them is the reading
   * that matches what the requirement says. Stated so the difference is a
   * decision rather than an oversight.
   */
  evaluate(
    module: LockModule,
    course: LockCourse,
    completedLessonIds: ReadonlySet<string>,
    now: Date,
  ): LockVerdict {
    // Rule 1 — the date. Checked first, deliberately; see the docblock.
    if (
      module.releaseAt !== null &&
      module.releaseAt.getTime() > now.getTime()
    ) {
      return {
        locked: true,
        reason: NOT_RELEASED,
        unlocksAt: module.releaseAt,
      };
    }

    if (!course.sequential) return UNLOCKED;

    const predecessor = precedingModule(module, course);
    // No predecessor: this is the first module. Never sequential-locked.
    if (!predecessor) return UNLOCKED;

    const predecessorComplete = predecessor.lessonIds.every((lessonId) =>
      completedLessonIds.has(lessonId),
    );
    // `Array.prototype.every` on an empty array is `true`, which IS the
    // empty-predecessor rule above — stated in the docblock because it is a
    // deliberate behaviour resting on a language detail rather than on a
    // visible branch.
    if (predecessorComplete) return UNLOCKED;

    return {
      locked: true,
      reason: PREVIOUS_MODULE_INCOMPLETE,
      unlocksAt: null,
    };
  }
}

/**
 * The module immediately before this one, in the order the course was fetched.
 *
 * ⚠️ IT TRUSTS `course.modules` TO BE IN `DETERMINISTIC_ORDER_BY` ORDER RATHER
 * THAN RE-SORTING. Re-sorting here would need `sortOrder`, `createdAt` and `id`
 * on every module and would be a SECOND declaration of the tie-break tuple —
 * which `common/sort-order.ts` exists to prevent. The caller fetches with
 * `orderBy: DETERMINISTIC_ORDER_BY`; this function's contract is that it was
 * given that list.
 *
 * ⚠️ A MODULE NOT IN ITS OWN COURSE'S LIST THROWS. Returning "no predecessor"
 * would silently unlock it, which is the failure direction that leaks content;
 * returning "locked" would silently hide a module for a reason nobody can see.
 * A programming error should look like one.
 */
function precedingModule(
  module: LockModule,
  course: LockCourse,
): LockModule | null {
  const index = course.modules.findIndex((m) => m.id === module.id);
  if (index === -1) {
    throw new Error(
      `ModuleLockService.evaluate was given module "${module.id}", which is ` +
        `not in the supplied course module list. The lock verdict depends on ` +
        `the module's POSITION among its siblings, so it cannot be evaluated ` +
        `against a course tree the module does not belong to.`,
    );
  }
  return index === 0 ? null : (course.modules[index - 1] ?? null);
}

const NOT_RELEASED = 'not_released' satisfies LockReason;
const PREVIOUS_MODULE_INCOMPLETE =
  'previous_module_incomplete' satisfies LockReason;

/**
 * The verdict shared by three places: the `403` body on the lesson route, the
 * three lock fields on `MemberModuleSummary`, and the hub's
 * `ContinueLearning.locked`.
 */
export interface LockVerdict {
  readonly locked: boolean;
  /** `null` exactly when {@link locked} is `false`. */
  readonly reason: LockReason | null;
  /**
   * `null` for `'previous_module_incomplete'` — that rule unlocks on an ACTION,
   * not on a clock, and inventing a timestamp for it would render as a
   * countdown to a moment that means nothing.
   */
  readonly unlocksAt: Date | null;
}

/**
 * The frozen "not locked" verdict.
 *
 * ⚠️ FROZEN, AND RETURNED BY REFERENCE. Three fields with fixed values; freezing
 * makes an accidental mutation by a mapper (`verdict.locked = true`) a loud
 * failure in strict mode rather than a lock that appears on every module in the
 * course at once.
 */
const UNLOCKED: LockVerdict = Object.freeze({
  locked: false,
  reason: null,
  unlocksAt: null,
});

/** The module fields the lock rules read — nothing else is needed or accepted. */
export interface LockModule {
  readonly id: string;
  /** R2.4.1. `null` = no scheduled release; a past value is inert. */
  readonly releaseAt: Date | null;
  /**
   * Every LIVE lesson in the module (AD-5 — tombstones excluded by the caller's
   * `where`).
   *
   * ⚠️ A DELETED LESSON MUST NOT REACH THIS LIST. It can never be completed, so
   * it would make the module permanently incomplete and lock the next one
   * forever — the silent-brick failure the empty-module rule also guards
   * against, arriving by a different route.
   */
  readonly lessonIds: readonly string[];
}

/** The course fields the lock rules read. */
export interface LockCourse {
  /** R2.4.2. When `false`, only the date rule applies (R2.4.3). */
  readonly sequential: boolean;
  /** Every live module, in `DETERMINISTIC_ORDER_BY` order. */
  readonly modules: readonly LockModule[];
}
