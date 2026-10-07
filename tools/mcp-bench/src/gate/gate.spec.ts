import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Scorecard } from '../scorecard/scorecard.types';
import { NOISE_MARGIN } from '../suites/suite-runner';
import {
  computeNoiseMargins,
  evaluateGate,
  loadNoiseMargins,
  marginFor,
  noiseMarginsFile,
  runMeasureNoise,
  suiteMarginKey,
  writeNoiseMargins,
  type NoiseMargins,
} from './gate';

interface SuiteSpec {
  readonly tool: string;
  readonly truth: string;
  readonly delta: number | null;
  readonly verdict?: 'pass' | 'fail' | 'na';
  readonly arm?: string;
  readonly noDecider?: boolean;
  readonly questions?: number;
  readonly own?: boolean;
}

function suite(spec: SuiteSpec): Scorecard['suites'][number] {
  const verdict = spec.verdict ?? 'pass';
  return {
    kind: 'retrieval',
    details: {
      tool: spec.tool,
      questions: spec.questions ?? 1000,
      metrics: { 'hit@5': spec.own ? spec.delta : 0.9 },
      ...(spec.noDecider
        ? {}
        : spec.own
          ? { primaryMetric: 'hit@5' }
          : { primaryMetric: 'hit@5', decidingBaseline: 'native' }),
      failures: [],
    },
    claim: { source: 'code', ref: 'x.ts:1' },
    groundTruth: { id: spec.truth, version: '1', method: 'generated' },
    ...(spec.arm === undefined ? {} : { arm: spec.arm }),
    baselines: spec.own
      ? []
      : [{ id: 'native', label: 'native', metrics: { 'hit@5': 0.9 } }],
    deltas: spec.own ? {} : { native: { 'hit@5': spec.delta } },
    cost: {
      source: 'live',
      calls: 1,
      latency_ms: { p50: 1, p95: 1 },
      error_rate: 0,
      tokens: {},
    },
    verdict,
    ...(verdict === 'na' ? { naReason: 'host not available' } : {}),
  };
}

function scorecard(
  suites: Scorecard['suites'],
  overrides: { host?: 'cli-headless' | 'electron'; commit?: string } = {},
): Scorecard {
  return {
    schemaVersion: 1,
    run: {
      id: 'run',
      startedAt: '2026-10-07T00:00:00.000Z',
      host: overrides.host ?? 'cli-headless',
      os: 'linux',
      node: 'v24',
      guardMode: 'hash',
      guard: { partial: false, unprobed: [] },
      hostExit: { kind: 'clean', exitCode: 0, signal: null },
    },
    product: { version: '1', commit: 'abc' },
    corpus: {
      repo: 'r',
      commit: overrides.commit ?? 'c1',
      eligibleFiles: 1,
      tsVersion: '5',
    },
    artifacts: [],
    suites,
    lifecycle: [],
    eagerSelection: { eager: [], deferred: [], rule: 'none' },
  };
}

const KEY = suiteMarginKey('ptah_search_files', 'file-tools');
const AT = '2026-10-07T00:00:00.000Z';
const margins = (suites: Record<string, number>): NoiseMargins => ({
  schemaVersion: 2,
  measuredAt: AT,
  runs: 3,
  host: 'cli-headless',
  smoke: false,
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
  lifecycle: {},
});

describe('marginFor', () => {
  it('prefers the override, then the measured margin, then the default', () => {
    const stored = margins({ [KEY]: 0.05 });
    expect(marginFor(stored, KEY, 0.1)).toBe(0.1);
    expect(marginFor(stored, KEY)).toBe(0.05);
    expect(marginFor(stored, 'other / suite')).toBe(NOISE_MARGIN);
    expect(marginFor(null, KEY)).toBe(NOISE_MARGIN);
    expect(marginFor(stored, KEY, 0)).toBe(0);
  });
});

