import { encode } from 'gpt-tokenizer';
import {
  countTokens,
  countTokensPiecewise,
  fitsBudget,
  fittingPrefixLength,
  O200K_SPLIT_PATTERN,
} from './token-measure';

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

  it('counts text between the two pre-checks piece-wise and compares the count', () => {
    const words = 'alpha beta gamma delta '.repeat(150); // 3,450 chars
    expect(fitsBudget(words, budget)).toBe(true);
    expect(encodeSpy).toHaveBeenCalledTimes(4); // pieces of at most 1,024 chars
  });

  it('stops counting once over the budget', () => {
    const words = 'alpha beta gamma delta '.repeat(340); // 7,820 chars, ~1,360 tokens
    expect(fitsBudget(words, { tokens: 100, chars: 8000 })).toBe(false);
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

describe('countTokensPiecewise', () => {
  beforeEach(() => encodeSpy.mockClear());

  it('equals the exact count for text up to one piece long', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(22); // 990 chars
    expect(countTokensPiecewise(text)).toBe(countTokens(text));
  });

  it('equals the exact count of a long ordinary text', () => {
    const text = 'const request = await handler(value, 0x1f3a); '.repeat(400);
    expect(countTokensPiecewise(text)).toBe(countTokens(text));
  });

  it('encodes a long run of one character in pieces of at most 1,024 chars', () => {
    const run = 'a'.repeat(65_000);
    const tokens = countTokensPiecewise(run);
    expect(tokens).toBeGreaterThan(0);
    for (const [piece] of encodeSpy.mock.calls) {
      expect(piece.length).toBeLessThanOrEqual(1024);
    }
  });

  it('copies the installed o200k split pattern verbatim', () => {
    const installed = jest.requireActual<{ O200K_TOKEN_SPLIT_REGEX: RegExp }>(
      'gpt-tokenizer/cjs/encodingParams/constants',
    );
    expect(O200K_SPLIT_PATTERN).toBe(installed.O200K_TOKEN_SPLIT_REGEX.source);
  });

  describe('review 2e r1 S1: an upper bound, never below the exact count', () => {
    it('counts the 1,018-space boundary case exactly (the old count was 18 of 19)', () => {
      const text = ' '.repeat(1018) + '59X!GWee0_g-';
      expect(countTokens(text)).toBe(19);
      expect(countTokensPiecewise(text)).toBe(19);
    });

    it('counts the reviewer default-budget case as 2,001 and rejects it at 2,000 tokens', () => {
      const raw = reviewerS1Text();
      expect(countTokens(raw)).toBe(2001);
      expect(countTokensPiecewise(raw)).toBe(2001);
      expect(fitsBudget(raw, { tokens: 2000, chars: 8000 })).toBe(false);
    });

    it('equals the exact count on 300 random texts that straddle piece boundaries', () => {
      let seed = 7;
      const alphabet = ['a', 'Z', ' ', '  ', '\n', '\r\n', '9', '12', '!', '?', '_', '-', "'s", 'é', '漢', '😀', '\t', '/', '.'];
      for (let sample = 0; sample < 300; sample++) {
        let text = '';
        const length = 900 + (sample % 7) * 400;
        while (text.length < length) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          text += alphabet[seed % alphabet.length];
        }
        expect(countTokensPiecewise(text)).toBe(countTokens(text));
      }
    });

    it('never cuts after whitespace: a space run before a tab stays one count', () => {
      // "  \t." — in the whole text `\s+(?!\S)` takes the two spaces only.
      const text = `${'word '.repeat(203)}x  \t.!-${'word '.repeat(300)}`;
      expect(countTokensPiecewise(text)).toBe(countTokens(text));
    });

    it('bounds stretches without a safe cut or with one long pre-token', () => {
      for (const text of [
        `lead ${'x'.repeat(3000)} tail`,
        '}\n'.repeat(2000),
        ` \t${'  \n'.repeat(900)}end`,
      ]) {
        expect(countTokensPiecewise(text)).toBeGreaterThanOrEqual(countTokens(text));
      }
    });
  });

  it('stops once the running sum passes the limit', () => {
    const words = 'alpha beta gamma delta '.repeat(3000);
    const partial = countTokensPiecewise(words, 10);
    expect(partial).toBeGreaterThan(10);
    expect(encodeSpy).toHaveBeenCalledTimes(1);
  });

  it('bounds a long run of one character by its bytes without encoding it', () => {
    const run = 'a'.repeat(65_000);
    expect(countTokensPiecewise(run)).toBe(65_000);
    expect(encodeSpy).not.toHaveBeenCalled();
  });

  it('never splits a surrogate pair between pieces', () => {
    const text = `${'a'.repeat(1023)}${'😀'.repeat(600)}`;
    countTokensPiecewise(text);
    for (const [piece] of encodeSpy.mock.calls) {
      const first = piece.charCodeAt(0);
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
    }
  });
});

describe('fittingPrefixLength', () => {
  it('returns the whole text when it fits', () => {
    expect(fittingPrefixLength('short', { tokens: 10, chars: 100 })).toBe(5);
  });

  it('stops at the char ceiling', () => {
    expect(fittingPrefixLength('x '.repeat(100), { tokens: 1000, chars: 51 })).toBe(51);
  });

  it('returns the longest prefix within the token limit', () => {
    const text = 'alpha beta gamma delta '.repeat(400);
    const budget = { tokens: 700, chars: 100_000 };
    const length = fittingPrefixLength(text, budget);
    expect(fitsBudget(text.slice(0, length), budget)).toBe(true);
    expect(countTokensPiecewise(text.slice(0, length + 8))).toBeGreaterThan(700);
  });

  it('never ends inside a surrogate pair', () => {
    const text = '😀'.repeat(5000);
    for (const chars of [101, 1025, 3001]) {
      const length = fittingPrefixLength(text, { tokens: 100_000, chars });
      expect(length % 2).toBe(0);
    }
    const byTokens = fittingPrefixLength(text, { tokens: 333, chars: 100_000 });
    expect(byTokens % 2).toBe(0);
  });

  it('returns 0 when nothing fits', () => {
    expect(fittingPrefixLength('hello', { tokens: 0, chars: 100 })).toBe(0);
  });

  it('review 2e r1 S1: every returned prefix is within the budget by the exact count', () => {
    const raw = reviewerS1Text();
    for (const tokens of [1999, 2000, 1500, 777]) {
      const length = fittingPrefixLength(raw, { tokens, chars: 8000 });
      expect(countTokens(raw.slice(0, length))).toBeLessThanOrEqual(tokens);
    }
    const spaces = ' '.repeat(1018) + '59X!GWee0_g-'.repeat(200);
    for (const tokens of [18, 100, 555]) {
      const length = fittingPrefixLength(spaces, { tokens, chars: 100_000 });
      expect(countTokens(spaces.slice(0, length))).toBeLessThanOrEqual(tokens);
    }
  });
});

/** The review's S1 reproduction: 2,734 chars that encode to exactly 2,001 tokens. */
function reviewerS1Text(): string {
  let seed = 42;
  const alphabet = 'abcefGWiX012345679_!-??';
  let raw = '';
  for (let i = 0; i <= 222; i++) {
    let s = '';
    for (let j = 0; j < 3500; j++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      s += alphabet[seed % alphabet.length];
    }
    if (i === 222) raw = s.slice(0, 2734);
  }
  return raw;
}
