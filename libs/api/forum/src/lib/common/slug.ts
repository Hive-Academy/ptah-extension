/**
 * Topic and category slugs — R1.2.2.
 *
 * ⚠️ A SLUG IS GENERATED ONCE, AT CREATION, AND NEVER REGENERATED. Editing a
 * title does not change the slug (R1.2.2). Every link that has been shared,
 * bookmarked, or written into a `Notification.route` (plan §1.6 stores the
 * route at write time for precisely this reason) keeps working. A slug that
 * tracked the title would break all of them on the first typo fix, and would
 * also break the accepted-answer deep link in the same edit.
 *
 * The generator is therefore only ever called from the create path. There is no
 * "resync slugs" operation and there must not be one.
 *
 * ⚠️ DETERMINISTIC AND PURE. {@link slugify} is a total function of its input,
 * and {@link resolveSlugCollision} is a total function of a stem plus the set
 * of already-taken slugs. Neither touches the database. The caller does one
 * query to build the taken-set and passes it in — which keeps the collision
 * rule unit-testable, and keeps the query count visible at the call site rather
 * than hidden inside a helper that loops until it gets a free slug.
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
 * ⚠️ WITHOUT THIS, such a title would produce the empty slug. The empty string
 * is a legal `TEXT` value and would be accepted by the unique index exactly
 * once, so the FIRST such topic would silently get `""` as its permanent public
 * identifier and its URL would be `/members/community/topics/`. The second
 * would then collide and be suffixed into `-2`, which is a slug beginning with
 * a hyphen. Both are bad and neither raises an error, which is why this is a
 * named constant rather than a guard someone might drop.
 */
export const FALLBACK_SLUG_STEM = 'topic';

/**
 * Normalise a title into a slug stem: lowercase, every run of non-alphanumeric
 * characters collapsed to a single `-`, leading/trailing `-` trimmed, truncated
 * to {@link MAX_SLUG_STEM_LENGTH}.
 *
 * ⚠️ ASCII-ONLY BY CONSTRUCTION. `[^a-z0-9]` treats every non-ASCII character
 * as a separator, so a fully non-Latin title yields the empty stem and falls
 * back to {@link FALLBACK_SLUG_STEM}. That is deliberate: transliterating
 * (`é` -> `e`, Cyrillic -> Latin) needs a mapping table per script, gets the
 * wrong answer for several of them, and produces slugs their own authors cannot
 * read. A short opaque slug plus a correct title is the better trade, and it is
 * the trade the fallback plus the collision suffix already implements.
 *
 * Truncation happens BEFORE the trailing-hyphen trim, so a cut that lands
 * mid-separator cannot leave a dangling `-`.
 */
export function slugify(title: string): string {
  const stem = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_SLUG_STEM_LENGTH)
    .replace(/^-+|-+$/g, '');

  return stem.length > 0 ? stem : FALLBACK_SLUG_STEM;
}

/**
 * Given a stem and the slugs already in use, return the first free slug:
 * the stem itself, else `stem-2`, `stem-3`, … (R1.2.2).
 *
 * ⚠️ THE SUFFIX STARTS AT 2, NOT 1 — `my-topic`, `my-topic-2`, `my-topic-3`.
 * The unsuffixed slug IS the first one, so a `-1` would imply a sibling that
 * does not exist.
 *
 * ⚠️ THE RESULT MAY EXCEED {@link MAX_SLUG_STEM_LENGTH}, BY UP TO THE WIDTH OF
 * THE SUFFIX. That is intentional. Truncating the stem to make room would mean
 * two different 80-character titles produce the same shortened stem more often,
 * not less — which increases the collisions the suffix exists to resolve, and
 * makes the slugs less readable at the same time. The cap governs the readable
 * stem; the suffix is disambiguation and is allowed to sit outside it.
 *
 * `taken` is the set of existing slugs sharing this stem, which the caller gets
 * in ONE query:
 *
 * ```ts
 * const rows = await this.prisma.topic.findMany({
 *   where: { slug: { startsWith: stem } },
 *   select: { slug: true },
 * });
 * const slug = resolveSlugCollision(stem, new Set(rows.map((r) => r.slug)));
 * ```
 *
 * ⚠️ THIS IS NOT A CONCURRENCY CONTROL. Two simultaneous creates can compute
 * the same free slug. The `@unique` index on `Topic.slug` is what actually
 * decides, and the create path must be prepared to catch `P2002` and retry.
 * A helper cannot close that race and this one does not pretend to.
 */
export function resolveSlugCollision(
  stem: string,
  taken: ReadonlySet<string>,
): string {
  if (!taken.has(stem)) return stem;

  // Bounded by `taken.size + 2`: with N taken slugs at most N candidates can be
  // occupied, so a free one is always found before the bound. An unbounded
  // `while (true)` here would be an infinite loop if `taken` were ever
  // pathological (e.g. a Set proxy whose `has` always returns true).
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
 * Kept as a named function so the two steps are never accidentally reordered
 * (suffixing before normalising would put the suffix inside the stem).
 */
export function buildSlug(title: string, taken: ReadonlySet<string>): string {
  return resolveSlugCollision(slugify(title), taken);
}