describe('computeNoiseMargins', () => {
  const run = (delta: number | null, commit = 'c1') =>
    scorecard(
      [suite({ tool: 'ptah_search_files', truth: 'file-tools', delta })],
      { commit },
    );

  it('is two sample standard deviations of the deciding delta', () => {
    const { margins: measured, unmeasured } = computeNoiseMargins(
      [run(0.1), run(0.12), run(0.14)],
      AT,
      true,
    );
    // sample sd of 0.10, 0.12, 0.14 is 0.02, so the margin is 0.04
    expect(measured.suites[KEY]).toMatchObject({
      margin: 0.04,
      sdMargin: 0.04,
      floor: 0.001,
      measuredAs: 'native-gap',
    });
    expect(measured.runs).toBe(3);
    expect(measured.smoke).toBe(true);
    expect(unmeasured).toEqual([]);
  });

  it('gives a deterministic suite a margin of 0', () => {
    const { margins: measured } = computeNoiseMargins(
      [run(0.1), run(0.1), run(0.1)],
      AT,
      false,
    );
    expect(measured.suites[KEY]).toMatchObject({ margin: 0.001, sdMargin: 0 });
  });

  it('floors the margin at one question: identical runs of a 40-question suite give 0.025, not 0', () => {
    const forty = (delta: number) =>
      scorecard([
        suite({
          tool: 'ptah_search_files',
          truth: 'file-tools',
          delta,
          questions: 40,
        }),
      ]);
    const { margins: measured } = computeNoiseMargins(
      [forty(0.1), forty(0.1), forty(0.1)],
      AT,
      true,
    );
    expect(measured.suites[KEY]).toMatchObject({
      margin: 0.025,
      sdMargin: 0,
      floor: 0.025,
      questions: 40,
    });
    // a larger spread wins over the floor
    const wide = computeNoiseMargins(
      [forty(0.1), forty(0.2), forty(0.3)],
      AT,
      true,
    );
    expect(wide.margins.suites[KEY]).toMatchObject({
      margin: 0.2,
      sdMargin: 0.2,
    });
  });

  it('measures a suite with no native baseline (memory) by the spread of its own metric', () => {
    const memory = (value: number) =>
      scorecard([
        suite({
          tool: 'ptah_memory_search',
          truth: 'memory',
          delta: value,
          own: true,
          questions: 40,
        }),
      ]);
    const { margins: measured } = computeNoiseMargins(
      [memory(0.8), memory(0.85), memory(0.9)],
      AT,
      true,
    );
    expect(
      measured.suites[suiteMarginKey('ptah_memory_search', 'memory')],
    ).toMatchObject({
      measuredAs: 'own-metric',
      metric: 'hit@5',
      sdMargin: 0.1,
      margin: 0.1,
    });
  });

  it('records lifecycle rows as pass/fail stability and marks a row that changed verdict flaky', () => {
    const rows = (a: boolean, b: boolean) => ({
      ...scorecard([]),
      lifecycle: [
        { scenario: 'cold-start', tool: 't', pass: a, detail: '' },
        { scenario: 'add-then-query', tool: 't', pass: b, detail: '' },
        { scenario: 'steady', tool: 't', pass: true, detail: '' },
      ],
    });
    const { margins: measured } = computeNoiseMargins(
      [rows(false, true), rows(false, false), rows(false, true)],
      AT,
      true,
    );
    expect(measured.lifecycle).toEqual({
      't / cold-start': { status: 'fail', passes: 0, runsSeen: 3 },
      't / add-then-query': { status: 'flaky', passes: 2, runsSeen: 3 },
      't / steady': { status: 'pass', passes: 3, runsSeen: 3 },
    });
  });

  it('leaves a suite without a score in some run unmeasured', () => {
    const { margins: measured, unmeasured } = computeNoiseMargins(
      [run(0.1), run(null), run(0.1)],
      AT,
      false,
    );
    expect(measured.suites[KEY]).toBeUndefined();
    expect(unmeasured).toEqual([KEY]);
  });

  it('skips na suites and breakdown arms', () => {
    const { margins: measured } = computeNoiseMargins(
      [1, 2, 3].map(() =>
        scorecard([
          suite({ tool: 'a', truth: 'g', delta: null, verdict: 'na' }),
          suite({ tool: 'a', truth: 'g', delta: 0.5, arm: 'view' }),
        ]),
      ),
      AT,
      false,
    );
    expect(measured.suites).toEqual({});
  });

  it('refuses fewer than three runs and mixed hosts or corpus commits', () => {
    expect(() => computeNoiseMargins([run(0.1), run(0.1)], AT, false)).toThrow(
      'needs 3 runs',
    );
    expect(() =>
      computeNoiseMargins([run(0.1), run(0.1), run(0.1, 'c2')], AT, false),
    ).toThrow('different corpus commits');
    expect(() =>
      computeNoiseMargins(
        [run(0.1), run(0.1), scorecard([], { host: 'electron' })],
        AT,
        false,
      ),
    ).toThrow('different hosts');
  });
});

