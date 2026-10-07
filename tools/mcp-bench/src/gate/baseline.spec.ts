import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Scorecard } from '../scorecard/scorecard.types';
import {
  BASELINE_FILE,
  BaselineMissingError,
  buildBaseline,
  evaluateWithBaseline,
  lifecycleKey,
  loadBaseline,
  writeBaseline,
  type GateBaseline,
} from './baseline';
import { runGate, runRecordBaseline } from './gate-command';
import { suiteMarginKey, type NoiseMargins } from './gate';

interface SuiteSpec {
  readonly tool: string;
  readonly truth?: string;
  readonly delta: number | null;
  readonly reason?: string;
  readonly errorRate?: number;
  readonly na?: string;
}

function suite(spec: SuiteSpec): Scorecard['suites'][number] {
  return {
    kind: 'retrieval',
    details: {
      tool: spec.tool,
      questions: 10,
      metrics: { 'hit@5': 0.9 },
      primaryMetric: 'hit@5',
      decidingBaseline: 'native',
      failures:
        spec.reason === undefined
          ? []
          : [{ question: '(verdict)', expected: [], got: [spec.reason] }],
    },
    claim: { source: 'code', ref: 'x.ts:1' },
    groundTruth: {
      id: spec.truth ?? 'truth',
      version: '1',
      method: 'generated',
    },
    baselines: [{ id: 'native', label: 'native', metrics: { 'hit@5': 0.9 } }],
    deltas: { native: { 'hit@5': spec.delta } },
    cost: {
      source: 'live',
      calls: 1,
      latency_ms: { p50: 1, p95: 1 },
      error_rate: spec.errorRate ?? 0,
      tokens: {},
    },
    verdict: spec.na !== undefined ? 'na' : 'pass',
    ...(spec.na === undefined ? {} : { naReason: spec.na }),
  };
}

function card(
  suites: SuiteSpec[],
  lifecycle: { scenario: string; pass: boolean }[] = [],
): Scorecard {
  return {
    schemaVersion: 1,
    run: {
      id: 'run',
      startedAt: '2026-10-07T00:00:00.000Z',
      host: 'cli-headless',
      os: 'linux',
      node: 'v24',
      guardMode: 'hash',
      guard: { partial: false, unprobed: [] },
      hostExit: { kind: 'clean', exitCode: 0, signal: null },
    },
    product: { version: '1', commit: 'abc' },
    corpus: { repo: 'r', commit: 'c1', eligibleFiles: 1, tsVersion: '5' },
    artifacts: [],
    suites: suites.map(suite),
    lifecycle: lifecycle.map((row) => ({
      scenario: row.scenario,
      tool: 'ptah_code_search_symbols',
      pass: row.pass,
      detail: row.pass ? 'ok' : 'index stayed empty',
    })),
    eagerSelection: { eager: [], deferred: [], rule: 'none' },
  };
}

const AT = '2026-10-07T00:00:00.000Z';
const A = suiteMarginKey('tool_a', 'truth');
const B = suiteMarginKey('tool_b', 'truth');
const margins = (
  suites: Record<string, number>,
  lifecycle: NoiseMargins['lifecycle'] = {},
): NoiseMargins => ({
  schemaVersion: 2,
  measuredAt: AT,
  runs: 3,
  host: 'cli-headless',
  smoke: true,
  corpusCommit: 'c1',
  sigmaMultiple: 2,
  suites: Object.fromEntries(
    Object.entries(suites).map(([key, margin]) => [
      key,
      {
        margin,
        sdMargin: margin,
        floor: 0,
        questions: 1000,
        metric: 'hit@5',
        measuredAs: 'native-gap' as const,
      },
    ]),
  ),
  lifecycle,
});
const recorded = (
  suites: SuiteSpec[],
  claim: string[] = [],
  lifecycle: { scenario: string; pass: boolean }[] = [],
): GateBaseline => buildBaseline(card(suites, lifecycle), AT, claim);

