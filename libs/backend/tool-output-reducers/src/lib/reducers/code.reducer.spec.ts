import type { ReduceContext } from '../reducer.types';
import {
  createCodeReducer,
  type CodeLineSpan,
  type CodeOutline,
  type CodeOutliner,
} from './code.reducer';
import { reduceLog } from './log.reducer';

const NOTE = /^… (\d+) lines? omitted …$/;
const CTX: ReduceContext = { budgetTokens: 200, languageHint: 'typescript' };

/**
 * Reconstruction oracle: walking the output against the input's `\n` lines,
 * every output line is either the next input line verbatim or a note that
 * skips exactly N input lines, and together they account for every input
 * line once, in order. So nothing was merged, reordered, edited or invented.
 */
function expectReconstructs(output: string, input: string): void {
  const source = input.split('\n');
  let cursor = 0;
  for (const line of output.split('\n')) {
    const note = NOTE.exec(line);
    if (note) {
      cursor += Number(note[1]);
      continue;
    }
    if (source[cursor] !== line) {
      throw new Error(
        `output line ${JSON.stringify(line)} is not input line ${cursor} ${JSON.stringify(source[cursor])}`,
      );
    }
    cursor++;
  }
  expect(cursor).toBe(source.length);
}

/** An outliner that always answers `outline` and records its calls. */
function fakeOutliner(outline: CodeOutline | null): CodeOutliner & {
  calls: Array<[string, string, string | undefined]>;
} {
  const calls: Array<[string, string, string | undefined]> = [];
  return {
    calls,
    outline: async (source, language, focusSymbol) => {
      calls.push([source, language, focusSymbol]);
      return outline;
    },
  };
}

function span(startLine: number, endLine: number): CodeLineSpan {
  return { startLine, endLine };
}

/** A small TypeScript file; comments give each line's 0-based index. */
const SOURCE = [
  "import { x } from './x';", // 0
  '', // 1
  'export function alpha(a: number): number {', // 2
  '  const doubled = a * 2; // alpha body line one', // 3
  '  const tripled = a * 3; // alpha body line two', // 4
  '  return doubled + tripled + x;', // 5
  '}', // 6
  '', // 7
  'export class Beta {', // 8
  '  gamma(b: string): string {', // 9
  '    const upper = b.toUpperCase(); // gamma body', // 10
  '    const lower = b.toLowerCase(); // gamma body', // 11
  '    return upper + lower;', // 12
  '  }', // 13
  '}', // 14
  '',
].join('\n');

/** alpha's body interior and gamma's body interior. */
const BODIES = [span(3, 5), span(10, 12)];

