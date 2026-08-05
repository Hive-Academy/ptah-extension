import { Transform } from 'class-transformer';
import { ValidateIf } from 'class-validator';

/**
 * OPTIONALITY, WITHOUT THE `null` HOLE — NFR-S7, TASK_2026_177 F-2.
 *
 * ⚠️ `@IsOptional()` SKIPS VALIDATION FOR `null` AS WELL AS `undefined`, AND
 * THAT IS NOT WHAT ANY DTO IN THIS LIB MEANT BY IT. On a field declared
 * `title?: string`, an explicit `{"title": null}` passes every `@IsString()`,
 * `@MinLength()` and `@MaxLength()` on the property UNTOUCHED — the decorators
 * are not merely satisfied, they are never run — and the `null` then reaches a
 * service that is typed as though it cannot exist. It throws there, below the
 * boundary, as an unhandled exception:
 *
 *   POST …/topics/:id/posts  {"bodyMarkdown":"…","parentId":null}  -> 500
 *   PATCH …/topics/:id       {"title":null}                        -> 500
 *   PATCH …/categories/:id   {"visibility":null}                   -> 500
 *
 * All three were measured against the running server. Twelve fields across five
 * DTOs behaved this way. A `null` on a member write path must be a `400` at
 * worst; a `500` is the raw, uncontrolled failure NFR-S7 exists to prevent, and
 * in a log it is indistinguishable from a real outage.
 *
 * ⚠️ IT IS A CLASS OF DEFECT, SO IT HAS A CLASS-WIDE ANSWER. Fixing one field
 * and leaving eleven is worse than fixing none: it makes the pattern look
 * inspected. `common/nullable-dto.spec.ts` scans every `*.dto.ts` in the lib and
 * fails the build on any `@IsOptional()` sitting on a field whose declared type
 * cannot be `null`, with a census of the two places where it legitimately can.
 */

/**
 * Optional, but an explicit `null` is a `400` — not a `500` four layers down.
 *
 * Use this wherever a field MAY BE OMITTED but has no meaning as `null`. It is
 * the default; `@IsOptional()` is the exception and needs a census entry.
 *
 * ⚠️ HOW IT WORKS, AND WHY `@ValidateIf` RATHER THAN A NULL VALIDATOR. class-
 * validator's `@ValidateIf(fn)` gates the WHOLE property: when `fn` returns
 * false every validator on it is skipped, and when it returns true every
 * validator runs. Conditioning on `value !== undefined` therefore gives exactly
 * the two behaviours wanted — an omitted key validates vacuously, and a present
 * key (including `null`) is judged by the `@IsString()` / `@IsInt()` /
 * `@IsBoolean()` already on the field. The refusal message names the property
 * and the expected type, so the client is told what is wrong rather than being
 * handed a stack trace's worth of nothing.
 *
 * The alternative — adding an explicit "not null" validator alongside
 * `@IsOptional()` — does not work: `@IsOptional()` short-circuits the property
 * before any sibling validator is consulted, so the new one would never run.
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
 * say so at the call site. There is exactly one such field today:
 * `CreatePostDto.parentId`. A post with no parent IS a top-level reply, which is
 * precisely what omitting the key means — and `MemberPost.parentId` is
 * `string | null` on the wire, so a client that holds one and hands it straight
 * back is doing a reasonable thing rather than a malformed one. Refusing it with
 * a `400` would be technically defensible and practically hostile.
 *
 * ⚠️ IT IS NOT A GENERAL SOFTENER. Applied to `UpdateTopicDto.title` it would
 * silently turn "clear the title" into "change nothing" — a request that looks
 * honoured and is not, which is worse than either a `400` or a `500` because
 * nothing anywhere reports it. That is why the two decorators in this file are
 * separate and why the census in `nullable-dto.spec.ts` enumerates rather than
 * pattern-matches.
 *
 * Compose it WITH {@link IsOptionalNotNull}: the transform runs first (during
 * `plainToInstance`) and turns `null` into `undefined`, and the gate then skips
 * the property — while a `null` that somehow arrived after transformation, or a
 * value of the wrong type, still meets the field's own validators.
 */
export function NullMeansAbsent(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    value === null ? undefined : value,
  ) as PropertyDecorator;
}
