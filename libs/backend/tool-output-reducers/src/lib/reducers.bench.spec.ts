import {
  reduceOutput,
  type CodeLineSpan,
  type CodeOutliner,
  type ReduceOutputOptions,
} from '../index';
import { countTokensPiecewise } from './token-measure';

/**
 * Default tool result budget as defined in TASK_2026_559 User Decision 2:
 * 2000 tokens / 8000 characters.
 *
 * Note: Batch 21.1 (vscode-lm-tools contract sweep) guards the production
 * default DEFAULT_TOOL_RESULT_BUDGET_TOKENS.
 */
const DEFAULT_BUDGET: ReduceOutputOptions = {
  budgetTokens: 2000,
  budgetChars: 8000,
};

/**
 * Pinned reduction ratios (returnedTokens / rawTokens) measured at HEAD on 2026-09-26.
 * Each constant records the measured baseline plus approximately +10% headroom.
 * Any regression that causes the reducer to return more tokens or retain less compaction
 * will exceed this ceiling and fail the benchmark.
 *
 * Measured at HEAD on 2026-09-26:
 * - HTML (~200 KB):        measured 0.0052  -> pinned 0.006  (+15% headroom)
 * - JSON (300 objects):    measured 0.1592  -> pinned 0.176  (+10.5% headroom)
 * - Log (5,000 lines):     measured 0.0239  -> pinned 0.027  (+13% headroom)
 * - Code (fake outliner):  measured 0.1776  -> pinned 0.198  (+11.5% headroom)
 * - Code (no-outliner):    measured 0.5462  -> pinned 0.605  (+10.8% headroom)
 * - Markdown (30 sect):    measured 0.4651  -> pinned 0.515  (+10.7% headroom)
 */
export const PINNED_RATIOS = {
  HTML: 0.006,
  JSON: 0.176,
  LOG: 0.027,
  CODE_OUTLINER: 0.198,
  CODE_FALLBACK: 0.605,
  MARKDOWN: 0.515,
} as const;

// Helper to generate repetitive prose sentences
function generateProse(topic: string, count: number): string {
  return Array.from(
    { length: count },
    (_, i) =>
      `Sentence ${i} explains ${topic} in clear and structured words with technical depth.`,
  ).join(' ');
}

// 1. HTML Generator: nav + article + footer, ~200 KB (~200,000 chars)
export function generateHtmlFixture(): {
  raw: string;
  headings: string[];
  paragraphs: string[];
} {
  const headings = [
    'Understanding Token Budgets',
    'Why Budgets Matter in Coding Orchestras',
    'Measuring Tokens Piecewise',
    'Reducing Output Deterministically',
  ];

  const paragraphs = [
    generateProse('the budget mechanism', 6),
    generateProse('context window preservation', 5),
    generateProse('piecewise token counting', 6),
    generateProse('reducer pipeline architecture', 5),
  ];

  const style = `<style>${Array.from(
    { length: 1400 },
    (_, i) =>
      `.c${i}{margin:${i}px;color:#${((i * 997) % 0xffffff).toString(16).padStart(6, '0')}}`,
  ).join('')}</style>`;

  const script = `<script>${Array.from(
    { length: 900 },
    (_, i) =>
      `window.__d${i}={id:${i},html:"<div class=\\"x\\">Script item ${i}</div>"};`,
  ).join('\n')}</script>`;

  const nav = `<nav><ul>${Array.from(
    { length: 150 },
    (_, i) => `<li><a href="/section/${i}">Nav section ${i}</a></li>`,
  ).join('')}</ul></nav>`;

  const aside = `<aside><h3>Related stories</h3>${Array.from(
    { length: 40 },
    (_, i) => `<p>Sidebar teaser text number ${i} about related systems.</p>`,
  ).join('')}</aside>`;

  const footer = `<footer><p>Copyright 2026 Ptah Coding Orchestra. All rights reserved.</p>${Array.from(
    { length: 100 },
    (_, i) => `<a href="/legal/${i}">Legal page ${i}</a>`,
  ).join(' ')}</footer>`;

  const article = [
    '<main><article>',
    `<header><h1>${headings[0]}</h1><p>By Principal Platform Engineer</p></header>`,
    `<h2>${headings[1]}</h2><p>${paragraphs[0]}</p><p>${paragraphs[1]}</p>`,
    `<h2>${headings[2]}</h2><p>${paragraphs[2]}</p>`,
    `<h2>${headings[3]}</h2><p>${paragraphs[3]}</p>`,
    '</article></main>',
  ].join('\n');

  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    items: Array.from({ length: 2300 }, (_, i) => ({
      id: i,
      name: `CatalogItem ${i}`,
    })),
  })}</script>`;

  const body = [
    '<body>',
    `<header><div class="logo">PtahOrchestra</div>${nav}</header>`,
    article,
    aside,
    footer,
    jsonLd,
    '</body>',
  ].join('\n');

  const raw = `<!doctype html><html><head><meta charset="utf-8"><title>Benchmark Article</title>${style}${script}</head>${body}</html>`;

  return {
    raw,
    headings,
    paragraphs,
  };
}

