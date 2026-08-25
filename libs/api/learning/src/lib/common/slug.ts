/**
 * Course, module and lesson slugs — R2.1, plan §3.4.
 *
 * ⚠️ SIBLING FILE: `libs/api/forum/src/lib/common/slug.ts`. Same rules, a second
 * declaration for the same reason `visibility.ts` is one (forum's `common/` is
 * not barrel-exported and an assertion depends on that). The two must change
 * together.
 *
 * ⚠️ A SLUG IS GENERATED ONCE, AT CREATION, AND NEVER REGENERATED. Editing a
 * title does not change the slug. Every link that has been shared, bookmarked
 * or written into a member's browser history keeps working. A slug that tracked
 * the title would break all of them on the first typo fix. The generator is
 * therefore only ever called from the create path; there is no "resync slugs"
 * operation and there must not be one.
 *
 * ⚠️ DETERMINISTIC AND PURE. {@link slugify} is a total function of its input
 * and {@link resolveSlugCollision} a total function of a stem plus the set of
 * already-taken slugs. Neither touches the database. The caller does one query
 * to build the taken-set and passes it in — which keeps the collision rule
 * unit-testable and keeps the query count visible at the call site rather than
 * hidden inside a helper that loops until it gets a free slug.
 *
 * 🔴 THIS IS NOT A CONCURRENCY CONTROL. Two simultaneous creates can compute
 * the same free slug. `Course.slug @unique`, `@@unique([courseId, slug])` and
 * `@@unique([moduleId, slug])` are what actually decide, and the create path
 * MUST catch `P2002` and retry. A helper cannot close that race and this one
 * does not pretend to. The retry is not only for the race: the taken-set is
 * read through `NOT_DELETED` (AD-5 binds every read), so a SOFT-DELETED row's
 * slug is invisible to the resolver while still occupying the unique index —
 * without the retry that is a deterministic 500, not an occasional one.
 *
 * 🔴 AND THE SCOPE OF THE TAKEN-SET IS NOT THE SCOPE OF THE UNIQUE INDEX FOR
 * LESSONS. `@@unique([moduleId, slug])` makes a lesson slug unique per MODULE,
 * but the member route is `courses/:slug/lessons/:lessonSlug` — course-scoped —
 * so two modules in one course holding the same lesson slug would make that URL
 * ambiguous. The resolver is therefore fed a COURSE-WIDE taken-set, which is a
 * superset of the module-wide one: every slug it returns is free in the module
 * as well, so the unique index still decides and the `P2002` mapping is
 * unchanged. See `CoursesService.createLesson`.
 */

/**
 * Maximum length of the readable stem, before any collision suffix.
 *
 * 80 characters is a long title's worth and comfortably inside every practical
 * URL limit. The column is `TEXT`, so this is a readability cap, not a storage
 * one.
 */
export const MAX_SLUG_STEM_LENGTH = 80;

/**
 * Used when a title normalises to nothing — a title that is entirely
 * punctuation (`"???"`), emoji, or non-Latin script, all of which are legal
 * titles.
 *
 * ⚠️ WITHOUT A FALLBACK, such a title would produce the EMPTY slug. The empty
 * string is a legal `TEXT` value and would be accepted by the unique index
 * exactly once, so the first such row would silently get `""` as its permanent
 * public identifier and its URL would end in a bare `/`. The second would then
 * collide and be suffixed into `-2`, a slug beginning with a hyphen. Both are
 * bad and neither raises an error, which is why these are named constants
 * rather than a guard someone might drop.
 *
 * ⚠️ THREE STEMS, NOT ONE, because the three models are addressed at three
 * different levels of the URL and a shared `'item'` would make an
 * unslugifiable course and an unslugifiable lesson indistinguishable in a log.
 */
export const FALLBACK_COURSE_SLUG_STEM = 'course';
/** @see FALLBACK_COURSE_SLUG_STEM */
export const FALLBACK_MODULE_SLUG_STEM = 'module';
/** @see FALLBACK_COURSE_SLUG_STEM */
export const FALLBACK_LESSON_SLUG_STEM = 'lesson';

/**
 * Normalise a title into a slug stem: lowercase, every run of non-alphanumeric
 * characters collapsed to a single `-`, leading/trailing `-` trimmed, truncated
 * to {@link MAX_SLUG_STEM_LENGTH}.
 *
 * ⚠️ ASCII-ONLY BY CONSTRUCTION. `[^a-z0-9]` treats every non-ASCII character
 * as a separator, so a fully non-Latin title yields the empty stem and falls
 * back. That is deliberate: transliterating needs a mapping table per script,
 * gets the wrong answer for several of them, and produces slugs their own
 * authors cannot read. A short opaque slug plus a correct title is the better
 * trade, and it is the trade the fallback plus the collision suffix already
 * implements.
 *
 * ⚠️ TRUNCATION HAPPENS BEFORE THE TRAILING-HYPHEN TRIM, so a cut that lands
 * mid-separator cannot leave a dangling `-`.
 */
export function slugify(title: string, fallbackStem: string): string {
  const stem = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_SLUG_STEM_LENGTH)
    .replace(/^-+|-+$/g, '');

  return stem.length > 0 ? stem : fallbackStem;
}

/**
 * Given a stem and the slugs already in use, return the first free slug:
 * the stem itself, else `stem-2`, `stem-3`, …
 *
 * ⚠️ THE SUFFIX STARTS AT 2, NOT 1 — `intro`, `intro-2`, `intro-3`. The
 * unsuffixed slug IS the first one, so a `-1` would imply a sibling that does
 * not exist.
 *
 * ⚠️ THE RESULT MAY EXCEED {@link MAX_SLUG_STEM_LENGTH}, BY UP TO THE WIDTH OF
 * THE SUFFIX. That is intentional. Truncating the stem to make room would mean
 * two different 80-character titles produce the same shortened stem MORE often,
 * not less — which increases the collisions the suffix exists to resolve, and
 * makes the slugs less readable at the same time. The cap governs the readable
 * stem; the suffix is disambiguation and is allowed to sit outside it.
 */
export function resolveSlugCollision(
  stem: string,
  taken: ReadonlySet<string>,
): string {
  if (!taken.has(stem)) return stem;

  // Bounded by `taken.size + 2`: with N taken slugs at most N candidates can be
  // occupied, so a free one is always found before the bound. An unbounded
  // `while (true)` would be an infinite loop if `taken` were ever pathological
  // (e.g. a Set proxy whose `has` always returns true).
  for (let suffix = 2; suffix <= taken.size + 2; suffix++) {
    const candidate = `${stem}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }

  /* istanbul ignore next -- unreachable: see the bound above. */
  throw new Error(
    `Could not resolve a free slug for stem "${stem}" against ${taken.size} taken slugs.`,
  );
}

/**
 * The whole create-path operation: title in, free slug out.
 *
 * Kept as a named function so the two steps are never accidentally reordered —
 * suffixing before normalising would put the suffix inside the stem
 * (`intro-2` → `intro-2`, but `Intro!` + `-2` → `intro-2` vs `intro-2-2`), and
 * the bug would only show on a collision.
 */
export function buildSlug(
  title: string,
  fallbackStem: string,
  taken: ReadonlySet<string>,
): string {
  return resolveSlugCollision(slugify(title, fallbackStem), taken);
}
