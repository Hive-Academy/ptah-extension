import type { Prisma } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import type { Visibility } from '@ptah-contracts/community';

/**
 * Category visibility as a `WHERE` clause — R1.1.1, R1.1.2, R1.1.3, AD-10.
 *
 * ⚠️ THIS FILE IS WHY AN INVISIBLE CATEGORY IS A `404` AND NEVER A `403`.
 *
 * R1.1.3 requires that a member who cannot see a category cannot learn it
 * exists. `403` violates that: it says "this is real, and you may not have it",
 * which is a membership oracle — an attacker enumerates category ids and reads
 * the difference between 403 and 404.
 *
 * The tempting implementation is to fetch the category, check visibility, and
 * `throw new NotFoundException()` on failure. That works until the day someone
 * writes `throw new ForbiddenException()` because it is more informative, or
 * adds a second read path and forgets the check. Both are one-line mistakes.
 *
 * So the check is not a check. It is part of the query. Every member-side read
 * of a category — and every read of a topic, which joins through one — spreads
 * this `where`, and an invisible category simply produces no row. `404` is then
 * the HONEST answer to the query that ran, not a translation a controller has
 * to remember to perform. There is no code path that could return `403`,
 * because nothing anywhere ever learns that the row existed.
 *
 * The same property gives R1.1.2 for free: `total` on a paged response counts
 * the same filtered set, so a member never sees a count that includes rows they
 * cannot read.
 */

/*
 * The three vocabulary values, pinned to the shared `Visibility` union.
 *
 * `satisfies Visibility` rather than a bare string literal: if `VISIBILITIES`
 * in `@ptah-contracts/community` ever gains, loses or renames a member, this
 * file stops compiling instead of quietly building a branch that matches no
 * rows. The column is a Postgres `String`, not an enum (§1.3), so nothing at
 * the database layer would catch the drift.
 */
const MEMBER_VISIBILITY = 'member' satisfies Visibility;
const COHORT_VISIBILITY = 'cohort' satisfies Visibility;
const STAFF_VISIBILITY = 'staff' satisfies Visibility;

/**
 * Every category the given member may see, as a `Prisma.CategoryWhereInput`.
 *
 * Produces an `OR` of AT MOST three branches:
 *
 *  1. `visibility: 'member'` — always present. Every entitled member sees these
 *     (R1.1.1), including one with no cohort assignments at all, which is the
 *     normal state today (`member_group_assignments` holds zero rows) and must
 *     never be an error (R7.8, A-2).
 *
 *  2. `visibility: 'cohort'` AND `cohortKeys hasSome ctx.cohortKeys` — ANY-match
 *     against the `String[]` column (AD-10, not a join table). ⚠️ OMITTED
 *     ENTIRELY when the member holds no cohort keys — see below.
 *
 *  3. `visibility: 'staff'` AND the member is an admin (ASSUMPTION-4) — see
 *     below.
 *
 * ⚠️ WHY THE COHORT BRANCH IS OMITTED RATHER THAN EMITTED AS `hasSome: []`.
 * Postgres's array-overlap operator against an empty array matches nothing, so
 * `hasSome: []` would in fact be correct. It is still wrong to write: the
 * correctness would rest on a subtle property of one operator that a reviewer
 * cannot verify by reading this file, and that a future migration to a
 * different filter shape would silently break. An omitted branch is correct for
 * a reason anyone can see — there is no branch. The result is the same rows and
 * a smaller query.
 *
 * ⚠️ ASSUMPTION-4 — `visibility: 'staff'` RESOLVES VISIBLE TO ADMINS ONLY, AND
 * THIS IS THE ONE PLACE IN THIS LIB WHERE `isAdmin` ENTERS A MEMBER-SIDE
 * DECISION.
 *
 * R1.1.1 defines the three values and R1.1.3 fixes the 404 posture, but no
 * requirement states who may see `staff`. "Admin only" is the reading the word
 * carries, and it is what the MG-1.4 content mapping assumes when it sends
 * Discourse's `Staff` category here.
 *
 * The limits of that grant, which are the reason it is acceptable:
 *   - It grants READ ONLY, and only through the member endpoints. Moderation —
 *     every write, every tombstone, every restore — stays behind `AdminGuard`
 *     on `v1/admin/community/*`. Nothing here is a write authorisation.
 *   - It grants NO COHORT CONTENT. An admin with no cohort assignments still
 *     does not match branch 2. Being an admin is not being in every cohort.
 *   - It does not weaken the 404 posture for anyone else. A non-admin entitled
 *     member matches no branch for a `staff` category, so the row is not found,
 *     so the answer is `404` by the same mechanism as every other invisible
 *     category — nothing special-cases it.
 *
 * `visibility.spec.ts` asserts that last point directly: an entitled non-admin
 * does NOT see a `staff` category. If ASSUMPTION-4 is overruled, the change is
 * branch 3 and that assertion, and nothing else.
 */
export function buildCategoryVisibilityWhere(
  ctx: MemberContext,
): Prisma.CategoryWhereInput {
  const branches: Prisma.CategoryWhereInput[] = [
    { visibility: MEMBER_VISIBILITY },
  ];

  if (ctx.cohortKeys.length > 0) {
    branches.push({
      visibility: COHORT_VISIBILITY,
      // Spread to a mutable array: `MemberContext.cohortKeys` is
      // `readonly string[]` and Prisma's `hasSome` takes `string[]`.
      cohortKeys: { hasSome: [...ctx.cohortKeys] },
    });
  }

  if (ctx.isAdmin) {
    branches.push({ visibility: STAFF_VISIBILITY });
  }

  return { OR: branches };
}

/**
 * The same rule, expressed as a filter on a topic's PARENT category — for reads
 * that start at `Topic` rather than at `Category`.
 *
 * ⚠️ USE THIS RATHER THAN CHECKING THE CATEGORY SEPARATELY. A topic read that
 * filters on the topic alone and then verifies its category in a second query
 * has a window where the two disagree, and — worse — it has already decided the
 * topic exists by the time it checks. Nesting the category filter into the
 * topic's own `where` keeps "invisible" and "not found" the same event, which
 * is the property the whole file is built around.
 */
export function buildTopicCategoryVisibilityWhere(
  ctx: MemberContext,
): Prisma.TopicWhereInput {
  return { category: buildCategoryVisibilityWhere(ctx) };
}
