import {
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  MAX_PAGE_SIZE,
} from '@ptah-contracts/community';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { IsOptionalNotNull } from '../../common/optional-field';

/**
 * `GET /api/v1/admin/community/topics` — the moderation list (§3.3 admin table:
 * `?includeDeleted&categoryId&search`).
 *
 * ⚠️ BOUND WITH `dtoPipe(ListAdminTopicsQueryDto)` AT THE CONTROLLER (PRE-1).
 * esbuild emits no `emitDecoratorMetadata`, so a bare `@Query() q: X` leaves
 * every decorator below inert — including the `@Max(MAX_PAGE_SIZE)` that is the
 * only thing between `?pageSize=1000000` and Prisma's `take`.
 *
 * ⚠️ WHOLE-OBJECT, NEVER `@Query('search') search: string` (RISK-I). The
 * server's `NAMED_PRIMITIVE_PARAM_COUNT = 6` is an exact-equality assertion.
 */
export class ListAdminTopicsQueryDto {
  /**
   * Include soft-deleted topics — the ONE sanctioned tombstone read in this lib
   * (AD-5, `EXPECTED_EXEMPTIONS`).
   *
   * ⚠️ THE TRANSFORM IS NOT COSMETIC. Express hands query values over as
   * STRINGS, and `'false'` is a truthy string — so without this, a moderator
   * who explicitly asked NOT to see deleted topics would be shown them. Only
   * the two affirmative spellings are accepted; everything else, including
   * `'false'`, `''` and a repeated `?includeDeleted=a&includeDeleted=b` array,
   * resolves to `false`. Defaulting to the SAFE direction is deliberate: the
   * failure mode of guessing wrong is deleted content on screen.
   */
  @IsOptionalNotNull()
  @Transform(
    ({ value }: { value: unknown }) =>
      value === true || value === 'true' || value === '1',
  )
  @IsBoolean()
  includeDeleted?: boolean;

  @IsOptionalNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  categoryId?: string;

  /**
   * Substring match on the topic TITLE, case-insensitive.
   *
   * Titles only — body search is `GET /v1/members/search`, which is
   * trigram-indexed. A `contains` over `body_markdown` here would be a
   * sequential scan of every post in the forum on an admin keystroke.
   */
  @IsOptionalNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  search?: string;

  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(FIRST_PAGE)
  page?: number;

  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}

/**
 * Defaults, applied OUTSIDE the DTO — the rule `resolveTopicQuery` and
 * `resolveSearchQuery` already follow, so "omitted" and "sent the default" stay
 * distinguishable after validation.
 */
export function resolveAdminTopicQuery(query: ListAdminTopicsQueryDto): {
  includeDeleted: boolean;
  categoryId: string | undefined;
  search: string | undefined;
  page: number;
  pageSize: number;
} {
  return {
    includeDeleted: query.includeDeleted ?? false,
    categoryId: query.categoryId,
    search: query.search?.trim() || undefined,
    page: query.page ?? FIRST_PAGE,
    pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
  };
}
