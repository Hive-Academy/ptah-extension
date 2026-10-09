import { join } from 'node:path';

import type { NativeResult } from '../baselines/native-baselines';
import { suiteSchema } from '../scorecard/scorecard.types';
import type { McpToolCaller, ToolCallOutcome } from '../transport/mcp-client';
import {
  ToolResultParseError,
  applyLifecycleVerdicts,
  assembleSuite,
  qualityMetrics,
  runNativeBaselines,
  runToolQuestions,
  sampleQuestions,
  type ToolSuiteDefinition,
} from './suite-runner';
import { loadQuestionBank } from './question-sets';
import {
  CLAIMS,
  SMOKE_QUESTIONS,
  buildPolyglotSuites,
  buildTsSuites,
} from './tool-suites';
import {
  namesPresent,
  parseFileList,
  parseGraphList,
  parseJsonResult,
  parseLspLocations,
  parseMemoryContents,
  parseRankedFiles,
  parseSymbolHits,
  parseSymbolIndex,
  parseTextLocations,
} from './tool-results';

const ROOT =
  process.platform === 'win32' ? 'D:\\Corpus\\Pin' : '/tmp/corpus/pin';
const abs = (relative: string): string => join(ROOT, relative);

describe('result parsers', () => {
  it('reads symbol hits as the truth location their line range covers, else file:start+1', () => {
    const text = JSON.stringify({
      index: { symbolCount: 3 },
      coverage: { clean: true },
      bm25Only: false,
      hits: [
        {
          filePath: 'libs/a/x.ts',
          symbolName: 'other',
          text: 'function other in libs/a/x.ts:1-3',
          score: 2,
        },
        {
          filePath: abs('libs/a/y.ts'),
          symbolName: 'target',
          text: 'function target in libs/a/y.ts:9-20',
          score: 1,
        },
      ],
    });
    expect(
      parseSymbolHits(text, ROOT, ['libs/a/y.ts:10'], false).ranked,
    ).toEqual(['libs/a/x.ts:2', 'libs/a/y.ts:10']);
    expect(parseSymbolHits(text, ROOT, [], true).ranked).toEqual([
      'libs/a/x.ts',
      'libs/a/y.ts',
    ]);
  });

  it('treats an empty hit list as an abstention and an error-only answer as a parse error', () => {
    expect(parseSymbolHits('{"hits":[]}', ROOT, [], false)).toEqual({
      ranked: [],
      abstained: true,
      symbolHits: [],
    });
    expect(() =>
      parseSymbolHits(
        '{"hits":[],"error":"Code symbol index not available"}',
        ROOT,
        [],
        false,
      ),
    ).toThrow(ToolResultParseError);
  });

  it('counts a budget-cut JSON body as a parse error, not as zero hits', () => {
    expect(() =>
      parseJsonResult(
        '{"hits":[{"filePath":"a.ts"\n[reduced: none — partial, cut mid-line — full output: x]',
      ),
    ).toThrow(ToolResultParseError);
    expect(
      parseJsonResult('{"hits":[]}\n[reduced: list — 3 of 9 shown]'),
    ).toEqual({ hits: [] });
  });

  it('reads LSP locations with 0-based lines as 1-based workspace-relative locations', () => {
    const text = `## LSP References\n\nMechanism: text-scan; language: typescript\n\nFound: 2 references\n\n1. \`${abs('libs/a/x.ts')}:4:2\`\n2. \`libs/b/y.ts:0\`\n`;
    expect(parseLspLocations(text, ROOT).ranked).toEqual([
      'libs/a/x.ts:5',
      'libs/b/y.ts:1',
    ]);
    expect(() =>
      parseLspLocations(
        'Not available on this host (mechanism: none; language: typescript).',
        ROOT,
      ),
    ).toThrow('mechanism: none');
    expect(() => parseLspLocations('something else', ROOT)).toThrow(
      ToolResultParseError,
    );
  });

  it('reads graph lists, and an unsupported language as an abstention', () => {
    const text = JSON.stringify({
      count: 1,
      fileInGraph: true,
      coverage: {},
      file: abs('a.ts'),
      dependents: [abs('libs/b.ts')],
    });
    expect(parseGraphList(text, 'dependents', ROOT).ranked).toEqual([
      'libs/b.ts',
    ]);
    expect(
      parseGraphList(
        '{"status":"unsupported-language","file":"x.mjs"}',
        'dependents',
        ROOT,
      ),
    ).toEqual({ ranked: [], abstained: true });
    expect(() => parseGraphList('{"count":0}', 'dependencies', ROOT)).toThrow(
      'dependencies is not a list of strings',
    );
  });

  it('reads ranked files, symbol-index pages, memory hits and file lists', () => {
    expect(
      parseRankedFiles(
        JSON.stringify([{ file: abs('libs/a.ts'), score: 48, reasons: [] }]),
        ROOT,
      ).ranked,
    ).toEqual(['libs/a.ts']);
    expect(
      parseSymbolIndex(
        JSON.stringify({
          count: 2,
          total: 2,
          offset: 0,
          files: [
            { file: 'libs/a.ts', symbols: ['A'] },
            { file: 'libs/b.ts', symbols: ['B'] },
          ],
        }),
        'B',
        ROOT,
      ).ranked,
    ).toEqual(['libs/b.ts']);
    expect(
      parseMemoryContents(
        JSON.stringify({
          hits: [{ memoryId: '1', content: ' fact one ' }],
          bm25Only: false,
          scope: 'workspace',
        }),
      ),
    ).toEqual(['fact one']);
    expect(
      parseFileList(
        '## File Search\n\nFound: 2 files\n\n1. libs/a.ts\n2. libs/b.ts\n',
        ROOT,
      ).ranked,
    ).toEqual(['libs/a.ts', 'libs/b.ts']);
    expect(parseFileList('## File Search\n\nFound: 0 files', ROOT)).toEqual({
      ranked: [],
      abstained: true,
    });
    expect(
      parseTextLocations(`${'x'.repeat(20_000)}:42\nlibs/a.ts:3`, ROOT).ranked,
    ).toEqual([`${'x'.repeat(20_000)}:42`, 'libs/a.ts:3']);
  });

  it('finds declaration names in a structure result', () => {
    expect(
      namesPresent('{"functions":[["name"],["load"]]}', ['load', 'save'])
        .ranked,
    ).toEqual(['load']);
  });
});

