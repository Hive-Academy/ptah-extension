import {
  rankPaletteMatches,
  scorePaletteMatch,
  type PaletteLabelled,
} from './palette-match';

function labelled(...labels: readonly string[]): PaletteLabelled[] {
  return labels.map((label) => ({ label }));
}

function ranked(labels: readonly string[], query: string): string[] {
  return rankPaletteMatches(labelled(...labels), query).map((e) => e.label);
}

describe('scorePaletteMatch', () => {
  // -------------------------------------------------------------------------
  // FR-C6.3, the named rule: a prefix match outranks an interior match.
  //
  // Asserted twice on purpose. The pair below is the rule as a user meets it;
  // the tier-boundary block after it is the rule as a PROPERTY, because a pair
  // of hand-picked strings only proves that those two strings happen to come
  // out in that order.
  // -------------------------------------------------------------------------
  it('ranks a prefix match above an interior match of the same needle', () => {
    const prefix = scorePaletteMatch('label filter', 'label');
    const interior = scorePaletteMatch('Add a label', 'label');

    expect(prefix).not.toBeNull();
    expect(interior).not.toBeNull();
    expect(prefix as number).toBeGreaterThan(interior as number);
  });

  it('keeps the tiers disjoint however late the match starts', () => {
    // A needle pushed as far right as a label can push it. If the position
    // adjustment were uncapped, a very late word-prefix would sink below an
    // early substring and "prefix outranks interior" would hold for short
    // labels and quietly stop holding for long ones.
    const padding = 'x'.repeat(400);
    const lateWordPrefix = scorePaletteMatch(`${padding} label`, 'label');
    const earlySubstring = scorePaletteMatch('xlabel', 'label');

    expect(lateWordPrefix as number).toBeGreaterThan(earlySubstring as number);

    const lateSubstring = scorePaletteMatch(`${padding}label`, 'label');
    // 'l...a...b...e...l' — in order, never contiguous.
    const bestSubsequence = scorePaletteMatch('l a b e l', 'label');
    expect(lateSubstring as number).toBeGreaterThan(bestSubsequence as number);
  });

  it('ranks an exact label above a label that merely starts with the needle', () => {
    expect(scorePaletteMatch('Reindex', 'reindex') as number).toBeGreaterThan(
      scorePaletteMatch('Reindex the workspace', 'reindex') as number,
    );
  });

  // -------------------------------------------------------------------------
  // Subsequence matching (FR-C6.3)
  // -------------------------------------------------------------------------
  it('matches characters that appear in order without being adjacent', () => {
    expect(scorePaletteMatch('Clear all filters', 'caf')).not.toBeNull();
    expect(scorePaletteMatch('Create a task', 'ctk')).not.toBeNull();
  });

  it('refuses characters that appear out of order', () => {
    // Every character of 'fac' is present in 'Clear all filters'; only the
    // ORDER refuses it. A matcher that merely tested set membership would
    // return a score here.
    expect(scorePaletteMatch('Clear all filters', 'fac')).toBeNull();
  });

  it('refuses a character the label does not carry at all', () => {
    expect(scorePaletteMatch('Clear all filters', 'z')).toBeNull();
  });

  it('scores a denser subsequence above a sparser one', () => {
    const dense = scorePaletteMatch('ab_______________________', 'ab');
    const sparse = scorePaletteMatch('a________________________b', 'ab');
    expect(dense as number).toBeGreaterThan(sparse as number);
  });

  // -------------------------------------------------------------------------
  // The empty query, and the reason `null` is not `0`
  // -------------------------------------------------------------------------
  it('scores every label neutrally for a blank query', () => {
    expect(scorePaletteMatch('anything at all', '')).toBe(0);
    expect(scorePaletteMatch('anything at all', '   ')).toBe(0);
  });

  it('distinguishes a non-match (null) from a neutral match (0)', () => {
    // The distinction is load-bearing: a caller testing `if (score)` would
    // discard the whole catalogue the instant the input is cleared.
    expect(scorePaletteMatch('Reindex', '')).toBe(0);
    expect(scorePaletteMatch('Reindex', 'zzz')).toBeNull();
  });

  it('ignores case and surrounding whitespace in the query', () => {
    expect(scorePaletteMatch('Reindex', '  REINDEX  ')).toBe(
      scorePaletteMatch('Reindex', 'reindex'),
    );
  });
});

describe('rankPaletteMatches', () => {
  it('returns every entry in authored order for a blank query', () => {
    const labels = ['Create a task', 'Clear all filters', 'Reindex'];
    expect(ranked(labels, '')).toEqual(labels);
  });

  it('drops entries that do not match', () => {
    expect(ranked(['Create a task', 'Reindex'], 'reindex')).toEqual([
      'Reindex',
    ]);
  });

  it('puts the prefix match first even when the interior match was authored first', () => {
    // Authored order deliberately opposes the ranking, so a ranker that only
    // filtered would fail this and a ranker that only sorted by input order
    // would too.
    expect(
      ranked(['Add label: filter-work', 'Filter by status: Backlog'], 'filter'),
    ).toEqual(['Filter by status: Backlog', 'Add label: filter-work']);
  });

  it('keeps equal-scoring entries in authored order', () => {
    // Three identical labels can only be told apart by their input position.
    const entries = [
      { label: 'Reindex', id: 'a' },
      { label: 'Reindex', id: 'b' },
      { label: 'Reindex', id: 'c' },
    ];
    expect(rankPaletteMatches(entries, 'reindex').map((e) => e.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('does not mutate the input array', () => {
    const entries = labelled('b', 'a', 'c');
    const before = entries.map((e) => e.label);
    rankPaletteMatches(entries, 'a');
    expect(entries.map((e) => e.label)).toEqual(before);
  });

  it('treats the query as literal text, never as a pattern (BR-10)', () => {
    // A regex-backed matcher would either throw on this needle or match
    // everything. Both are wrong; the only right answer is "no entry contains
    // those characters in that order".
    expect(ranked(['Create a task', 'Reindex'], '.*')).toEqual([]);
    expect(ranked(['Create a task', 'Reindex'], '[')).toEqual([]);
    // ...and a needle that IS present literally still matches.
    expect(ranked(['Filter by label: a.b', 'Reindex'], 'a.b')).toEqual([
      'Filter by label: a.b',
    ]);
  });
});