describe('evaluateGate', () => {
  const card = (delta: number | null, extra: Partial<SuiteSpec> = {}) =>
    scorecard([
      suite({
        tool: 'ptah_search_files',
        truth: 'file-tools',
        delta,
        ...extra,
      }),
    ]);

  it('passes a tool at or above native and one within the margin', () => {
    expect(evaluateGate(card(0.1), null).status).toBe('pass');
    expect(evaluateGate(card(-0.02), null).status).toBe('pass');
  });

  it('fails a tool below native by more than the measured margin', () => {
    const stored = margins({ [KEY]: 0.005 });
    const report = evaluateGate(card(-0.02), stored);
    expect(report.status).toBe('fail');
    expect(report.suites[0]).toMatchObject({
      outcome: 'below-native',
      margin: 0.005,
    });
    expect(
      evaluateGate(card(-0.02), stored, { noiseMargin: 0.05 }).status,
    ).toBe('pass');
  });

  it('fails a suite that has a deciding baseline but no score', () => {
    const report = evaluateGate(card(null, { verdict: 'fail' }), null);
    expect(report.status).toBe('fail');
    expect(report.suites[0].outcome).toBe('unscored');
  });

  it('fails when the deciding baseline exceeds the error-rate limit', () => {
    const baselineFailure = card(0, {
      verdict: 'fail',
    });
    baselineFailure.suites[0].baselines[0].metrics['error_rate'] = 0.02;
    const report = evaluateGate(baselineFailure, null);
    expect(report.status).toBe('fail');
    expect(report.suites[0]).toMatchObject({
      outcome: 'over-baseline-error-rate',
      note: 'deciding baseline native error rate 0.02 is over 0.01',
    });
  });

  it('shows na suites with their reason and never counts them as a pass or a failure', () => {
    const report = evaluateGate(
      card(null, { verdict: 'na', noDecider: true }),
      null,
    );
    expect(report.status).toBe('pass');
    expect(report.suites[0]).toMatchObject({
      outcome: 'na',
      note: 'host not available',
    });
  });

  it('ignores breakdown arms', () => {
    const report = evaluateGate(
      scorecard([
        suite({
          tool: 't',
          truth: 'g',
          delta: -0.5,
          arm: 'view',
          verdict: 'na',
        }),
      ]),
      null,
    );
    expect(report.suites).toEqual([]);
  });

  it.each([1, 2, 3, 4])(
    'treats bench exit %i as a run failure, never a verdict',
    (exit) => {
      const report = evaluateGate(card(0.5), null, { benchExit: exit });
      expect(report.status).toBe('run-failure');
      expect(report.suites).toEqual([]);
    },
  );
});

