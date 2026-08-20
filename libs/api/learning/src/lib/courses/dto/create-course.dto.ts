import { VISIBILITIES, type Visibility } from '@ptah-contracts/community';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { IsOptionalNotNull } from '../../common/optional-field';

/**
 * `POST /api/v1/admin/courses` — R2.1, R8.1, plan §3.4.
 *
 * ⚠️ BOUND WITH `dtoPipe(CreateCourseDto)` AT THE CONTROLLER (PRE-1). Unbound,
 * every limit below is inert: this app is bundled by esbuild, which does not
 * implement `emitDecoratorMetadata`, so Nest cannot infer the parameter's class
 * and the global `ValidationPipe` short-circuits on `if (!metatype) return
 * value;`. A 2 MB `description` would reach Postgres.
 *
 * ⚠️ THERE IS NO `slug` FIELD AND THERE MUST NEVER BE ONE. Course slugs are
 * GENERATED from the title (`common/slug.ts`) and are stable for life — a course
 * slug is its public URL and there is no redirect table in this design.
 * `CoursesService.createCourse` resolves collisions by appending a suffix, so
 * the slug the SERVICE allocated is the one the response carries; a
 * caller-supplied one would let an admin squat a path or collide deliberately.
 *
 * ⚠️ THERE IS NO `published` FIELD EITHER, AND THAT IS NOT AN OVERSIGHT.
 * `CoursesService.createCourse` writes `published: false` unconditionally (plan
 * §1.4's `@default(false)`), and `PUT :id/published` is the separate, separately
 * audited endpoint. `forbidNonWhitelisted: true` in `dtoPipe` means an admin who
 * sends `{ published: true }` gets a `400` rather than a silently ignored field —
 * which is the correct answer, because creating something member-visible in the
 * same request that creates it removes the step where an admin checks their work.
 */
export class CreateCourseDto {
  /**
   * 3–200 characters.
   *
   * The floor is 3 rather than 1 because the title is what the slug is generated
   * from, and a one-character title produces a one-character URL. `slugify`
   * handles a title that normalises to nothing (emoji, non-Latin script) with
   * `FALLBACK_COURSE_SLUG_STEM`; that case is legal and is not what this limit
   * is for.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  /**
   * REQUIRED, because `Course.description` is a non-null column (plan §1.4) and
   * `MemberCourseSummary.description` is typed `string` rather than
   * `string | null` on the wire. Making it optional here would mean writing `''`
   * — a value that renders as a blank card and reads as a bug.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(5_000)
  description!: string;

  /**
   * Optional on CREATE, and an explicit `null` is a `400` here.
   *
   * ⚠️ CONTRAST WITH `UpdateCourseDto.coverImageUrl`, WHICH DOES ACCEPT `null`.
   * On a create, "no cover image" and "the key was omitted" are the same request
   * and there is nothing to clear, so `@IsOptionalNotNull()` is both correct and
   * cheaper — it keeps this property out of
   * `nullable-dto.spec.ts`'s `EXPECTED_NULLABLE_OPTIONALS`. On a patch, `null`
   * is the only way to express "remove the cover I set last week", so that one
   * is a census entry with a stated reason.
   */
  @IsOptionalNotNull()
  @IsString()
  @MaxLength(2_048)
  coverImageUrl?: string;

  /**
   * R2.1.1 — the same three-value vocabulary a forum category uses, from the
   * same `shared/` tuple so a `ParseEnumPipe`, a Zod `z.enum` and this
   * validator cannot drift apart.
   */
  @IsIn(VISIBILITIES, {
    message: `visibility must be one of: ${VISIBILITIES.join(', ')}`,
  })
  visibility!: Visibility;

  /**
   * `MemberGroup.key` values, ANY-match (AD-10 — a `String[]` column, not a join
   * table). Meaningful only when `visibility === 'cohort'`.
   *
   * ⚠️ THE SHAPE IS CHECKED HERE; THE EXISTENCE OF EACH KEY IS CHECKED IN THE
   * SERVICE, against real `MemberGroup` rows. No `Matches` can know which
   * cohorts exist, and an unknown key produces a course that is invisible to
   * every member INCLUDING the admin who created it, with no error anywhere —
   * which is why `CoursesService.assertCohortKeysExist` answers `400`.
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

  /** R2.4.2 — modules unlock only after the previous one is complete. */
  @IsOptionalNotNull()
  @IsBoolean()
  sequential?: boolean;

  /**
   * Admin-defined display order, ascending (R2.1.4).
   *
   * Optional: omitted means "append", and the service places the course after
   * the current last one on the same sparse scale `reorder` uses (R8.8). A
   * client that has to compute a sort key to create a row is a client that races
   * every other admin doing the same.
   */
  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
