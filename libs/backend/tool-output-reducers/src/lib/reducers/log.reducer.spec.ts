import { countTokens } from '../token-measure';
import type { ReduceResult } from '../reducer.types';
import { reduceLog } from './log.reducer';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const GAP = /^… (\d+) lines? omitted …$/;
const REPEAT = / \(×(\d+)\)$/;
/** Any `(×N)` suffix anywhere in a multi-line output. */
const ANY_REPEAT = / \(×\d+\)$/m;

/** The reducer's view of the input: ANSI removed, LF lines, no final terminator line. */
function inputLines(input: string): string[] {
  const text = input.replace(
    new RegExp(
      `${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|[@-_])`,
      'g',
    ),
    '',
  );
  const lines = text.split('\n');
  if (text.endsWith('\n')) {
    lines.pop();
  }
  return lines.map((line) => line.replace(/\r$/, ''));
}

/**
 * Reconstruction oracle: walking the output against the input lines, every
 * output line is a gap marker (skips exactly N input lines), an input line
 * verbatim, or an input line with a `(×N)` suffix that stands for exactly N
 * identical consecutive input lines. Together they account for every input
 * line exactly once, in order — so nothing was merged, reordered or rewritten.
 */
function expectReconstructs(output: string, input: string): void {
  const source = inputLines(input);
  let cursor = 0;
  for (const line of output.split('\n')) {
    const gap = GAP.exec(line);
    if (gap) {
      cursor += Number(gap[1]);
      continue;
    }
    if (source[cursor] === line) {
      cursor++;
      continue;
    }
    const repeat = REPEAT.exec(line);
    const base = repeat ? line.slice(0, repeat.index) : undefined;
    const count = repeat ? Number(repeat[1]) : 0;
    if (base === undefined || count < 2 || base.trim() === '') {
      throw new Error(`output line ${JSON.stringify(line)} is not input line ${cursor}`);
    }
    for (let k = 0; k < count; k++) {
      if (source[cursor + k] !== base) {
        throw new Error(`(×${count}) at input line ${cursor} is not a run of ${JSON.stringify(base)}`);
      }
    }
    cursor += count;
  }
  expect(cursor).toBe(source.length);
}

/** Every reduction goes through here: reduced output reconstructs, unchanged output is byte-identical. */
function reduce(input: string, budgetTokens: number): ReduceResult {
  const result = reduceLog(input, { budgetTokens });
  if (result.reducer === 'log-unchanged') {
    expect(result.text).toBe(input);
  } else {
    expect(result.reducer).toBe('log-reduced');
    expect(result.text.trim().length).toBeGreaterThan(0);
    expectReconstructs(result.text, input);
  }
  return result;
}

interface Failure {
  readonly bullet: string;
  readonly assertion: string;
  readonly frame: string;
  readonly received: string;
}

const TS_LINE =
  "src/api/client.ts(42,7): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.";
const SUMMARY = [
  '',
  `${ESC}[1mTest Suites:${ESC}[22m ${ESC}[1m${ESC}[31m3 failed${ESC}[39m${ESC}[22m, 497 passed, 500 total`,
  'Tests:       3 failed, 3997 passed, 4000 total',
  'Snapshots:   0 total',
  'Time:        48.213 s',
  'Ran all test suites.',
];

function failureBlock(k: number): { lines: string[]; failure: Failure } {
  const failure: Failure = {
    bullet: `  ● Invoice ${k} › totals line items`,
    assertion: '    expect(received).toBe(expected) // Object.is equality',
    frame: `      at Object.<anonymous> (src/billing/invoice-${k}.spec.ts:42:27)`,
    received: `    Received: ${99 + k}`,
  };
  const lines = [
    `${ESC}[0m${ESC}[7m${ESC}[1m${ESC}[31m FAIL ${ESC}[39m${ESC}[22m${ESC}[27m${ESC}[0m src/billing/invoice-${k}.spec.ts`,
    failure.bullet,
    '',
    failure.assertion,
    '',
    `    Expected: ${100 + k}`,
    failure.received,
    '',
    "      40 |   it('totals line items', () => {",
    `      41 |     const invoice = build(${k});`,
    `    > 42 |     expect(invoice.total).toBe(${100 + k});`,
    '         |                           ^',
    '      43 |   });',
    '',
    failure.frame,
    '      at processTicksAndRejections (node:internal/process/task_queues:95:5)',
    '',
  ];
  return { lines, failure };
}

