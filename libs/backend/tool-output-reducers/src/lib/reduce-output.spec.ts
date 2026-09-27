import { encode } from 'gpt-tokenizer';
import type { IOutputChannel } from '@ptah-extension/platform-core';
import {
  MAX_REDUCER_INPUT_CHARS,
  reduceOutput,
  type ReduceOutputOptions,
} from './reduce-output';
import type {
  CodeLineSpan,
  CodeOutline,
  CodeOutliner,
} from './reducers/code.reducer';
import { reduceJson } from './reducers/json.reducer';
import { countTokens, countTokensPiecewise } from './token-measure';

jest.mock('gpt-tokenizer', () => {
  const actual =
    jest.requireActual<typeof import('gpt-tokenizer')>('gpt-tokenizer');
  return { ...actual, encode: jest.fn(actual.encode) };
});

jest.mock('./reducers/json.reducer', () => {
  const actual = jest.requireActual<typeof import('./reducers/json.reducer')>(
    './reducers/json.reducer',
  );
  return { ...actual, reduceJson: jest.fn(actual.reduceJson) };
});

const encodeSpy = encode as jest.MockedFunction<typeof encode>;
const reduceJsonMock = reduceJson as jest.MockedFunction<typeof reduceJson>;

const BUDGET: ReduceOutputOptions = { budgetTokens: 2000, budgetChars: 8000 };
/** Omission notes: the log/code gap marker, the pipeline's cap note, the Markdown `(… omitted …)` notes. */
const NOTE =
  /^(?:… \d+ lines? omitted …|… \d+ chars in the middle omitted \(2 MiB reducer input cap\) …|\((?:\d+ lines omitted|[a-z ]+, \d+ lines, omitted|section text omitted, \d+ lines)\))$/;

/** Every output line is an input line (a `(×N)` suffix allowed) or an omission note. */
function expectVerbatimLines(output: string, input: string): void {
  const source = new Set(
    input.split('\n').map((line) => line.replace(/\r$/, '')),
  );
  for (const line of output.split('\n')) {
    if (
      NOTE.test(line) ||
      source.has(line) ||
      source.has(line.replace(/ \(×\d+\)$/, ''))
    ) {
      continue;
    }
    throw new Error(`output line ${JSON.stringify(line)} is not an input line`);
  }
}

function recordingOutput(): IOutputChannel & { lines: string[] } {
  const lines: string[] = [];
  return {
    name: 'test',
    lines,
    appendLine: (message: string) => lines.push(message),
    append: () => undefined,
    clear: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
  };
}

function jsonRows(count: number): string {
  return JSON.stringify(
    Array.from({ length: count }, (_, i) => ({
      id: i,
      name: `item-${i}`,
      status: i % 7 === 0 ? 'failed' : 'ok',
      note: null,
      tags: [],
    })),
    null,
    2,
  );
}

function jestLog(lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i++) {
    out.push(
      `[2026-09-26T10:00:${String(i % 60).padStart(2, '0')}] INFO step ${i} running`,
    );
    if (i === Math.floor(lines / 2)) {
      out.push('ERROR: expected 3 to be 4');
      out.push('    at Object.<anonymous> (src/a.spec.ts:12:5)');
    }
  }
  out.push('Tests: 1 failed, 99 passed');
  return out.join('\n');
}

function markdownDoc(sections: number): string {
  const out: string[] = ['# Report', ''];
  for (let i = 0; i < sections; i++) {
    out.push(`## Section ${i}`, '');
    for (let p = 0; p < 6; p++) {
      out.push(
        `Paragraph ${p} of section ${i} explains a detail of the result in plain words.`,
        '',
      );
    }
  }
  return out.join('\n');
}

function htmlPage(paragraphs: number): string {
  const body = Array.from(
    { length: paragraphs },
    (_, i) =>
      `<p>Article paragraph ${i} with the content the reader came for.</p>`,
  ).join('');
  return (
    '<!doctype html><html><head><title>T</title></head><body>' +
    '<nav><a href="/a">Home</a><a href="/b">About</a></nav>' +
    `<main><h1>Title</h1>${body}</main>` +
    '<footer>Footer links</footer></body></html>'
  );
}

function tsSource(functions: number): string {
  const out: string[] = [];
  for (let i = 0; i < functions; i++) {
    out.push(`export function f${i}(a: number): number {`);
    for (let k = 0; k < 20; k++) {
      out.push(`  const v${k} = a * ${k} + ${i}; // body line ${k} of f${i}`);
    }
    out.push('  return a;', '}', '');
  }
  return out.join('\n');
}