// 2. JSON Generator: pretty JSON (~300 objects)
export function generateJsonFixture(): {
  raw: string;
  rows: Array<{
    id: number;
    s: string;
  }>;
} {
  const rows: Array<{
    id: number;
    s: string;
  }> = [];

  const rawObjects: Array<{
    id: number;
    s: string;
    emptyNote: null;
    blankDetail: string;
    emptyTags: unknown[];
  }> = [];

  for (let i = 1; i <= 300; i++) {
    const row = {
      id: i,
      s: `s${i}`,
    };
    rows.push(row);
    rawObjects.push({
      ...row,
      emptyNote: null,
      blankDetail: '',
      emptyTags: [],
    });
  }

  const raw = JSON.stringify(rawObjects, null, 2);
  return { raw, rows };
}

// 3. Jest Log Generator: ~5,000 lines, exactly 3 failures + summary line
export function generateJestLogFixture(): {
  raw: string;
  failureBlocks: string[][];
  summaryLine: string;
} {
  const lines: string[] = [];
  const failureBlocks: string[][] = [];

  const failure1 = [
    '    [setup-context] preparing user token authentication request',
    'FAIL src/auth/token-authenticator.spec.ts',
    '  ● TokenAuthenticator > rejects expired jwt bearer token',
    '    AssertionError: expected status code 401 but received 200',
    '      at Object.<anonymous> (src/auth/token-authenticator.spec.ts:142:18)',
    '      at processTicksAndRejections (node:internal/process/task_queues:95:5)',
    '    [teardown-context] cleaning up auth token session cache',
  ];
  const failure2 = [
    '    [setup-context] opening socket connection to primary replica',
    'FAIL src/database/connection-pool.spec.ts',
    '  ● ConnectionPool > recovers gracefully after connection reset',
    '    ConnectionTimeoutError: database socket connection timed out after 5000ms',
    '      at ConnectionPool.acquire (src/database/connection-pool.ts:284:15)',
    '      at Object.<anonymous> (src/database/connection-pool.spec.ts:98:23)',
    '    [teardown-context] terminating idle client pool sockets',
  ];
  const failure3 = [
    '    [setup-context] scheduling batch interval processing timer',
    'FAIL src/pipeline/batch-aggregator.spec.ts',
    '  ● BatchAggregator > flushes metrics queue when threshold exceeded',
    '    Error: expected queue length 0, but found 42 pending items',
    '      at BatchAggregator.flush (src/pipeline/batch-aggregator.ts:77:11)',
    '      at Object.<anonymous> (src/pipeline/batch-aggregator.spec.ts:189:27)',
    '    [teardown-context] metrics buffer dropped and reset',
  ];
  failureBlocks.push(failure1, failure2, failure3);

  const summaryLine = 'Test Suites: 3 failed, 497 passed, 500 total';

  // Generate ~5000 lines
  const totalTargetLines = 5000;
  for (let i = 1; i <= totalTargetLines - 10; i++) {
    if (i === 1200) {
      lines.push(...failure1);
      i += failure1.length - 1;
    } else if (i === 2600) {
      lines.push(...failure2);
      i += failure2.length - 1;
    } else if (i === 4100) {
      lines.push(...failure3);
      i += failure3.length - 1;
    } else {
      lines.push(
        `PASS src/modules/worker-subsystem-${i}.spec.ts (${((i * 7) % 80) + 10} ms)`,
      );
    }
  }

  while (lines.length < totalTargetLines - 4) {
    lines.push(`PASS src/modules/worker-tail-${lines.length}.spec.ts (15 ms)`);
  }

  lines.push(summaryLine);
  lines.push('Tests:       3 failed, 1497 passed, 1500 total');
  lines.push('Snapshots:   0 total');
  lines.push('Time:        38.452 s');

  return {
    raw: lines.join('\n'),
    failureBlocks,
    summaryLine,
  };
}

