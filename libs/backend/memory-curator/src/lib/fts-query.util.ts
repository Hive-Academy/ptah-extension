/**
 * Build an FTS5 MATCH expression from raw user query text.
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
export function escapeFtsQuery(rawQuery: string): string {
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