/** Outliner that marks every function body (the lines between signature and `}`) omittable. */
function bodyOutliner(): CodeOutliner & {
  calls: Array<[string, string | undefined]>;
} {
  const calls: Array<[string, string | undefined]> = [];
  return {
    calls,
    outline: async (source, language, focusSymbol): Promise<CodeOutline> => {
      calls.push([language, focusSymbol]);
      const lines = source.split('\n');
      const omittable: CodeLineSpan[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('export function')) {
          omittable.push({ startLine: i + 1, endLine: i + 21 });
        }
      }
      return { omittable, focus: [] };
    },
  };
}

describe('reduceOutput', () => {
  beforeEach(() => {
    encodeSpy.mockClear();
    reduceJsonMock.mockClear();
  });

  describe('under budget', () => {
    it('returns the raw text byte-for-byte with one encode for a short result', async () => {
      const raw = '{"ok":true,\r\n "value":  "  spaced  "}\n';
      const tokens = countTokens(raw);
      encodeSpy.mockClear();
      const result = await reduceOutput(raw, BUDGET);
      expect(encodeSpy).toHaveBeenCalledTimes(1); // the pre-check only
      expect(result).toEqual({
        text: raw,
        reducer: 'none',
        rawTokens: tokens,
        returnedTokens: tokens,
        reduced: false,
      });
      expect(reduceJsonMock).not.toHaveBeenCalled();
    });

    it('keeps a result exactly at both limits unreduced', async () => {
      const raw = 'abcd';
      const result = await reduceOutput(raw, {
        budgetTokens: 1,
        budgetChars: 4,
      });
      expect(result.text).toBe(raw);
      expect(result.reduced).toBe(false);
    });

    it('never runs a reducer on an under-budget JSON document', async () => {
      const raw = jsonRows(5);
      expect(raw.length).toBeLessThan(8000);
      const result = await reduceOutput(raw, BUDGET);
      expect(result.text).toBe(raw);
      expect(reduceJsonMock).not.toHaveBeenCalled();
    });
  });

  describe('routing over budget', () => {
    it('routes a JSON document to the JSON compactor', async () => {
      const raw = jsonRows(400);
      const result = await reduceOutput(raw, BUDGET);
      expect(result.reducer).toBe('json-compact');
      expect(result.reduced).toBe(true);
      expect(result.returnedTokens).toBeLessThan(result.rawTokens);
      expect(result.rawTokens).toBe(countTokensPiecewise(raw));
      expect(result.returnedTokens).toBe(countTokensPiecewise(result.text));
      expect(result.text).not.toContain('"note"');
    });

    it('routes a log to the log reducer and keeps the error lines', async () => {
      const raw = jestLog(2000);
      const result = await reduceOutput(raw, BUDGET);
      expect(result.reducer).toBe('log-reduced');
      expect(result.text).toContain('ERROR: expected 3 to be 4');
      expect(result.text).toContain(
        '    at Object.<anonymous> (src/a.spec.ts:12:5)',
      );
      expect(result.text).toContain('Tests: 1 failed, 99 passed');
      expectVerbatimLines(result.text, raw);
    });

    it('routes Markdown to the outline reducer', async () => {
      const raw = markdownDoc(60);
      const result = await reduceOutput(raw, BUDGET);
      expect(result.reducer).toBe('markdown-outline');
      for (let i = 0; i < 60; i++) {
        expect(result.text).toContain(`## Section ${i}`);
      }
      expectVerbatimLines(result.text, raw);
    });

    it('routes HTML to the main-content extractor', async () => {
      const raw = htmlPage(400);
      const result = await reduceOutput(raw, BUDGET);
      expect(result.reducer).toBe('html-extract');
      expect(result.text).toContain('Article paragraph 399');
      expect(result.text).not.toContain('About');
    });

    it('awaits the code reducer and passes the language hint and focus symbol', async () => {
      const raw = tsSource(40);
      const outliner = bodyOutliner();
      const result = await reduceOutput(raw, {
        ...BUDGET,
        hint: 'code',
        languageHint: '.ts',
        focusSymbol: 'f3',
        outliner,
      });
      expect(outliner.calls).toEqual([['.ts', 'f3']]);
      expect(result.reducer).toBe('code-outline');
      expect(result.text).toContain('export function f39(a: number): number {');
      expectVerbatimLines(result.text, raw);
    });

    it('falls back to the log reducer for code when there is no outliner', async () => {
      const raw = tsSource(40);
      const result = await reduceOutput(raw, {
        ...BUDGET,
        hint: 'code',
        languageHint: '.ts',
      });
      expect(result.reducer).toBe('code-fallback:log-reduced');
      expectVerbatimLines(result.text, raw);
    });

    it('runs no reducer on plain text', async () => {
      const raw = 'An ordinary sentence of prose that goes on. '.repeat(1000);
      const result = await reduceOutput(raw, BUDGET);
      expect(result).toMatchObject({
        text: raw,
        reducer: 'none',
        reduced: false,
      });
      expect(result.rawTokens).toBe(countTokensPiecewise(raw));
    });
  });

  describe('hint', () => {
    it('wins over sniffing: preformatted JSON is not compacted', async () => {
      const raw = jsonRows(400);
      const result = await reduceOutput(raw, {
        ...BUDGET,
        hint: 'preformatted',
      });
      expect(result).toMatchObject({
        text: raw,
        reducer: 'none',
        reduced: false,
      });
      expect(reduceJsonMock).not.toHaveBeenCalled();
    });

    it('wins over sniffing: a log hint routes JSON to the log reducer', async () => {
      const raw = jsonRows(400);
      const result = await reduceOutput(raw, { ...BUDGET, hint: 'log' });
      expect(result.reducer).toBe('log-reduced');
      expect(reduceJsonMock).not.toHaveBeenCalled();
      expectVerbatimLines(result.text, raw);
    });
  });

  describe('refusals', () => {
    it('catches a throwing reducer, logs one line without the message and keeps the raw', async () => {
      reduceJsonMock.mockImplementationOnce(() => {
        throw new TypeError('secret content from /home/user/private');
      });
      const output = recordingOutput();
      const raw = jsonRows(400);
      const result = await reduceOutput(raw, { ...BUDGET, output });
      expect(result).toMatchObject({
        text: raw,
        reducer: 'none',
        reduced: false,
      });
      expect(result.rawTokens).toBe(countTokensPiecewise(raw));
      expect(output.lines).toHaveLength(1);
      expect(output.lines[0]).toContain('json reducer threw TypeError');
      expect(output.lines[0]).not.toContain('secret');
    });

    it('catches a rejecting reducer the same way', async () => {
      reduceJsonMock.mockImplementationOnce(
        () => Promise.reject(new RangeError('boom')) as never,
      );
      const output = recordingOutput();
      const raw = jsonRows(400);
      const result = await reduceOutput(raw, { ...BUDGET, output });
      expect(result.text).toBe(raw);
      expect(output.lines).toEqual([
        '[tool-output-reducers] json reducer threw RangeError; the raw output is kept',
      ]);
    });

    it('review 2e r1 M2: a throwing output channel never changes the result', async () => {
      reduceJsonMock.mockImplementationOnce(() => {
        throw new TypeError('boom');
      });
      const output = recordingOutput();
      output.appendLine = () => {
        throw new Error('sink down');
      };
      const raw = jsonRows(400);
      await expect(
        reduceOutput(raw, { ...BUDGET, output }),
      ).resolves.toMatchObject({
        text: raw,
        reducer: 'none',
      });
    });

    it('review 2e r1 M3: logs a fixed name for an error with a custom name', async () => {
      reduceJsonMock.mockImplementationOnce(() => {
        throw Object.assign(new Error('message'), { name: '/private/SECRET' });
      });
      const output = recordingOutput();
      await reduceOutput(jsonRows(400), { ...BUDGET, output });
      expect(output.lines).toEqual([
        '[tool-output-reducers] json reducer threw Error; the raw output is kept',
      ]);
    });

    it('keeps the raw when the reducer returns its input unchanged', async () => {
      const raw = '{"truncated": [' + '1, '.repeat(5000);
      const result = await reduceOutput(raw, { ...BUDGET, hint: 'json' });
      expect(result).toMatchObject({
        text: raw,
        reducer: 'none',
        reduced: false,
      });
    });

    it('keeps the raw when the reducer does not lower the token count', async () => {
      const raw = jsonRows(400);
      reduceJsonMock.mockImplementationOnce((input) => ({
        text: `${input}\n${input}`,
        reducer: 'json-compact',
      }));
      const result = await reduceOutput(raw, BUDGET);
      expect(result).toMatchObject({
        text: raw,
        reducer: 'none',
        reduced: false,
      });
    });

    it('keeps the raw when the reducer returns blank text', async () => {
      const raw = jsonRows(400);
      reduceJsonMock.mockImplementationOnce(() => ({
        text: ' \n ',
        reducer: 'json-compact',
      }));
      const result = await reduceOutput(raw, BUDGET);
      expect(result.text).toBe(raw);
    });

    it('rejects a budget that is not a finite number above zero', async () => {
      for (const bad of [0, -1, Number.NaN, Infinity]) {
        await expect(
          reduceOutput('x', { budgetTokens: bad, budgetChars: 10 }),
        ).rejects.toThrow(RangeError);
        await expect(
          reduceOutput('x', { budgetTokens: 10, budgetChars: bad }),
        ).rejects.toThrow(RangeError);
      }
    });
  });

  describe('reducer input cap', () => {
    function longLog(extra: number): string[] {
      const line = '[2026-09-26T10:00:00] INFO a line of a very long run';
      const lines: string[] = [];
      let length = 0;
      while (length <= MAX_REDUCER_INPUT_CHARS + extra) {
        const next = `${line} ${lines.length}`;
        lines.push(next);
        length += next.length + 1;
      }
      return lines;
    }

    it('reduces the whole lines at both ends of the cap and notes the chars between', async () => {
      const lines = longLog(100_000);
      const raw = lines.join('\n');
      expect(raw.length).toBeGreaterThan(MAX_REDUCER_INPUT_CHARS);
      const result = await reduceOutput(raw, BUDGET);
      expect(result.reducer).toBe('log-reduced');
      const notes = result.text
        .split('\n')
        .map((line) =>
          /^… (\d+) chars in the middle omitted \(2 MiB reducer input cap\) …$/.exec(
            line,
          ),
        )
        .filter((match) => match !== null);
      expect(notes).toHaveLength(1);
      const omitted = Number(notes[0]?.[1]);
      expect(raw.length - omitted).toBeLessThanOrEqual(MAX_REDUCER_INPUT_CHARS);
      expect(result.text.split('\n')).toContain(lines[0]);
      expect(result.text.split('\n')).toContain(lines[lines.length - 1]);
      expectVerbatimLines(result.text, raw);
    });

    it('review 2e r1 S2: keeps a failure and the summary that lie past the first 2 MiB', async () => {
      const lines = longLog(400_000);
      lines.push(
        'ERROR: UNIQUE_FAILURE',
        '    at fail (x.ts:1:2)',
        ...lines.slice(0, 50),
        'Tests: 1 failed, 999 passed',
      );
      const raw = lines.join('\n');
      expect(raw.indexOf('UNIQUE_FAILURE')).toBeGreaterThan(
        MAX_REDUCER_INPUT_CHARS,
      );
      const result = await reduceOutput(raw, BUDGET);
      expect(result.reducer).toBe('log-reduced');
      const out = result.text.split('\n');
      expect(out).toContain('ERROR: UNIQUE_FAILURE');
      expect(out).toContain('    at fail (x.ts:1:2)');
      expect(out).toContain('Tests: 1 failed, 999 passed');
      expect(countTokens(result.text)).toBeLessThanOrEqual(BUDGET.budgetTokens);
      expect(result.text.length).toBeLessThanOrEqual(BUDGET.budgetChars);
    });

    it('runs no reducer on one line longer than the cap', async () => {
      const raw = `[${'1,'.repeat(MAX_REDUCER_INPUT_CHARS / 2 + 10)}1]`;
      const result = await reduceOutput(raw, BUDGET);
      expect(result).toMatchObject({
        text: raw,
        reducer: 'none',
        reduced: false,
      });
      expect(reduceJsonMock).not.toHaveBeenCalled();
    });

    it('review 2e r2 B1: returns an over-cap Markdown document raw instead of outlining a stitched one', async () => {
      const raw =
        '# REAL\n\n' +
        'x'.repeat(1100000) +
        '\n```\n' +
        'y'.repeat(1100000) +
        '\n# NOT_A_HEADING\ncode text\n```\n';
      const result = await reduceOutput(raw, {
        budgetTokens: 30,
        budgetChars: 500,
        hint: 'markdown',
      });
      expect(result.reducer).toBe('none');
      expect(result.reduced).toBe(false);
      expect(result.text).toBe(raw);
    });

    it('review 2e r2 B1: returns an over-cap sniffed HTML document raw', async () => {
      const raw =
        '<main>\n<p>VISIBLE</p>\n' +
        'x'.repeat(1100000) +
        '\n<script>\n' +
        'y'.repeat(1100000) +
        '\n<p>HIDDEN_SCRIPT_SENTINEL</p>\n</script>\n</main>';
      const result = await reduceOutput(raw, BUDGET);
      expect(result).toMatchObject({
        text: raw,
        reducer: 'none',
        reduced: false,
      });
    });
  });

  /**
   * Load-robust timing, the lib's pattern (Batch 2c): fastest of three runs
   * against the absolute bound; over it, the run still passes under a 10 s
   * hard ceiling AND within LOAD_FACTOR of a linear reference timed right
   * after it under the same load.
   */
  describe('timing', () => {
    const LOAD_FACTOR = 8;
    const HARD_CEILING_MS = 10_000;
    const TIMING_TEST_TIMEOUT_MS = 120_000;

    async function fastestMs(raw: string): Promise<number> {
      let elapsed = Infinity;
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        await reduceOutput(raw, BUDGET);
        elapsed = Math.min(elapsed, performance.now() - start);
      }
      return elapsed;
    }

    async function expectWithin(
      raw: string,
      bound: number,
      reference: string,
    ): Promise<void> {
      const elapsed = await fastestMs(raw);
      if (elapsed < bound) {
        return;
      }
      expect(elapsed).toBeLessThan(HARD_CEILING_MS);
      expect(elapsed).toBeLessThan(LOAD_FACTOR * (await fastestMs(reference)));
    }

    it(
      'handles a 65,000-char run of one character in under 100 ms',
      async () => {
        countTokens('warm up the encoder');
        const raw = 'a'.repeat(65_000);
        const result = await reduceOutput(raw, BUDGET);
        expect(result.text).toBe(raw);
        expect(result.rawTokens).toBeGreaterThan(2000);
        // Reference: the same length of ordinary words, which BPE handles linearly.
        await expectWithin(raw, 100, 'plain words '.repeat(65_000 / 12));
      },
      TIMING_TEST_TIMEOUT_MS,
    );

    it(
      'reduces a 1 MB log end to end in under 1 s',
      async () => {
        countTokens('warm up the encoder');
        let raw = jestLog(20_000);
        while (raw.length < 1024 * 1024) {
          raw += `\n${raw}`;
        }
        raw = raw.slice(0, 1024 * 1024);
        const result = await reduceOutput(raw, BUDGET);
        expect(result.reducer).toBe('log-reduced');
        // Reference: a quarter of the same log; a linear pipeline runs the whole at ~4x.
        await expectWithin(raw, 1000, raw.slice(0, 256 * 1024));
      },
      TIMING_TEST_TIMEOUT_MS,
    );

    it(
      'handles 1 MB of JSON end to end in under 1 s',
      async () => {
        countTokens('warm up the encoder');
        let rows = 1000;
        let raw = jsonRows(rows);
        while (raw.length < 1024 * 1024) {
          rows *= 2;
          raw = jsonRows(rows);
        }
        const result = await reduceOutput(raw, BUDGET);
        expect(result.reducer).toBe('json-compact');
        await expectWithin(raw, 1000, jsonRows(Math.floor(rows / 4)));
      },
      TIMING_TEST_TIMEOUT_MS,
    );
  });
});

describe('reduceOutput — preserveKeys (Batch 24r)', () => {
  it('hands preserveKeys to the reducer, so a status block keeps its nulls', async () => {
    const raw = JSON.stringify(
      {
        coverage: { clean: false, unrecognised: null, excluded: null },
        hits: Array.from({ length: 400 }, (_, i) => ({
          name: `symbol${i}`,
          path: `/ws/src/module${i}/file.ts`,
          empty: null,
        })),
      },
      null,
      2,
    );

    const result = await reduceOutput(raw, {
      ...BUDGET,
      hint: 'json',
      preserveKeys: ['coverage'],
    });

    expect(result.reduced).toBe(true);
    expect(
      result.text.startsWith(
        '{"coverage":{"clean":false,"unrecognised":null,"excluded":null}',
      ),
    ).toBe(true);
  });
});
