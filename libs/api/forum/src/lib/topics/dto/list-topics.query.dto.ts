import {
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  MAX_PAGE_SIZE,
} from '@ptah-contracts/community';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** The two feed orderings §3.3 declares. */
export const TOPIC_SORTS = ['recent', 'unread'] as const;
export type TopicSort = (typeof TOPIC_SORTS)[number];

/**
 * `GET /api/v1/members/community/topics` — R1.2.5, NFR-P5, plan §3.3.
 *
 * ⚠️ ONE WHOLE-OBJECT `@Query()` DTO, BOUND WITH `dtoPipe(ListTopicsQueryDto)`
 * (PRE-1, RISK-I). This is not a style preference — it is a build constraint.
 * `controller-validation.spec.ts` holds `NAMED_PRIMITIVE_PARAM_COUNT = 6` as an
 * EXACT-EQUALITY assertion, so a single `@Query('categoryId') categoryId:
 * string` anywhere in this batch fails the build for every project that depends
 * on the server. Every query parameter this lib accepts therefore arrives as a
 * property of an object like this one.
 *
 * ⚠️ EVERY FIELD NEEDS `@Type(() => Number)` OR IT IS A STRING. Query values
 * arrive as strings; `dtoPipe` sets `transform: true`, and without the explicit
 * `@Type` the transform has no target type to convert to, so `@IsInt()` fails
 * on `?page=2` — a `400` on a request that is obviously valid.
 *
 * ⚠️ `pageSize > 50` IS A `400`, NOT A SILENT CLAMP (NFR-P5). `@Max(MAX_PAGE_SIZE)`
 * is what makes the cap enforceable BEFORE the service is entered, which is
 * where the spec requires it. See `MAX_PAGE_SIZE`'s own docblock for why
 * rejecting beats clamping: a clamped client believes it received everything
 * and quietly drops the tail.
 */
export class ListTopicsQueryDto {
  /**
   * Restrict the feed to one category.
   *
   * ⚠️ A CATEGORY THE MEMBER CANNOT SEE IS A `404`, decided in the service by
   * the visibility query (R1.1.3). Omitted means the cross-category feed, which
   * is filtered to every category the member CAN see — so an invisible
   * category's topics never appear either way.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  categoryId?: string;

  /**
   * `recent` (default) — pinned first, then `lastPostedAt` descending (R1.2.5),
   * the ordering `@@index([categoryId, pinned, lastPostedAt])` exists to serve.
   *
   * `unread` — the same ordering, RESTRICTED to topics with at least one post
   * this member has not read. It is a filter plus the same sort rather than a
   * true "sort by unread count", because unread is a per-member comparison
   * between two columns in different tables and Postgres cannot order by it
   * without a join this feed's query budget does not have. Restricting is what
   * the member actually wants from the control ("show me what's new"), and it
   * stays inside NFR-P4's five queries.
   */
  @IsOptional()
  @IsIn(TOPIC_SORTS, {
    message: `sort must be one of: ${TOPIC_SORTS.join(', ')}`,
  })
  sort?: TopicSort;

  /** 1-BASED. There is no page 0; `page=1` is the first page. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(FIRST_PAGE)
  page?: number;

  /** Default 25, hard maximum 50 — `> 50` is a `400` (NFR-P5). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}

/**
 * The effective paging + sort for a request, with the defaults applied ONCE.
 *
 * ⚠️ DEFAULTS ARE RESOLVED HERE, NOT AS CLASS-FIELD INITIALISERS. Under ES2022
 * class-field semantics a `plainToInstance`-built DTO declares every optional
 * property, and a field initialiser would make "the caller omitted `pageSize`"
 * indistinguishable from "the caller sent 25" — which is the same trap
 * `packs.service.ts`'s `suppliedKeys` documents for PATCH bodies. Resolving in
 * a function keeps the DTO an honest record of what arrived.
 */
export function resolveTopicQuery(query: ListTopicsQueryDto): {
  categoryId: string | undefined;
  sort: TopicSort;
  page: number;
  pageSize: number;
} {
  return {
    categoryId: query.categoryId,
    sort: query.sort ?? 'recent',
    page: query.page ?? FIRST_PAGE,
    pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
  };
}
