import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RunnerHost } from './host-completion-reader';
import { toScorecardSuite } from './run-scorecard';
import {
  SUITE_RESULT_SCHEMA_ID,
  suiteResultSchema,
  readSuiteResult,
  suiteCasesFile,
  suiteResultFile,
  writeSuiteResult,
  type CaseRecord,
  type SuiteResultInput,
} from './suite-result';

const RESULT: SuiteResultInput = {
  suiteId: 'mem.temporal',
  kind: 'curation',
  details: { operation: 'temporal' },
  claim: { source: 'ledger', ref: 'feature-ledger.md:3' },
  groundTruth: { id: 'gt-memory', version: 'v1', method: 'seeded' },
  baselines: [],
  deltas: {},
  cost: {
    calls: 0,
    latency_ms: { p50: null, p95: null },
    error_rate: null,
    tokens: {},
  },
  modelCalls: 0,
  verdict: 'pass',
  metrics: { accuracy: 1 },
  cassetteVersion: null,
};

const CASE: CaseRecord = {
  caseId: 't1',
  inputSha256: 'a'.repeat(64),
  expected: '2026-10-01',
  observed: '2026-10-01',
  outcome: 'pass',
  latencyMs: 3,
};

describe('suite result files', () => {
  let runDir: string;

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), 'ptah-620-suite-result-'));
  });

  afterEach(() => {
    rmSync(runDir, { recursive: true, force: true });
  });

  it('round-trips a result and its cases', () => {
    writeSuiteResult(runDir, RESULT, [CASE]);
    expect(readSuiteResult(runDir, 'mem.temporal')).toEqual({
      result: { ...RESULT, schemaId: '620.suite-result.v1' },
      cases: [CASE],
    });
  });

  it('never overwrites a result', () => {
    writeSuiteResult(runDir, RESULT, [CASE]);
    expect(() => writeSuiteResult(runDir, RESULT, [CASE])).toThrow(
      /already has a result/,
    );
  });

  it('refuses a case without a runtime and a cost carrying a source', () => {
    const noRuntime: Partial<CaseRecord> = { ...CASE };
    delete noRuntime.latencyMs;
    expect(() =>
      writeSuiteResult(runDir, RESULT, [noRuntime as CaseRecord]),
    ).toThrow();
    expect(() =>
      writeSuiteResult(
        runDir,
        {
          ...RESULT,
          cost: { ...RESULT.cost, source: 'none' } as SuiteResultInput['cost'],
        },
        [CASE],
      ),
    ).toThrow();
  });

  it("validates the core fields with 619's suiteCoreSchema and refuses runner-set or unknown keys", () => {
    const refuses = (result: Record<string, unknown>, message: RegExp) =>
      expect(() =>
        suiteResultSchema.parse({
          ...result,
          schemaId: SUITE_RESULT_SCHEMA_ID,
        }),
      ).toThrow(message);
    refuses(
      { ...RESULT, projectionSha256: 'a'.repeat(64) },
      /set by the runner/,
    );
    refuses({ ...RESULT, extra: 1 }, /unrecognized key: extra/);
    // A 619 core rule (naReason only on na suites) now applies here too.
    refuses(
      { ...RESULT, naReason: 'x' },
      /naReason is only valid for na suites/,
    );
    refuses({ ...RESULT, modelCalls: -1 }, /Too small|>=0/);
  });

  it('refuses a key that 619 would strip at any depth, naming its path (619-adoption review)', () => {
    const refuses = (result: Record<string, unknown>, message: string) =>
      expect(() =>
        suiteResultSchema.parse({
          ...result,
          schemaId: SUITE_RESULT_SCHEMA_ID,
        }),
      ).toThrow(message);
    refuses(
      { ...RESULT, claim: { ...RESULT.claim, reff: 'typo' } },
      'unrecognized key: claim.reff',
    );
    refuses(
      { ...RESULT, groundTruth: { ...RESULT.groundTruth, frozen: 'x' } },
      'unrecognized key: groundTruth.frozen',
    );
    refuses(
      {
        ...RESULT,
        cost: { ...RESULT.cost, tokens: { ...RESULT.cost.tokens, billd: 1 } },
      },
      'unrecognized key: cost.tokens.billd',
    );
    refuses(
      {
        ...RESULT,
        baselines: [{ id: 'b', label: 'B', metrics: {}, lable: 'typo' }],
      },
      'unrecognized key: baselines.0.lable',
    );
  });

  it('parses a valid result unchanged, including nested optional keys and free-form details', () => {
    const full: SuiteResultInput = {
      ...RESULT,
      details: { operation: 'temporal', any: { nested: ['shape'] } },
      claim: { ...RESULT.claim, text: 'claim text' },
      groundTruth: {
        ...RESULT.groundTruth,
        raterCount: 2,
        frozenAt: '2026-10-07T00:00:00.000Z',
      },
      arm: 'memory',
      baselines: [{ id: 'b', label: 'B', metrics: { accuracy: 0.5 } }],
      deltas: { b: { accuracy: 0.5 } },
      cost: { ...RESULT.cost, tokens: { input: 1, output: null } },
    };
    const input = { ...full, schemaId: SUITE_RESULT_SCHEMA_ID };
    expect(suiteResultSchema.parse(input)).toEqual(input);
  });

  it('keeps displayLabel and a model-panel panel, and rejects panel on labelled', () => {
    const panelResult: SuiteResultInput = {
      ...RESULT,
      displayLabel: 'skill.trigger-eval.panel',
      groundTruth: {
        id: 'gt-skill-triggers',
        version: 'v1',
        method: 'model-panel',
        panel: 'xAI+Google; adjudicator=GLM',
        raterCount: 2,
      },
    };
    const parsed = suiteResultSchema.parse({
      ...panelResult,
      schemaId: SUITE_RESULT_SCHEMA_ID,
    });
    expect(parsed.displayLabel).toBe('skill.trigger-eval.panel');
    expect(parsed.groundTruth).toEqual(panelResult.groundTruth);
    expect(() =>
      suiteResultSchema.parse({
        ...RESULT,
        schemaId: SUITE_RESULT_SCHEMA_ID,
        groundTruth: {
          ...RESULT.groundTruth,
          panel: 'xAI+Google; adjudicator=GLM',
        },
      }),
    ).toThrow(/panel is only valid/);
    const suite = toScorecardSuite(
      { placement: 'offline', result: parsed, cases: [CASE] },
      'replay',
      {
        runId: 'ms-panel',
        startedAt: '2026-10-07T00:00:00.000Z',
        host: { pid: 1, port: 9 } as RunnerHost,
      },
    );
    expect(suite.displayLabel).toBe('skill.trigger-eval.panel');
    expect(suite.groundTruth.panel).toBe('xAI+Google; adjudicator=GLM');
    expect(suite.groundTruth.method).toBe('model-panel');
  });

  it('rejects a repeated case id, a foreign suite id and a missing result', () => {
    writeSuiteResult(runDir, RESULT, [CASE]);
    appendFileSync(
      join(runDir, suiteCasesFile('mem.temporal')),
      `${JSON.stringify(CASE)}\n`,
    );
    expect(() => readSuiteResult(runDir, 'mem.temporal')).toThrow(
      /repeats case t1/,
    );

    const resultPath = join(runDir, suiteResultFile('mem.temporal'));
    const other = JSON.parse(readFileSync(resultPath, 'utf8'));
    writeFileSync(
      join(runDir, suiteResultFile('mem.other')),
      JSON.stringify(other),
    );
    expect(() => readSuiteResult(runDir, 'mem.other')).toThrow(
      /names suite mem.temporal, expected mem.other/,
    );
    expect(() => readSuiteResult(runDir, 'mem.absent')).toThrow(/wrote no/);
  });
});