describe('commands', () => {
  let dir = '';
  const log = (): void => undefined;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-bench-gate-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const writeCard = async (name: string, delta: number): Promise<string> => {
    const path = join(dir, name);
    await writeFile(
      path,
      JSON.stringify(
        scorecard([
          suite({ tool: 'ptah_search_files', truth: 'file-tools', delta }),
        ]),
      ),
    );
    return path;
  };

  it('stores and reloads margins; a missing file is null and an invalid one throws', async () => {
    const baseline = join(dir, 'baseline');
    expect(await loadNoiseMargins(baseline)).toBeNull();
    const stored = margins({ [KEY]: 0.0123 });
    await writeNoiseMargins(baseline, stored);
    expect(await loadNoiseMargins(baseline, stored.host, stored.smoke)).toEqual(
      stored,
    );
    await mkdir(join(dir, 'bad'));
    await writeFile(
      join(dir, 'bad', 'noise-margins.json'),
      '{"schemaVersion":1}',
    );
    await expect(loadNoiseMargins(join(dir, 'bad'))).rejects.toThrow();
  });

  it('keeps margins per mode: cli-headless smoke is the PR file, every other mode has its own', async () => {
    expect(noiseMarginsFile('cli-headless', true)).toBe('noise-margins.json');
    expect(noiseMarginsFile('cli-headless', false)).toBe(
      'noise-margins.cli-headless.full.json',
    );
    expect(noiseMarginsFile('electron', true)).toBe(
      'noise-margins.electron.smoke.json',
    );
    const baseline = join(dir, 'baseline');
    await writeNoiseMargins(baseline, {
      ...margins({ [KEY]: 0.02 }),
      smoke: true,
    });
    await writeNoiseMargins(baseline, {
      ...margins({ [KEY]: 0.07 }),
      smoke: false,
    });
    expect(
      (await loadNoiseMargins(baseline, 'cli-headless', true))?.suites[KEY]
        .margin,
    ).toBe(0.02);
    expect(
      (await loadNoiseMargins(baseline, 'cli-headless', false))?.suites[KEY]
        .margin,
    ).toBe(0.07);
    expect(await loadNoiseMargins(baseline, 'electron', false)).toBeNull();
  });

  it('measure-noise --from measures three scorecards and writes only with --write', async () => {
    const from = (
      await Promise.all([
        writeCard('a.json', 0.1),
        writeCard('b.json', 0.12),
        writeCard('c.json', 0.14),
      ])
    ).join(',');
    const base = { host: 'cli-headless' as const, smoke: false, from };
    expect(await runMeasureNoise({ ...base, write: false }, dir, log)).toBe(0);
    const full = (): ReturnType<typeof loadNoiseMargins> =>
      loadNoiseMargins(join(dir, 'baseline'), 'cli-headless', false);
    expect(await full()).toBeNull();
    expect(await runMeasureNoise({ ...base, write: true }, dir, log)).toBe(0);
    const stored = await full();
    expect(stored?.suites[KEY].margin).toBe(0.04);
    expect(
      JSON.parse(
        await readFile(
          join(dir, 'baseline', 'noise-margins.cli-headless.full.json'),
          'utf8',
        ),
      ),
    ).toMatchObject({ runs: 3 });
  });

  it('measure-noise --runs stops at the first bench exit 2 and measures nothing', async () => {
    const calls: string[][] = [];
    const code = await runMeasureNoise(
      { host: 'cli-headless', smoke: true, runs: 3, write: true },
      dir,
      log,
      {
        now: () => new Date(AT),
        bench: async (args) => {
          calls.push([...args]);
          return calls.length === 2 ? 2 : 0;
        },
      },
    );
    expect(code).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(
      expect.arrayContaining(['--host', 'cli-headless', '--smoke', '--out']),
    );
    expect(await loadNoiseMargins(join(dir, 'baseline'))).toBeNull();
  });

  it('measure-noise needs exactly one of --from and --runs', async () => {
    expect(
      await runMeasureNoise(
        { host: 'cli-headless', smoke: false, write: false },
        dir,
        log,
      ),
    ).toBe(1);
  });
});
