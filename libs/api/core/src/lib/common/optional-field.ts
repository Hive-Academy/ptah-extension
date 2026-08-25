import { Transform } from 'class-transformer';
import { ValidateIf } from 'class-validator';

/**
 * OPTIONALITY, WITHOUT THE `null` HOLE — NFR-S7, TASK_2026_177 F-2,
 * TASK_2026_188.
 *
 * ⚠️ THE SERVER-WIDE HOME FOR THESE TWO DECORATORS. It sits beside `dtoPipe`
 * (`common/dto-validation.pipe.ts`) because it is the SAME kind of thing — a
 * validation primitive every api lib needs — and because `@ptah-api/core` is
 * already imported by every controller that binds a DTO. There used to be three
 * verbatim re-declarations of this file (`forum`, `learning`,
 * `community/live-sessions`); TASK_2026_188 collapsed them to thin re-exports of
 * this module once the census it drives had to cover libs the per-lib copies
 * could not reach (`admin`, `identity`, `licensing`, `marketing`, and the
 * `packs` / `member-groups` / `google-sessions` corners of `community`). The
 * "duplication beats widening a barrel" trade (ASSUMPTION-11) stopped being the
 * cheaper one at four more copies, and this barrel was already wide.
 *
 * ⚠️ `@IsOptional()` SKIPS VALIDATION FOR `null` AS WELL AS `undefined`, AND
 * THAT IS NOT WHAT ANY DTO MEANS BY IT. On a field declared `title?: string`, an
 * explicit `{"title": null}` passes every `@IsString()`, `@MinLength()` and
 * `@MaxLength()` on the property UNTOUCHED — the decorators are not merely
 * satisfied, they are never run — and the `null` then reaches a service typed as
 * though it cannot exist. It throws there, below the boundary, as an unhandled
 * exception. Measured live against the running server in Phase 2:
 *
 *   PATCH …/topics/:id       {"title":null}       -> 500
 *   PATCH …/categories/:id   {"visibility":null}  -> 500
 *
 * A `null` on a write path must be a `400` at worst; a `500` is the raw,
 * uncontrolled failure NFR-S7 exists to prevent, and in a log it is
 * indistinguishable from a real outage.
 *
 * ⚠️ IT IS A CLASS OF DEFECT, SO IT HAS A CLASS-WIDE ANSWER.
 * `common/nullable-dto.spec.ts` in THIS lib scans every `*.dto.ts` under
 * `libs/api` and fails the build on any `@IsOptional()` sitting on a field whose
 * declared type cannot be `null`, with a census of the places where it
 * legitimately can. There are no by-name exclusions and no per-lib blind spots.
 */

/**
 * Optional, but an explicit `null` is a `400` — not a `500` four layers down.
 *
 * Use this wherever a field MAY BE OMITTED but has no meaning as `null`. It is
 * the default; `@IsOptional()` is the exception and needs a census entry.
 *
 * ⚠️ HOW IT WORKS, AND WHY `@ValidateIf` RATHER THAN A NULL VALIDATOR.
 * class-validator's `@ValidateIf(fn)` gates the WHOLE property: when `fn`
 * returns false every validator on it is skipped, and when it returns true every
 * validator runs. Conditioning on `value !== undefined` therefore gives exactly
 * the two behaviours wanted — an omitted key validates vacuously, and a present
 * key (INCLUDING `null`) is judged by the `@IsString()` / `@IsInt()` /
 * `@IsBoolean()` already on the field. The refusal names the property and the
 * expected type, so the client is told what is wrong.
 *
 * The alternative — adding an explicit "not null" validator alongside
 * `@IsOptional()` — does not work: `@IsOptional()` short-circuits the property
 * BEFORE any sibling validator is consulted, so the new one would never run.
 *
 * ⚠️ THE PROPERTY IS STILL WHITELISTED. `dtoPipe` runs with `whitelist: true`,
 * which strips properties carrying NO validation metadata. `@ValidateIf`
 * registers metadata of its own and the type validator beside it registers more,
 * so a field using this decorator survives the whitelist exactly as an
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
 * say so at the call site.
 *
 * ⚠️ IT IS NOT A GENERAL SOFTENER. Applied to `UpdateLiveSessionDto.title` it
 * would silently turn "clear the title" into "change nothing" — a request that
 * looks honoured and is not, which is worse than either a `400` or a `500`
 * because nothing anywhere reports it. Note the CONTRAST with a field where
 * `null` is a real value meaning "detach this": that one wants a nullable
 * declared type and a census entry, not this transform.
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