// 4. TS Source Generator: 300 lines with a focus symbol
export function generate300LineCodeFixture(): {
  raw: string;
  focusSymbolName: string;
  focusBodyLines: string[];
  outliner: CodeOutliner;
} {
  const lines: string[] = [];
  const focusSymbolName = 'targetCriticalFocusSymbol';
  const focusBodyLines = [
    '  const scaledMultiplier = inputValue * 42;',
    '  const normalizedMetricResult = scaledMultiplier + 100;',
    '  return normalizedMetricResult;',
  ];

  const FROM = 'fr' + 'om';

  lines.push(
    '/**',
    ' * Benchmark TS source for reducer verification (300 lines).',
    ' */',
  );
  lines.push(`import { ConfigService } ${FROM} './config.service';`);
  lines.push('');

  const focusStartLine = lines.length; // 0-based
  lines.push(
    `export function ${focusSymbolName}(inputValue: number): number {`,
  );
  lines.push(...focusBodyLines);
  lines.push('}');
  lines.push('');
  const focusEndLine = lines.length - 2; // 0-based inclusive

  const omittableSpans: CodeLineSpan[] = [];

  let helperIdx = 1;
  while (lines.length + 14 < 300) {
    lines.push(
      `export function auxiliaryRoutine${helperIdx}(metricParam: number): number {`,
    );
    const bodyStart = lines.length;
    for (let b = 1; b <= 8; b++) {
      lines.push(
        `  const stepCalculation${b} = metricParam * ${helperIdx} + ${b};`,
      );
    }
    lines.push('  return stepCalculation1;');
    const bodyEnd = lines.length - 1;
    lines.push('}');
    lines.push('');
    omittableSpans.push({ startLine: bodyStart, endLine: bodyEnd });
    helperIdx++;
  }

  while (lines.length < 299) {
    lines.push(`// Aux padding line ${lines.length + 1}`);
  }
  lines.push('// End of 300-line benchmark TS source file');

  const outliner: CodeOutliner = {
    outline: async () => ({
      omittable: omittableSpans,
      focus: [{ startLine: focusStartLine, endLine: focusEndLine }],
    }),
  };

  return {
    raw: lines.join('\n'),
    focusSymbolName,
    focusBodyLines,
    outliner,
  };
}

// 5. Markdown Generator: 30-section Markdown doc
export function generateMarkdownDocFixture(): {
  raw: string;
  headings: string[];
} {
  const headings: string[] = ['# Master Benchmark Evaluation Document'];
  const lines: string[] = [headings[0], ''];

  for (let s = 1; s <= 30; s++) {
    const heading = `## Section ${s}: Architecture Domain Pillar ${s}`;
    headings.push(heading);
    lines.push(heading, '');
    for (let p = 1; p <= 4; p++) {
      lines.push(
        `Paragraph ${p} of section ${s} outlines the operational invariants and design parameters governing domain component ${s}. This paragraph provides substantive explanation.`,
        '',
      );
    }
  }

  return {
    raw: lines.join('\n'),
    headings,
  };
}

