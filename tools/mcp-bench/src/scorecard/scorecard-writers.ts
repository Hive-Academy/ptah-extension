import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Scorecard, scorecardSchema } from './scorecard.types';

export async function readScorecard(filePath: string): Promise<Scorecard> {
  return scorecardSchema.parse(
    JSON.parse(await readFile(filePath, 'utf8')) as unknown,
  ) as Scorecard;
}
export async function writeScorecardJson(
  scorecard: Scorecard,
  outputDirectory: string,
): Promise<string> {
  await mkdir(outputDirectory, { recursive: true });
  const path = join(outputDirectory, 'scorecard.json');
  await writeFile(
    path,
    `${JSON.stringify(scorecardSchema.parse(scorecard), null, 2)}\n`,
    'utf8',
  );
  return path;
}
export async function writeScorecardMarkdown(
  scorecard: Scorecard,
  outputDirectory: string,
): Promise<string> {
  await mkdir(outputDirectory, { recursive: true });
  const path = join(outputDirectory, 'scorecard.md');
  await writeFile(
    path,
    renderScorecardMarkdown(scorecardSchema.parse(scorecard) as Scorecard),
    'utf8',
  );
  return path;
}
export function scorecardOutputDirectory(
  projectRoot: string,
  runId: string,
): string {
  return join(projectRoot, 'out', basename(runId));
}
export function scorecardBaselineDirectory(projectRoot: string): string {
  return join(projectRoot, 'baseline');
}
export function renderScorecardMarkdown(scorecard: Scorecard): string {
  return renderValidatedScorecardMarkdown(
    scorecardSchema.parse(scorecard) as Scorecard,
  );
}
function renderValidatedScorecardMarkdown(scorecard: Scorecard): string {
  const lines = [
    `# MCP benchmark scorecard: ${scorecard.run.id}`,
    '',
    `Host: ${scorecard.run.host}`,
    '',
  ];
  for (const suite of scorecard.suites) {
    lines.push(
      `## ${suite.tool}`,
      '',
      `Claim: ${suite.claim}`,
      '',
      '| Metric | Tool | Native | Delta |',
      '| --- | ---: | ---: | ---: |',
    );
    for (const row of metricRows(suite))
      lines.push(
        `| ${row.name} | ${row.tool} | ${row.native} | ${row.delta} |`,
      );
    lines.push(
      `| Verdict | ${suite.verdict} | ${suite.naReason ?? ''} | |`,
      '',
    );
  }
  lines.push(
    '## Lifecycle',
    '',
    '| Scenario | Tool | Pass | Detail |',
    '| --- | --- | --- | --- |',
  );
  for (const item of scorecard.lifecycle)
    lines.push(
      `| ${item.scenario} | ${item.tool} | ${item.pass ? 'pass' : 'fail'} | ${item.detail} |`,
    );
  lines.push(
    '',
    '## Eager selection',
    '',
    '| Mode | Tools | Rule |',
    '| --- | --- | --- |',
    `| Eager | ${scorecard.eagerSelection.eager.join(', ')} | ${scorecard.eagerSelection.rule} |`,
    `| Deferred | ${scorecard.eagerSelection.deferred.join(', ')} | ${scorecard.eagerSelection.rule} |`,
    '',
  );
  return `${lines.join('\n')}\n`;
}
interface MetricRow {
  name: string;
  tool: string;
  native: string;
  delta: string;
}
function metricRows(suite: Scorecard['suites'][number]): MetricRow[] {
  const rows: MetricRow[] = [];
  for (const [name, tool] of Object.entries(suite.tool_metrics)) {
    if (name === 'latency_ms') {
      const value = tool as { p50: number | null; p95: number | null };
      const native = suite.native_metrics.latency_ms;
      const nativeLatency =
        typeof native === 'object' && native !== null
          ? (native as { p50: number | null; p95: number | null })
          : undefined;
      rows.push(
        metricRow(
          'latency_ms.p50',
          value.p50,
          nativeLatency?.p50,
          suite.delta.latency_ms_p50,
        ),
        metricRow('latency_ms.p95', value.p95, nativeLatency?.p95, undefined),
      );
    } else
      rows.push(
        metricRow(
          name,
          tool,
          suite.native_metrics[name],
          deltaForMetric(name, suite),
        ),
      );
  }
  return rows;
}
function metricRow(
  name: string,
  tool: unknown,
  native: unknown,
  delta: number | null | undefined,
): MetricRow {
  return {
    name,
    tool: formatMetric(tool),
    native: formatMetric(native),
    delta: formatMetric(delta),
  };
}
function deltaForMetric(
  metric: string,
  suite: Scorecard['suites'][number],
): number | null | undefined {
  if (metric === 'tokens_p50') return suite.delta.tokens;
  if (metric === 'calls_per_answer') return suite.delta.calls;
  if (['hit@1', 'hit@5', 'mrr', 'recall@10'].includes(metric))
    return suite.delta.quality;
  return undefined;
}
function formatMetric(value: unknown): string {
  return value === undefined || value === null ? 'na' : String(value);
}