describe('createCodeReducer', () => {
  it('renders the outline: signatures kept verbatim, body interiors replaced by notes', async () => {
    const outliner = fakeOutliner({ omittable: BODIES, focus: [] });

    const result = await createCodeReducer(outliner)(SOURCE, CTX);

    expect(result.reducer).toBe('code-outline');
    expect(result.text).toBe(
      [
        "import { x } from './x';",
        '',
        'export function alpha(a: number): number {',
        '… 3 lines omitted …',
        '}',
        '',
        'export class Beta {',
        '  gamma(b: string): string {',
        '… 3 lines omitted …',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    expect(result.notes).toEqual([
      'omitted 6 of 16 lines of declaration bodies in 2 run(s)',
    ]);
    expectReconstructs(result.text, SOURCE);
  });

  // Batch 31 r1 R31-01: an approximation the outline rests on is served.
  it("renders the outline's approximations as its first line, and only safe codes", async () => {
    const outliner = fakeOutliner({
      omittable: BODIES,
      focus: [],
      approximations: ['c:parsed-as-cpp', 'Bad Code\n', 'x'.repeat(41)],
    });

    const result = await createCodeReducer(outliner)(SOURCE, CTX);

    expect(result.reducer).toBe('code-outline');
    expect(result.text.split('\n')[0]).toBe(
      '… approximations: c:parsed-as-cpp …',
    );
    expect(result.notes).toContain('approximations: c:parsed-as-cpp');
    const plain = await createCodeReducer(
      fakeOutliner({ omittable: BODIES, focus: [] }),
    )(SOURCE, CTX);
    expect(result.text.split('\n').slice(1).join('\n')).toBe(plain.text);
  });

  it('passes the exact source, the language hint and the trimmed focus symbol to the outliner', async () => {
    const outliner = fakeOutliner({ omittable: BODIES, focus: [] });

    await createCodeReducer(outliner)(SOURCE, {
      budgetTokens: 10,
      languageHint: ' .ts ',
      focusSymbol: '  gamma ',
    });

    expect(outliner.calls).toEqual([[SOURCE, '.ts', 'gamma']]);
  });

  it('keeps the focus symbol body verbatim, even inside an omitted enclosing body', async () => {
    // Beta (8-14) contains an omittable span over its whole member list
    // (9-13), and gamma's own body (10-12) nests inside it. Focus = gamma.
    const outliner = fakeOutliner({
      omittable: [span(3, 5), span(9, 13), span(10, 12)],
      focus: [span(9, 13)],
    });

    const result = await createCodeReducer(outliner)(SOURCE, {
      ...CTX,
      focusSymbol: 'gamma',
    });

    expect(result.reducer).toBe('code-outline');
    for (let line = 9; line <= 13; line++) {
      expect(result.text).toContain(SOURCE.split('\n')[line]);
    }
    expect(result.text).not.toContain('alpha body line one');
    expect(result.notes).toContain(
      'kept focus symbol "gamma" in full (1 declaration(s))',
    );
    expectReconstructs(result.text, SOURCE);
  });

  it('notes a focus symbol the outliner did not find and still outlines', async () => {
    const outliner = fakeOutliner({ omittable: BODIES, focus: [] });

    const result = await createCodeReducer(outliner)(SOURCE, {
      ...CTX,
      focusSymbol: 'missing',
    });

    expect(result.reducer).toBe('code-outline');
    expect(result.notes).toContain('focus symbol "missing" not found');
  });

  it('merges nested and overlapping spans into one note per run', async () => {
    const outliner = fakeOutliner({
      omittable: [span(9, 13), span(10, 12), span(11, 11), span(12, 13)],
      focus: [],
    });

    const result = await createCodeReducer(outliner)(SOURCE, CTX);

    expect(result.text.split('\n').filter((line) => NOTE.test(line))).toEqual([
      '… 5 lines omitted …',
    ]);
    expectReconstructs(result.text, SOURCE);
  });

  it('keeps a run verbatim when its note would not be shorter', async () => {
    const source =
      'function f() {\n  a;\n  b;\n}\nfunction g() {\n' +
      '  const long = "a line long enough to be worth omitting";\n' +
      '  const more = "another line long enough to be worth omitting";\n}\n';
    const outliner = fakeOutliner({
      omittable: [span(1, 2), span(5, 6)],
      focus: [],
    });

    const result = await createCodeReducer(outliner)(source, CTX);

    expect(result.text).toBe(
      'function f() {\n  a;\n  b;\n}\nfunction g() {\n… 2 lines omitted …\n}\n',
    );
    expectReconstructs(result.text, source);
  });

  it('keeps CRLF lines verbatim (the \\r stays with its line)', async () => {
    const source = SOURCE.split('\n').join('\r\n');
    const outliner = fakeOutliner({ omittable: BODIES, focus: [] });

    const result = await createCodeReducer(outliner)(source, CTX);

    expect(result.reducer).toBe('code-outline');
    expect(result.text).toContain(
      'export function alpha(a: number): number {\r',
    );
    expectReconstructs(result.text, source);
  });

  describe('fallback to the log reducer (never a throw)', () => {
    const expectLogFallback = (
      result: { text: string; reducer: string; notes?: string[] },
      input: string,
      reason: string,
      ctx: ReduceContext = CTX,
    ): void => {
      const log = reduceLog(input, ctx);
      expect(result.text).toBe(log.text);
      expect(result.reducer).toBe(`code-fallback:${log.reducer}`);
      expect(result.notes).toEqual([
        `code outline unavailable: ${reason}`,
        ...(log.notes ?? []),
      ]);
    };

    it('falls back when the outliner returns null', async () => {
      const result = await createCodeReducer(fakeOutliner(null))(SOURCE, CTX);

      expectLogFallback(result, SOURCE, 'no outline for language "typescript"');
    });

    it('falls back when the outliner rejects, naming only the error type', async () => {
      const outliner: CodeOutliner = {
        outline: () => Promise.reject(new TypeError('D:/secret/path failed')),
      };

      const result = await createCodeReducer(outliner)(SOURCE, CTX);

      expectLogFallback(result, SOURCE, 'outliner failed: TypeError');
      expect(result.notes?.join('\n')).not.toContain('secret');
    });

    it('falls back when the outliner throws synchronously', async () => {
      const outliner: CodeOutliner = {
        outline: () => {
          throw new RangeError('boom');
        },
      };

      await expect(createCodeReducer(outliner)(SOURCE, CTX)).resolves.toEqual(
        expect.objectContaining({
          reducer: expect.stringMatching(/^code-fallback:/),
        }),
      );
      const result = await createCodeReducer(outliner)(SOURCE, CTX);
      expectLogFallback(result, SOURCE, 'outliner failed: RangeError');
    });

    it('falls back when the host supplies no outliner', async () => {
      const result = await createCodeReducer(undefined)(SOURCE, CTX);

      expectLogFallback(result, SOURCE, 'no code outliner on this host');
    });

    it('falls back without calling the outliner when there is no language hint', async () => {
      const outliner = fakeOutliner({ omittable: BODIES, focus: [] });
      const ctx = { budgetTokens: 200, languageHint: '  ' };

      const result = await createCodeReducer(outliner)(SOURCE, ctx);

      expectLogFallback(result, SOURCE, 'no language hint', ctx);
      expect(outliner.calls).toHaveLength(0);
    });

    it('falls back without calling the outliner above 256 KiB', async () => {
      const outliner = fakeOutliner({ omittable: [], focus: [] });
      const input = `${'x'.repeat(99)}\n`.repeat(2621) + 'y'.repeat(45);
      expect(input.length).toBe(256 * 1024 + 1);

      const result = await createCodeReducer(outliner)(input, CTX);

      expectLogFallback(
        result,
        input,
        'input larger than 256 KiB; not outlined',
      );
      expect(outliner.calls).toHaveLength(0);
    });

    it.each<[string, CodeOutline]>([
      ['a negative start', { omittable: [span(-1, 2)], focus: [] }],
      ['an end past the last line', { omittable: [span(3, 16)], focus: [] }],
      ['start after end', { omittable: [span(5, 3)], focus: [] }],
      ['a fractional line', { omittable: [span(3, 4.5)], focus: [] }],
      ['NaN', { omittable: [span(Number.NaN, 4)], focus: [] }],
      ['a bad focus span', { omittable: BODIES, focus: [span(0, 99)] }],
      [
        'a null span',
        { omittable: [null as unknown as CodeLineSpan], focus: [] },
      ],
      [
        'a non-array span list',
        { omittable: {} as unknown as CodeLineSpan[], focus: [] },
      ],
    ])('falls back on %s', async (_name, outline) => {
      const result = await createCodeReducer(fakeOutliner(outline))(
        SOURCE,
        CTX,
      );

      expectLogFallback(result, SOURCE, 'outline line spans out of range');
    });

    it('falls back when the outline omits nothing', async () => {
      const result = await createCodeReducer(
        fakeOutliner({ omittable: [], focus: [] }),
      )(SOURCE, CTX);

      expectLogFallback(result, SOURCE, 'outline omits nothing');
    });

    it('falls back when the focus symbol covers every omittable line', async () => {
      const result = await createCodeReducer(
        fakeOutliner({ omittable: BODIES, focus: [span(0, 15)] }),
      )(SOURCE, { ...CTX, focusSymbol: 'everything' });

      expectLogFallback(result, SOURCE, 'outline omits nothing', {
        ...CTX,
        focusSymbol: 'everything',
      });
    });

    it('truncates a long language hint in the note', async () => {
      const language = 'l'.repeat(200);
      const ctx = { budgetTokens: 200, languageHint: language };

      const result = await createCodeReducer(fakeOutliner(null))(SOURCE, ctx);

      expect(result.notes?.[0]).toBe(
        `code outline unavailable: no outline for language "${'l'.repeat(80)}…"`,
      );
    });
  });

  it('returns empty input unchanged without calling the outliner', async () => {
    const outliner = fakeOutliner({ omittable: BODIES, focus: [] });

    const result = await createCodeReducer(outliner)('', CTX);

    expect(result).toEqual({
      text: '',
      reducer: 'code-unchanged',
      notes: ['empty input'],
    });
    expect(outliner.calls).toHaveLength(0);
  });

  it('never returns empty text when every line is omittable', async () => {
    const source =
      'a line that is long enough\nanother line that is long enough';
    const result = await createCodeReducer(
      fakeOutliner({ omittable: [span(0, 1)], focus: [] }),
    )(source, CTX);

    expect(result.text).toBe('… 2 lines omitted …');
    expectReconstructs(result.text, source);
  });

  /**
   * Deeply nested spans (every span encloses the next) must cost
   * O(lines + spans): the difference array does, marking each span line by
   * line would be quadratic. Load-robust relative guard (the lib's pattern):
   * fastest of three; over the absolute bound the run still passes under a
   * 10 s hard ceiling and within LOAD_FACTOR of a quarter-size input timed
   * under the same load (linear ≈ 4x, quadratic ≈ 16x).
   */
  it('handles 16,000 nested spans in linear time', async () => {
    const LOAD_FACTOR = 8;
    const HARD_CEILING_MS = 10_000;
    const nested = (
      depth: number,
    ): { source: string; outline: CodeOutline } => {
      const lines = [
        ...Array.from({ length: depth }, () => 'f(() => {'),
        ...Array.from({ length: depth }, () => '});'),
      ];
      return {
        source: lines.join('\n'),
        outline: {
          omittable: Array.from({ length: depth - 1 }, (_, i) =>
            span(i + 1, 2 * depth - 2 - i),
          ),
          focus: [],
        },
      };
    };
    const fastestMs = async (depth: number): Promise<number> => {
      const { source, outline } = nested(depth);
      const reduce = createCodeReducer(fakeOutliner(outline));
      let elapsed = Infinity;
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        const result = await reduce(source, CTX);
        elapsed = Math.min(elapsed, performance.now() - start);
        expect(result.text).toBe(
          `f(() => {\n… ${2 * depth - 2} lines omitted …\n});`,
        );
      }
      return elapsed;
    };

    const elapsed = await fastestMs(16_000);
    if (elapsed >= 250) {
      expect(elapsed).toBeLessThan(HARD_CEILING_MS);
      expect(elapsed).toBeLessThan(LOAD_FACTOR * (await fastestMs(4_000)));
    }
  }, 60_000);
});