/** A 5,000-line jest run: 500 suites, 3 failures, a ts-jest TS2345 line, a repeated warning, colour codes. */
function jestLog(): { text: string; failures: Failure[] } {
  const lines = ['> jest --ci --colors', '', 'Determining test suites to run...'];
  const failures: Failure[] = [];
  const failAt = new Set([90, 240, 390]);
  for (let s = 0; lines.length < 5000 - SUMMARY.length; s++) {
    if (failAt.has(s)) {
      const block = failureBlock(failures.length + 1);
      lines.push(...block.lines);
      failures.push(block.failure);
      continue;
    }
    if (s === 300) {
      lines.push(`ts-jest[ts-compiler] (WARN) ${TS_LINE}`);
    }
    if (s === 170) {
      for (let r = 0; r < 40; r++) {
        lines.push('  console.warn: option "legacyMode" is deprecated');
      }
    }
    lines.push(
      `${ESC}[0m${ESC}[7m${ESC}[1m${ESC}[32m PASS ${ESC}[39m${ESC}[22m${ESC}[27m${ESC}[0m src/feature-${s}/feature-${s}.spec.ts (${(s % 7) + 1}.${s % 10} s)`,
    );
    // The required set (head 40 + tail 80 + errors with context) is kept
    // whatever it costs, so the fixture's pass lines use jest's common short
    // shape; with 12-token names the required set alone is ~2,100 tokens.
    for (let t = 0; t < 8 && lines.length < 5000 - SUMMARY.length; t++) {
      lines.push(`    ✓ case ${t} (${((s * t) % 20) + 1} ms)`);
    }
  }
  lines.push(...SUMMARY);
  return { text: lines.join('\n') + '\n', failures };
}

/** Distinct prose paragraphs, some mentioning failure in a sentence. */
function proseDocument(): string {
  const paragraphs: string[] = [];
  for (let p = 0; p < 160; p++) {
    paragraphs.push(
      `Paragraph ${p} describes the migration plan for team ${p % 12} in plain words.`,
      p % 9 === 0
        ? `The rollout in region ${p} failed once because the approval arrived late.`
        : `Region ${p} completed its checklist and signed off on day ${p % 30}.`,
      `Owners for step ${p} review the notes before the weekly sync.`,
      '',
    );
  }
  return paragraphs.join('\n');
}

