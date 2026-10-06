import {
  buildSuiteProjection,
  computeSuiteProjectionSha256,
  SuiteProjectionInput,
} from './projection';

function baseInput(): SuiteProjectionInput {
  return {
    suite: {
      kind: 'curation',
      details: {
        operation: 'extraction',
        slice: 'seeded',
        confusion: { tp: 9, fp: 3, fn: 2, tn: 4, unlabelled: 1 },
        recall: 0.82,
        precision: 0.75,
        f1: 0.78,
        fmr: 0.05,
        baits: 12,
        overSuppression: 0.01,
        byCategory: {
          extraction: { tp: 5, fp: 1, fn: 1 },
          temporal: { tp: 4, fp: 2, fn: 1 },
        },
        bySedimentClass: { worktree: 3, 'dead-branch': 2 },
        matcher: { id: 'fact-matcher', version: '1.0.0' },
        cassette: 'gt-curation-seeded@v1',
      },
      claim: { source: 'ledger', ref: 'context.md:157' },
      groundTruth: {
        id: 'gt-memory@v1',
        version: '1.0.0',
        method: 'seeded',
        raterCount: 2,
        frozenAt: '2026-10-01T00:00:00.000Z',
      },
      baselines: [{ id: 'b-563', label: '563 replay', metrics: { f1: 0.7 } }],
      deltas: { 'b-563': { f1: 0.08 } },
      cost: {
        source: 'cassette',
        calls: 12,
        latency_ms: { p50: 811.7, p95: 2400.4 },
        error_rate: 0,
        tokens: {
          input: 42000,
          output: 9000,
          billed: 51000,
          result_p50: 800,
        },
      },
      verdict: 'pass',
    },
    cases: [
      {
        caseId: 'f-001',
        inputSha256: 'a'.repeat(64),
        expected: 'fact 1',
        observed: 'fact 1',
        outcome: 'pass',
        baselineOutcomes: { 'b-563': 'pass' },
        cassetteKey: 'curator-llm/gt-curation-seeded@v1',
        latencyMs: 812.5,
        error: null,
      },
      {
        caseId: 'f-002',
        inputSha256: 'b'.repeat(64),
        expected: 'fact 2',
        observed: 'fact 2 (merged into fact 1)',
        outcome: 'fail',
        latencyMs: 900,
        error: null,
      },
    ],
    cassetteVersion: 'gt-curation-seeded@v1',
    run: {
      runId: 'run-2026-10-07t00-00-00',
      startedAt: '2026-10-07T00:00:00.000Z',
      hostPid: 4212,
      hostPort: 39271,
      safetyCapMs: 120000,
    },
  };
}

function hashOf(mutate: (input: SuiteProjectionInput) => void): string {
  const input = structuredClone(baseInput());
  mutate(input);
  return computeSuiteProjectionSha256(input);
}

