import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { IsOptionalNotNull } from '@ptah-api/core';
import {
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  MAX_PAGE_SIZE,
} from '@ptah-contracts/community';

import type { NotificationPageRequest } from '../notifications.service';

/**
 * `GET /v1/members/notifications` — the inbox's paging (R10.3, plan §3.6).
 *
 * 🔴 A WHOLE-OBJECT QUERY DTO, NOT `@Query('page') page: string`, AND THAT IS A
 * BUILD-BREAKING RULE RATHER THAN A STYLE PREFERENCE (PRE-1, ground truth 10).
 * Two separate things ride on it:
 *
 *   - `controller-validation.spec.ts` asserts `NAMED_PRIMITIVE_PARAM_COUNT` by
 *     EXACT EQUALITY at 6 — a carve-out for six pre-existing OAuth/ticket
 *     params that is deliberately not allowed to grow. One named primitive here
 *     makes the server-wide total 7 and fails the build;
 *   - a bare `@Query() q: X` is SILENTLY UNVALIDATED. esbuild does not implement
 *     `emitDecoratorMetadata`, so `metadata.metatype` is `undefined` and
 *     `ValidationPipe.transform` short-circuits before any decorator on this
 *     class runs. The controller binds `dtoPipe(ListNotificationsQueryDto)`,
 *     which supplies the type explicitly.
 *
 * ⚠️ `@Type(() => Number)` IS LOAD-BEARING. Express hands every query parameter
 * over as a STRING, so `@IsInt()` on a bare `'2'` fails. `dtoPipe` runs with
 * `transform: true` and this decorator is what gives that transform a target.
 *
 * ⚠️ BOTH FIELDS TAKE `@IsOptionalNotNull()`, NOT `@IsOptional()`.
 * `@IsOptional()` skips validation for `null` as well as `undefined`, so
 * `?page=` deserialising to `null` would sail past `@IsInt()` untouched and
 * reach the service as a `null` typed `number` — a `500` on a request that
 * should be a `400`. Neither field's declared type includes `null`, so neither
 * appears in `nullable-dto.spec.ts`'s `EXPECTED_NULLABLE_OPTIONALS` census, and
 * that absence is correct rather than an omission.
 */
export class ListNotificationsQueryDto {
  /** 1-BASED. There is no page 0. */
  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(FIRST_PAGE)
  page?: number;

  /**
   * Default {@link DEFAULT_PAGE_SIZE}, hard maximum {@link MAX_PAGE_SIZE}.
   *
   * 🔴 `> MAX_PAGE_SIZE` IS A `400`, NOT A SILENT CLAMP (NFR-P5). A clamp makes
   * a client that asked for 500 rows believe it received all of them and quietly
   * drop the tail; the `400` tells it at the first request, in development.
   * `NotificationsService.list` therefore does not clamp either — it trusts this
   * bound, and a second clamp there would make this one unobservable.
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
 * ⚠️ NOT CLASS-FIELD INITIALISERS. `plainToInstance` runs those BEFORE the
 * whitelist, so a defaulted field survives a request that never sent it and
 * becomes indistinguishable from one the caller supplied — which matters
 * because `forbidNonWhitelisted` then has a property to reject that the caller
 * never wrote. Every query DTO in `libs/api/forum` and `libs/api/community`
 * resolves its defaults this way, for the same reason.
 */
export function resolveNotificationPage(
  query: ListNotificationsQueryDto,
): NotificationPageRequest {
  return {
    page: query.page ?? FIRST_PAGE,
    pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
  };
}
