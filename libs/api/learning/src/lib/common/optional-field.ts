import { Transform } from 'class-transformer';
import { ValidateIf } from 'class-validator';

/**
 * OPTIONALITY, WITHOUT THE `null` HOLE — NFR-S7, TASK_2026_177 F-2.
 *
 * ⚠️ SIBLING FILE: `libs/api/forum/src/lib/common/optional-field.ts`. This is a
 * deliberate RE-DECLARATION, not an import — the decision was recorded in
 * `nullable-dto.spec.ts`'s docblock by Batch 9A and is honoured here. Forum's
 * copy lives in its `common/`, which `forum.module.spec.ts` asserts is NOT
 * barrel-exported, with a stated reason: `NOT_DELETED` leaving that lib would
 * let a consumer hand-build a `where` and read the forum past every visibility
 * clause. Widening a public barrel for two decorators is a worse trade than
 * ~20 duplicated lines. The two must change together.
 *
 * ⚠️ `@IsOptional()` SKIPS VALIDATION FOR `null` AS WELL AS `undefined`, AND
 * THAT IS NOT WHAT ANY DTO MEANS BY IT. On a field declared `title?: string`,
 * an explicit `{"title": null}` passes every `@IsString()`, `@MinLength()` and
 * `@MaxLength()` on the property UNTOUCHED — the decorators are not merely
 * satisfied, they are never run — and the `null` then reaches a service typed
 * as though it cannot exist. It throws there, below the boundary, as an
 * unhandled exception. Measured live against the running server in Phase 2:
 *
 *   PATCH …/topics/:id       {"title":null}       -> 500
 *   PATCH …/categories/:id   {"visibility":null}  -> 500
 *
 * TWELVE fields across FIVE DTOs behaved this way and Batch 6.1 swept them. A
 * `null` on a write path must be a `400` at worst; a `500` is the raw,
 * uncontrolled failure NFR-S7 exists to prevent, and in a log it is
 * indistinguishable from a real outage.
 *
 * ⚠️ IT IS A CLASS OF DEFECT, SO IT HAS A CLASS-WIDE ANSWER. `nullable-dto.spec.ts`
 * in this directory scans every `*.dto.ts` in this lib and fails the build on
 * any `@IsOptional()` sitting on a field whose declared type cannot be `null`,
 * with a census of the places where it legitimately can. That census is `[]`
 * and should stay `[]`.
 */

/**
 * Optional, but an explicit `null` is a `400` — not a `500` four layers down.
 *
 * Use this wherever a field MAY BE OMITTED but has no meaning as `null`. It is
 * the default; `@IsOptional()` is the exception and needs a census entry.
 *
 * ⚠️ HOW IT WORKS, AND WHY `@ValidateIf` RATHER THAN A NULL VALIDATOR.
 * class-validator's `@ValidateIf(fn)` gates the WHOLE property: when `fn`
 * returns false every validator on it is skipped, and when it returns true
 * every validator runs. Conditioning on `value !== undefined` therefore gives
 * exactly the two behaviours wanted — an omitted key validates vacuously, and a
 * present key (INCLUDING `null`) is judged by the `@IsString()` / `@IsInt()` /
 * `@IsBoolean()` already on the field. The refusal names the property and the
 * expected type, so the client is told what is wrong.
 *
 * The alternative — adding an explicit "not null" validator alongside
 * `@IsOptional()` — does not work: `@IsOptional()` short-circuits the property
 * BEFORE any sibling validator is consulted, so the new one would never run.
 *
 * ⚠️ THE PROPERTY IS STILL WHITELISTED. `dtoPipe` runs with `whitelist: true`,
 * which strips properties carrying NO validation metadata. `@ValidateIf`
 * registers metadata of its own and the type validator beside it registers
 * more, so a field using this decorator survives the whitelist exactly as an
 * `@IsOptional()` one did.
 */
export function IsOptionalNotNull(): PropertyDecorator {
  return ValidateIf(
    (_object: unknown, value: unknown) => value !== undefined,
  ) as PropertyDecorator;
}

/**
 * `null` MEANS "not supplied" for this field, so normalise it at the boundary.
 *
 * ⚠️ USE THIS ONLY WHERE `null` AND ABSENT GENUINELY DENOTE THE SAME THING, and
 * say so at the call site. The realistic candidate in this lib is
 * `CreateCommentDto.parentId`: a comment with no parent IS a top-level comment,
 * which is precisely what omitting the key means — and `MemberLessonComment.parentId`
 * is `string | null` on the wire, so a client that holds one and hands it
 * straight back is doing a reasonable thing rather than a malformed one.
 *
 * ⚠️ IT IS NOT A GENERAL SOFTENER. Applied to `UpdateCourseDto.title` it would
 * silently turn "clear the title" into "change nothing" — a request that looks
 * honoured and is not, which is worse than either a `400` or a `500` because
 * nothing anywhere reports it. Note the CONTRAST with a field like
 * `UpdateModuleDto.releaseAt`, where `null` is a real value meaning "unschedule
 * this module": that one wants a nullable declared type and a census entry, not
 * this transform.
 *
 * Compose it WITH {@link IsOptionalNotNull}: the transform runs first (during
 * `plainToInstance`) and turns `null` into `undefined`, and the gate then skips
 * the property — while a value of the wrong type still meets the field's own
 * validators.
 */
export function NullMeansAbsent(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    value === null ? undefined : value,
  ) as PropertyDecorator;
}
