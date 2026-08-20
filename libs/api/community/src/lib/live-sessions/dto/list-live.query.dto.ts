import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  MAX_PAGE_SIZE,
} from '@ptah-contracts/community';

import { IsOptionalNotNull } from '../common/optional-field';

/**
 * `GET /v1/members/live` — the replay archive's paging (plan §3.5).
 *
 * 🔴 A WHOLE-OBJECT QUERY DTO, NOT `@Query('page') page: string` — AND THAT IS
 * A BUILD-BREAKING RULE, NOT A STYLE PREFERENCE (RISK-I).
 * `controller-validation.spec.ts` asserts `NAMED_PRIMITIVE_PARAM_COUNT` by
 * EXACT EQUALITY at 6. One named primitive anywhere in this batch makes the
 * total read 7 and fails the build — deliberately, so the carve-out for the six
 * pre-existing OAuth/ticket params cannot silently grow.
 *
 * ⚠️ `@Type(() => Number)` IS LOAD-BEARING. Express hands every query parameter
 * over as a STRING, so `@IsInt()` on a bare `'2'` fails. `dtoPipe` runs with
 * `transform: true`, and this decorator is what gives that transform a target.
 *
 * ⚠️ ONLY `replays` IS PAGED. `upcoming` and `live` are bounded by the schedule
 * itself — there are never many — so a page cursor on them would be a knob with
 * no second page behind it. The contract says so; this DTO is the half that
 * makes it true.
 */
export class ListLiveQueryDto {
  /** 1-BASED. There is no page 0. */
  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(FIRST_PAGE)
  page?: number;

  /**
   * Default {@link DEFAULT_PAGE_SIZE}, hard maximum {@link MAX_PAGE_SIZE}.
   *
   * ⚠️ `> MAX_PAGE_SIZE` IS A `400`, NOT A SILENT CLAMP. A clamp makes a client
   * that asked for 500 rows believe it received all of them and quietly drop the
   * tail; the `400` tells it at the first request. `LiveFeedService` therefore
   * does not clamp either — it trusts this bound.
   */
  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}

/**
 * Defaults resolved ONCE, OUTSIDE the DTO.
 *
 * ⚠️ NOT CLASS-FIELD INITIALISERS. `plainToInstance` runs them before the
 * whitelist, so a defaulted field survives a request that never sent it and
 * becomes indistinguishable from one the caller supplied. Every query DTO in
 * `libs/api/forum` resolves its defaults this way, for the same reason.
 */
export function resolveLiveQuery(query: ListLiveQueryDto): {
  page: number;
  pageSize: number;
} {
  return {
    page: query.page ?? FIRST_PAGE,
    pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
  };
}
