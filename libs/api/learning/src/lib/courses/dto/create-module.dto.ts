import {
  IsInt,
  IsISO8601,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { IsOptionalNotNull } from '../../common/optional-field';

/**
 * `POST /api/v1/admin/course-modules` — R2.1, R2.4.1, R8.1, plan §3.4.
 *
 * ⚠️ BOUND WITH `dtoPipe(CreateModuleDto)` (PRE-1).
 *
 * ⚠️ THE PREFIX IS `v1/admin/course-modules`, NOT `v1/admin/courses/modules`,
 * AND THAT IS A ROUTING REQUIREMENT RATHER THAN A NAMING PREFERENCE (RISK-N).
 * The nested form is a strict path-prefix of `v1/admin/courses`, which RI-1 in
 * `route-map.spec.ts` rejects — and both ledgers that could excuse it
 * (`PREFIX_EXCEPTIONS`, `KNOWN_PREFIX_DEBT`) are held at their current contents
 * deliberately. `['v1','admin','courses']` is NOT a prefix of
 * `['v1','admin','course-modules']` because segment 3 differs, which is why the
 * sibling form is legal even though it is a *string* prefix pair.
 *
 * ⚠️ NO `slug`, for the same reason as {@link CreateCourseDto} — module slugs
 * are generated from the title and scoped by `@@unique([courseId, slug])`.
 */
export class CreateModuleDto {
  /**
   * The owning course.
   *
   * ⚠️ A COURSE THAT IS SOFT-DELETED OR DOES NOT EXIST IS A `404`, decided in
   * `CoursesService.requireLiveModule`'s sibling `requireLiveCourse` by a query
   * that carries `NOT_DELETED`. No validator here can make that decision.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  courseId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  /**
   * Optional, and an explicit `null` is a `400` here — see
   * {@link UpdateModuleDto.description}, which DOES accept `null` because
   * clearing an existing description is a real request and creating without one
   * is not.
   */
  @IsOptionalNotNull()
  @IsString()
  @MaxLength(2_000)
  description?: string;

  /**
   * R2.4.1 — ISO 8601. A FUTURE value locks the module and its lessons answer
   * `403 { reason: 'not_released', unlocksAt }`; a past value is inert.
   *
   * ⚠️ THE BOUNDARY IS CLOSED ON THE OPEN SIDE: `releaseAt === now` is
   * UNLOCKED (`ModuleLockService`). "Released at 09:00" that is true only from
   * 09:00.001 is not what an admin means when they type a time.
   *
   * ⚠️ A STRING ON THE WIRE, A `Date` IN THE SERVICE. The controller converts.
   * `@Type(() => Date)` is deliberately not used: it turns an unparseable string
   * into `Invalid Date` rather than a `400`, and the failure then surfaces as a
   * Prisma error four layers down.
   */
  @IsOptionalNotNull()
  @IsISO8601()
  releaseAt?: string;

  /** Ascending within the course (R2.1.4). Omitted means "append" (R8.8). */
  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