interface Q {
  readonly id: string;
  readonly truth: string[];
}

function native(
  answers: Record<string, string[]>,
  error: string | null = null,
): (q: Q) => Promise<NativeResult> {
  return async (q) => ({
    answer: {
      ranked: answers[q.id] ?? [],
      abstained: (answers[q.id] ?? []).length === 0,
    },
    commands: 1,
    resultText: (answers[q.id] ?? []).join('\n'),
    latencyMs: 5,
    error,
  });
}

function definition(
  overrides: Partial<ToolSuiteDefinition<Q>> = {},
): ToolSuiteDefinition<Q> {
  return {
    id: 'demo',
    tool: 'ptah_demo',
    claim: CLAIMS.codeSearch,
    groundTruth: {
      id: 'demo',
      version: '1',
      method: 'generated',
      frozenAt: '2026-10-07T00:00:00.000Z',
    },
    primaryMetric: 'hit@1',
    questions: [
      { id: 'q1', truth: ['a.ts'] },
      { id: 'q2', truth: ['b.ts'] },
    ],
    questionsInFile: 2,
    truth: (q) => ({ items: q.truth }),
    args: (q) => ({ query: q.id }),
    parse: (text) => {
      if (text === 'garbage') throw new ToolResultParseError('not readable');
      return { ranked: text.split(','), abstained: false };
    },
    natives: [
      {
        id: 'native',
        label: 'rg',
        run: native({ q1: ['a.ts'], q2: ['b.ts'] }),
        decides: true,
        scored: true,
      },
    ],
    ...overrides,
  };
}

function caller(texts: Record<string, ToolCallOutcome>): McpToolCaller {
  return { callTool: async (_tool, args) => texts[String(args['query'])] };
}

const ok = (text: string): ToolCallOutcome => ({
  kind: 'result',
  text,
  isError: false,
  wallMs: 10,
});

async function score(
  def: ToolSuiteDefinition<Q>,
  texts: Record<string, ToolCallOutcome>,
  listed = new Set([def.tool]),
) {
  const natives = await runNativeBaselines(def);
  const tools = await runToolQuestions(def, {
    listedTools: listed,
    callerFor: () => caller(texts),
    corpusRoot: ROOT,
    log: () => undefined,
  });
  return assembleSuite(def, natives, tools, { listedTools: listed });
}

