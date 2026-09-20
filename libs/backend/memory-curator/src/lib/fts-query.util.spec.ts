import {
  buildFtsQueryPlan,
  escapeFtsQuery,
  executeFtsQueryPlan,
} from './fts-query.util';

describe('escapeFtsQuery', () => {
  it('strips double-quote metacharacter from query', () => {
    const result = escapeFtsQuery('hello "world" thing');
    expect(result).toContain('"hello"');
    expect(result).toContain('"world"');
    expect(result).toContain('"thing"*');
    expect(result).toBe('"hello" AND "world" AND "thing"*');
  });

  it('strips asterisk metacharacter from query tokens', () => {
    expect(escapeFtsQuery('foo* bar*')).toBe('"foo" AND "bar"*');
  });

  it('strips opening and closing parentheses from query', () => {
    expect(escapeFtsQuery('(hello) (world)')).toBe('"hello" AND "world"*');
  });

  it('drops single-character tokens', () => {
    const result = escapeFtsQuery('a the quick b fox');
    expect(result).not.toMatch(/"a"/);
    expect(result).not.toMatch(/"b"/);
    expect(result).toBe('"quick" AND "fox"*');
  });

  it('applies prefix match (* suffix) only to the last token', () => {
    const result = escapeFtsQuery('alpha beta gamma');
    expect(result).toBe('"alpha" AND "beta" AND "gamma"*');
    const parts = result.split(' AND ');
    expect(parts.at(-1)).toMatch(/"\w+"\*$/);
    for (const p of parts.slice(0, -1)) {
      expect(p).not.toMatch(/\*$/);
    }
  });

  it('returns the no-match sentinel for an empty string', () => {
    expect(escapeFtsQuery('')).toBe('""');
  });

  it('returns the no-match sentinel when all tokens are single characters', () => {
    expect(escapeFtsQuery('a b c')).toBe('""');
  });

  it('returns the no-match sentinel for a string that is only metacharacters', () => {
    expect(escapeFtsQuery('"*(*)')).toBe('""');
  });

  it('joins multi-token query with AND', () => {
    expect(escapeFtsQuery('memory retrieval pipeline')).toBe(
      '"memory" AND "retrieval" AND "pipeline"*',
    );
  });

  it('single surviving token gets the prefix match', () => {
    expect(escapeFtsQuery('configur')).toBe('"configur"*');
  });

  it('lowercases tokens before quoting', () => {
    expect(escapeFtsQuery('Hello World')).toBe('"hello" AND "world"*');
  });

  // Metacharacter coverage (F-H1 security fix)

  it('strips caret ^ metacharacter', () => {
    const result = escapeFtsQuery('foo^bar baz');
    expect(result).not.toContain('^');
    expect(result).not.toContain('"^"');
  });

  it('strips colon : column-qualifier metacharacter', () => {
    const result = escapeFtsQuery('subject:secret foo');
    expect(result).not.toContain(':');
    expect(result).toContain('"foo"*');
  });

  it('strips plus + operator', () => {
    const result = escapeFtsQuery('+required term');
    expect(result).not.toContain('+');
    expect(result).toContain('"required"');
    expect(result).toContain('"term"*');
  });

  it('strips minus - operator', () => {
    const result = escapeFtsQuery('foo -exclude bar');
    expect(result).not.toContain('-');
    expect(result).toContain('"foo"');
    expect(result).toContain('"bar"*');
  });

  it('strips tilde ~ proximity operator', () => {
    expect(escapeFtsQuery('hello~world')).not.toContain('~');
  });

  it('neutralises FTS5 AND keyword (case-insensitive)', () => {
    expect(escapeFtsQuery('foo AND bar')).toBe('"foo" AND "bar"*');
  });

  it('neutralises FTS5 OR keyword (case-insensitive)', () => {
    expect(escapeFtsQuery('foo OR bar')).toBe('"foo" AND "bar"*');
  });

  it('neutralises FTS5 NOT keyword (case-insensitive)', () => {
    expect(escapeFtsQuery('foo NOT bar')).toBe('"foo" AND "bar"*');
  });

  it('neutralises FTS5 NEAR keyword (case-insensitive)', () => {
    expect(escapeFtsQuery('NEAR foo bar')).toBe('"foo" AND "bar"*');
  });

  it('neutralises lowercase fts5 keywords', () => {
    expect(escapeFtsQuery('foo and bar or baz')).toBe(
      '"foo" AND "bar" AND "baz"*',
    );
  });

  it('returns no-match sentinel for a query of only FTS5 keywords', () => {
    expect(escapeFtsQuery('AND OR NOT NEAR')).toBe('""');
  });

  it('subject:foo column-qualifier does not survive stripping', () => {
    const result = escapeFtsQuery('subject:foo');
    expect(result).not.toContain(':');
    expect(result).toContain('"subject"');
    expect(result).toContain('"foo"*');
  });
});

