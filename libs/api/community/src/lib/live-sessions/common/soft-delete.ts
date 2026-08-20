import { ConflictException } from '@nestjs/common';

/**
 * Soft delete for `libs/api/community`'s Phase-4 live-session surface — AD-5.
 *
 * ⚠️ SIBLING FILES — THE THREE MUST CHANGE TOGETHER:
 *   - `libs/api/forum/src/lib/common/soft-delete.ts`
 *   - `libs/api/learning/src/lib/common/soft-delete.ts`
 *
 * This is a deliberate THIRD declaration, not an import (ASSUMPTION-11). Forum's
 * `common/` is not barrel-exported and `forum.module.spec.ts` asserts that
 * surface by exact array equality, with a stated reason: a consumer that can
 * reach `NOT_DELETED` can hand-build a `where` and read past every visibility
 * clause. Importing from there means widening a public barrel and deleting an
 * assertion, for one constant. `libs/api/learning` made the same call one phase
 * earlier and this file follows it. Say so in any PR that touches any of them.
 *
 * ⚠️ ONE CONSTANT, SPREAD AT EVERY READ SITE. Not Prisma middleware — a
 * `$extends` that injected `deletedAt: null` everywhere would WORK, and that is
 * the problem: a reader of `live-feed.service.ts` could not tell whether a query
 * was filtered without opening a different file, and `soft-delete-filter.spec.ts`
 * would have nothing to check. A structural test cannot see an interceptor.
 *
 * 🔴 IN THIS LIB THE FILTER APPLIES TO EXACTLY ONE MODEL: `LiveSession`.
 * `SessionRequest` has NO `deletedAt` column and never gains one — a request is
 * `canceled` or `declined`, which are lifecycle STATES on a row the member and
 * the admin both keep seeing, not a tombstone. Spreading this into a read on
 * `sessionRequest` is a COMPILE ERROR rather than a safety improvement, and
 * `soft-delete-filter.spec.ts` deliberately does not list it.
 */

/**
 * The soft-delete filter. Spread into the `where` of every read of
 * `LiveSession`:
 *
 * ```ts
 * this.prisma.liveSession.findMany({ where: { ...NOT_DELETED, ...visibility } });
 * ```
 *
 * ⚠️ `findUnique` CANNOT CARRY THIS. Its `where` accepts only unique fields and
 * `deletedAt` is not one, so `findUnique({ where: { id, ...NOT_DELETED } })` does
 * not compile — it is the one read shape that can LOOK filtered and not be.
 * `LiveSession` additionally carries `@unique calendar_event_id`, which makes
 * `findUnique({ where: { calendarEventId } })` the tempting way to answer "does a
 * LiveSession claim this event?". It is banned outright by
 * `soft-delete-filter.spec.ts`; use `findFirst`.
 *
 * ⚠️ A LITERAL `{ deletedAt: null }` IS NOT AN ACCEPTABLE SUBSTITUTE, even
 * though it is semantically identical. The spec requires this identifier
 * specifically, so that "which reads are filtered" is one greppable token and a
 * future change to the soft-delete representation has exactly one edit site.
 */
export const NOT_DELETED = { deletedAt: null } as const;

/* -------------------------------------------------------------------------- */
/* R8.5 — the admin restore window                                             */
/* -------------------------------------------------------------------------- */

/**
 * How long a soft-deleted live session stays admin-recoverable — R8.5.
 *
 * ⚠️ R8.5 STATES A FLOOR, NOT A CAP ("admin-recoverable for **at least** 30
 * days"), so 30 is the MINIMUM this implementation may honour and the boundary
 * below is INCLUSIVE — a restore at exactly 30 days still succeeds. The same
 * reading and the same number as forum's and learning's `RESTORE_WINDOW_DAYS`;
 * three surfaces answering different windows for one requirement would be a
 * defect nobody notices until an admin asks why.
 *
 * ⚠️ NOTHING PURGES ANYTHING WHEN THE WINDOW ELAPSES. There is no reaper job and
 * RK-1 licenses none — the row survives, it simply stops being restorable
 * through the API. That is why the refusal below is a `409` and not a `404`.
 */
export const RESTORE_WINDOW_DAYS = 30;

/** {@link RESTORE_WINDOW_DAYS} in milliseconds — derived, never re-typed. */
export const RESTORE_WINDOW_MS = RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * The `where` fragment identifying a RESTORABLE tombstone at `now`.
 *
 * 🔴 THE WINDOW IS A `WHERE` CLAUSE, NOT A CHECK IN JAVASCRIPT, AND THAT IS WHY
 * THIS DIRECTORY TAKES NO AD-5 EXEMPTION.
 *
 * Written the obvious way — read the tombstone, compare `deletedAt` to a cutoff,
 * then update — the comparison and the write see two different snapshots, AND
 * the pre-flight read is an unfiltered read of a soft-deletable model, which
 * would need an `// AD-5-EXEMPT:` marker and a census entry on a WRITE path.
 * Expressed here, Postgres evaluates the window against the committed row in the
 * same statement that performs the restore, so `updateMany().count` IS the
 * answer: `1` means it was restorable and now is restored, `0` means it was not,
 * with no gap in between and no tombstone read anywhere. Forum's D-6.13d
 * established this idiom; learning carried it; this is the third use.
 *
 * `deletedAt: { not: null }` is what makes this reject a LIVE row: restoring
 * something that was never deleted is a request that cannot mean anything, and
 * silently succeeding would write over a live session's state for no reason.
 */
export function restorableWhere(now: Date): {
  deletedAt: { not: null; gte: Date };
} {
  return {
    deletedAt: { not: null, gte: new Date(now.getTime() - RESTORE_WINDOW_MS) },
  };
}

/**
 * The ONE construction site for the "nothing was restored" refusal.
 *
 * ⚠️ IT ENUMERATES THE THREE CAUSES RATHER THAN NAMING ONE, and that is honest
 * rather than lazy. Because the window is enforced inside the `UPDATE`, a
 * `count` of `0` genuinely does not say WHICH of the three held — and the only
 * way to find out would be the unfiltered read this design just removed.
 *
 * `409`, not `404`: the row is still there.
 */
export function assertRestored(count: number): void {
  if (count === 0) {
    throw new ConflictException(
      `Nothing was restored: the item does not exist, is not deleted, or was ` +
        `deleted more than ${RESTORE_WINDOW_DAYS} days ago`,
    );
  }
}
