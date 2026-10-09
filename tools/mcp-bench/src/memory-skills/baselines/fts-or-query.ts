/**
 * BASELINE CODE — the pinned pre-473 OR query builder (benchmark-design.md:85,
 * :159, suite `mem.search.fts-and`). Do not modernise: it is the old FTS5
 * query the AND builder replaced, kept verbatim so the retrieval comparison
 * runs against what the product actually shipped before TASK_2026_473.
 *
 * Pinned at commit 51f235a1e ("feat(electron): consume the code-symbol index
 * via hybrid search + chat injection"), the last revision of
 * `libs/backend/memory-curator/src/lib/fts-query.util.ts` before the 473 fix
 * commit 12865f539 ("fix(memory-curator): make retrieval and merge reach the
 * whole corpus") introduced stopwords and the AND form. This file was read
 * from that revision with the read-only command
 * `git show 51f235a1e:libs/backend/memory-curator/src/lib/fts-query.util.ts`.
 *
 * Differences from the current builder are the point of the baseline and are
 * preserved: no stopword filter (filler tokens dominate BM25 in a large
 * index), no apostrophe splitting, no AND form, no fallback plan.
 */

/**
 * Build the pre-473 FTS5 MATCH expression: every surviving token joined with
 * OR, the last token prefix-matched.
 *
 * - Strips ALL FTS5 metacharacters so user input cannot break out of the
 *   query expression or trigger column-qualifier injection:
 *     " * ( ) ^ : + - ~
 * - FTS5 boolean keywords (NEAR AND OR NOT) are neutralised by wrapping
 *   each surviving token in double-quotes; the quoting turns them into
 *   literal phrase tokens. An explicit keyword-drop filter is added as
 *   defence-in-depth for any version where quoting behaviour might differ.
 * - Drops single-character tokens (low signal, high noise).
 * - Prefix-matches the LAST token: "<token>"* — accommodates partial words
 *   the user is mid-typing.
 * - Joins all tokens with OR for recall (RAG context injection prefers
 *   recall over precision; reranker handles precision in a later step).
 * - Empty-after-stripping -> returns '""' which won't match anything.
 *
 * Security: this is NOT classical SQL injection — the query is fed to
 * prepare().all() as a bound parameter. This strips FTS5-grammar-level
 * operators only (F-H1 from security review).
 */
export function buildFtsOrQuery(rawQuery: string): string {
  /** FTS5 boolean keywords that must not survive into the final expression. */
  const FTS5_KEYWORDS = new Set(['near', 'and', 'or', 'not']);

  const tokens = rawQuery
    .toLowerCase()
    .replace(/["*()^:+\-~]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .filter((t) => !FTS5_KEYWORDS.has(t));

  if (tokens.length === 0) return '""';

  return tokens
    .map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`))
    .join(' OR ');
}