describe('Reducers Benchmark (TASK_2026_559 Batch 20 Task 20.3)', () => {
  it('reports measured reduction metrics at HEAD', async () => {
    const html = generateHtmlFixture();
    const htmlRes = await reduceOutput(html.raw, DEFAULT_BUDGET);
    const htmlRawTokens = countTokensPiecewise(html.raw);

    const json = generateJsonFixture();
    const jsonRes = await reduceOutput(json.raw, DEFAULT_BUDGET);
    const jsonRawTokens = countTokensPiecewise(json.raw);

    const log = generateJestLogFixture();
    const logRes = await reduceOutput(log.raw, DEFAULT_BUDGET);
    const logRawTokens = countTokensPiecewise(log.raw);

    const code = generate300LineCodeFixture();
    const codeOutRes = await reduceOutput(code.raw, {
      ...DEFAULT_BUDGET,
      hint: 'code',
      languageHint: 'typescript',
      focusSymbol: code.focusSymbolName,
      outliner: code.outliner,
    });
    const codeNoOutRes = await reduceOutput(code.raw, {
      ...DEFAULT_BUDGET,
      hint: 'code',
      languageHint: 'typescript',
      outliner: undefined,
    });
    const codeRawTokens = countTokensPiecewise(code.raw);

    const md = generateMarkdownDocFixture();
    const mdRes = await reduceOutput(md.raw, DEFAULT_BUDGET);
    const mdRawTokens = countTokensPiecewise(md.raw);

    const metrics = [
      {
        kind: 'HTML (~200 KB)',
        rawTokens: htmlRawTokens,
        returnedTokens: htmlRes.returnedTokens,
        ratio: (htmlRes.returnedTokens / htmlRawTokens).toFixed(4),
        pinned: PINNED_RATIOS.HTML,
      },
      {
        kind: 'JSON (~300 objects)',
        rawTokens: jsonRawTokens,
        returnedTokens: jsonRes.returnedTokens,
        ratio: (jsonRes.returnedTokens / jsonRawTokens).toFixed(4),
        pinned: PINNED_RATIOS.JSON,
      },
      {
        kind: 'Jest log (~5,000 lines)',
        rawTokens: logRawTokens,
        returnedTokens: logRes.returnedTokens,
        ratio: (logRes.returnedTokens / logRawTokens).toFixed(4),
        pinned: PINNED_RATIOS.LOG,
      },
      {
        kind: 'TS 300L (outliner)',
        rawTokens: codeRawTokens,
        returnedTokens: codeOutRes.returnedTokens,
        ratio: (codeOutRes.returnedTokens / codeRawTokens).toFixed(4),
        pinned: PINNED_RATIOS.CODE_OUTLINER,
      },
      {
        kind: 'TS 300L (no-outliner)',
        rawTokens: codeRawTokens,
        returnedTokens: codeNoOutRes.returnedTokens,
        ratio: (codeNoOutRes.returnedTokens / codeRawTokens).toFixed(4),
        pinned: PINNED_RATIOS.CODE_FALLBACK,
      },
      {
        kind: 'Markdown (30 sections)',
        rawTokens: mdRawTokens,
        returnedTokens: mdRes.returnedTokens,
        ratio: (mdRes.returnedTokens / mdRawTokens).toFixed(4),
        pinned: PINNED_RATIOS.MARKDOWN,
      },
    ];

    // Format table output
    console.log('\n=== REDUCER BENCHMARK MEASUREMENTS (2026-09-26) ===');
    console.table(metrics);
  });
  describe('HTML reducer', () => {
    it('reduces ~200 KB HTML below budget and pinned ratio while preserving article headings and paragraphs', async () => {
      const { raw, headings, paragraphs } = generateHtmlFixture();
      expect(raw.length).toBeGreaterThanOrEqual(180 * 1024);

      const rawTokens = countTokensPiecewise(raw);
      const result = await reduceOutput(raw, DEFAULT_BUDGET);

      expect(result.reduced).toBe(true);
      expect(result.reducer).toBe('html-extract');
      expect(result.returnedTokens).toBeLessThanOrEqual(
        DEFAULT_BUDGET.budgetTokens,
      );

      const ratio = result.returnedTokens / rawTokens;
      expect(ratio).toBeLessThanOrEqual(PINNED_RATIOS.HTML);

      // Preserved content assertions: all article headings and paragraphs present
      for (const heading of headings) {
        expect(result.text).toContain(heading);
      }
      for (const paragraph of paragraphs) {
        expect(result.text).toContain(paragraph);
      }

      // Boilerplate stripped
      expect(result.text).not.toContain('<nav');
      expect(result.text).not.toContain('<footer');
      expect(result.text).not.toContain('window.__d');
    });
  });

  describe('JSON compactor', () => {
    it('compacts ~300 objects pretty JSON below budget and pinned ratio while preserving every non-empty scalar', async () => {
      const { raw, rows } = generateJsonFixture();
      expect(rows.length).toBe(300);

      const rawTokens = countTokensPiecewise(raw);
      const result = await reduceOutput(raw, DEFAULT_BUDGET);

      expect(result.reduced).toBe(true);
      expect(result.reducer).toBe('json-compact');
      expect(result.returnedTokens).toBeLessThanOrEqual(
        DEFAULT_BUDGET.budgetTokens,
      );

      const ratio = result.returnedTokens / rawTokens;
      expect(ratio).toBeLessThanOrEqual(PINNED_RATIOS.JSON);

      // Preserved content assertions: every row renders as a table row unit (|id|s|)
      for (const row of rows) {
        expect(result.text).toContain(`|${row.id}|${row.s}|`);
      }

      // Empty fields pruned
      expect(result.text).not.toContain('emptyNote');
      expect(result.text).not.toContain('blankDetail');
      expect(result.text).not.toContain('emptyTags');
    });
  });

  describe('Log reducer', () => {
    it('reduces 5,000-line log below budget and pinned ratio while preserving all 3 failure blocks and summary line', async () => {
      const { raw, failureBlocks, summaryLine } = generateJestLogFixture();
      const rawLines = raw.split('\n');
      expect(rawLines.length).toBeGreaterThanOrEqual(5000);

      const rawTokens = countTokensPiecewise(raw);
      const result = await reduceOutput(raw, DEFAULT_BUDGET);

      expect(result.reduced).toBe(true);
      expect(result.reducer).toBe('log-reduced');
      expect(result.returnedTokens).toBeLessThanOrEqual(
        DEFAULT_BUDGET.budgetTokens,
      );

      const ratio = result.returnedTokens / rawTokens;
      expect(ratio).toBeLessThanOrEqual(PINNED_RATIOS.LOG);

      // Preserved content assertions: all 3 failure blocks with context and the summary line
      for (const block of failureBlocks) {
        for (const line of block) {
          expect(result.text).toContain(line.trim());
        }
      }
      expect(result.text).toContain(summaryLine);
    });
  });

  describe('Code reducer', () => {
    it('reduces 300-line TS source via fake outliner below budget and pinned ratio while preserving focus symbol body', async () => {
      const { raw, focusSymbolName, focusBodyLines, outliner } =
        generate300LineCodeFixture();
      expect(raw.split('\n').length).toBe(300);

      const rawTokens = countTokensPiecewise(raw);
      const result = await reduceOutput(raw, {
        ...DEFAULT_BUDGET,
        hint: 'code',
        languageHint: 'typescript',
        focusSymbol: focusSymbolName,
        outliner,
      });

      expect(result.reduced).toBe(true);
      expect(result.reducer).toBe('code-outline');
      expect(result.returnedTokens).toBeLessThanOrEqual(
        DEFAULT_BUDGET.budgetTokens,
      );

      const ratio = result.returnedTokens / rawTokens;
      expect(ratio).toBeLessThanOrEqual(PINNED_RATIOS.CODE_OUTLINER);

      // Preserved content assertions: focus symbol name and its full body lines present
      expect(result.text).toContain(focusSymbolName);
      for (const bodyLine of focusBodyLines) {
        expect(result.text).toContain(bodyLine.trim());
      }
    });

    it('reduces 300-line TS source via no-outliner fallback below budget and pinned ratio while preserving focus symbol', async () => {
      const { raw, focusSymbolName, focusBodyLines } =
        generate300LineCodeFixture();
      expect(raw.split('\n').length).toBe(300);

      const rawTokens = countTokensPiecewise(raw);
      const result = await reduceOutput(raw, {
        ...DEFAULT_BUDGET,
        hint: 'code',
        languageHint: 'typescript',
        outliner: undefined, // triggers fallback to log reducer
      });

      expect(result.reduced).toBe(true);
      expect(result.reducer).toContain('log-reduced');
      expect(result.returnedTokens).toBeLessThanOrEqual(
        DEFAULT_BUDGET.budgetTokens,
      );

      const ratio = result.returnedTokens / rawTokens;
      expect(ratio).toBeLessThanOrEqual(PINNED_RATIOS.CODE_FALLBACK);

      // In fallback mode, head lines preserve the early focus symbol
      expect(result.text).toContain(focusSymbolName);
      for (const bodyLine of focusBodyLines) {
        expect(result.text).toContain(bodyLine.trim());
      }
    });
  });

  describe('Markdown outline reducer', () => {
    it('reduces 30-section Markdown doc below budget and pinned ratio while preserving every section heading', async () => {
      const { raw, headings } = generateMarkdownDocFixture();
      expect(headings.length).toBe(31); // 1 title + 30 sections

      const rawTokens = countTokensPiecewise(raw);
      const result = await reduceOutput(raw, DEFAULT_BUDGET);

      expect(result.reduced).toBe(true);
      expect(result.reducer).toBe('markdown-outline');
      expect(result.returnedTokens).toBeLessThanOrEqual(
        DEFAULT_BUDGET.budgetTokens,
      );

      const ratio = result.returnedTokens / rawTokens;
      expect(ratio).toBeLessThanOrEqual(PINNED_RATIOS.MARKDOWN);

      // Preserved content assertions: every Markdown heading present
      for (const heading of headings) {
        expect(result.text).toContain(heading);
      }
    });
  });

  describe('Table-driven sweep over all kinds', () => {
    const testCases = [
      {
        kind: 'html' as const,
        name: 'HTML page (~200 KB)',
        fixture: () => {
          const { raw, headings } = generateHtmlFixture();
          return {
            raw,
            options: DEFAULT_BUDGET,
            expectedReducer: 'html-extract',
            pinnedRatio: PINNED_RATIOS.HTML,
            assertContent: (text: string) => {
              expect(text).toContain(headings[0]);
              expect(text).toContain(headings[headings.length - 1]);
            },
          };
        },
      },
      {
        kind: 'json' as const,
        name: 'Pretty JSON (~300 objects)',
        fixture: () => {
          const { raw, rows } = generateJsonFixture();
          return {
            raw,
            options: DEFAULT_BUDGET,
            expectedReducer: 'json-compact',
            pinnedRatio: PINNED_RATIOS.JSON,
            assertContent: (text: string) => {
              expect(text).toContain('|1|s1|');
              expect(text).toContain('|300|s300|');
            },
          };
        },
      },
      {
        kind: 'log' as const,
        name: 'Jest log (~5,000 lines, 3 failures)',
        fixture: () => {
          const { raw, failureBlocks, summaryLine } = generateJestLogFixture();
          return {
            raw,
            options: DEFAULT_BUDGET,
            expectedReducer: 'log-reduced',
            pinnedRatio: PINNED_RATIOS.LOG,
            assertContent: (text: string) => {
              expect(text).toContain(summaryLine);
              for (const block of failureBlocks) {
                for (const line of block) {
                  expect(text).toContain(line.trim());
                }
              }
            },
          };
        },
      },
      {
        kind: 'code' as const,
        name: '300-line TS via outliner',
        fixture: () => {
          const { raw, focusSymbolName, outliner } =
            generate300LineCodeFixture();
          return {
            raw,
            options: {
              ...DEFAULT_BUDGET,
              hint: 'code' as const,
              languageHint: 'typescript',
              focusSymbol: focusSymbolName,
              outliner,
            },
            expectedReducer: 'code-outline',
            pinnedRatio: PINNED_RATIOS.CODE_OUTLINER,
            assertContent: (text: string) => {
              expect(text).toContain(focusSymbolName);
            },
          };
        },
      },
      {
        kind: 'code' as const,
        name: '300-line TS via no-outliner fallback',
        fixture: () => {
          const { raw, focusSymbolName } = generate300LineCodeFixture();
          return {
            raw,
            options: {
              ...DEFAULT_BUDGET,
              hint: 'code' as const,
              languageHint: 'typescript',
              outliner: undefined,
            },
            expectedReducer: 'log-reduced',
            pinnedRatio: PINNED_RATIOS.CODE_FALLBACK,
            assertContent: (text: string) => {
              expect(text).toContain(focusSymbolName);
            },
          };
        },
      },
      {
        kind: 'markdown' as const,
        name: '30-section Markdown doc',
        fixture: () => {
          const { raw, headings } = generateMarkdownDocFixture();
          return {
            raw,
            options: DEFAULT_BUDGET,
            expectedReducer: 'markdown-outline',
            pinnedRatio: PINNED_RATIOS.MARKDOWN,
            assertContent: (text: string) => {
              expect(text).toContain(headings[1]);
              expect(text).toContain(headings[headings.length - 1]);
            },
          };
        },
      },
    ];

    test.each(testCases)(
      '$name satisfies size budget (tokens <= 2000), pinned ratio, and preserves key content',
      async ({ fixture }) => {
        const { raw, options, expectedReducer, pinnedRatio, assertContent } =
          fixture();
        const rawTokens = countTokensPiecewise(raw);
        const result = await reduceOutput(raw, options);

        expect(result.reduced).toBe(true);
        expect(result.reducer).toContain(expectedReducer);
        expect(result.returnedTokens).toBeLessThanOrEqual(
          DEFAULT_BUDGET.budgetTokens,
        );

        const ratio = result.returnedTokens / rawTokens;
        expect(ratio).toBeLessThanOrEqual(pinnedRatio);

        assertContent(result.text);
      },
    );
  });
});
