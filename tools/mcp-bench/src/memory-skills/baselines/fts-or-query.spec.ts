import { buildFtsOrQuery } from './fts-or-query';

/**
 * Outputs are pinned against the pre-473 builder exactly as read from
 * `git show 51f235a1e:libs/backend/memory-curator/src/lib/fts-query.util.ts`.
 * The pins also prove the baseline was NOT modernised: filler tokens survive
 * (no stopword filter), apostrophes stay inside the token (no split), the
 * join is OR, and only the last surviving token is prefix-matched.
 */
describe('buildFtsOrQuery (pinned pre-473 baseline, design 85/159)', () => {
  it('pins five query outputs', () => {
    // 1. Filler tokens survive: no stopword filter existed pre-473.
    expect(
      buildFtsOrQuery('What did we decide about the judge threshold'),
    ).toBe(
      '"what" OR "did" OR "we" OR "decide" OR "about" OR "the" OR "judge" OR "threshold"*',
    );
    // 2. Apostrophes are not split: "user's" stays one token pre-473.
    expect(buildFtsOrQuery("The user's decision")).toBe(
      '"the" OR "user\'s" OR "decision"*',
    );
    // 3. FTS5 boolean keywords are dropped after lowercasing.
    expect(buildFtsOrQuery('NEAR and merge')).toBe('"merge"*');
    // 4. Single-character tokens are dropped; nothing survives -> '""'.
    expect(buildFtsOrQuery('a 7')).toBe('""');
    // 5. Metacharacters are stripped, quoted input is neutralised, and the
    // single-character "x" is dropped by the length filter.
    expect(buildFtsOrQuery('judge "threshold" OR x')).toBe(
      '"judge" OR "threshold"*',
    );
  });

  it('returns the never-matching expression for empty and metachar-only input', () => {
    expect(buildFtsOrQuery('')).toBe('""');
    expect(buildFtsOrQuery('  * ( ) ^ : + - ~  ')).toBe('""');
  });

  it('lowercases the input and prefix-matches only the last surviving token', () => {
    expect(buildFtsOrQuery('Merge Retention')).toBe('"merge" OR "retention"*');
    expect(buildFtsOrQuery('merge NOT')).toBe('"merge"*');
  });
});
