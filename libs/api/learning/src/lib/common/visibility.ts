import type { Prisma } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import type { Visibility } from '@ptah-contracts/community';

import { NOT_DELETED } from './soft-delete';

/**
 * Course visibility as a `WHERE` clause — R2.1.1, R2.1.2, R2.1.3, AD-10,
 * ASSUMPTION-7.
 *
 * ⚠️ SIBLING FILE: `libs/api/forum/src/lib/common/visibility.ts`
 * (`buildCategoryVisibilityWhere`). This is a deliberate SECOND implementation
 * of the same three-branch rule, NOT a shared one, and the two must change
 * together. Three reasons:
 *   1. Forum's builder returns `Prisma.CategoryWhereInput` — a different
 *      generated type. Sharing would need a generic that no longer reads as a
 *      visibility rule.
 *   2. It lives in forum's `common/`, which `forum.module.spec.ts` asserts is
 *      NOT barrel-exported, with a stated reason: `NOT_DELETED` or a
 *      where-builder leaving that lib would let a consumer hand-build a `where`
 *      and read the forum past every visibility clause. Sharing means widening
 *      that barrel and deleting that assertion.
 *   3. The duplicated thing is ~15 lines of pure branch logic, pinned by its
 *      own spec in each lib.
 *
 * ⚠️ THIS FILE IS WHY AN INVISIBLE OR DRAFT COURSE IS A `404` AND NEVER A `403`.
 *
 * The tempting implementation is to fetch the course, check `published` and
 * visibility, and throw. That works until someone writes `ForbiddenException`
 * because it is more informative, or adds a second read path and forgets the
 * check. Both are one-line mistakes, and a `403` is a membership oracle: it
 * says "this is real, and you may not have it".
 *
 * So the check is not a check. It is part of the query. Every member-side read
 * of a course — and every read of a module or lesson, which joins through one —
 * composes this `where`, and an invisible course simply produces no row. `404`
 * is then the HONEST answer to the query that ran, not a translation a
 * controller has to remember to perform.
 *
 * 🔴 A LOCKED MODULE IS THE OTHER CASE AND IT IS `403`. Do not harmonise them.
 * R2.4.4 says a locked module's title and lesson titles MAY be visible — the
 * member has already been shown that it exists, on purpose, so they can see
 * what is coming. Visible-but-forbidden is exactly what `403` is for, and
 * answering `404` would contradict the course detail the same member just
 * received. The distinction is: THIS FILE decides whether the course exists FOR
 * YOU (404 when not); `ModuleLockService` decides whether a module you can
 * already see is open yet (403 when not).
 */

/*
 * The three vocabulary values, pinned to the shared `Visibility` union.
 *
 * `satisfies Visibility` rather than a bare string literal: if `VISIBILITIES`
 * in `@ptah-contracts/community` ever gains, loses or renames a member, this
 * file stops compiling instead of quietly building a branch that matches no
 * rows. `Course.visibility` is a Postgres `String`, not an enum (plan §1.4), so
 * NOTHING AT THE DATABASE LAYER WOULD CATCH THAT DRIFT.
 */
const MEMBER_VISIBILITY = 'member' satisfies Visibility;
const COHORT_VISIBILITY = 'cohort' satisfies Visibility;
const STAFF_VISIBILITY = 'staff' satisfies Visibility;

