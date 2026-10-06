import { KnownFailureEntry } from '../ground-truth/label-schemas';
import {
  evaluateKnownFailures,
  KnownFailuresGateInput,
} from './known-failures';

function entry(overrides: Partial<KnownFailureEntry> = {}): KnownFailureEntry {
  return {
    suiteId: 'mem.extraction',
    metric: 'recall',
    direction: 'higher-is-better',
    recordedValue: 0.5,
    tolerance: 0,
    ledgerRow: 'extract durability',
    since: '2026-10-07',
    ...overrides,
  };
}

function input(
  overrides: Partial<KnownFailuresGateInput> = {},
): KnownFailuresGateInput {
  return {
    entries: [entry()],
    suites: [
      {
        id: 'mem.extraction',
        verdict: 'fail',
        metrics: { recall: 0.5 },
        executedCases: 1,
      },
    ],
    ...overrides,
  };
}

describe('evaluateKnownFailures', () => {
  it('reports an unchanged listed failure without failing', () => {
    expect(evaluateKnownFailures(input())).toEqual({
      passed: true,
      findings: [],
    });
  });

  it('reports a listed failure within tolerance without failing', () => {
    expect(
      evaluateKnownFailures(
        input({
          entries: [
            entry({ tolerance: 0.1, toleranceReason: 'rounded source rate' }),
          ],
          suites: [
            {
              id: 'mem.extraction',
              verdict: 'fail',
              metrics: { recall: 0.55 },
            },
          ],
        }),
      ),
    ).toEqual({ passed: true, findings: [] });
  });

  it('fails a better-but-still-failing entry so its floor is tightened', () => {
    expect(
      evaluateKnownFailures(
        input({
          suites: [
            { id: 'mem.extraction', verdict: 'fail', metrics: { recall: 0.6 } },
          ],
        }),
      ).findings[0]?.kind,
    ).toBe('tighten-recorded-value');
  });

  it('fails a failure that worsens against its direction', () => {
    expect(
      evaluateKnownFailures(
        input({
          suites: [
            { id: 'mem.extraction', verdict: 'fail', metrics: { recall: 0.4 } },
          ],
        }),
      ).findings[0]?.kind,
    ).toBe('worsened');
  });

  it('fails an unlisted failure', () => {
    const result = evaluateKnownFailures(
      input({
        entries: [],
        suites: [
          { id: 'mem.extraction', verdict: 'fail', metrics: { recall: 0.5 } },
        ],
      }),
    );
    expect(result.findings[0]?.kind).toBe('new-failure');
  });

  it('fails na because na is never a pass', () => {
    expect(
      evaluateKnownFailures(
        input({
          suites: [{ id: 'mem.extraction', verdict: 'na', metrics: {} }],
        }),
      ).findings[0]?.kind,
    ).toBe('not-measurable');
  });

  it('fails zero executed cases', () => {
    expect(
      evaluateKnownFailures(
        input({
          suites: [
            {
              id: 'mem.extraction',
              verdict: 'fail',
              metrics: { recall: 0.5 },
              executedCases: 0,
            },
          ],
        }),
      ).findings.map((finding) => finding.kind),
    ).toContain('zero-cases');
  });

  it('fails a listed entry whose suite now passes so it is removed', () => {
    expect(
      evaluateKnownFailures(
        input({
          suites: [
            { id: 'mem.extraction', verdict: 'pass', metrics: { recall: 0.8 } },
          ],
        }),
      ).findings[0]?.kind,
    ).toBe('remove-entry');
  });

  it('fails each runtime integrity signal', () => {
    expect(
      evaluateKnownFailures(
        input({
          signals: {
            cassetteMisses: ['fixture-1'],
            guardTrips: ['hash'],
            networkHits: ['https://example.test'],
          },
        }),
      ).findings.map((finding) => finding.kind),
    ).toEqual(['cassette-miss', 'guard-trip', 'network-hit']);
  });

  it('accepts an empty list when every suite passes', () => {
    expect(
      evaluateKnownFailures(
        input({
          entries: [],
          suites: [
            { id: 'mem.extraction', verdict: 'pass', metrics: { recall: 1 } },
          ],
        }),
      ),
    ).toEqual({ passed: true, findings: [] });
  });

  it('fails duplicate entries deterministically', () => {
    const result = evaluateKnownFailures(
      input({ entries: [entry(), entry()] }),
    );
    expect(result.passed).toBe(false);
    expect(result.findings.map((finding) => finding.kind)).toEqual([
      'duplicate-entry',
    ]);
  });

  it('fails an entry whose suite or metric no longer exists', () => {
    const missingSuite = evaluateKnownFailures(input({ suites: [] }));
    const missingMetric = evaluateKnownFailures(
      input({
        suites: [
          {
            id: 'mem.extraction',
            verdict: 'fail',
            metrics: { precision: 0.5 },
          },
        ],
      }),
    );
    expect(missingSuite.findings[0]?.kind).toBe('suite-missing');
    expect(missingMetric.findings.map((finding) => finding.kind)).toEqual([
      'new-failure',
      'metric-missing',
    ]);
  });
});