describe('buildFtsQueryPlan', () => {
  it('drops stopwords and ANDs the content terms', () => {
    // The forensics query that returned 0 relevant results of 5 under OR.
    expect(
      buildFtsQueryPlan('what did we decide about the judge threshold').match,
    ).toBe('"decide" AND "judge" AND "threshold"*');
  });

  it('offers the OR form as the fallback for a multi-term query', () => {
    const plan = buildFtsQueryPlan('how do we name DI tokens');
    expect(plan.match).toBe('"name" AND "di" AND "tokens"*');
    expect(plan.fallbackMatch).toBe('"name" OR "di" OR "tokens"*');
  });

  it('keeps the OR form over the raw tokens when the query is only stopwords', () => {
    const plan = buildFtsQueryPlan('what did we do about it');
    expect(plan.match).toBe(
      '"what" OR "did" OR "we" OR "do" OR "about" OR "it"*',
    );
    expect(plan.fallbackMatch).toBeNull();
  });

  it('offers no fallback for a single content term', () => {
    const plan = buildFtsQueryPlan('what is commitlint');
    expect(plan.match).toBe('"commitlint"*');
    expect(plan.fallbackMatch).toBeNull();
  });

  it('keeps a snake_case identifier as one quoted query phrase', () => {
    expect(buildFtsQueryPlan('memory_chunks_fts')).toEqual({
      match: '"memory_chunks_fts"*',
      fallbackMatch: null,
    });
  });

  it('offers no fallback for an empty query', () => {
    expect(buildFtsQueryPlan('')).toEqual({
      match: '""',
      fallbackMatch: null,
    });
  });

  it('fallback repeats the content terms, not the stopwords', () => {
    const plan = buildFtsQueryPlan('why did the release branch drift');
    expect(plan.match).toBe('"release" AND "branch" AND "drift"*');
    expect(plan.fallbackMatch).toBe('"release" OR "branch" OR "drift"*');
  });

  it('treats apostrophes as token separators and drops the possessive suffix', () => {
    const straight = buildFtsQueryPlan(
      "what is the user's preference for commit messages",
    );
    const curly = buildFtsQueryPlan(
      'what is the user’s preference for commit messages',
    );
    expect(straight.match).toBe(
      '"user" AND "preference" AND "commit" AND "messages"*',
    );
    expect(curly).toEqual(straight);
  });
});

describe('executeFtsQueryPlan', () => {
  const plan = {
    match: '"alpha" AND "beta"*',
    fallbackMatch: '"alpha" OR "beta"*',
  } as const;

  it('uses the fallback when the AND form returns nothing', () => {
    const run = jest.fn((match: string) =>
      match === plan.match ? [] : [{ id: 1 }, { id: 2 }],
    );

    expect(executeFtsQueryPlan(plan, 5, run, (row) => row.id)).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    expect(run).toHaveBeenCalledWith(plan.fallbackMatch);
  });

  it('tops up an underfilled AND page with de-duplicated OR hits', () => {
    const run = jest.fn((match: string) =>
      match === plan.match
        ? [{ id: 1 }, { id: 2 }]
        : [{ id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }],
    );

    expect(executeFtsQueryPlan(plan, 5, run, (row) => row.id)).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
      { id: 5 },
    ]);
  });
});
