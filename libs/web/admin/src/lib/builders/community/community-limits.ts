/**
 * Client mirrors of the server's own field limits.
 *
 * ⚠️ DEFENSE IN DEPTH, NOT THE BOUNDARY. `CreateAdminTopicDto`,
 * `CreateCategoryDto` and `UpdateCategoryDto` are the real check. These copies
 * exist so the common mistake is refused BEFORE the round trip: a
 * `ValidationPipe` rejection answers 400 with `message: string[]`, which
 * `refusalSentence()` deliberately masks, so an over-long title that reaches
 * the server produces a generic sentence naming no field.
 *
 * Keep each value equal to the decorator it names. A relaxed server limit that
 * is not mirrored here only refuses input the server would have taken; a
 * tightened one that is not mirrored here produces the masked 400 above.
 */

/** `CreateAdminTopicDto.title` — `@MinLength(3)`. */
export const TITLE_MIN_LENGTH = 3;

/** `CreateAdminTopicDto.title` — `@MaxLength(200)`. */
export const TITLE_MAX_LENGTH = 200;

/** `CreateAdminTopicDto.body` — `@MinLength(1)`. */
export const BODY_MIN_LENGTH = 1;

/** `CreateAdminTopicDto.body` — `@MaxLength(50_000)`. */
export const BODY_MAX_LENGTH = 50_000;

/** `CreateCategoryDto.name` / `UpdateCategoryDto.name` — `@MinLength(1)`. */
export const CATEGORY_NAME_MIN_LENGTH = 1;

/** `CreateCategoryDto.name` / `UpdateCategoryDto.name` — `@MaxLength(120)`. */
export const CATEGORY_NAME_MAX_LENGTH = 120;

/**
 * `CreateCategoryDto.description` / `UpdateCategoryDto.description` —
 * `@MaxLength(2000)`. An empty description is sent as `null`, which clears it.
 */
export const CATEGORY_DESCRIPTION_MAX_LENGTH = 2000;

/**
 * `CreateCategoryDto.slug` — `@Matches(/^[a-z0-9-]{2,64}$/)`. The shape lives in
 * `CATEGORY_SLUG_REGEX`; these two numbers are here only so a message can name
 * them without restating the pattern.
 */
export const CATEGORY_SLUG_MIN_LENGTH = 2;

/** `CreateCategoryDto.slug` — the upper bound of the same `@Matches(...)`. */
export const CATEGORY_SLUG_MAX_LENGTH = 64;
