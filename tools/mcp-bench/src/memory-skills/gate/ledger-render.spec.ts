import {
  evaluateFeatureEvidenceRow,
  FeatureEvidenceRow,
  LedgerSuite,
  renderFeatureEvidenceLedger,
} from './ledger-render';

function row(overrides: Partial<FeatureEvidenceRow> = {}): FeatureEvidenceRow {
  return {
    feature: 'Extraction durability',
    shippedIn: '563',
    claim: 'Less sediment written (memory.ts:1)',
    suiteId: 'mem.extraction',
    metric: 'recall',
    direction: 'higher-is-better',
    minEffect: 0.1,
    groundTruth: 'gt-memory@v1',
    groundTruthTrusted: true,
    baselines: ['old-prompt'],
    scorecardRunId: 'run-1',
    fixOrDeleteProposal: 'Fix extraction prompt or delete claim.',
    ...overrides,
  };
}

function suite(overrides: Partial<LedgerSuite> = {}): LedgerSuite {
  return {
    id: 'mem.extraction',
    verdict: 'fail',
    metrics: { recall: 0.8 },
    baselines: [
      { id: 'old-prompt', label: 'Old prompt', metrics: { recall: 0.6 } },
    ],
    pairedIntervals: { 'old-prompt': [0.1, 0.3] },
    ...overrides,
  };
}

describe('renderFeatureEvidenceLedger', () => {
  it('renders a proven row only when every baseline clears MinE and its interval excludes zero', () => {
    const result = evaluateFeatureEvidenceRow(row(), suite());
    expect(result.verdict).toBe('proven');
    expect(renderFeatureEvidenceLedger([row()], [suite()])).toContain(
      '| proven | — |',
    );
  });

  it('renders no effect and its mandatory fix-or-delete proposal when the interval includes zero', () => {
    const result = evaluateFeatureEvidenceRow(
      row(),
      suite({ pairedIntervals: { 'old-prompt': [-0.01, 0.2] } }),
    );
    expect(result.verdict).toBe('no effect');
    expect(
      renderFeatureEvidenceLedger(
        [row()],
        [suite({ pairedIntervals: { 'old-prompt': [-0.01, 0.2] } })],
      ),
    ).toContain('Fix extraction prompt or delete claim.');
  });

  it('renders regressed when the metric moves beyond MinE in the wrong direction', () => {
    expect(
      evaluateFeatureEvidenceRow(row(), suite({ metrics: { recall: 0.4 } }))
        .verdict,
    ).toBe('regressed');
  });

  it('renders not measurable yet for na, never proven', () => {
    expect(
      evaluateFeatureEvidenceRow(row(), suite({ verdict: 'na' })).verdict,
    ).toBe('not measurable yet');
  });

  it('requires a real baseline for invariant rows', () => {
    expect(() =>
      renderFeatureEvidenceLedger(
        [row({ invariant: true, minEffect: null, baselines: [] })],
        [suite()],
      ),
    ).toThrow('invariant row requires a baseline');
  });

  it('renders invariant failures as regressions when the freeze baseline held', () => {
    expect(
      evaluateFeatureEvidenceRow(
        row({ invariant: true, minEffect: null, metric: 'violations' }),
        suite({
          metrics: { violations: 1 },
          baselines: [
            { id: 'old-prompt', label: 'freeze', metrics: { violations: 0 } },
          ],
        }),
      ).verdict,
    ).toBe('regressed');
  });
});
