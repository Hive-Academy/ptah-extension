import {
  jsonUtf8Bytes,
  omitJsonPaths,
  shrinkJsonStringLeaves,
} from './json-budget';

const CONTROL = String.fromCharCode(0x01);
const LAST_CONTROL = String.fromCharCode(0x1f);
const E_ACUTE = String.fromCharCode(0xe9);
const CJK = String.fromCharCode(0x4e2d);
const EMOJI = String.fromCodePoint(0x1f600);

const byJson = (value: unknown): number => jsonUtf8Bytes(value);

function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function prefixBeforeSuffix(text: string | undefined): string {
  return (text ?? '').split('[')[0];
}

describe('jsonUtf8Bytes', () => {
  it('counts ASCII one byte per character plus quotes', () => {
    expect(jsonUtf8Bytes('abc')).toBe(5);
  });

  it('counts a non-whitespace control character as six JSON bytes', () => {
    expect(jsonUtf8Bytes(CONTROL + LAST_CONTROL)).toBe(2 + 12);
  });

  it('counts multibyte and astral characters by UTF-8 length', () => {
    expect(jsonUtf8Bytes(E_ACUTE)).toBe(2 + 2);
    expect(jsonUtf8Bytes(CJK)).toBe(2 + 3);
    expect(jsonUtf8Bytes(EMOJI)).toBe(2 + 4);
  });

  it('treats undefined as null', () => {
    expect(jsonUtf8Bytes(undefined)).toBe(4);
  });
});

describe('omitJsonPaths', () => {
  const source = {
    id: 's1',
    cliSessions: [
      { agentId: 'a1', stdout: 'x'.repeat(10), segments: [1, 2] },
      { agentId: 'a2', stdout: 'y', streamEvents: [{ t: 1 }] },
    ],
    nested: { keep: 1, drop: 2 },
  };

  it('removes every match of a wildcard path over array indexes', () => {
    const result = omitJsonPaths(source, [
      ['cliSessions', '*', 'stdout'],
      ['cliSessions', '*', 'segments'],
      ['cliSessions', '*', 'streamEvents'],
    ]);
    expect(result).toEqual({
      id: 's1',
      cliSessions: [{ agentId: 'a1' }, { agentId: 'a2' }],
      nested: { keep: 1, drop: 2 },
    });
  });

  it('matches object keys with a wildcard', () => {
    expect(
      omitJsonPaths({ a: { x: 1, y: 2 }, b: { x: 3 } }, [['*', 'x']]),
    ).toEqual({ a: { y: 2 }, b: {} });
  });

  it('matches a numeric array index segment', () => {
    expect(omitJsonPaths({ list: ['a', 'b', 'c'] }, [['list', 1]])).toEqual({
      list: ['a', 'c'],
    });
  });

  it('does not mutate the input and returns fresh containers', () => {
    const before = JSON.parse(JSON.stringify(source));
    const result = omitJsonPaths(source, [['nested', 'drop']]);
    expect(source).toEqual(before);
    expect(result).not.toBe(source);
    expect(result.cliSessions).not.toBe(source.cliSessions);
    expect(result.nested).toEqual({ keep: 1 });
  });

  it('ignores paths that do not exist and empty paths', () => {
    expect(omitJsonPaths(source, [['missing', '*', 'x'], []])).toEqual(source);
  });
});

