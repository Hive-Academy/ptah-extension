import { ConflictException } from '@nestjs/common';

/**
 * Soft delete — AD-5, resolving OQ-5 in favour of option (a).
 *
 * ⚠️ ONE CONSTANT, SPREAD AT EVERY MEMBER READ SITE. Not Prisma middleware.
 *
 * WHY NOT MIDDLEWARE (OQ-5 option b). A `$extends`/middleware that injects
 * `deletedAt: null` into every query WORKS — that is exactly the problem. It
 * makes the filter invisible at the call site, so:
 *
 *   - a reader of `posts.service.ts` cannot tell whether a query is filtered
 *     without going to read a different file;
 *   - the admin moderation read that legitimately WANTS tombstones has to fight
 *     the middleware with a bypass flag, and a bypass flag is the thing that
 *     gets copied into a member read by autocomplete;
 *   - and `soft-delete-filter.spec.ts` would have nothing to check. A
 *     structural test cannot see an interceptor. The whole point of AD-5 is
 *     that the filter is a token in the source that a parser can find.
 *
 * The cost is that it must be written every time. That cost is paid by the
 * structural spec, which fails the build when it is not.
 *
 * ⚠️ THIS APPLIES TO `Topic` AND `Post` ONLY. They are the only two models with
 * a `deletedAt` column. `Category`, `PostReaction` and `TopicReadState` are
 * hard-deleted (or cascade), and spreading this into a read on one of them is a
 * compile error, not a safety improvement.
 */

/**
 * The soft-delete filter. Spread into the `where` of every MEMBER-facing read
 * of `Topic` or `Post`:
 *
 * ```ts
 * this.prisma.topic.findMany({ where: { ...NOT_DELETED, categoryId } });
 * ```
 *
 * ⚠️ `findUnique` CANNOT CARRY THIS. Its `where` accepts only unique fields, and
 * `deletedAt` is not one — `findUnique({ where: { id, ...NOT_DELETED } })` does
 * not compile. Use `findFirst({ where: { id, ...NOT_DELETED } })` instead. The
 * structural spec rejects `findUnique` on a soft-deletable model for exactly
 * this reason: it is the one read shape that can look filtered and not be.
 *
 * ⚠️ A LITERAL `{ deletedAt: null }` IS NOT AN ACCEPTABLE SUBSTITUTE, even
 * though it is semantically identical. The spec requires this identifier
 * specifically, so that "which reads are filtered" is one greppable token and
 * a future change to the soft-delete representation has exactly one edit site.
 */
export const NOT_DELETED = { deletedAt: null } as const;

/**
 * The inverse, for the ADMIN moderation read that takes `?includeDeleted`
 * (plan §3.3) — the one read in this lib that is *supposed* to see tombstones.
 *
 * Returns `NOT_DELETED` when the caller did not ask for deleted rows, and an
 * empty filter when they did. Written as a function rather than a bare
 * conditional at the call site so the admin read still names a soft-delete
 * decision explicitly, instead of silently omitting one.
 *
 * ⚠️ ADMIN PATHS ONLY. Reaching for this in a member read would satisfy the
 * structural spec's token search while defeating its purpose, so the spec does
 * NOT accept it as a filter: an admin read using it still needs its
 * `// AD-5-EXEMPT:` comment, which is what puts the decision in front of a
 * reviewer.
 */
export function deletedFilter(includeDeleted: boolean): {
  deletedAt?: null;
} {
  return includeDeleted ? {} : { ...NOT_DELETED };
}

/* -------------------------------------------------------------------------- */
/* R8.5 — the admin restore window                                             */
/* -------------------------------------------------------------------------- */

/**
 * How long a soft-deleted topic or post stays admin-recoverable — R8.5.
 *
 * ⚠️ R8.5 STATES A FLOOR, NOT A CAP: "soft-deleted (admin-recoverable for **at
 * least** 30 days)". 30 is therefore the MINIMUM this implementation may
 * honour, and the boundary below is INCLUSIVE so a restore at exactly 30 days
 * still succeeds — at 29.999 days a strict comparison would already be in
 * breach of the words "at least 30".
 *
 * ⚠️ IT IS A CONSTANT HERE, NOT A LITERAL IN A CONTROLLER (Task 6.13). Two
 * routes enforce it (`POST topics/:id/restore`, `POST posts/:id/restore`) and
 * they must never drift; and if the window is ever wrong, it is one number in
 * one file to change rather than a grep for `30`.
 *
 * ⚠️ NOTHING PURGES ANYTHING WHEN THE WINDOW ELAPSES. There is no reaper job
 * and RK-1 does not license one — the row survives, it simply stops being
 * restorable through the API. That distinction matters for a support request
 * ("it is still in the database") and it is why the refusal below is a `409`
 * rather than a `404`: the tombstone genuinely exists and the admin can already
 * see it through `?includeDeleted`, so pretending otherwise would be theatre.
 */
export const RESTORE_WINDOW_DAYS = 30;

/** {@link RESTORE_WINDOW_DAYS} in milliseconds — derived, never re-typed. */
export const RESTORE_WINDOW_MS = RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * The `where` fragment that identifies a RESTORABLE tombstone at `now`.
 *
 * ⚠️ THE WINDOW IS A `WHERE` CLAUSE, NOT A CHECK IN JAVASCRIPT, AND THAT IS THE
 * WHOLE DESIGN. Written as "read the row, compare `deletedAt` to a cutoff, then
 * update", the comparison and the write see two different instants and two
 * different snapshots — a second admin restoring concurrently, or a purge
 * landing between them, both slip through. Expressed here, POSTGRES evaluates
 * the window against the committed row in the same statement that performs the
 * restore, so `updateMany().count` IS the answer: `1` means it was restorable
 * and is now restored, `0` means it was not, with no gap in between.
 *
 * ⚠️ IT ALSO REMOVES THE NEED FOR AN UNFILTERED READ, which is not a
 * side-benefit. A pre-flight `findFirst({ where: { id } })` on a tombstone is a
 * read that returns soft-deleted rows, so it would need an `// AD-5-EXEMPT:`
 * marker and an `EXPECTED_EXEMPTIONS` entry — on a WRITE path, which is
 * precisely where that census says an exemption should be refused in review.
 * Restore takes none.
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
 * The ONE construction site for the "nothing was restored" refusal — shared by
 * `TopicsService.restore` and `PostsService.restore`.
 *
 * Shared for the same reason `assertTopicNotLocked` is: one documented error
 * must have one response body, or the admin panel has to recognise two
 * sentences for one rule.
 *
 * ⚠️ IT ENUMERATES THE THREE CAUSES RATHER THAN NAMING ONE, and that is honest
 * rather than lazy. Because the window is enforced inside the `UPDATE`, a
 * `count` of `0` genuinely does not say WHICH of the three held — and the only
 * way to find out would be the unfiltered read this design just removed. An
 * admin reaches this route from a moderation table that already shows the
 * tombstone, so in practice the third cause is the one that fires; saying so
 * without claiming to have checked is the accurate thing to print.
 *
 * `409`, not `404`: the row is still there and the admin can still see it
 * through `?includeDeleted`. Answering "not found" about something visible on
 * the screen that issued the request would be a lie.
 */
export function assertRestored(count: number): void {
  if (count === 0) {
    throw new ConflictException(
      `Nothing was restored: the item does not exist, is not deleted, or was ` +
        `deleted more than ${RESTORE_WINDOW_DAYS} days ago`,
    );
  }
}
