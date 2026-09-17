import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { IsOptionalNotNull } from '@ptah-api/core';

import {
  WAITLIST_PAGE_SIZES,
  WAITLIST_SORT_FIELDS,
  WAITLIST_SORT_ORDERS,
  WAITLIST_SOURCES,
  WAITLIST_STAGES,
  type WaitlistPageSize,
  type WaitlistSortField,
  type WaitlistSortOrder,
  type WaitlistSource,
  type WaitlistStage,
} from './waitlist-query';

/**
 * Query DTOs for the admin waitlist read surface (TASK_2026_462 Batch A).
 *
 * ⚠️ THE ALLOWLISTS ARE THE POLICY MODULE'S OWN CONSTANTS. Every `@IsIn` below
 * decorates with the same tuple `waitlist-query.ts` exports, so a wire value
 * can never be valid at the DTO layer and invalid in the query layer — the two
 * cannot drift within the backend.
 */

/**
 * The shared filter vocabulary for `eligible-ids` and `export.csv`, extended
 * by {@link WaitlistListQueryDto} with pagination for the list route.
 */
export class WaitlistFilterQueryDto {
  @IsOptionalNotNull()
  @IsIn(WAITLIST_STAGES)
  stage?: WaitlistStage = 'all';

  @IsOptionalNotNull()
  @IsString()
  @MaxLength(256)
  search?: string;

  @IsOptionalNotNull()
  @IsIn(WAITLIST_SOURCES)
  source?: WaitlistSource;

  /**
   * Inclusive lower bound on `createdAt`, an ISO-8601 instant. The Angular
   * date inputs serialize UTC day bounds (`00:00:00.000Z`).
   */
  @IsOptionalNotNull()
  @IsISO8601({ strict: true })
  @MaxLength(32)
  createdFrom?: string;

  /** Inclusive upper bound on `createdAt` (`23:59:59.999Z` from the UI). */
  @IsOptionalNotNull()
  @IsISO8601({ strict: true })
  @MaxLength(32)
  createdTo?: string;

  @IsOptionalNotNull()
  @IsIn(WAITLIST_SORT_FIELDS)
  sortBy?: WaitlistSortField = 'createdAt';

  @IsOptionalNotNull()
  @IsIn(WAITLIST_SORT_ORDERS)
  sortOrder?: WaitlistSortOrder = 'desc';
}

/** The list route's own query — every filter, plus pagination. */
export class WaitlistListQueryDto extends WaitlistFilterQueryDto {
  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @IsIn(WAITLIST_PAGE_SIZES)
  pageSize?: WaitlistPageSize = 25;
}

/**
 * Path params for `GET /api/v1/admin/waitlist/:id/details`. `id` is a waitlist
 * cuid — alphanumerics, `-`, `_` — so the pattern excludes every character
 * that could change the route's meaning.
 */
export class WaitlistIdParamsDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  id!: string;
}