/**
 * Every course the given member may see, as a `Prisma.CourseWhereInput`.
 *
 * Produces `published: true` AND an `OR` of AT MOST three branches:
 *
 *  1. `visibility: 'member'` — always present. Every entitled member sees these
 *     (R2.1.1), including one with no cohort assignments at all, which is the
 *     normal state today (`member_group_assignments` holds zero rows) and must
 *     never be an error (R7.8, A-2).
 *
 *  2. `visibility: 'cohort'` AND `cohortKeys hasSome ctx.cohortKeys` — ANY-match
 *     against the `String[]` column (AD-10, not a join table). ⚠️ OMITTED
 *     ENTIRELY when the member holds no cohort keys — see below.
 *
 *  3. `visibility: 'staff'` AND the member is an admin (ASSUMPTION-4/-7).
 *
 * 🔴 `published: true` IS PART OF THIS CLAUSE, NOT A SEPARATE STEP (R2.1.2).
 * A draft course must be invisible by the SAME mechanism that makes an
 * out-of-cohort course invisible, so that both are `404` for the same reason
 * and neither depends on a controller remembering to translate. It applies to
 * ADMINS TOO on the member surface: an admin previewing a draft does so through
 * the ADMIN endpoints, which do not use this builder at all. Two ways to see a
 * draft would be two ways to leak one.
 *
 * ⚠️ WHY THE COHORT BRANCH IS OMITTED RATHER THAN EMITTED AS `hasSome: []`.
 * Postgres's array-overlap operator against an empty array matches nothing, so
 * `hasSome: []` would in fact be correct. It is still wrong to write: the
 * correctness would rest on a subtle property of one operator that a reviewer
 * cannot verify by reading this file, and that a future migration to a
 * different filter shape would silently break. An omitted branch is correct for
 * a reason anyone can see — there is no branch. Same rows, smaller query.
 *
 * ⚠️ ASSUMPTION-4/-7 — `visibility: 'staff'` RESOLVES VISIBLE TO ADMINS ONLY,
 * AND THIS IS THE ONE PLACE IN THIS LIB WHERE `isAdmin` AFFECTS *VISIBILITY*.
 * (It affects who may ACT in two other places — `LessonCommentsService`'s
 * moderation of another member's comment, and `setAnswered` — which is a
 * different kind of grant.) No requirement states who may see a `staff` course,
 * exactly as none did for a `staff` category. The limits that make the grant
 * acceptable are the same three:
 *   - READ ONLY, and only through the member endpoints;
 *   - NO COHORT CONTENT — an admin with no assignments still does not match
 *     branch 2. Being an admin is not being in every cohort;
 *   - it does not weaken the 404 posture for anyone else.
 * If the user wants `staff` courses visible to non-admin staff, that is branch
 * 3 and one assertion in `visibility.spec.ts`, and nothing else.
 *
 * ⚠️ THIS BUILDER DOES NOT CARRY `NOT_DELETED` AT THE TOP LEVEL, ON PURPOSE.
 * The caller spreads it, so `soft-delete-filter.spec.ts` can see it at the call
 * site — the whole value of AD-5 is that the filter is a visible token in the
 * read, not something a helper might or might not have done. (The NESTED
 * builders below DO carry it, because the caller has no way to reach inside
 * them; see their docblocks.)
 */
export function buildCourseVisibilityWhere(
  ctx: MemberContext,
): Prisma.CourseWhereInput {
  const branches: Prisma.CourseWhereInput[] = [
    { visibility: MEMBER_VISIBILITY },
  ];

  if (ctx.cohortKeys.length > 0) {
    branches.push({
      visibility: COHORT_VISIBILITY,
      // Spread to a mutable array: `MemberContext.cohortKeys` is
      // `readonly string[]` and Prisma's `hasSome` takes `string[]`. Aliasing
      // the request-scoped context into a query object would let a downstream
      // mutation of the query alter the member's own visibility context.
      cohortKeys: { hasSome: [...ctx.cohortKeys] },
    });
  }

  if (ctx.isAdmin) {
    branches.push({ visibility: STAFF_VISIBILITY });
  }

  return { published: true, OR: branches };
}

/**
 * The same rule, expressed as a filter on a module's PARENT course — for reads
 * that start at `CourseModule`.
 *
 * ⚠️ USE THIS RATHER THAN CHECKING THE COURSE SEPARATELY. A module read that
 * filters the module alone and then verifies its course in a second query has a
 * window where the two disagree, and — worse — it has ALREADY DECIDED THE
 * MODULE EXISTS by the time it checks. Nesting the course filter into the
 * module's own `where` keeps "invisible" and "not found" the same event, which
 * is the property this whole file is built around. Batch 6A added
 * `buildTopicCategoryVisibilityWhere` for exactly this reason.
 *
 * ⚠️ THE NESTED COURSE CARRIES `NOT_DELETED` HERE, unlike the top-level clause.
 * The caller cannot reach inside this object to add it, and a module whose
 * course has been soft-deleted must not be readable — an admin who deleted a
 * course would otherwise find its modules still serving.
 */
export function buildModuleCourseVisibilityWhere(
  ctx: MemberContext,
): Prisma.CourseModuleWhereInput {
  return { course: { ...NOT_DELETED, ...buildCourseVisibilityWhere(ctx) } };
}

/**
 * The same rule, two levels up — for reads that start at `Lesson`.
 *
 * Both intermediate levels are filtered: a lesson whose MODULE is soft-deleted
 * is as unreachable as one whose COURSE is. Without this, the natural member
 * lesson read filters the lesson, then joins upward for a breadcrumb, and
 * happily serves a lesson out of a deleted module.
 */
export function buildLessonCourseVisibilityWhere(
  ctx: MemberContext,
): Prisma.LessonWhereInput {
  return {
    module: {
      ...NOT_DELETED,
      course: { ...NOT_DELETED, ...buildCourseVisibilityWhere(ctx) },
    },
  };
}
