import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createScorecardSchema,
  Scorecard,
  scorecardSchema,
  summarizeVerdicts,
} from './scorecard.types';
import {
  readScorecard,
  renderScorecardMarkdown,
  writeScorecardJson,
  writeScorecardMarkdown,
} from './scorecard-writers';
import { z } from 'zod';
import { createSuiteKindRegistry, registerSuiteKind } from './suite-kinds';
const scorecard: Scorecard = {
  schemaVersion: 1,
  run: {
    id: 'run-1',
    startedAt: '2026-10-06T10:00:00.000Z',
    host: 'cli-headless',
    os: 'win32',
    node: '24.0.0',
    guardMode: 'process-watch',
    guard: { partial: false, unprobed: [] },
    hostExit: { kind: 'clean', exitCode: 0, signal: null },
  },
  product: { version: '1.0.0', commit: 'abcdef' },
  corpus: {
    repo: 'ptah',
    commit: '7910f34cf',
    eligibleFiles: 2,
    tsVersion: '6.0.3',
  },
  artifacts: [
    {
      kind: 'questions',
      path: 'questions.json',
      sha256: 'a'.repeat(64),
      schemaId: 'questions-v1',
    },
  ],
  suites: [
    {
      kind: 'retrieval',
      details: {
        tool: 'ptah_code_search_symbols',
        questions: 2,
        metrics: { 'hit@1': 1, mrr: 1, truncation_rate: 0 },
        failures: [],
      },
      claim: { source: 'prompt', ref: 'ptah-core-prompt.ts:47' },
      groundTruth: {
        id: 'retrieval-set',
        version: '1',
        method: 'labelled',
        raterCount: 2,
        frozenAt: '2026-10-06T10:00:00.000Z',
      },
      baselines: [
        { id: 'rg', label: 'rg', metrics: { 'hit@1': 0.5, mrr: 0.5 } },
        {
          id: 'native',
          label: 'native',
          metrics: { 'hit@1': 0.75, mrr: 0.75 },
        },
      ],
      deltas: {
        rg: { 'hit@1': 0.5, mrr: 0.5 },
        native: { 'hit@1': 0.25, mrr: 0.25 },
      },
      cost: {
        source: 'live',
        calls: 2,
        latency_ms: { p50: 10, p95: 20 },
        error_rate: 0,
        tokens: { input: 20, output: 10 },
      },
      verdict: 'pass',
    },
    {
      kind: 'retrieval',
      details: {
        tool: 'ptah_get_dependencies',
        questions: 0,
        metrics: {},
        failures: [],
      },
      claim: { source: 'code', ref: 'src/tool.ts:1' },
      groundTruth: { id: 'empty', version: '1', method: 'seeded' },
      baselines: [],
      deltas: {},
      cost: {
        source: 'none',
        calls: 0,
        latency_ms: { p50: null, p95: null },
        error_rate: null,
        tokens: {},
      },
      verdict: 'na',
      naReason: 'no eligible questions',
    },
  ],
  lifecycle: [],
  eagerSelection: { eager: [], deferred: [], rule: 'test' },
};
describe('scorecard writers', () => {
  it('round trips retrieval suites and renders null latency as na', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-bench-scorecard-'));
    try {
      const jsonPath = await writeScorecardJson(scorecard, directory);
      const markdownPath = await writeScorecardMarkdown(scorecard, directory);
      expect(await readScorecard(jsonPath)).toEqual(scorecard);
      expect(await readFile(markdownPath, 'utf8')).toContain(
        '## ptah_code_search_symbols',
      );
      expect(renderScorecardMarkdown(scorecard)).toContain(
        '| latency_ms.p50 | na |',
      );
      expect(renderScorecardMarkdown(scorecard)).toContain(
        '| cost.source | live |',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('renders tool metrics without baselines and escapes markdown cells', () => {
    const withoutBaselines = structuredClone(scorecard);
    (
      withoutBaselines.suites[1].details as {
        metrics: Record<string, number>;
      }
    ).metrics = { mrr: 0.5 };
    withoutBaselines.lifecycle = [
      {
        scenario: 'pipe | newline\nscenario',
        tool: 'tool|name',
        pass: true,
        detail: 'line one\nline two',
      },
    ];
    const markdown = renderScorecardMarkdown(withoutBaselines);
    expect(markdown).toContain('| mrr | 0.5 |  |  |');
    expect(markdown).toContain('pipe \\| newline<br>scenario');
    expect(markdown).toContain('tool\\|name');
    expect(markdown).toContain('line one<br>line two');
  });
  it('rejects unknown kinds, missing baselines, invalid claims, and invalid guards', () => {
    const unknown = structuredClone(scorecard);
    unknown.suites[0].kind = 'unknown';
    expect(() => scorecardSchema.parse(unknown)).toThrow(
      'unregistered suite kind: unknown',
    );
    const missingBaseline = structuredClone(scorecard);
    missingBaseline.suites[0].deltas = { absent: {} };
    expect(() => scorecardSchema.parse(missingBaseline)).toThrow(
      'delta names unknown baseline: absent',
    );
    const invalidClaim = structuredClone(scorecard);
    invalidClaim.suites[0].claim.ref = 'other.ts:4';
    expect(() => scorecardSchema.parse(invalidClaim)).toThrow(
      'prompt claims must point',
    );
    const unprobed = structuredClone(scorecard);
    unprobed.run.guard.unprobed = [{ pid: 1, name: 'node', handles: 2 }];
    expect(() => scorecardSchema.parse(unprobed)).toThrow(
      'guard.partial must be true',
    );
    const partialHash = structuredClone(scorecard);
    partialHash.run.guard.partial = true;
    partialHash.run.guardMode = 'hash';
    expect(() => scorecardSchema.parse(partialHash)).toThrow(
      'partial guard requires process-watch mode',
    );
    const invalidProjection = structuredClone(scorecard);
    invalidProjection.suites[0].projectionSha256 = 'A'.repeat(64);
    expect(() => scorecardSchema.parse(invalidProjection)).toThrow(
      'projectionSha256 must be lowercase hex',
    );
    const missingCostSource = structuredClone(scorecard);
    delete (missingCostSource.suites[0].cost as { source?: string }).source;
    expect(() => scorecardSchema.parse(missingCostSource)).toThrow();
  });
  it('requires na reasons and leaves crash-on-shutdown as a run fact', () => {
    expect(summarizeVerdicts(scorecard.suites)).toEqual({
      passed: 1,
      failed: 0,
      notApplicable: 1,
    });
    const missingReason = structuredClone(scorecard);
    missingReason.suites[1].naReason = undefined;
    expect(() => renderScorecardMarkdown(missingReason)).toThrow(
      'na suites require naReason',
    );
    const crash = structuredClone(scorecard);
    crash.run.hostExit.kind = 'crash-on-shutdown';
    const markdown = renderScorecardMarkdown(crash);
    expect(markdown).toContain('Host exit: crash-on-shutdown');
    expect(markdown).toContain('| error_rate | 0 |');
  });
  it('uses the generic table for a registered kind without a renderer', () => {
    registerSuiteKind('generic-test', z.unknown());
    const generic = structuredClone(scorecard);
    generic.suites = [
      { ...generic.suites[0], kind: 'generic-test', details: {} },
    ];
    expect(renderScorecardMarkdown(generic)).toContain('## generic-test');
    expect(renderScorecardMarkdown(generic)).toContain(
      '| Cost | source | live | |',
    );
  });
  it('validates and renders a typed custom kind through an isolated registry', () => {
    const registry = createSuiteKindRegistry();
    registry.registerSuiteKind(
      'custom',
      z.object({ heading: z.string().min(1) }),
      (suite) => [`## ${suite.details.heading}`, ''],
    );
    const custom = structuredClone(scorecard);
    custom.suites = [
      { ...custom.suites[0], kind: 'custom', details: { heading: 'Custom' } },
    ];
    expect(() => createScorecardSchema(registry).parse(custom)).not.toThrow();
    expect(() => scorecardSchema.parse(custom)).toThrow(
      'unregistered suite kind: custom',
    );
    expect(renderScorecardMarkdown(custom, registry)).toContain('## Custom');
  });
  it('shows an escaped displayLabel and stays byte-identical without one', () => {
    const unmarked = renderScorecardMarkdown(scorecard);
    const labelled = structuredClone(scorecard);
    labelled.suites[0].displayLabel = 'Search | symbols\npanel';
    const markdown = renderScorecardMarkdown(labelled);
    expect(markdown).toContain('## Search \\| symbols panel (retrieval)');
    expect(markdown).toContain('## ptah_code_search_symbols');
    const carriageReturn = structuredClone(scorecard);
    carriageReturn.suites[0].displayLabel = 'safe\r## forged';
    const forged = renderScorecardMarkdown(carriageReturn);
    expect(forged).toContain('## safe ## forged (retrieval)');
    expect(
      forged.split('\n').some((line) => line.startsWith('## forged')),
    ).toBe(false);
    const cleared = structuredClone(labelled);
    delete cleared.suites[0].displayLabel;
    expect(renderScorecardMarkdown(cleared)).toBe(unmarked);
  });
  it('rejects invalid JSON scorecards on read', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-bench-scorecard-'));
    const path = join(directory, 'scorecard.json');
    try {
      await writeFile(
        path,
        JSON.stringify({
          ...scorecard,
          run: { ...scorecard.run, host: 'cli' },
        }),
        'utf8',
      );
      await expect(readScorecard(path)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