describe('assembleSuite', () => {
  it('passes a tool that matches native, with sign-normalised deltas and a valid scorecard suite', async () => {
    const [suite] = await score(definition(), {
      q1: ok('a.ts'),
      q2: ok('b.ts'),
    });
    expect(suiteSchema.safeParse(suite).success).toBe(true);
    expect(suite.verdict).toBe('pass');
    expect(suite.cost.source).toBe('live');
    expect(suite.cost.calls).toBe(2);
    expect(suite.deltas['native']['hit@1']).toBe(0);
    expect(suite.baselines[0].metrics['latency_ms_p50']).toBe(5);
    expect(suite.deltas['native']['latency_ms_p50']).toBe(-5);
  });

  it('counts a parse failure as an error (not zero hits) and fails over 1 % errors', async () => {
    const [suite] = await score(definition(), {
      q1: ok('a.ts'),
      q2: ok('garbage'),
    });
    expect(suite.verdict).toBe('fail');
    expect(suite.cost.error_rate).toBe(0.5);
    const failures = (
      suite.details as { failures: { question: string; got: string[] }[] }
    ).failures;
    expect(
      failures.some((failure) => failure.got[0]?.includes('error rate 0.5')),
    ).toBe(true);
    expect(
      failures.some(
        (failure) =>
          failure.question === 'q2' &&
          failure.got[0] === 'error: parse: not readable',
      ),
    ).toBe(true);
  });

  it('fails a tool below native by more than the noise margin', async () => {
    const [suite] = await score(definition(), {
      q1: ok('a.ts'),
      q2: ok('zzz.ts'),
    });
    expect(suite.verdict).toBe('fail');
    expect(suite.deltas['native']['hit@1']).toBe(-0.5);
  });

  it('lists native errors and fails when the deciding baseline exceeds the error-rate limit', async () => {
    const [suite] = await score(
      definition({
        natives: [
          {
            id: 'native',
            label: 'rg',
            run: native({ q1: ['a.ts'], q2: ['b.ts'] }, 'rg unavailable'),
            decides: true,
            scored: true,
          },
        ],
      }),
      { q1: ok('a.ts'), q2: ok('b.ts') },
    );
    expect(suite.verdict).toBe('fail');
    expect(suite.baselines[0].metrics['error_rate']).toBe(1);
    const failures = (
      suite.details as {
        readonly failures: readonly { question: string; got: string[] }[];
      }
    ).failures;
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          question: 'q1',
          got: ['native native error: rg unavailable'],
        }),
        expect.objectContaining({
          question: '(verdict)',
          got: ['deciding baseline native error rate 1 is over 0.01'],
        }),
      ]),
    );
    expect(
      failures.filter((failure) => failure.got[0] === 'native native error: rg unavailable'),
    ).toHaveLength(1);
  });

  it('lists but does not fail for a non-deciding native error', async () => {
    const [suite] = await score(
      definition({
        natives: [
          {
            id: 'native',
            label: 'rg',
            run: native({ q1: ['a.ts'], q2: ['b.ts'] }),
            decides: true,
            scored: true,
          },
          {
            id: 'auxiliary',
            label: 'other',
            run: native({}, 'auxiliary unavailable'),
            decides: false,
            scored: false,
          },
        ],
      }),
      { q1: ok('a.ts'), q2: ok('b.ts') },
    );
    expect(suite.verdict).toBe('pass');
    expect(JSON.stringify(suite.details)).toContain(
      'native auxiliary error: auxiliary unavailable',
    );
  });

  it('fails a tool that tools/list does not show, makes no call, and still scores native', async () => {
    const [suite] = await score(definition(), {}, new Set());
    expect(suite.verdict).toBe('fail');
    expect(suite.cost).toMatchObject({
      source: 'none',
      calls: 0,
      error_rate: null,
    });
    expect(JSON.stringify(suite.details)).toContain(
      'tool not exposed on this host (mechanism: none)',
    );
    expect(suite.baselines[0].metrics['hit@1']).toBe(1);
  });

  it('scores an na suite as na with its reason and no call', async () => {
    const [suite] = await score(
      definition({ naReason: 'not implemented yet' }),
      {},
    );
    expect(suite).toMatchObject({
      verdict: 'na',
      naReason: 'not implemented yet',
      cost: { source: 'none' },
    });
    expect(suiteSchema.safeParse(suite).success).toBe(true);
  });

  it('adds breakdown suites as na views that never decide', async () => {
    const suites = await score(
      definition({
        breakdowns: [
          {
            arm: 'only-q1',
            filter: (q) => q.id === 'q1',
            naReason: (count, total) => `view ${count}/${total}`,
          },
        ],
      }),
      { q1: ok('a.ts'), q2: ok('zzz.ts') },
    );
    expect(suites).toHaveLength(2);
    expect(suites[1]).toMatchObject({
      arm: 'only-q1',
      verdict: 'na',
      naReason: 'view 1/2',
    });
    expect((suites[1].details as { questions: number }).questions).toBe(1);
    expect(suites[1].details).toMatchObject({ metrics: { 'hit@1': 1 } });
  });

  it('keeps a non-scored native out of the quality deltas and out of the verdict', async () => {
    const [suite] = await score(
      definition({
        natives: [
          {
            id: 'native-comparison',
            label: 'rg',
            run: native({}),
            decides: false,
            scored: false,
          },
        ],
      }),
      { q1: ok('zzz.ts'), q2: ok('zzz.ts') },
    );
    expect(suite.verdict).toBe('pass');
    expect(suite.baselines[0].metrics['hit@1']).toBeUndefined();
    expect(suite.deltas['native-comparison']['hit@1']).toBeUndefined();
  });

  it('fails a passing suite whose tool failed a lifecycle scenario', async () => {
    const suites = await score(definition(), {
      q1: ok('a.ts'),
      q2: ok('b.ts'),
    });
    const [after] = applyLifecycleVerdicts(suites, [
      { scenario: 'cold-start', tool: 'ptah_demo', pass: false },
    ]);
    expect(after.verdict).toBe('fail');
    expect(JSON.stringify(after.details)).toContain(
      'lifecycle scenario cold-start failed',
    );
  });
});

