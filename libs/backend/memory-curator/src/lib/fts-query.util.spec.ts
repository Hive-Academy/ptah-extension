import { escapeFtsQuery } from './fts-query.util';

describe('escapeFtsQuery', () => {
  it('strips double-quote metacharacter from query', () => {
    const result = escapeFtsQuery('hello "world" thing');
    expect(result).toContain('"hello"');
    expect(result).toContain('"world"');
    expect(result).toContain('"thing"*');
    expect(result).toBe('"hello" OR "world" OR "thing"*');
  });

  it('strips asterisk metacharacter from query tokens', () => {
    expect(escapeFtsQuery('foo* bar*')).toBe('"foo" OR "bar"*');
  });

  it('strips opening and closing parentheses from query', () => {
    expect(escapeFtsQuery('(hello) (world)')).toBe('"hello" OR "world"*');
  });

  it('drops single-character tokens', () => {
    const result = escapeFtsQuery('a the quick b fox');
    expect(result).not.toMatch(/"a"/);
    expect(result).not.toMatch(/"b"/);
    expect(result).toContain('"the"');
    expect(result).toContain('"quick"');
    expect(result).toContain('"fox"*');
  });

  it('applies prefix match (* suffix) only to the last token', () => {
    const result = escapeFtsQuery('alpha beta gamma');
    expect(result).toBe('"alpha" OR "beta" OR "gamma"*');
    const parts = result.split(' OR ');
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

  it('joins multi-token query with OR', () => {
    expect(escapeFtsQuery('memory retrieval pipeline')).toBe(
      '"memory" OR "retrieval" OR "pipeline"*',
    );
  });

  it('single surviving token gets the prefix match', () => {
    expect(escapeFtsQuery('configur')).toBe('"configur"*');
  });

  it('lowercases tokens before quoting', () => {
    expect(escapeFtsQuery('Hello World')).toBe('"hello" OR "world"*');
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
    expect(escapeFtsQuery('foo AND bar')).toBe('"foo" OR "bar"*');
  });

  it('neutralises FTS5 OR keyword (case-insensitive)', () => {
    expect(escapeFtsQuery('foo OR bar')).toBe('"foo" OR "bar"*');
  });

  it('neutralises FTS5 NOT keyword (case-insensitive)', () => {
    expect(escapeFtsQuery('foo NOT bar')).toBe('"foo" OR "bar"*');
  });

  it('neutralises FTS5 NEAR keyword (case-insensitive)', () => {
    expect(escapeFtsQuery('NEAR foo bar')).toBe('"foo" OR "bar"*');
  });

  it('neutralises lowercase fts5 keywords', () => {
    expect(escapeFtsQuery('foo and bar or baz')).toBe(
      '"foo" OR "bar" OR "baz"*',
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
