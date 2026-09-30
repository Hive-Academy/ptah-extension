import { formatViolation, normaliseViolations, type Violation } from './report';

const v = (over: Partial<Violation>): Violation => ({
  file: 'a.ts',
  line: 1,
  kind: 'unknown-key',
  key: 'x.a.b',
  detail: 'd',
  ...over,
});

describe('report', () => {
  it('sorts by file, line, kind and key, independent of input order', () => {
    const input = [
      v({ file: 'b.ts', line: 1 }),
      v({ file: 'a.ts', line: 9 }),
      v({ file: 'a.ts', line: 2, kind: 'unknown-key' }),
      v({ file: 'a.ts', line: 2, kind: 'foreign-scope' }),
    ];
    const once = normaliseViolations(input).map(formatViolation);
    const reversed = normaliseViolations([...input].reverse()).map(
      formatViolation,
    );
    expect(once).toEqual(reversed);
    expect(once).toEqual([
      'a.ts:2: [foreign-scope] x.a.b - d',
      'a.ts:2: [unknown-key] x.a.b - d',
      'a.ts:9: [unknown-key] x.a.b - d',
      'b.ts:1: [unknown-key] x.a.b - d',
    ]);
  });

  it('drops exact duplicates reached by two rules', () => {
    expect(normaliseViolations([v({}), v({})])).toHaveLength(1);
  });

  it('omits empty key and detail parts', () => {
    expect(formatViolation(v({ key: '', detail: '' }))).toBe(
      'a.ts:1: [unknown-key]',
    );
  });
});
