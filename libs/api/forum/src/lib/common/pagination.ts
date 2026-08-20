import type { Paged } from '@ptah-contracts/community';

/**
 * The `Paged<T>` envelope, built in one place — NFR-P5, plan §3.1.
 *
 * ⚠️ THE CAP IS NOT ENFORCED HERE, AND THAT IS DELIBERATE. `pageSize > 50` is a
 * `400`, and it is rejected by the DTO (`@Max(MAX_PAGE_SIZE)`) BEFORE a service
 * is entered. A clamp in this file would be a second, silent policy that
 * disagreed with the DTO: a request that got past validation with `pageSize:
 * 500` would be quietly served 50 rows and told `pageSize: 50`, which is
 * exactly the "client believes it received everything and drops the tail"
 * failure `MAX_PAGE_SIZE`'s docblock rejects. So these helpers TRUST their
 * input and the DTO is the only gate.
 *
 * ⚠️ `page` IS 1-BASED (`FIRST_PAGE`). `skip` is therefore `(page - 1) *
 * pageSize`, and the off-by-one that produces is the single most repeated
 * pagination bug there is — which is why it is written once, here, rather than
 * at each of the five list endpoints in this lib.
 */

/** The effective, already-validated paging values for one request. */
export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
}

/** Prisma's `skip` / `take` for a {@link PageRequest}. */
export function toSkipTake(request: PageRequest): {
  skip: number;
  take: number;
} {
  return {
    skip: (request.page - 1) * request.pageSize,
    take: request.pageSize,
  };
}

/**
 * Wrap one page of already-fetched items.
 *
 * `total` MUST come from a count that ran under the SAME `where` as `items` —
 * including the visibility clause and `NOT_DELETED`. A `total` computed under a
 * wider filter tells the member exactly how much content exists that they
 * cannot read, which is the disclosure R1.1.2 forbids and the reason this
 * parameter is not optional.
 *
 * `hasMore` is derived rather than passed: `page * pageSize < total`. It is
 * redundant with the other three fields on purpose (see `Paged`'s docblock) —
 * deriving it in three components is three chances to get the boundary wrong.
 */
export function toPaged<T>(
  items: T[],
  total: number,
  request: PageRequest,
): Paged<T> {
  return {
    items,
    page: request.page,
    pageSize: request.pageSize,
    total,
    hasMore: request.page * request.pageSize < total,
  };
}

/**
 * A well-formed EMPTY page.
 *
 * Used where a read short-circuits before touching the database at all — a
 * member who can see no categories, or a `?kinds=` that did not ask for this
 * group. It echoes the requested paging values rather than inventing `page: 1`,
 * so a client paging through results does not see its own cursor reset.
 *
 * ⚠️ NEVER `undefined` AND NEVER AN ABSENT KEY (see `MemberSearchResults`). An
 * empty group is an empty `Paged`, so a caller reads `.total` unconditionally.
 */
export function emptyPage<T>(request: PageRequest): Paged<T> {
  return toPaged<T>([], 0, request);
}
