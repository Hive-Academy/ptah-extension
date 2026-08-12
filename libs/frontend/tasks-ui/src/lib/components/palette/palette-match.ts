/**
 * The command palette's matcher and ranker (FR-C6.3, FR-C6.9).
 *
 * ## Why this is hand-rolled
 *
 * FR-C6.9 forbids a new runtime dependency, and a fuzzy-search library is the
 * obvious thing to reach for. It is also unnecessary: the corpus is a few
 * hundred short labels held in memory, re-scored once per keystroke, and the
 * only ranking rule the requirement states is that a prefix match outranks an
 * interior one. That is roughly forty lines. A dependency would add a bundle,
 * a supply-chain surface and a scoring model nobody here can explain, to
 * satisfy a spec that fits on one screen.
 *
 * ## The scoring model, stated so it can be checked
 *
 * A match falls into exactly one TIER, and the tiers cannot cross. Within a
 * tier the score is adjusted by how early the match starts, capped so that
 * adjustment can never push an entry out of its tier — that cap is what makes
 * "prefix outranks interior" a property of the model rather than a hope about
 * the numbers.
 *
 * | Tier | Meaning | Score range |
 * |---|---|---|
 * | exact | the whole label, case-folded | 1000 |
 * | prefix | the label starts with the needle | 800 |
 * | word prefix | the needle starts a word inside the label | 500 – 600 |
 * | substring | the needle appears anywhere else | 300 – 400 |
 * | subsequence | the needle's characters appear in order | 1 – 200 |
 *
 * Matching is case-insensitive and the needle is trimmed. Nothing here builds
 * a `RegExp` from user text (BR-10): every comparison is `startsWith`,
 * `indexOf` or a character walk.
 */

/** A label that can be ranked. The catalogue's entries satisfy this. */
export interface PaletteLabelled {
  readonly label: string;
}

/**
 * Tier floors. Each tier's *worst* score stays strictly above the next tier's
 * best, which is the invariant `palette-match.spec.ts` pins directly.
 */
const SCORE_EXACT = 1000;
const SCORE_PREFIX = 800;
const SCORE_WORD_PREFIX = 600;
const SCORE_SUBSTRING = 400;

/**
 * The most a late match may cost inside its tier.
 *
 * 100, against a 200-point gap between tier floors, so the worst word-prefix
 * (500) still beats the best substring (400) and the worst substring (300)
 * still beats the best subsequence (200).
 */
const MAX_POSITION_PENALTY = 100;

/** The subsequence tier's floor and ceiling. */
const SUBSEQUENCE_MIN = 1;
const SUBSEQUENCE_DENSITY_WEIGHT = 149;
const SUBSEQUENCE_EARLINESS_WEIGHT = 50;

/**
 * The score every entry receives for a blank query.
 *
 * Zero, and identical for all entries, so a blank query ranks nothing above
 * anything else and {@link rankPaletteMatches}'s stable sort hands the
 * catalogue back in its authored order.
 */
const SCORE_NEUTRAL = 0;

/** Characters that start a "word" for the word-prefix tier. */
function isWordBoundary(haystack: string, index: number): boolean {
  if (index === 0) return true;
  const previous = haystack[index - 1];
  return (
    previous === ' ' ||
    previous === '-' ||
    previous === '_' ||
    previous === ':' ||
    previous === '/' ||
    previous === '.' ||
    previous === '—'
  );
}

/**
 * Score a needle that appears in `haystack` only as a subsequence.
 *
 * Returns `null` when the characters do not appear in order at all. The score
 * rewards a DENSE run (the matched characters close together) and an EARLY
 * one, both bounded so the result always lands inside the subsequence tier.
 */
function scoreSubsequence(haystack: string, needle: string): number | null {
  let first = -1;
  let last = -1;
  let cursor = 0;

  for (let index = 0; index < haystack.length; index += 1) {
    if (haystack[index] !== needle[cursor]) continue;
    if (first === -1) first = index;
    last = index;
    cursor += 1;
    if (cursor === needle.length) break;
  }

  if (cursor < needle.length) return null;

  const span = last - first + 1;
  const density = needle.length / span;
  const earliness = Math.max(0, SUBSEQUENCE_EARLINESS_WEIGHT - first);
  return (
    SUBSEQUENCE_MIN +
    Math.round(density * SUBSEQUENCE_DENSITY_WEIGHT) +
    earliness
  );
}

/**
 * Score one label against one query.
 *
 * `null` means "does not match" — distinct from `0`, which is the score every
 * label gets for a blank query. Callers that treat a falsy score as a
 * non-match would drop every entry the moment the input is cleared.
 */
export function scorePaletteMatch(label: string, query: string): number | null {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return SCORE_NEUTRAL;

  const haystack = label.toLowerCase();
  if (haystack === needle) return SCORE_EXACT;
  if (haystack.startsWith(needle)) return SCORE_PREFIX;

  const index = haystack.indexOf(needle);
  if (index >= 0) {
    const penalty = Math.min(index, MAX_POSITION_PENALTY);
    return isWordBoundary(haystack, index)
      ? SCORE_WORD_PREFIX - penalty
      : SCORE_SUBSTRING - penalty;
  }

  return scoreSubsequence(haystack, needle);
}

/**
 * Filter and rank a catalogue against a query.
 *
 * Non-matching entries are dropped; the rest come back best-first. Ties keep
 * their authored order — the sort is decorated with the input index rather
 * than trusting `Array.prototype.sort`'s stability, because the ordering of
 * equal-scoring entries is a contract this palette's grouping relies on and it
 * should not rest on an engine detail.
 */
export function rankPaletteMatches<T extends PaletteLabelled>(
  entries: readonly T[],
  query: string,
): T[] {
  const scored: {
    readonly entry: T;
    readonly score: number;
    readonly at: number;
  }[] = [];

  entries.forEach((entry, at) => {
    const score = scorePaletteMatch(entry.label, query);
    if (score !== null) scored.push({ entry, score, at });
  });

  scored.sort((left, right) =>
    right.score === left.score ? left.at - right.at : right.score - left.score,
  );

  return scored.map((row) => row.entry);
}
