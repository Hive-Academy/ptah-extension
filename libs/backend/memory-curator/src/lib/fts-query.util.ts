/**
 * Conversational filler that carries no retrieval signal. A natural-language
 * question ("what did we decide about the judge threshold") is mostly these,
 * and in a 38k-chunk FTS index every chunk matches "the" — so the filler both
 * dominates the BM25 score and makes an AND join impossible to satisfy.
 * Measured 2026-09-18 (TASK_2026_471 forensics): the four sample queries
 * returned 4.5 relevant results of 20 with the filler left in and joined by OR.
 */
const STOPWORDS = new Set([
  'about',
  'all',
  'am',
  'an',
  'any',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'her',
  'here',
  'him',
  'his',
  'how',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'me',
  'my',
  'of',
  'on',
  'our',
  'out',
  'over',
  'she',
  'should',
  'so',
  'some',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'to',
  'up',
  'us',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'whose',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
]);

/** FTS5 boolean keywords that must not survive into the final expression. */
const FTS5_KEYWORDS = new Set(['near', 'and', 'or', 'not']);

/**
 * An FTS5 MATCH expression plus the wider expression used to fill an
 * under-supplied result page.
 */
export interface FtsQueryPlan {
  /** The expression to run first: content terms joined with AND. */
  readonly match: string;
  /**
   * The same content terms joined with OR, or null when there is nothing wider
   * to try. Run this only when `match` returned fewer than the requested rows.
   */
  readonly fallbackMatch: string | null;
}

/**
 * Build an FTS5 MATCH plan from raw user query text.
 *
 * - Strips ALL FTS5 metacharacters so user input cannot break out of the
 *   query expression or trigger column-qualifier injection:
 *     " * ( ) ^ : + - ~
 * - FTS5 boolean keywords (NEAR AND OR NOT) are neutralised by wrapping
 *   each surviving token in double-quotes; the quoting turns them into
 *   literal phrase tokens. An explicit keyword-drop filter is added as
 *   defence-in-depth for any version where quoting behaviour might differ.
 * - Drops single-character tokens (low signal, high noise).
 * - Treats straight and curly apostrophes as token separators. This turns a
 *   possessive such as `user's` into `user` after the one-character `s` is
 *   dropped, matching how the indexed prose expresses the same concept.
 * - Drops common English stopwords, then joins the remaining content terms
 *   with AND for precision. The OR form is returned beside it so a caller can
 *   retry when AND matches nothing; recall is preserved, it is no longer the
 *   first thing tried.
 * - A query made only of stopwords has no content term to AND, so it keeps the
 *   old OR behaviour over its original tokens.
 * - Prefix-matches the LAST token: "<token>"* — accommodates partial words
 *   the user is mid-typing.
 * - Empty-after-stripping -> returns '""' which won't match anything.
 *
 * Security: this is NOT classical SQL injection — the query is fed to
 * prepare().all() as a bound parameter. This strips FTS5-grammar-level
 * operators only (F-H1 from security review).
 */
export function buildFtsQueryPlan(rawQuery: string): FtsQueryPlan {
  const tokens = rawQuery
    .toLowerCase()
    .replace(/["*()^:+\-~]/g, ' ')
    .replace(/['’]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .filter((t) => !FTS5_KEYWORDS.has(t));

  if (tokens.length === 0) return { match: '""', fallbackMatch: null };

  const content = tokens.filter((t) => !STOPWORDS.has(t));
  if (content.length === 0) {
    return { match: joinTokens(tokens, 'OR'), fallbackMatch: null };
  }
  if (content.length === 1) {
    return { match: joinTokens(content, 'AND'), fallbackMatch: null };
  }
  return {
    match: joinTokens(content, 'AND'),
    fallbackMatch: joinTokens(content, 'OR'),
  };
}

/**
 * Run a query plan, widening only when the precise expression cannot fill the
 * requested page. Precise AND hits stay first; OR hits only top up the page and
 * are de-duplicated by the caller-provided stable key.
 */
export function executeFtsQueryPlan<T>(
  plan: FtsQueryPlan,
  limit: number,
  run: (match: string) => T[],
  keyOf: (row: T) => string | number,
): T[] {
  const primary = run(plan.match);
  if (primary.length >= limit || plan.fallbackMatch === null) return primary;

  const fallback = run(plan.fallbackMatch);
  if (primary.length === 0) return fallback;

  const rows = [...primary];
  const seen = new Set(primary.map(keyOf));
  for (const row of fallback) {
    const key = keyOf(row);
    if (seen.has(key)) continue;
    rows.push(row);
    seen.add(key);
    if (rows.length >= limit) break;
  }
  return rows;
}

/**
 * The expression to run first. Kept for callers that do not retry.
 */
export function escapeFtsQuery(rawQuery: string): string {
  return buildFtsQueryPlan(rawQuery).match;
}

function joinTokens(tokens: readonly string[], op: 'AND' | 'OR'): string {
  return tokens
    .map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`))
    .join(` ${op} `);
}
