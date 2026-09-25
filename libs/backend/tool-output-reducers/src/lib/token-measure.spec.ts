import { encode } from 'gpt-tokenizer';
import { countTokens, fitsBudget } from './token-measure';

jest.mock('gpt-tokenizer', () => {
  const actual =
    jest.requireActual<typeof import('gpt-tokenizer')>('gpt-tokenizer');
  return { ...actual, encode: jest.fn(actual.encode) };
});

const encodeSpy = encode as jest.MockedFunction<typeof encode>;

/** Deterministic ~1 MB of log-like text (xorshift PRNG, fixed seed). */
function megabyteOfLogText(): string {
  let seed = 0x2545f491;
  const next = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const words = [
    'const',
    'request',
    'handler',
    'src/lib/tool.ts',
    '=>',
    'await',
    'timeout',
    'the',
    'value',
    '0x1f3a',
  ];
  const size = 1024 * 1024;
  const lines: string[] = [];
  let length = 0;
  for (let i = 0; length < size; i++) {
    let line = `[2026-09-25T10:${String(i % 60).padStart(2, '0')}]`;
    for (let k = 0; k < 10; k++) {
      line += ` ${words[Math.floor(next() * words.length)]}`;
      if (next() < 0.3) line += String(Math.floor(next() * 100000));
    }
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join('\n').slice(0, size);
}

describe('countTokens', () => {
  beforeEach(() => encodeSpy.mockClear());

  it('returns a pinned o200k_base count for a fixed string', () => {
    expect(countTokens('The quick brown fox jumps over the lazy dog.')).toBe(
      10,
    );
  });

  it('returns 0 for an empty string without encoding', () => {
    expect(countTokens('')).toBe(0);
    expect(encodeSpy).not.toHaveBeenCalled();
  });

  it('counts special-token markers as plain text instead of throwing', () => {
    expect(countTokens('Hello, world! <|endoftext|>')).toBe(11);
  });

  /**
   * Load-robust (Batch 2c, authorized test-only change): fastest of three.
   * Over 500 ms (it measured 577 ms with 16 busy processes on the machine)
   * the run still passes when it is under a hard 10 s ceiling and within
   * LOAD_FACTOR of counting the first quarter of the same text, timed right
   * after it under the same load. Idle, the full count ran at 3.6-5.3x the
   * quarter (Node 24); a quadratic count would run at ~16x.
   */
  it('counts 1 MB of text in under 500 ms', () => {
    const LOAD_FACTOR = 8;
    const HARD_CEILING_MS = 10_000;
    const fastestMs = (sample: string): number => {
      let elapsed = Infinity;
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        countTokens(sample);
        elapsed = Math.min(elapsed, performance.now() - start);
      }
      return elapsed;
    };
    countTokens('warm up the encoder');
    const text = megabyteOfLogText();
    expect(text.length).toBe(1024 * 1024);

    const tokens = countTokens(text);
    const elapsed = fastestMs(text);

    expect(tokens).toBeGreaterThan(100_000);
    if (elapsed >= 500) {
      expect(elapsed).toBeLessThan(HARD_CEILING_MS);
      expect(elapsed).toBeLessThan(LOAD_FACTOR * fastestMs(text.slice(0, 256 * 1024)));
    }
  }, 120_000);
});

describe('fitsBudget', () => {
  const budget = { tokens: 2000, chars: 8000 };

  beforeEach(() => encodeSpy.mockClear());

  it('skips encode for short text (byte length within the token budget)', () => {
    expect(fitsBudget('short result', budget)).toBe(true);
    expect(fitsBudget('x'.repeat(2000), budget)).toBe(true);
    expect(encodeSpy).not.toHaveBeenCalled();
  });

  it('skips encode for text over the char ceiling', () => {
    expect(fitsBudget('a'.repeat(8001), budget)).toBe(false);
    expect(encodeSpy).not.toHaveBeenCalled();
  });

  it('encodes text between the two pre-checks and compares the count', () => {
    const words = 'alpha beta gamma delta '.repeat(150); // 3,450 chars
    expect(fitsBudget(words, budget)).toBe(true);
    expect(encodeSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects multi-byte text whose token count exceeds the budget', () => {
    // 3,000 CJK chars: under the char ceiling, over 2,000 tokens.
    const cjk = '漢字仮名交じり文'.repeat(375);
    expect(cjk.length).toBe(3000);
    expect(countTokens(cjk)).toBeGreaterThan(budget.tokens);
    expect(fitsBudget(cjk, budget)).toBe(false);
  });

  it('treats a result exactly at both limits as fitting', () => {
    expect(fitsBudget('', { tokens: 0, chars: 0 })).toBe(true);
    expect(fitsBudget('abcd', { tokens: 4, chars: 4 })).toBe(true);
  });

  it('throws a RangeError on a negative or NaN limit', () => {
    expect(() => fitsBudget('a', { tokens: -1, chars: 10 })).toThrow(
      RangeError,
    );
    expect(() => fitsBudget('a', { tokens: 10, chars: Number.NaN })).toThrow(
      RangeError,
    );
  });
});
