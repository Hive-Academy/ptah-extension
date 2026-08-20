/**
 * Sparse ordering and the ONE deterministic tie-break — R2.1.4, R8.8.
 *
 * ⚠️ THIS FILE HAS NO FORUM SIBLING. Forum inlines its `SORT_ORDER_STEP` in
 * `categories.service.ts` because it orders exactly one thing; this lib orders
 * three (courses, modules within a course, lessons within a module) through two
 * services, and a second copy of the tie-break tuple is how two screens start
 * disagreeing about lesson order.
 */

/**
 * The gap between adjacent `sortOrder` values after a reorder — R8.8.
 *
 * ⚠️ SPARSE (100, 200, 300 …) SO A LATER SINGLE INSERT DOES NOT FORCE A FULL
 * RENUMBER. With a dense 0,1,2 scale, dropping one lesson between two others
 * means rewriting every row after it; with a step of 100 it means writing one
 * row at 150. That is R8.8's stated reason for the sparse scale, and it is why
 * `create` appends at `max + STEP` rather than at `count + 1`.
 */
export const SORT_ORDER_STEP = 100;

/**
 * The R2.1.4 tie-break, declared ONCE.
 *
 * 🔴 `sortOrder` ALONE IS NOT A TOTAL ORDER, AND PLAN §1.4 SAYS SO: ties break
 * on `(sortOrder, createdAt, id)`. `@@unique([courseId, sortOrder])` is
 * DELIBERATELY NOT DECLARED (R8.8 — a uniqueness constraint would force the
 * bulk reorder to sequence its UPDATEs to dodge transient collisions), so ties
 * are not merely possible, they are an ordinary state: two rows created without
 * an explicit position, or a reorder interrupted mid-transaction.
 *
 * With a bare `orderBy: { sortOrder: 'asc' }` Postgres is free to return tied
 * rows in whatever order it last wrote them, so the outline and the player
 * disagree about what comes next — intermittently, and only for the courses
 * that have ties. `createdAt` breaks almost every tie and `id` breaks the rest
 * (two rows created in the same millisecond), which is what makes this a TOTAL
 * order rather than a better one.
 *
 * ⚠️ IT IS EXPORTED AS A CONSTANT, NOT RE-TYPED AT EACH CALL SITE. A second
 * copy that omitted `id` would be right 99.99% of the time, which is the worst
 * available failure rate for an ordering bug.
 *
 * ⚠️ SPREAD IT AT THE CALL SITE — `orderBy: [...DETERMINISTIC_ORDER_BY]`.
 * Prisma's generated `orderBy` parameter is a MUTABLE array type, so a
 * `readonly` tuple does not assign to it. The `as const` is kept anyway,
 * because it is what makes `sort-order.spec.ts` able to assert the exact tuple
 * and what stops a caller reordering the shared constant in place — a single
 * mutation would silently change every list in the product.
 */
export const DETERMINISTIC_ORDER_BY = [
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
] as const;

/** One row's new position, as {@link renumberSparse} returns it. */
export interface SparsePosition {
  readonly id: string;
  readonly sortOrder: number;
}

/**
 * The complete sibling list, in the desired order, renumbered onto the sparse
 * scale: `100, 200, 300 …` — R8.8.
 *
 * ⚠️ IT TAKES THE COMPLETE LIST AND NOTHING LESS. Renumbering a SUBSET
 * interleaves the renumbered rows with untouched ones at values nobody chose,
 * so the resulting order is neither the old one nor the new one — and it can
 * create ties, which {@link DETERMINISTIC_ORDER_BY} then breaks by `createdAt`,
 * i.e. by an order the admin never expressed. `ReorderService` therefore
 * rejects a partial list with a `400`; this function is pure and assumes the
 * caller has already done that.
 *
 * ⚠️ IT STARTS AT `SORT_ORDER_STEP`, NOT AT `0`. Leaving room BEFORE the first
 * row matters as much as between them: an admin inserting a new first lesson
 * would otherwise have nowhere to put it without a renumber.
 *
 * PURE: no database, no clock, no ids invented. That is what lets the reorder
 * spec assert the numbers without a mock, and what lets `ReorderService`'s spec
 * assert that the WRITES match this function's output rather than restating the
 * arithmetic a second time.
 */
export function renumberSparse(ids: readonly string[]): SparsePosition[] {
  return ids.map((id, index) => ({
    id,
    sortOrder: (index + 1) * SORT_ORDER_STEP,
  }));
}

/**
 * The append position for a create that did not choose one:
 * `highest + SORT_ORDER_STEP`, or the first slot when there are no siblings.
 *
 * ⚠️ THE CLIENT MUST NOT COMPUTE THIS. A client that had to work out a sort key
 * before creating a row would race every other admin doing the same, and would
 * need a read it has no other reason to do.
 */
export function appendSortOrder(highestExisting: number | null): number {
  return (highestExisting ?? 0) + SORT_ORDER_STEP;
}
