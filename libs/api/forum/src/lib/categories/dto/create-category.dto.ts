import { VISIBILITIES, type Visibility } from '@ptah-contracts/community';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { IsOptionalNotNull } from '../../common/optional-field';

/**
 * `POST /api/v1/admin/community/categories` — R1.1.1, R8.8, plan §3.3.
 *
 * ⚠️ BOUND WITH `dtoPipe(CreateCategoryDto)` AT THE CONTROLLER (PRE-1). A bare
 * `@Body() dto: CreateCategoryDto` is SILENTLY UNVALIDATED in this app: it is
 * bundled by esbuild, which does not implement `emitDecoratorMetadata`, so
 * `metadata.metatype` is `undefined` and the global `ValidationPipe`
 * short-circuits. Every decorator below is inert without the explicit binding.
 *
 * ⚠️ `visibility` IS VALIDATED AGAINST THE SHARED TUPLE, NOT A LOCAL COPY.
 * `VISIBILITIES` comes from `@ptah-contracts/community`, which is also what
 * `common/visibility.ts` builds its `WHERE` branches from and what the member
 * panel renders. The `Category.visibility` column is a Postgres `String`, not
 * an enum (§1.3), so nothing at the database layer would catch a fourth value
 * typed here — this validator is the only thing standing between a typo and a
 * category that matches no visibility branch and is therefore invisible to
 * EVERYONE, silently, forever.
 */
export class CreateCategoryDto {
  /**
   * Stable public identifier. Lowercase slug, 2–64 chars — the same shape
   * `PACK_SLUG_REGEX` uses, so admin slug rules do not vary per surface.
   *
   * Caller-supplied rather than derived from `name`: a category slug is
   * long-lived navigation and an admin should choose it. Topic slugs, by
   * contrast, are GENERATED (R1.2.2, `common/slug.ts`) because members do not
   * author URLs.
   */
  @IsString()
  @Matches(/^[a-z0-9-]{2,64}$/, {
    message: 'slug must be a lowercase slug (2-64 chars of a-z, 0-9, -)',
  })
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsIn(VISIBILITIES, {
    message: `visibility must be one of: ${VISIBILITIES.join(', ')}`,
  })
  visibility!: Visibility;

  /**
   * `MemberGroup.key` values, ANY-match (AD-10 — a `String[]` column, not a
   * join table). Meaningful only when `visibility === 'cohort'`.
   *
   * ⚠️ THE SHAPE IS CHECKED HERE; THE EXISTENCE OF EACH KEY IS CHECKED IN THE
   * SERVICE, against real `MemberGroup` rows. A `Matches` cannot know which
   * cohorts exist, and an unknown key produces a category that is invisible to
   * every member — which is why `CategoriesService` answers `400` rather than
   * storing it (Task 6.6).
   */
  @IsOptionalNotNull()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^[a-z0-9-]{2,40}$/, {
    each: true,
    message:
      'each cohortKey must be a lowercase slug (2-40 chars of a-z, 0-9, -)',
  })
  cohortKeys?: string[];

  /**
   * Admin-defined display order, ascending (R1.1.4).
   *
   * Optional: omitted means "append", and the service places the category after
   * the current last one on the same sparse scale `reorder` uses (R8.8). A
   * client that has to compute a sort key to create a row is a client that
   * races every other admin doing the same.
   */
  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