describe('recorded-failure mode', () => {
  const base = recorded([{ tool: 'tool_a', delta: 0.1 }]);
  const noise = margins({ [A]: 0.03 });
  const gate = (delta: number | null, extra: Partial<SuiteSpec> = {}) =>
    evaluateWithBaseline(
      card([{ tool: 'tool_a', delta, ...extra }]),
      base,
      noise,
    );

  it('passes when equal within the stored noise margin', () => {
    expect(gate(0.1).status).toBe('pass');
    expect(gate(0.125).status).toBe('pass');
    expect(gate(0.075).status).toBe('pass');
  });

  it('fails a regression beyond noise, even above native', () => {
    const report = gate(0.06);
    expect(report.status).toBe('fail');
    expect(report.suites[0].outcome).toBe('regression');
  });

  it('passes an improvement beyond noise and reports "baseline out of date"', () => {
    const report = gate(0.2);
    expect(report.status).toBe('pass');
    expect(report.suites[0].outcome).toBe('improved');
    expect(report.outOfDate).toEqual([
      expect.stringContaining('baseline out of date'),
    ]);
  });

  it('tolerates a recorded failure: below native as recorded passes', () => {
    const failing = recorded([{ tool: 'tool_a', delta: -0.4 }]);
    expect(
      evaluateWithBaseline(
        card([{ tool: 'tool_a', delta: -0.4 }]),
        failing,
        noise,
      ).status,
    ).toBe('pass');
  });

  it('an unscored tool passes only with the same recorded reason', () => {
    const unscored = recorded([
      { tool: 'tool_a', delta: null, reason: 'tool not exposed on this host' },
    ]);
    const run = (reason: string, delta: number | null = null) =>
      evaluateWithBaseline(
        card([{ tool: 'tool_a', delta, reason }]),
        unscored,
        noise,
      );
    expect(run('tool not exposed on this host').status).toBe('pass');
    expect(run('host failed to start').suites[0].outcome).toBe('changed');
    expect(run('host failed to start').status).toBe('fail');
    expect(run('', 0.5).suites[0].outcome).toBe('improved');
    expect(gate(null).suites[0].outcome).toBe('regression');
  });

  it('judges a suite that is missing from the run as failing and a new one as out of date', () => {
    const missing = evaluateWithBaseline(card([]), base, noise);
    expect(missing.suites[0].outcome).toBe('missing');
    expect(missing.status).toBe('fail');
    const added = evaluateWithBaseline(
      card([
        { tool: 'tool_a', delta: 0.1 },
        { tool: 'tool_b', delta: 0.1 },
      ]),
      base,
      noise,
    );
    expect(added.status).toBe('pass');
    expect(added.outOfDate).toHaveLength(1);
  });

  it('an na suite passes as recorded and fails when a recorded pass becomes na', () => {
    const na = recorded([{ tool: 'tool_a', delta: null, na: 'no host' }]);
    expect(
      evaluateWithBaseline(
        card([{ tool: 'tool_a', delta: null, na: 'no host' }]),
        na,
        noise,
      ).status,
    ).toBe('pass');
    expect(
      evaluateWithBaseline(
        card([{ tool: 'tool_a', delta: null, na: 'no host' }]),
        base,
        noise,
      ).status,
    ).toBe('fail');
  });

  it('falls back to the default margin when none is stored', () => {
    const report = evaluateWithBaseline(
      card([{ tool: 'tool_a', delta: 0.07 }]),
      base,
      null,
    );
    expect(report.suites[0].outcome).toBe('regression');
  });

  it('a non-zero bench exit is a run failure, never a verdict', () => {
    expect(
      evaluateWithBaseline(
        card([{ tool: 'tool_a', delta: 0.1 }]),
        base,
        noise,
        {
          benchExit: 2,
        },
      ).status,
    ).toBe('run-failure');
  });
});

describe('claim mode on one suite while others stay recorded', () => {
  const base = recorded(
    [
      { tool: 'tool_a', delta: -0.2 },
      { tool: 'tool_b', delta: -0.2 },
    ],
    [A],
  );

  it('fails the claim suite below native and passes the recorded one as recorded', () => {
    const report = evaluateWithBaseline(
      card([
        { tool: 'tool_a', delta: -0.2 },
        { tool: 'tool_b', delta: -0.2 },
      ]),
      base,
      null,
    );
    const byName = Object.fromEntries(
      report.suites.map((row) => [row.suite, row.outcome]),
    );
    expect(byName[A]).toBe('below-native');
    expect(byName[B]).toBe('pass');
    expect(report.status).toBe('fail');
  });

  it('a claim suite over 1 % errors fails, and a claim suite with no score fails', () => {
    const errors = evaluateWithBaseline(
      card([
        { tool: 'tool_a', delta: 0.1, errorRate: 0.05 },
        { tool: 'tool_b', delta: -0.2 },
      ]),
      base,
      null,
    );
    expect(errors.suites[0].outcome).toBe('over-error-rate');
    const unscored = evaluateWithBaseline(
      card([
        {
          tool: 'tool_a',
          delta: null,
          reason: 'tool not exposed on this host',
        },
        { tool: 'tool_b', delta: -0.2 },
      ]),
      base,
      null,
    );
    expect(unscored.suites[0].outcome).toBe('unscored');
  });
});

