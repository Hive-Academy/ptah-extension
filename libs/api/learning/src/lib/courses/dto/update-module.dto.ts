import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { IsOptionalNotNull } from '../../common/optional-field';

/**
 * `PATCH /api/v1/admin/course-modules/:id` — R2.1, R2.4.1, R8.1, plan §3.4.
 *
 * ⚠️ BOUND WITH `dtoPipe(UpdateModuleDto)` (PRE-1).
 *
 * ⚠️ NO `courseId`. Moving a module between courses would renumber two courses
 * at once, orphan every `LessonProgress` row's position in the sequential chain
 * (R2.4.2), and change the URL of every lesson under it. Delete and recreate is
 * the honest route and it makes the consequence visible.
 *
 * 🔴 TWO OF THE THREE `EXPECTED_NULLABLE_OPTIONALS` CENSUS ENTRIES IN THIS LIB
 * ARE IN THIS FILE. Both are genuine clear-the-value semantics and neither can
 * be expressed any other way. Read `common/nullable-dto.spec.ts` before copying
 * the shape — `@IsOptional()` is the exception here, not the default.
 */
export class UpdateModuleDto {
  @IsOptionalNotNull()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  /**
   * 🔴 CENSUS ENTRY. `null` means "remove this module's description", which is a
   * real request: `CourseModule.description` is a nullable column and
   * `CoursesService.updateModule` writes `null` for it.
   *
   * `''` is not a substitute — an empty string is a value that renders as an
   * empty paragraph rather than as no paragraph, and the two are visibly
   * different in the outline.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string | null;

  /**
   * 🔴 CENSUS ENTRY, AND THE CLEAREST ONE. `null` means "UNSCHEDULE THIS
   * MODULE — open it now" (R2.4.1). `CoursesService.updateModule` already
   * implements exactly that semantics.
   *
   * There is no other spelling for it. Omitting the key means "leave the
   * schedule alone", `''` is not a date, and a far-past timestamp would be a
   * lie in the audit trail about when the module was actually opened. This is
   * the field `optional-field.ts`'s docblock names as the archetypal legitimate
   * nullable optional.
   */
  @IsOptional()
  @IsISO8601()
  releaseAt?: string | null;

  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
