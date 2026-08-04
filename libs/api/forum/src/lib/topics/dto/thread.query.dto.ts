import {
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  MAX_PAGE_SIZE,
} from '@ptah-contracts/community';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import type { PageRequest } from '../../common/pagination';

/**
 * `GET /api/v1/members/community/topics/:slug` — the thread read's paging
 * window (§3.3: `?page&pageSize`).
 *
 * ⚠️ BOUND WITH `dtoPipe(ThreadQueryDto)` AT THE CONTROLLER (PRE-1). A bare
 * `@Query() query: ThreadQueryDto` is SILENTLY UNVALIDATED in this app: it is
 * bundled by esbuild, which does not implement `emitDecoratorMetadata`, so
 * `metadata.metatype` is `undefined` and the global `ValidationPipe`
 * short-circuits. Without the explicit binding `?pageSize=100000` reaches
 * Prisma's `take`.
 *
 * ⚠️ IT IS A WHOLE-OBJECT DTO, NOT TWO `@Query('page')` PRIMITIVES (RISK-I).
 * `controller-validation.spec.ts` asserts `NAMED_PRIMITIVE_PARAM_COUNT` by
 * EXACT EQUALITY, so a single named primitive anywhere in this batch fails the
 * build. `@Type(() => Number)` is what gives `dtoPipe`'s `transform: true` a
 * target — Express hands every query value over as a string, and `@IsInt()`
 * on an untransformed `'2'` rejects a perfectly valid request.
 *
 * ⚠️ IT IS A SEPARATE CLASS FROM {@link ListTopicsQueryDto}, DELIBERATELY.
 * Reusing the feed's DTO here would make `forbidNonWhitelisted` ACCEPT
 * `?categoryId=` and `?sort=` on a thread read and then silently ignore them —
 * a request that looks honoured and is not. Two payload shapes, two classes.
 */
export class ThreadQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(FIRST_PAGE)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}

/**
 * Apply the defaults, OUTSIDE the DTO — the same rule `resolveTopicQuery` and
 * `resolveSearchQuery` follow.
 *
 * Class-field initialisers (`page = 1`) would make "the caller omitted it" and
 * "the caller sent the default" indistinguishable after validation, which is the
 * `suppliedKeys` trap `packs.service.ts` documents. Nothing in this lib needs
 * that distinction today; keeping the defaults out of the class is what means
 * nothing has to be undone if something does.
 */
export function resolveThreadPage(query: ThreadQueryDto): PageRequest {
  return {
    page: query.page ?? FIRST_PAGE,
    pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
  };
}
