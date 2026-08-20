import { z } from 'zod';

/**
 * The pagination envelope — NFR-P5, plan §3.1.
 *
 * ONE envelope for EVERY list endpoint in this domain, member and admin alike:
 * `topics`, `notifications`, `replays`, and every search group.
 *
 * ⚠️ WHY THIS LIVES IN `shared/` AND NOT `member/`.
 * Plan §2.10 sketches it at `lib/member/paged.contract.ts`. It is moved here
 * deliberately: it is used by admin list endpoints too, so leaving it under
 * `member/` would force `contract-boundary.spec.ts` to carry an allowlist
 * exception for `admin/* -> member/paged.contract` — and an exception is the
 * first crack in a rule whose entire value is that it has none. A generic
 * envelope is not a member payload; the two payload directories stay disjoint.
 *
 * ⚠️ `Paged<T>` is an INTERFACE with no heritage, on purpose. `interface Paged<T>`
 * composed by TYPE ARGUMENT (`Paged<MemberTopicSummary>`) rather than by
 * `extends` is what keeps the member/admin split expressible without
 * inheritance anywhere in this lib.
 */

/**
 * `?pageSize` default when the caller omits it.
 *
 * Single-sourced so the server's `@IsInt() @Min(1) @Max(MAX_PAGE_SIZE)` DTO,
 * the client's request builder and this docblock cannot drift into three
 * different numbers.
 */
export const DEFAULT_PAGE_SIZE = 25;

/**
 * Hard ceiling. A request with `pageSize > MAX_PAGE_SIZE` is REJECTED with
 * `400` — it is NOT silently clamped.
 *
 * ⚠️ Rejecting rather than clamping is the deliberate choice. A silent clamp
 * makes a client that asked for 500 rows believe it received all of them and
 * quietly drop the tail; a `400` tells it, at the first request, in
 * development, that the page it wants does not exist.
 */
export const MAX_PAGE_SIZE = 50;

/** `?page` is 1-BASED. There is no page 0; `page=1` is the first page. */
export const FIRST_PAGE = 1;

/**
 * One page of results.
 *
 * - `page` / `pageSize` echo the EFFECTIVE values used, not the requested ones,
 *   so a caller that omitted `pageSize` learns it got {@link DEFAULT_PAGE_SIZE}
 *   without hard-coding that number.
 * - `total` is the count across all pages, matching the same visibility filter
 *   that produced `items`. A member never sees a `total` that counts rows they
 *   cannot read (R1.1.2).
 * - `hasMore` is redundant with `page * pageSize < total` and is sent anyway:
 *   it is the value an infinite-scroll UI actually branches on, and deriving it
 *   in three different components is three chances to get the boundary wrong.
 */
export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/**
 * Runtime schema for a page of `item`, for the client-side HTTP boundary parse
 * (the `validate()` idiom in `libs/web/core/.../members-api.service.ts`).
 *
 * A factory rather than a constant because the envelope is generic and Zod
 * schemas are values — `pagedSchema(memberTopicSummarySchema)`.
 *
 * ⚠️ THE RETURN TYPE IS INFERRED, NOT ANNOTATED, AND THERE IS NO CAST.
 * Annotating it `z.ZodType<Paged<z.output<T>>>` requires a cast, because Zod 4
 * cannot reduce a still-generic schema sitting inside an object shape. A cast
 * would ASSERT the envelope matches {@link Paged}; inference plus the
 * concrete-instantiation witnesses in `contract-boundary.spec.ts` PROVE it. At
 * a concrete item type the inference resolves and the assignability check is
 * real, which is exactly where the drift would show up.
 */
export function pagedSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    hasMore: z.boolean(),
  });
}