describe('reduceLog', () => {
  describe('size and preserved content on a 5,000-line jest log', () => {
    const { text, failures } = jestLog();

    it('fits the default budget and keeps every failure block, the TS2345 line and the summary', () => {
      expect(text.split('\n').length - 1).toBe(5000);
      const result = reduce(text, 2000);
      expect(result.reducer).toBe('log-reduced');
      expect(countTokens(result.text)).toBeLessThanOrEqual(2000);
      expect(countTokens(result.text)).toBeLessThan(countTokens(text) / 10);

      const out = result.text.split('\n');
      for (const failure of failures) {
        expect(out).toContain(failure.bullet);
        expect(out).toContain(failure.assertion);
        expect(out).toContain(failure.frame);
      }
      expect(out).toContain(`ts-jest[ts-compiler] (WARN) ${TS_LINE}`);
      expect(out).toContain('Test Suites: 3 failed, 497 passed, 500 total');
      expect(out[out.length - 1]).toBe('Ran all test suites.');
    });

    it('keeps the whole required set even at a budget too small for anything', () => {
      const result = reduce(text, 1);
      const out = result.text.split('\n');
      for (const failure of failures) {
        expect(out).toContain(failure.bullet);
        expect(out).toContain(failure.assertion);
        expect(out).toContain(failure.frame);
      }
      expect(out).toContain(`ts-jest[ts-compiler] (WARN) ${TS_LINE}`);
      expect(out).toContain('Tests:       3 failed, 3997 passed, 4000 total');
      expect(out[out.length - 1]).toBe('Ran all test suites.');
    });

    it('collapses the repeated warning run and strips colour codes', () => {
      const result = reduce(text, 1_000_000);
      expect(result.text).toContain('  console.warn: option "legacyMode" is deprecated (×40)');
      expect(result.text).not.toContain(ESC);
      expect(result.notes).toEqual(
        expect.arrayContaining(['removed ANSI escape codes', 'collapsed 1 run(s) of repeated lines']),
      );
    });

    it('uses leftover budget to widen the context around kept lines', () => {
      const tight = reduce(text, 2000);
      const roomy = reduce(text, 4000);
      expect(countTokens(roomy.text)).toBeLessThanOrEqual(4000);
      expect(roomy.text.split('\n').length).toBeGreaterThan(tight.text.split('\n').length);
      expect(roomy.text).toContain(failures[0].received);
    });
  });

  describe('selection order', () => {
    const numbered = (n: number): string[] =>
      Array.from({ length: n }, (_, i) => `line ${i} of the build output`);
    const lineCost = (line: string): number => countTokens(line) + 1;
    const MARKER_COST = lineCost('… 9999999 lines omitted …');

    it('keeps exactly head 40 and tail 80 with one gap marker when they fit and nothing more does', () => {
      const lines = numbered(1000);
      const budget =
        [...lines.slice(0, 40), ...lines.slice(920)].reduce((sum, line) => sum + lineCost(line), 0) +
        MARKER_COST;
      const result = reduce(lines.join('\n'), budget);
      const out = result.text.split('\n');
      expect(out).toHaveLength(40 + 1 + 80);
      expect(out[0]).toBe('line 0 of the build output');
      expect(out[39]).toBe('line 39 of the build output');
      expect(out[40]).toBe('… 880 lines omitted …');
      expect(out[41]).toBe('line 920 of the build output');
      expect(out[120]).toBe('line 999 of the build output');
    });

    it('keeps head and tail even when they exceed the budget (the pipeline cut trims)', () => {
      const lines = numbered(1000);
      const out = reduce(lines.join('\n'), 300).text.split('\n');
      expect(out).toEqual([...lines.slice(0, 40), '… 880 lines omitted …', ...lines.slice(920)]);
    });

    it('keeps each error line with exactly three lines of context on either side when nothing else fits', () => {
      const lines = numbered(1000);
      lines[500] = 'TypeError: Cannot read properties of undefined';
      const result = reduce(lines.join('\n'), 120);
      const out = result.text.split('\n');
      for (let i = 497; i <= 503; i++) {
        expect(out).toContain(lines[i]);
      }
      expect(out).not.toContain(lines[496]);
      expect(out).not.toContain(lines[504]);
      expect(out[out.length - 1]).toBe('line 999 of the build output');
    });

    it.each([
      ['Error: boom'],
      ['npm ERR! code ELIFECYCLE'],
      ['FAIL src/a.spec.ts'],
      ['  ✕ rejects bad input (4 ms)'],
      ['    at Server.handle (src/server.ts:10:3)'],
      ['  File "app.py", line 12, in <module>'],
      ['Traceback (most recent call last):'],
      ['java.lang.IllegalStateException: closed'],
      ['src/a.ts:3:1 - error TS2304: Cannot find name'],
      ['thread main panicked at src/main.rs:2:5'],
      ['3 tests failed'],
    ])('treats %j as an error line', (marker) => {
      const lines = numbered(600);
      lines[300] = marker;
      const result = reduce(lines.join('\n'), 1);
      expect(result.text.split('\n')).toContain(marker);
    });

    it('collapses an identical run that is itself an error line, keeping its count', () => {
      const lines = numbered(300);
      lines.splice(150, 0, ...Array.from({ length: 25 }, () => 'Error: retry failed'));
      const result = reduce(lines.join('\n'), 1);
      expect(result.text).toContain('Error: retry failed (×25)');
    });
  });

  describe('safety contract', () => {
    it('emits only verbatim lines in order for off-kind prose, never merging distinct lines', () => {
      const prose = proseDocument();
      expect(countTokens(prose)).toBeGreaterThan(2000);
      const result = reduce(prose, 2000);
      expect(result.reducer).toBe('log-reduced');
      expect(result.text).not.toMatch(ANY_REPEAT);
      const failedLines = prose.split('\n').filter((line) => line.includes('failed'));
      for (const line of failedLines) {
        expect(result.text.split('\n')).toContain(line);
      }
    });

    it('never collapses blank lines', () => {
      const input = ['start', ...Array.from({ length: 300 }, () => ''), 'end'].join('\n');
      const result = reduce(input, 50);
      expect(result.reducer).toBe('log-reduced');
      expect(result.text).not.toMatch(ANY_REPEAT);
    });

    it('does not collapse alternating lines', () => {
      const input = Array.from({ length: 400 }, (_, i) => (i % 2 ? 'tick' : 'tock')).join('\n');
      const result = reduce(input, 50);
      expect(result.reducer).toBe('log-reduced');
      expect(result.text).not.toMatch(ANY_REPEAT);
    });

    it('returns the input unchanged when nothing would be omitted', () => {
      const input = 'one\ntwo\nthree\n';
      expect(reduce(input, 1000)).toEqual({
        text: input,
        reducer: 'log-unchanged',
        notes: ['nothing to omit'],
      });
    });

    it('returns a CRLF input byte-identical when nothing would be omitted', () => {
      const input = 'alpha\r\nbeta\r\n';
      expect(reduce(input, 1000)).toEqual({
        text: input,
        reducer: 'log-unchanged',
        notes: ['nothing to omit'],
      });
    });

    it('reduces a CRLF input to LF lines', () => {
      const input = Array.from({ length: 500 }, (_, i) => `row ${i}`).join('\r\n');
      const result = reduce(input, 60);
      expect(result.reducer).toBe('log-reduced');
      expect(result.text).not.toContain('\r');
      expect(result.text.endsWith('\nrow 498\nrow 499')).toBe(true);
    });

    it('returns empty input and ANSI-only input unchanged', () => {
      expect(reduce('', 1).text).toBe('');
      const ansiOnly = `${ESC}[31m${ESC}[0m\n${ESC}[2K`;
      expect(reduce(ansiOnly, 1)).toEqual({
        text: ansiOnly,
        reducer: 'log-unchanged',
        notes: ['no text left after removing ANSI escape codes'],
      });
    });

    it('keeps a whitespace-only log non-empty', () => {
      const input = '\n'.repeat(1000);
      const result = reduce(input, 50);
      expect(result.reducer).toBe('log-reduced');
      expect(result.text).toContain('omitted');
    });

    it('strips CSI, OSC and two-byte escapes but keeps the text between them', () => {
      const input = `${ESC}]0;title${BEL}${ESC}[1;32mgreen${ESC}[0m ${ESC}]8;;http://x${ESC}\\link${ESC}]8;;${ESC}\\ ${ESC}Mdone`;
      const result = reduce(input, 100);
      expect(result.text).toBe('green link done');
      expect(result.notes).toEqual(['kept 1 of 1 lines', 'removed ANSI escape codes']);
    });
  });

  describe('linear cost at the 2 MiB pipeline cap', () => {
    const CAP = 2 * 1024 * 1024;
    /**
     * Fastest of three runs. Measured on an idle machine (Node 24, fastest of
     * three): only newlines 339 ms, alternating short lines 155 ms, every
     * other shape under 40 ms. The bound leaves room for a loaded CI runner
     * while still failing on any quadratic path, which at this size would
     * take minutes.
     *
     * Load-robust (Batch 2c bounded correction): with 16 busy processes on
     * the machine, "only newlines" measured 1,500 ms and failed the bare
     * bound. A run over MAX_CAP_MS still passes when it is within
     * LOAD_FACTOR of a linear reference timed right after it under the same
     * load (idle ratio to the reference: 2.2), but never past HARD_CEILING_MS,
     * which a quadratic path at this size exceeds many times over.
     */
    const MAX_CAP_MS = 1500;
    const LOAD_FACTOR = 4;
    const HARD_CEILING_MS = 10_000;
    const TIMING_TEST_TIMEOUT_MS = 120_000;

    function expectLinearTime(elapsed: number): void {
      if (elapsed < MAX_CAP_MS) {
        return;
      }
      expect(elapsed).toBeLessThan(HARD_CEILING_MS);
      expect(elapsed).toBeLessThan(LOAD_FACTOR * timed(fill('a\nb\n')).elapsed);
    }

    function timed(input: string): { result: ReduceResult; elapsed: number } {
      countTokens('warm up the encoder');
      let elapsed = Infinity;
      let result: ReduceResult | undefined;
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        result = reduceLog(input, { budgetTokens: 2000 });
        elapsed = Math.min(elapsed, performance.now() - start);
      }
      return { result: result as ReduceResult, elapsed };
    }

    const fill = (unit: string): string => unit.repeat(Math.floor(CAP / unit.length));

    it.each([
      ['one huge line of one character', () => 'a'.repeat(CAP)],
      ['one huge line of "e" (error-word prefix)', () => 'e'.repeat(CAP)],
      ['one huge indented line (stack-frame prefix)', () => ' '.repeat(CAP - 3) + 'at'],
      ['one huge unterminated File frame', () => '  File "' + '"'.repeat(CAP - 9)],
      ['only newlines', () => '\n'.repeat(CAP)],
      ['identical lines', () => fill('same line\n')],
      ['distinct error lines', () => Array.from({ length: CAP / 16 }, (_, i) => `error ${i}`.padEnd(15)).join('\n')],
      ['unterminated CSI runs', () => fill(`${ESC}[${'0'.repeat(62)}`)],
      ['unterminated OSC runs', () => fill(`${ESC}]${'x'.repeat(62)}`)],
      ['bare escapes', () => ESC.repeat(CAP)],
      ['alternating short lines', () => fill('a\nb\n')],
    ])('%s stays fast and valid', (_name, build) => {
      const input = build();
      expect(input.length).toBeGreaterThan(CAP - 64);
      expect(input.length).toBeLessThanOrEqual(CAP);
      const { result, elapsed } = timed(input);
      expectLinearTime(elapsed);
      if (result.reducer === 'log-unchanged') {
        expect(result.text).toBe(input);
      } else {
        expect(result.text.trim().length).toBeGreaterThan(0);
      }
    }, TIMING_TEST_TIMEOUT_MS);
  });

  describe('review r1 regressions (D1: the required set is unconditional)', () => {
    it('D1a keeps the context after an error and the final summary at a tiny budget', () => {
      const input =
        'Error: boom\n    at fn (a.ts:1:1)\n' +
        Array.from({ length: 100 }, (_, i) => `item ${i}`).join('\n') +
        '\nRan all test suites.';
      const out = reduce(input, 10).text.split('\n');
      for (const line of ['Error: boom', '    at fn (a.ts:1:1)', 'item 0', 'item 1', 'item 2', 'Ran all test suites.']) {
        expect(out).toContain(line);
      }
    });

    it('D1b keeps the final summary when every earlier line matches the error pattern', () => {
      const input =
        Array.from({ length: 200 }, (_, i) => `0 errors, 0 failures run ${i}`).join('\n') +
        '\nRan all test suites.';
      const out = reduce(input, 2000).text.split('\n');
      expect(out[out.length - 1]).toBe('Ran all test suites.');
    });

    it('D1c keeps head 40, tail 80 and ±3 context around every error at budget 1', () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `line ${i} of the build output`);
      lines[500] = 'TypeError: Cannot read properties of undefined';
      const out = reduce(lines.join('\n'), 1).text.split('\n');
      const expected = [...lines.slice(0, 40), ...lines.slice(497, 504), ...lines.slice(920)];
      expect(out.filter((line) => !line.startsWith('…'))).toEqual(expected);
      expect(out).toEqual([
        ...lines.slice(0, 40),
        '… 457 lines omitted …',
        ...lines.slice(497, 504),
        '… 416 lines omitted …',
        ...lines.slice(920),
      ]);
    });
  });
});