describe('lifecycle rows', () => {
  const key = lifecycleKey('ptah_code_search_symbols', 'cold-start');
  const rows = (pass: boolean) => [{ scenario: 'cold-start', pass }];
  const suites: SuiteSpec[] = [{ tool: 'tool_a', delta: 0.1 }];

  it('a recorded failing row passes while it fails, improves to out of date, and a recorded pass that fails is a regression', () => {
    const failing = recorded(suites, [], rows(false));
    expect(
      evaluateWithBaseline(card(suites, rows(false)), failing, null).status,
    ).toBe('pass');
    const improved = evaluateWithBaseline(
      card(suites, rows(true)),
      failing,
      null,
    );
    expect(improved.status).toBe('pass');
    expect(improved.outOfDate).toHaveLength(1);
    const passing = recorded(suites, [], rows(true));
    expect(
      evaluateWithBaseline(card(suites, rows(false)), passing, null).status,
    ).toBe('fail');
  });

  it('an na row (host cannot run it) is never recorded, judged, or reported missing', () => {
    const withNa = (
      rowsNow: { scenario: string; pass: boolean }[],
    ): Scorecard => {
      const base = card(suites, rowsNow);
      return {
        ...base,
        lifecycle: [
          ...base.lifecycle,
          {
            scenario: 'worktree-memory-scope',
            tool: 'ptah_memory_search',
            pass: false,
            detail: '',
            na: 'no seeding hook',
          },
        ],
      };
    };
    const baseline = buildBaseline(withNa(rows(false)), AT, []);
    expect(
      Object.keys(baseline.modes.lifecycle).some((key) =>
        key.includes('worktree-memory-scope'),
      ),
    ).toBe(false);
    expect(
      evaluateWithBaseline(withNa(rows(false)), baseline, null).status,
    ).toBe('pass');
    // A run without the row (or with it na) is not "missing" either.
    expect(
      evaluateWithBaseline(card(suites, rows(false)), baseline, null).status,
    ).toBe('pass');
  });

  it('a flaky row (changed verdict across the noise runs) tolerates a flip either way', () => {
    const flaky = margins(
      {},
      { [key]: { status: 'flaky', passes: 2, runsSeen: 3 } },
    );
    const passing = recorded(suites, [], rows(true));
    const report = evaluateWithBaseline(
      card(suites, rows(false)),
      passing,
      flaky,
    );
    expect(report.status).toBe('pass');
    expect(report.suites.at(-1)?.note).toContain('flaky');
  });

  it('a claim-mode row fails whenever the scenario fails', () => {
    const base = recorded(suites, [key], rows(false));
    const report = evaluateWithBaseline(card(suites, rows(false)), base, null);
    expect(report.status).toBe('fail');
    expect(
      evaluateWithBaseline(card(suites, rows(true)), base, null).status,
    ).toBe('pass');
  });

  it('a recorded row absent from the run fails', () => {
    const base = recorded(suites, [], rows(true));
    expect(evaluateWithBaseline(card(suites, []), base, null).status).toBe(
      'fail',
    );
  });
});

describe('baseline file and commands', () => {
  let dir = '';
  const lines: string[] = [];
  const log = (line: string): void => {
    lines.push(line);
  };
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-bench-baseline-'));
    lines.length = 0;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const cardFile = async (delta: number): Promise<string> => {
    const path = join(dir, `card-${delta}.json`);
    await writeFile(
      path,
      JSON.stringify(
        card(
          [{ tool: 'tool_a', delta }],
          [{ scenario: 'cold-start', pass: false }],
        ),
      ),
    );
    return path;
  };

  it('a missing baseline file is a clear error, and the gate exits 2 with it', async () => {
    await expect(loadBaseline(join(dir, 'baseline'))).rejects.toThrow(
      BaselineMissingError,
    );
    await expect(loadBaseline(join(dir, 'baseline'))).rejects.toThrow(
      /record-baseline/,
    );
    const code = await runGate({ scorecard: await cardFile(0.1) }, dir, log);
    expect(code).toBe(2);
    expect(lines.join('\n')).toContain(BASELINE_FILE);
  });

  it('record-baseline defaults every row to recorded-failure, honours --claim and round-trips', async () => {
    const path = await cardFile(0.1);
    const claimKey = lifecycleKey('ptah_code_search_symbols', 'cold-start');
    expect(
      await runRecordBaseline(
        { scorecard: path, claim: `${A}, ${claimKey}` },
        dir,
        log,
        () => new Date(AT),
      ),
    ).toBe(0);
    const stored = await loadBaseline(join(dir, 'baseline'));
    expect(stored.modes.suites).toEqual({ [A]: 'claim' });
    expect(stored.modes.lifecycle).toEqual({ [claimKey]: 'claim' });
    const again = buildBaseline(stored.scorecard, AT);
    expect(again.modes.suites).toEqual({ [A]: 'recorded-failure' });
    await writeBaseline(join(dir, 'baseline'), again);
    expect((await loadBaseline(join(dir, 'baseline'))).modes.lifecycle).toEqual(
      { [claimKey]: 'recorded-failure' },
    );
  });

  it('runGate exits 0 against the recorded run, 1 on a regression, 2 on a bench exit', async () => {
    await runRecordBaseline({ scorecard: await cardFile(0.1) }, dir, log);
    expect(await runGate({ scorecard: await cardFile(0.1) }, dir, log)).toBe(0);
    expect(await runGate({ scorecard: await cardFile(-0.5) }, dir, log)).toBe(
      1,
    );
    expect(
      await runGate(
        { scorecard: await cardFile(0.1), 'bench-exit': 2 },
        dir,
        log,
      ),
    ).toBe(2);
  });
});
