import { ConflictException } from '@nestjs/common';

/**
 * Soft delete for `libs/api/learning` — AD-5, resolving OQ-5 in favour of
 * option (a).
 *
 * ⚠️ SIBLING FILE: `libs/api/forum/src/lib/common/soft-delete.ts`. This is a
 * deliberate SECOND declaration, not an import. Forum's `common/` is not
 * barrel-exported and `forum.module.spec.ts` asserts that by exact array
 * equality, with a stated reason: a consumer that can reach `NOT_DELETED` can
 * hand-build a `where` and read the forum past every visibility clause.
 * Importing from there means widening that barrel and deleting that assertion,
 * for one constant. The two must change together — say so in any PR that
 * touches either.
 *
 * ⚠️ ONE CONSTANT, SPREAD AT EVERY READ SITE. Not Prisma middleware.
 *
 * WHY NOT MIDDLEWARE (OQ-5 option b). A `$extends`/middleware that injects
 * `deletedAt: null` into every query WORKS — that is exactly the problem:
 *
 *   - a reader of `course-read.service.ts` cannot tell whether a query is
 *     filtered without going to read a different file;
 *   - an admin read that legitimately wants tombstones has to fight the
 *     middleware with a bypass flag, and a bypass flag is the thing that gets
 *     copied into a member read by autocomplete;
 *   - and `soft-delete-filter.spec.ts` would have nothing to check. A
 *     structural test cannot see an interceptor. The whole point of AD-5 is
 *     that the filter is a token in the source that a parser can find.
 *
 * The cost is that it must be written every time. That cost is paid by the
 * structural spec, which fails the build when it is not.
 *
 * ⚠️ THIS APPLIES TO `Course`, `CourseModule`, `Lesson` AND `LessonComment`
 * ONLY — the four models with a `deletedAt` column (plan §1.4).
 * `LessonProgress` has none: it is removed by cascade with the user or the
 * lesson, never softly, and spreading this into a read on it is a COMPILE
 * ERROR rather than a safety improvement.
 */

/**
 * The soft-delete filter. Spread into the `where` of every read of `Course`,
 * `CourseModule`, `Lesson` or `LessonComment`:
 *
 * ```ts
 * this.prisma.lesson.findMany({ where: { ...NOT_DELETED, moduleId } });
 * ```
 *
 * ⚠️ `findUnique` CANNOT CARRY THIS, AND THAT MATTERS MORE HERE THAN IT DID IN
 * THE FORUM. Its `where` accepts only unique fields, and `deletedAt` is not one,
 * so `findUnique({ where: { id, ...NOT_DELETED } })` does not compile. This
 * lib's models carry NATURAL COMPOSITE UNIQUES — `@@unique([moduleId, slug])`,
 * `@@unique([courseId, slug])` — and every member route addresses a lesson by
 * exactly that pair, which makes `findUnique` look like the obvious lookup.
 * It is banned outright by `soft-delete-filter.spec.ts`. Use
 * `findFirst({ where: { …, ...NOT_DELETED } })`.
 *
 * ⚠️ A LITERAL `{ deletedAt: null }` IS NOT AN ACCEPTABLE SUBSTITUTE, even
 * though it is semantically identical. The spec requires this identifier
 * specifically, so that "which reads are filtered" is one greppable token and a
 * future change to the soft-delete representation has exactly one edit site.
 *
 * ⚠️ AND IT BELONGS INSIDE NESTED `include`s TOO. `_count: { select: { lessons:
 * true } }` counts tombstones, which inflates `totalLessons`, which deflates
 * every course percentage in the product — silently, consistently, and
 * invisibly to any call-expression scan. `RULE-NESTED` exists for that read.
 */
export const NOT_DELETED = { deletedAt: null } as const;

/* -------------------------------------------------------------------------- */
/* R8.5 — the admin restore window                                             */
/* -------------------------------------------------------------------------- */

/**
 * How long a soft-deleted course, module or lesson stays admin-recoverable —
 * R8.5.
 *
 * ⚠️ R8.5 STATES A FLOOR, NOT A CAP ("admin-recoverable for **at least** 30
 * days"), so 30 is the MINIMUM this implementation may honour and the boundary
 * below is INCLUSIVE — a restore at exactly 30 days still succeeds. At 29.999
 * days a strict comparison would already be in breach of the words "at least
 * 30". The same reading and the same number as forum's `RESTORE_WINDOW_DAYS`;
 * two surfaces answering different windows for one requirement would be a
 * defect nobody notices until an admin asks why.
 *
 * ⚠️ NOTHING PURGES ANYTHING WHEN THE WINDOW ELAPSES. There is no reaper job
 * and RK-1 licenses none — the row survives, it simply stops being restorable
 * through the API. That is why the refusal below is a `409` and not a `404`.
 */
export const RESTORE_WINDOW_DAYS = 30;

/** {@link RESTORE_WINDOW_DAYS} in milliseconds — derived, never re-typed. */
export const RESTORE_WINDOW_MS = RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * The `where` fragment identifying a RESTORABLE tombstone at `now`.
 *
 * 🔴 THE WINDOW IS A `WHERE` CLAUSE, NOT A CHECK IN JAVASCRIPT, AND THAT IS THE
 * WHOLE DESIGN — AND IT IS ALSO WHY THIS LIB TAKES NO AD-5 EXEMPTION.
 *
 * Written the obvious way — read the tombstone, compare `deletedAt` to a
 * cutoff, then update — the comparison and the write see two different
 * snapshots, AND the pre-flight read is an unfiltered read of a soft-deletable
 * model, which would need an `// AD-5-EXEMPT:` marker and an
 * `EXPECTED_EXEMPTIONS` entry on a WRITE path. Expressed here, Postgres
 * evaluates the window against the committed row in the same statement that
 * performs the restore, so `updateMany().count` IS the answer: `1` means it was
 * restorable and now is restored, `0` means it was not, with no gap in between
 * and no tombstone read anywhere. Forum's D-6.13d established this; the
 * structural spec in this lib carries it as a legal probe.
 *
 * `deletedAt: { not: null }` is what makes this reject a LIVE row: restoring
 * something that was never deleted is a request that cannot mean anything, and
 * silently succeeding would write `deletedBy: null` over nothing.
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
