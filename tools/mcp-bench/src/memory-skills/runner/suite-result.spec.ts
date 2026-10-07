import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
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
