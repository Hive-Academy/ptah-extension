export type FeatureEvidenceVerdict =
  'proven' | 'no effect' | 'regressed' | 'not measurable yet';

export interface LedgerBaseline {
  readonly id: string;
  readonly label: string;
  readonly metrics: Readonly<Record<string, number | null>>;
}

export interface LedgerSuite {
  readonly id: string;
  readonly verdict: 'pass' | 'fail' | 'na';
  readonly metrics: Readonly<Record<string, number | null>>;
  readonly baselines: readonly LedgerBaseline[];
  readonly pairedIntervals?: Readonly<
    Record<string, readonly [number, number] | null>
  >;
}

export interface LedgerGuard {
  readonly metric: string;
  readonly direction: 'higher-is-better' | 'lower-is-better';
  readonly tolerance: number;
}

export interface FeatureEvidenceRow {
  readonly feature: string;
  readonly shippedIn: string;
  readonly claim: string;
  readonly suiteId: string;
  readonly metric: string;
  readonly direction: 'higher-is-better' | 'lower-is-better';
  readonly minEffect: number | null;
  readonly groundTruth: string;
  readonly groundTruthTrusted: boolean;
  readonly baselines: readonly string[];
  readonly scorecardRunId: string;
  readonly guards?: readonly LedgerGuard[];
  readonly invariant?: boolean;
  readonly fixOrDeleteProposal?: string;
}

export interface RenderedFeatureEvidenceRow {
  readonly row: FeatureEvidenceRow;
  readonly verdict: FeatureEvidenceVerdict;
  readonly result: string;
}

/** Renders the committed feature-evidence template with R-L2 through R-L6 verdicts. */
export function renderFeatureEvidenceLedger(
  rows: readonly FeatureEvidenceRow[],
  suites: readonly LedgerSuite[],
): string {
  const suiteById = new Map(suites.map((suite) => [suite.id, suite]));
  const rendered = rows
    .map((row) => renderRow(row, suiteById.get(row.suiteId)))
    .sort((left, right) => left.row.feature.localeCompare(right.row.feature));

  const header = [
    '| Feature | Shipped in | Claim (verbatim, file:line) | Suite id | Metric (direction) | MinE / guard | Ground truth (id@version) | Baselines | Result (system vs baselines) | Scorecard run id | Verdict | Fix-or-delete proposal |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  const body = rendered.map(({ row, verdict, result }) => {
    const proposal = verdict === 'no effect' ? requiredProposal(row) : '—';
    return `| ${cell(row.feature)} | ${cell(row.shippedIn)} | ${cell(row.claim)} | ${cell(row.suiteId)} | ${cell(`${row.metric} (${row.direction})`)} | ${cell(formatMinEffect(row))} | ${cell(row.groundTruth)} | ${cell(row.baselines.join('; '))} | ${cell(result)} | ${cell(row.scorecardRunId)} | ${verdict} | ${cell(proposal)} |`;
  });
  return [...header, ...body].join('\n').concat('\n');
}

export function evaluateFeatureEvidenceRow(
  row: FeatureEvidenceRow,
  suite: LedgerSuite | undefined,
): RenderedFeatureEvidenceRow {
  return renderRow(row, suite);
}

function renderRow(
  row: FeatureEvidenceRow,
  suite: LedgerSuite | undefined,
): RenderedFeatureEvidenceRow {
  if (suite === undefined || suite.verdict === 'na' || !row.groundTruthTrusted)
    return { row, verdict: 'not measurable yet', result: 'not measurable yet' };
  if (row.invariant === true) return renderInvariantRow(row, suite);
  const minEffect = row.minEffect;
  if (minEffect === null)
    throw new Error(`non-invariant row requires MinE: ${row.feature}`);

  const current = suite.metrics[row.metric];
  const baselines = metricBaselines(row, suite);
  if (current === undefined || current === null || baselines === undefined)
    return { row, verdict: 'not measurable yet', result: 'not measurable yet' };

  const deltas = baselines.map((baseline) =>
    directionalDelta(current, baseline.value, row.direction),
  );
  const guardRegressed = (row.guards ?? []).some((guard) =>
    isGuardRegressed(guard, suite),
  );
  const allImproved = deltas.every((delta) => delta >= minEffect);
  const intervalExcludesZero = baselines.every((baseline) => {
    const interval = suite.pairedIntervals?.[baseline.id];
    return interval !== undefined && interval !== null && interval[0] > 0;
  });
  const wrongDirection = deltas.some((delta) => delta <= -minEffect);
  const verdict: FeatureEvidenceVerdict =
    guardRegressed || wrongDirection
      ? 'regressed'
      : allImproved && intervalExcludesZero
        ? 'proven'
        : 'no effect';
  return {
    row,
    verdict,
    result: `${formatNumber(current)} vs ${baselines.map((baseline) => `${baseline.id} ${formatNumber(baseline.value)}`).join(', ')}`,
  };
}

function renderInvariantRow(
  row: FeatureEvidenceRow,
  suite: LedgerSuite,
): RenderedFeatureEvidenceRow {
  const baselines = metricBaselines(row, suite);
  if (baselines === undefined)
    throw new Error(`invariant row requires a baseline: ${row.feature}`);
  const current = suite.metrics[row.metric];
  if (current === undefined || current === null)
    return { row, verdict: 'not measurable yet', result: 'not measurable yet' };
  const holds = current === 0;
  const heldBefore = baselines.every((baseline) => baseline.value === 0);
  return {
    row,
    verdict: holds ? 'proven' : heldBefore ? 'regressed' : 'no effect',
    result: `${formatNumber(current)} vs ${baselines.map((baseline) => `${baseline.id} ${formatNumber(baseline.value)}`).join(', ')}`,
  };
}

function metricBaselines(
  row: FeatureEvidenceRow,
  suite: LedgerSuite,
): Array<{ id: string; value: number }> | undefined {
  if (row.baselines.length === 0) return undefined;
  const selected = suite.baselines.filter((baseline) =>
    row.baselines.includes(baseline.id),
  );
  if (selected.length !== row.baselines.length) return undefined;
  const values = selected.map((baseline) => ({
    id: baseline.id,
    value: baseline.metrics[row.metric],
  }));
  if (
    values.some(
      (baseline) => baseline.value === undefined || baseline.value === null,
    )
  )
    return undefined;
  return values as Array<{ id: string; value: number }>;
}

function isGuardRegressed(guard: LedgerGuard, suite: LedgerSuite): boolean {
  const current = suite.metrics[guard.metric];
  if (current === undefined || current === null) return true;
  return suite.baselines.some((baseline) => {
    const value = baseline.metrics[guard.metric];
    return (
      value !== undefined &&
      value !== null &&
      directionalDelta(current, value, guard.direction) < -guard.tolerance
    );
  });
}

function directionalDelta(
  value: number,
  baseline: number,
  direction: 'higher-is-better' | 'lower-is-better',
): number {
  return direction === 'higher-is-better' ? value - baseline : baseline - value;
}

function requiredProposal(row: FeatureEvidenceRow): string {
  if (
    row.fixOrDeleteProposal === undefined ||
    row.fixOrDeleteProposal.trim() === ''
  )
    throw new Error(
      `no-effect row requires a fix-or-delete proposal: ${row.feature}`,
    );
  return row.fixOrDeleteProposal;
}

function formatMinEffect(row: FeatureEvidenceRow): string {
  if (row.invariant === true) return 'invariant';
  return `MinE ${row.minEffect}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function cell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', '<br>');
}