describe('qualityMetrics and sampling', () => {
  it('scores an errored answer 0, even against an abstention truth', () => {
    expect(
      qualityMetrics([
        {
          answer: { ranked: [], abstained: false },
          truth: { items: [], abstain: true },
        },
      ])['hit@1'],
    ).toBe(0);
    expect(qualityMetrics([])['hit@1']).toBeNull();
  });

  it('samples the same questions for the same seed, in file order', () => {
    const items = Array.from({ length: 100 }, (_, index) => index);
    const seeded = (): (() => number) => {
      let state = 7;
      return () => (state = (state * 48_271) % 2_147_483_647) / 2_147_483_647;
    };
    const first = sampleQuestions(items, 40, seeded());
    expect(first).toHaveLength(40);
    expect(sampleQuestions(items, 40, seeded())).toEqual(first);
    expect([...first].sort((a, b) => a - b)).toEqual(first);
    expect(sampleQuestions(items.slice(0, 10), 40, seeded())).toHaveLength(10);
  });
});

describe('the committed question bank', () => {
  it('validates every frozen file through the merged envelope and builds every suite', () => {
    const bank = loadQuestionBank(join(__dirname, '..', '..'), '7910f34cf');
    expect(bank.symbolsExact.questions).toHaveLength(350);
    expect(
      bank.relevance.questions.filter((q) => q.split === 'test'),
    ).toHaveLength(200);
    expect(
      bank.polyglot.map((set) => [
        set.corpusId,
        set.references.questions.length,
        set.dependents.questions.length,
      ]),
    ).toEqual([
      ['python-attrs', 37, 50],
      ['go-logrus', 41, 37],
    ]);
    const context = {
      corpusRoot: ROOT,
      native: {
        corpusRoot: ROOT,
        rg: async () => ({
          stdout: '',
          exitCode: 1,
          latencyMs: 0,
          commandLine: 'rg',
        }),
      },
      sample: SMOKE_QUESTIONS,
    };
    const suites = buildTsSuites(bank, context, {
      listedTools: new Set(),
      memory: {
        roots: null,
        naReason: 'no seeding in this spec',
        native: context.native,
      },
    });
    expect(suites.map((suite) => suite.id)).toEqual([
      'symbols-exact',
      'symbols-concept',
      'relevance',
      'references',
      'definitions',
      'dependents',
      'dependencies',
      'symbol-index',
      'memory',
      'ast-analyze',
      'context-enrich',
      'search-files',
      'search-text',
    ]);
    for (const suite of suites)
      expect(suite.questions.length).toBeLessThanOrEqual(SMOKE_QUESTIONS);
    expect(
      suites.find((suite) => suite.id === 'search-text')?.naReason,
    ).toContain('Batch 33');
    expect(
      suites
        .find((suite) => suite.id === 'memory')
        ?.questions.every(
          (q) => (q as { scorable?: boolean }).scorable !== false,
        ),
    ).toBe(true);
    const polyglot = bank.polyglot.flatMap((set) =>
      buildPolyglotSuites(set, context),
    );
    expect(polyglot.map((suite) => suite.id)).toEqual([
      'references-python-attrs',
      'dependents-python-attrs',
      'references-go-logrus',
      'dependents-go-logrus',
    ]);
  });
});

describe('assembleSuite with a run failure', () => {
  it('fails the suite with the host failure reason and keeps the native side', async () => {
    const def = definition();
    const natives = await runNativeBaselines(def);
    const [suite] = assembleSuite(def, natives, null, {
      listedTools: new Set(),
      failure:
        'host polyglot python-attrs failed to start (exited-early, exit 3221226505)',
    });
    expect(suite.verdict).toBe('fail');
    expect(suite.cost.source).toBe('none');
    expect(JSON.stringify(suite.details)).toContain('exit 3221226505');
    expect(JSON.stringify(suite.details)).not.toContain('tool not exposed');
    expect(suite.baselines[0].metrics['hit@1']).toBe(1);
    expect(suiteSchema.safeParse(suite).success).toBe(true);
  });
});
