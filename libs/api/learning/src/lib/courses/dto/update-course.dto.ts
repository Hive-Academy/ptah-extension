import { VISIBILITIES, type Visibility } from '@ptah-contracts/community';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
 * `PATCH /api/v1/admin/courses/:id` — R2.1, R8.1, plan §3.4.
 *
 * ⚠️ BOUND WITH `dtoPipe(UpdateCourseDto)` (PRE-1).
 *
 * ⚠️ A DISTINCT CLASS FROM {@link CreateCourseDto}, NOT A `Partial<>` OF IT
 * (B6C's D-6.12a). Reusing the create DTO would make `forbidNonWhitelisted`
 * ACCEPT a field this endpoint ignores, producing a request that looks honoured
 * and is not. Two payload shapes, two classes — and they genuinely differ:
 * `description` is required on create and optional here, and `coverImageUrl` is
 * nullable here and not there.
 *
 * ⚠️ NO `slug`. A course slug is its public URL and there is no redirect table;
 * changing it breaks every shared link and browser-history entry at once.
 * `CoursesService.updateCourse` has no `slug` on its input type either, so this
 * is enforced twice.
 *
 * ⚠️ NO `published`. It has its own endpoint (`PUT :id/published`) and its own
 * audit action (`learning.course.publish`), because "who made this visible to
 * members" is a different question from "who corrected the description" and a
 * moderation log answers it only if the two are separate rows.
 */
export class UpdateCourseDto {
  /** 3–200 characters. Leaves {@link CreateCourseDto}'s generated slug alone. */
  @IsOptionalNotNull()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @IsOptionalNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(5_000)
  description?: string;

  /**
   * 🔴 THE ONE PROPERTY IN THIS FILE THAT USES `@IsOptional()`, AND IT IS A
   * `EXPECTED_NULLABLE_OPTIONALS` CENSUS ENTRY — read
   * `common/nullable-dto.spec.ts` before copying this shape.
   *
   * `null` is a REAL VALUE here: "remove the cover image I set last week".
   * There is no other way to express it. `''` would store an empty string in a
   * nullable column, which renders as a broken `<img src="">` rather than as no
   * image, and `NullMeansAbsent()` would silently turn the request into a no-op
   * — a request that looks honoured and is not, which is worse than either a
   * `400` or a `500` because nothing anywhere reports it.
   *
   * `@IsOptional()` skips validation for `null` as well as `undefined`, which is
   * exactly what is wanted for this field and exactly what makes it dangerous on
   * every other one: the declared type genuinely includes `null` and
   * `CoursesService.updateCourse` writes `coverImageUrl: null` for it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2_048)
  coverImageUrl?: string | null;

  @IsOptionalNotNull()
  @IsIn(VISIBILITIES, {
    message: `visibility must be one of: ${VISIBILITIES.join(', ')}`,
  })
  visibility?: Visibility;

  /**
   * ⚠️ REPLACES THE WHOLE ARRAY; it is not a merge. `[]` is the way to clear
   * every cohort restriction, which is why this field does not need `null` and
   * therefore is not a census entry. Each key is still checked against real
   * `MemberGroup` rows in the service (AD-10 has no foreign key to do it).
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

  @IsOptionalNotNull()
  @IsBoolean()
  sequential?: boolean;

  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