describe('suite projection', () => {
  it('hashes the deterministic projection as lowercase sha256', () => {
    expect(computeSuiteProjectionSha256(baseInput())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps cost latency, tokens and error rate out of the hash', () => {
    const baseline = hashOf(() => undefined);
    const mutations: Array<(input: SuiteProjectionInput) => void> = [
      (input) => {
        input.suite.cost.latency_ms.p50 = 1.1;
        input.suite.cost.latency_ms.p95 = 9999.9;
      },
      (input) => {
        input.suite.cost.error_rate = 0.5;
      },
      (input) => {
        input.suite.cost.tokens = {
          input: 1,
          output: 2,
          billed: 3,
          result_p50: 4,
        };
      },
    ];
    for (const mutate of mutations) expect(hashOf(mutate)).toBe(baseline);
  });

  it('keeps run id, timestamps, pid, port and safety-cap timing out of the hash', () => {
    const baseline = hashOf(() => undefined);
    const mutations: Array<(input: SuiteProjectionInput) => void> = [
      (input) => {
        input.run.runId = 'run-2027-01-01t00-00-00';
      },
      (input) => {
        input.run.startedAt = '2027-01-01T00:00:00.000Z';
      },
      (input) => {
        input.run.hostPid = 999999;
      },
      (input) => {
        input.run.hostPort = 8125;
      },
      (input) => {
        input.run.safetyCapMs = 60000;
      },
    ];
    for (const mutate of mutations) expect(hashOf(mutate)).toBe(baseline);
  });

  it('keeps per-case latency, error, baseline outcomes and cassette key out of the hash', () => {
    const baseline = hashOf(() => undefined);
    const mutations: Array<(input: SuiteProjectionInput) => void> = [
      (input) => {
        input.cases[0].latencyMs = 12345.6;
      },
      (input) => {
        input.cases[0].error = 'safety-cap';
      },
      (input) => {
        input.cases[0].baselineOutcomes = { 'b-563': 'fail' };
      },
      (input) => {
        input.cases[0].cassetteKey = 'curator-llm/other@v2';
      },
    ];
    for (const mutate of mutations) expect(hashOf(mutate)).toBe(baseline);
  });

  it('keeps claim, arm, baselines, deltas and a recorded projection hash out of the hash', () => {
    const baseline = hashOf(() => undefined);
    const mutations: Array<(input: SuiteProjectionInput) => void> = [
      (input) => {
        input.suite.claim = {
          source: 'code',
          ref: 'memory-curator.service.ts:1',
        };
      },
      (input) => {
        input.suite.arm = 'memory';
      },
      (input) => {
        input.suite.baselines.push({
          id: 'b2',
          label: 'second baseline',
          metrics: {},
        });
      },
      (input) => {
        input.suite.deltas['b-563']['f1'] = 0.5;
      },
      (input) => {
        input.suite.projectionSha256 = 'c'.repeat(64);
      },
    ];
    for (const mutate of mutations) expect(hashOf(mutate)).toBe(baseline);
  });

  it('lets cost.calls change the hash', () => {
    const baseline = hashOf(() => undefined);
    expect(hashOf((input) => (input.suite.cost.calls = 13))).not.toBe(baseline);
  });

  it('lets per-case outcomes, ids and observations change the hash', () => {
    const baseline = hashOf(() => undefined);
    expect(hashOf((input) => (input.cases[1].outcome = 'pass'))).not.toBe(
      baseline,
    );
    expect(hashOf((input) => (input.cases[0].caseId = 'f-009'))).not.toBe(
      baseline,
    );
    expect(
      hashOf((input) => (input.cases[0].inputSha256 = 'c'.repeat(64))),
    ).not.toBe(baseline);
    expect(
      hashOf((input) => (input.cases[0].observed = 'fact 1 (changed)')),
    ).not.toBe(baseline);
  });

  it('lets details, ground truth and cassette version change the hash', () => {
    const baseline = hashOf(() => undefined);
    expect(
      hashOf((input) => {
        (input.suite.details as { recall: number }).recall = 0.83;
      }),
    ).not.toBe(baseline);
    expect(
      hashOf((input) => (input.suite.groundTruth.version = '1.1.0')),
    ).not.toBe(baseline);
    expect(
      hashOf((input) => (input.cassetteVersion = 'gt-curation-seeded@v2')),
    ).not.toBe(baseline);
  });

  it('rounds numbers to 6 decimals at every depth before hashing', () => {
    const withDetails = (details: unknown): string =>
      hashOf((input) => (input.suite.details = details));
    expect(withDetails({ a: 0.6666666666666665 })).toBe(
      withDetails({ a: 0.666667 }),
    );
    expect(withDetails({ a: 0.6666664 })).toBe(withDetails({ a: 0.6666661 }));
    expect(withDetails({ a: 0.6666664 })).not.toBe(
      withDetails({ a: 0.6666671 }),
    );
    expect(withDetails({ nested: { deep: [0.123456789, 2] } })).toBe(
      withDetails({ nested: { deep: [0.123457, 2] } }),
    );
  });

  it('rejects non-finite and cyclic details like the core canonicalizer', () => {
    const base = baseInput();
    expect(() =>
      computeSuiteProjectionSha256({
        ...base,
        suite: { ...base.suite, details: { score: Number.NaN } },
      }),
    ).toThrow('projection cannot contain non-finite numbers');
    const cyclic: Record<string, unknown> = { name: 'cycle' };
    cyclic['self'] = cyclic;
    expect(() =>
      computeSuiteProjectionSha256({
        ...base,
        suite: { ...base.suite, details: cyclic },
      }),
    ).toThrow('projection cannot contain cycles');
  });

  it('projects only the deterministic fields', () => {
    const input = baseInput();
    const projection = buildSuiteProjection(input);
    expect(Object.keys(projection).sort()).toEqual([
      'calls',
      'cases',
      'cassetteVersion',
      'details',
      'groundTruth',
      'verdict',
    ]);
    expect(projection.verdict).toBe('pass');
    expect(projection.calls).toBe(12);
    expect(projection.cassetteVersion).toBe('gt-curation-seeded@v1');
    expect(projection.groundTruth).toEqual(input.suite.groundTruth);
    expect(projection.cases).toEqual([
      {
        caseId: 'f-001',
        inputSha256: 'a'.repeat(64),
        expected: 'fact 1',
        observed: 'fact 1',
        outcome: 'pass',
      },
      {
        caseId: 'f-002',
        inputSha256: 'b'.repeat(64),
        expected: 'fact 2',
        observed: 'fact 2 (merged into fact 1)',
        outcome: 'fail',
      },
    ]);
  });
});