describe('shrinkJsonStringLeaves', () => {
  it('returns the value unchanged when it already fits', () => {
    const value = { text: 'short' };
    expect(
      shrinkJsonStringLeaves(value, {
        maxEstimatorBytes: 1000,
        maxJsonBytes: 1000,
        estimate: byJson,
      }),
    ).toBe(value);
  });

  it('shrinks string leaves and counts the suffix inside the JSON budget', () => {
    const value = { a: 'a'.repeat(500), b: 'b'.repeat(300), n: 7 };
    const result = shrinkJsonStringLeaves(value, {
      maxEstimatorBytes: 10_000,
      maxJsonBytes: 200,
      estimate: byJson,
    });
    expect(result).not.toBeNull();
    expect(jsonUtf8Bytes(result)).toBeLessThanOrEqual(200);
    expect(result?.n).toBe(7);
    expect(result?.a).toMatch(/^a*\[truncated \d+ bytes\]$/);
    const kept = prefixBeforeSuffix(result?.a).length;
    expect(result?.a).toBe(
      `${'a'.repeat(kept)}[truncated ${500 - kept} bytes]`,
    );
  });

  it('satisfies a tighter estimator budget independently of the JSON budget', () => {
    const estimate = (value: unknown): number => jsonUtf8Bytes(value) * 2;
    const result = shrinkJsonStringLeaves(
      { text: 'z'.repeat(1000) },
      { maxEstimatorBytes: 300, maxJsonBytes: 10_000, estimate },
    );
    expect(result).not.toBeNull();
    expect(estimate(result)).toBeLessThanOrEqual(300);
    expect(jsonUtf8Bytes(result)).toBeLessThanOrEqual(10_000);
  });

  it('accounts for control characters at six JSON bytes each', () => {
    const result = shrinkJsonStringLeaves(
      { text: CONTROL.repeat(200) },
      { maxEstimatorBytes: 10_000, maxJsonBytes: 120, estimate: byJson },
    );
    expect(result).not.toBeNull();
    expect(jsonUtf8Bytes(result)).toBeLessThanOrEqual(120);
    const prefix = prefixBeforeSuffix(result?.text);
    expect(prefix.length).toBeGreaterThan(0);
    expect(Array.from(prefix).every((ch) => ch === CONTROL)).toBe(true);
    expect(result?.text).toBe(
      `${prefix}[truncated ${200 - prefix.length} bytes]`,
    );
  });

  it('never splits a multibyte or astral character', () => {
    const value = { cjk: CJK.repeat(100), emoji: EMOJI.repeat(100) };
    const result = shrinkJsonStringLeaves(value, {
      maxEstimatorBytes: 10_000,
      maxJsonBytes: 150,
      estimate: byJson,
    });
    expect(result).not.toBeNull();
    expect(jsonUtf8Bytes(result)).toBeLessThanOrEqual(150);
    expect(hasLoneSurrogate(result?.emoji ?? '')).toBe(false);
    const emojiPrefix = prefixBeforeSuffix(result?.emoji);
    expect(Array.from(emojiPrefix).every((ch) => ch === EMOJI)).toBe(true);
    const removed = 400 - Buffer.byteLength(emojiPrefix, 'utf8');
    expect(result?.emoji).toBe(`${emojiPrefix}[truncated ${removed} bytes]`);
    const cjkPrefix = prefixBeforeSuffix(result?.cjk);
    expect(Array.from(cjkPrefix).every((ch) => ch === CJK)).toBe(true);
  });

  it('keeps short leaves whose truncated form would be longer', () => {
    const result = shrinkJsonStringLeaves(
      { tiny: 'ab', big: 'c'.repeat(400) },
      { maxEstimatorBytes: 10_000, maxJsonBytes: 60, estimate: byJson },
    );
    expect(result?.tiny).toBe('ab');
    expect(jsonUtf8Bytes(result)).toBeLessThanOrEqual(60);
  });

  it('returns null when the value cannot fit even with every leaf shrunk', () => {
    expect(
      shrinkJsonStringLeaves(
        { a: 'x'.repeat(500), b: 'y'.repeat(500), c: 'z'.repeat(500) },
        { maxEstimatorBytes: 10_000, maxJsonBytes: 40, estimate: byJson },
      ),
    ).toBeNull();
    expect(
      shrinkJsonStringLeaves(
        { numbers: Array.from({ length: 100 }, (_, i) => i) },
        { maxEstimatorBytes: 10_000, maxJsonBytes: 50, estimate: byJson },
      ),
    ).toBeNull();
  });

  it('does not mutate the input', () => {
    const value = { list: ['q'.repeat(300)] };
    shrinkJsonStringLeaves(value, {
      maxEstimatorBytes: 10_000,
      maxJsonBytes: 80,
      estimate: byJson,
    });
    expect(value.list[0]).toBe('q'.repeat(300));
  });
});
