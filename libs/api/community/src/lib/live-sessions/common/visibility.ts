import type { Prisma } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import type { Visibility } from '@ptah-contracts/community';

/**
 * Live-session visibility as a `WHERE` clause — R3.1, AD-10, ASSUMPTION-12,
 * ASSUMPTION-13.
 *
 * ⚠️ SIBLING FILES — THE THREE MUST CHANGE TOGETHER:
 *   - `libs/api/forum/src/lib/common/visibility.ts` (`buildCategoryVisibilityWhere`)
 *   - `libs/api/learning/src/lib/common/visibility.ts` (`buildCourseVisibilityWhere`)
 *
 * A deliberate THIRD implementation of the same three-branch rule, not a shared
 * one (ASSUMPTION-11). Each returns a DIFFERENT generated Prisma type
 * (`CategoryWhereInput` / `CourseWhereInput` / `LiveSessionWhereInput`), so
 * sharing would need a generic that no longer reads as a visibility rule; and
 * both existing copies live in a `common/` their own module spec asserts is NOT
 * barrel-exported, because a consumer that can reach a where-builder can
 * hand-build a `where` and read past every visibility clause.
 *
 * ⚠️ THIS FILE IS WHY AN INVISIBLE LIVE SESSION IS ABSENT FROM THE FEED RATHER
 * THAN A `403`. The check is not a check — it is part of the query. Every
 * member-side read of a live session composes this `where`, and an invisible
 * session simply produces no row. There is no code path that could answer "this
 * exists and you may not have it", which is what a membership oracle looks like.
 *
 * 🔴 NO `published` CLAUSE — AND THAT IS A DECISION, NOT AN OMISSION
 * (ASSUMPTION-13). Unlike `Course`, `LiveSession` has NO `published` column
 * (plan §1.5), so there is no draft posture: a session is visible the moment it
 * is created, to whom `visibility` says. Inventing the clause here would be a
 * schema decision made in a where-builder — it would not even compile against
 * `LiveSessionWhereInput`. If a draft posture is wanted it is one column and one
 * clause, and it must be said before B13 renders the admin surface.
 */

/*
 * The three vocabulary values, pinned to the shared `Visibility` union.
 *
 * `satisfies Visibility` rather than a bare string literal: if `VISIBILITIES` in
 * `@ptah-contracts/community` ever gains, loses or renames a member, this file
 * stops compiling instead of quietly building a branch that matches no rows.
 * `LiveSession.visibility` is a Postgres `String`, not an enum (plan §1.5), so
 * NOTHING AT THE DATABASE LAYER WOULD CATCH THAT DRIFT.
 */
const MEMBER_VISIBILITY = 'member' satisfies Visibility;
const COHORT_VISIBILITY = 'cohort' satisfies Visibility;
const STAFF_VISIBILITY = 'staff' satisfies Visibility;

/**
 * Every live session the given member may see, as a
 * `Prisma.LiveSessionWhereInput`.
 *
 * Produces an `OR` of AT MOST three branches:
 *
 *  1. `visibility: 'member'` — always present. Every entitled member sees these,
 *     including one with no cohort assignments at all, which is the normal state
 *     today (`member_group_assignments` holds zero rows) and must never be an
 *     error (R7.8, A-2).
 *
 *  2. `visibility: 'cohort'` AND `cohortKeys hasSome ctx.cohortKeys` — ANY-match
 *     against the `String[]` column (AD-10, not a join table). ⚠️ OMITTED
 *     ENTIRELY when the member holds no cohort keys — see below.
 *
 *  3. `visibility: 'staff'` AND the member is an admin (ASSUMPTION-12).
 *
 * ⚠️ WHY THE COHORT BRANCH IS OMITTED RATHER THAN EMITTED AS `hasSome: []`.
 * Postgres's array-overlap operator against an empty array matches nothing, so
 * `hasSome: []` would in fact be correct. It is still wrong to write: the
 * correctness would rest on a subtle property of one operator that a reviewer
 * cannot verify by reading this file, and that a future migration to a different
 * filter shape would silently break. An omitted branch is correct for a reason
 * anyone can see — there is no branch. Same rows, smaller query.
 *
 * ⚠️ ASSUMPTION-12 — `visibility: 'staff'` RESOLVES VISIBLE TO ADMINS ONLY, and
 * this is the ONLY place in this directory where `isAdmin` affects VISIBILITY.
 * No requirement states who may see a `staff` live session, exactly as none did
 * for a `staff` category or a `staff` course. The limits that make the grant
 * acceptable are the same three:
 *   - READ ONLY, and only through the member endpoints;
 *   - NO COHORT CONTENT — an admin with no assignments still does not match
 *     branch 2. Being an admin is not being in every cohort;
 *   - it does not weaken the "absent, never 403" posture for anyone else.
 * Making `staff` sessions visible to non-admin staff is branch 3 and one
 * assertion in `visibility.spec.ts`, and nothing else.
 *
 * ⚠️ THIS BUILDER DOES NOT CARRY `NOT_DELETED`, ON PURPOSE. The caller spreads
 * it, so `soft-delete-filter.spec.ts` can see it AT THE CALL SITE — the whole
 * value of AD-5 is that the filter is a visible token in the read, not something
 * a helper might or might not have done.
 */
export function buildLiveSessionVisibilityWhere(
  ctx: MemberContext,
): Prisma.LiveSessionWhereInput {
  const branches: Prisma.LiveSessionWhereInput[] = [
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

  return { OR: branches };
}
