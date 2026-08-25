import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * THE THREE BULK-REORDER PAYLOADS — R8.8, plan §3.4.
 *
 * ⚠️ THREE CLASSES, NOT ONE WITH AN OPTIONAL PARENT ID (B6C's D-6.12a). A
 * single `ReorderDto { ids, courseId?, moduleId? }` would make
 * `forbidNonWhitelisted` ACCEPT `{ ids, moduleId }` on `PATCH
 * v1/admin/courses/reorder` — a request that names a scope the endpoint ignores,
 * looks honoured, and is not. And it would make the parent id optional on the
 * two endpoints where it is mandatory, moving that check from the boundary into
 * the service. Three payload shapes, three classes.
 *
 * ⚠️ THE SUBMITTED LIST MUST BE EXACTLY THE CURRENT SIBLING SET, and that is
 * checked INSIDE the transaction by `ReorderService` — a partial list, a
 * duplicated id and a foreign-parent id are all `400` with no writes. Nothing
 * here can do it: it needs the rows.
 *
 * ⚠️ AND THE REFUSAL REPORTS A COUNT, NOT THE OFFENDING IDS. Echoing which of
 * the caller's ids are real rows somewhere else turns a reorder into an
 * existence probe. `ReorderService` owns that; this file is the shape.
 *
 * ⚠️ `ArrayMinSize(1)` ON ALL THREE. An empty `ids` array is not "reorder
 * nothing" — it is a claim that the parent has no children, and under the
 * "exactly the current sibling set" rule it would be a `400` from the service
 * anyway. Rejecting it here costs no query.
 */

/** The shared cap. 500 siblings is far beyond any real curriculum. */
const MAX_REORDER_IDS = 500;

/** `PATCH /api/v1/admin/courses/reorder` — every course, one flat list. */
export class ReorderCoursesDto {
  /**
   * Every live course id, in the order the admin wants them displayed.
   *
   * ⚠️ THE ORDER OF THIS ARRAY IS THE PAYLOAD. The numbers written are derived
   * from the position (`renumberSparse`), never sent — a client that computed
   * `sortOrder` values would be a second implementation of the scale, and the
   * two would disagree the first time either changed.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_REORDER_IDS)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(64, { each: true })
  ids!: string[];
}

/** `PATCH /api/v1/admin/course-modules/reorder` — one course's modules. */
export class ReorderModulesDto {
  /**
   * The course whose modules are being renumbered.
   *
   * ⚠️ IT IS A PARAMETER RATHER THAN INFERRED FROM THE FIRST ID, and
   * `ReorderService.reorderModules` says why: inferring it would make a request
   * that mixes two courses' modules look valid for whichever course the first id
   * happened to belong to, and would silently renumber a course the admin was
   * not editing.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  courseId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_REORDER_IDS)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(64, { each: true })
  ids!: string[];
}

/** `PATCH /api/v1/admin/lessons/reorder` — one module's lessons. */
export class ReorderLessonsDto {
  /** @see ReorderModulesDto.courseId — the same reasoning, one level down. */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  moduleId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_REORDER_IDS)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(64, { each: true })
  ids!: string[];
}
