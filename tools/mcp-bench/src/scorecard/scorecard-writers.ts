import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  createScorecardSchema,
  Scorecard,
  ScorecardSuite,
} from './scorecard.types';
import { defaultSuiteKindRegistry, SuiteKindRegistry } from './suite-kinds';

export async function readScorecard(
  filePath: string,
  registry: SuiteKindRegistry = defaultSuiteKindRegistry,
): Promise<Scorecard> {
  return createScorecardSchema(registry).parse(
    JSON.parse(await readFile(filePath, 'utf8')) as unknown,
  );
}
export async function writeScorecardJson(
  scorecard: Scorecard,
  outputDirectory: string,
  registry: SuiteKindRegistry = defaultSuiteKindRegistry,
): Promise<string> {
  await mkdir(outputDirectory, { recursive: true });
  const path = join(outputDirectory, 'scorecard.json');
  await writeFile(
    path,
    `${JSON.stringify(createScorecardSchema(registry).parse(scorecard), null, 2)}\n`,
    'utf8',
  );
  return path;
}
export async function writeScorecardMarkdown(
  scorecard: Scorecard,
  outputDirectory: string,
  registry: SuiteKindRegistry = defaultSuiteKindRegistry,
): Promise<string> {
  await mkdir(outputDirectory, { recursive: true });
  const path = join(outputDirectory, 'scorecard.md');
  await writeFile(path, renderScorecardMarkdown(scorecard, registry), 'utf8');
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
export function renderScorecardMarkdown(
  scorecard: Scorecard,
  registry: SuiteKindRegistry = defaultSuiteKindRegistry,
): string {
  return renderValidatedScorecardMarkdown(
    createScorecardSchema(registry).parse(scorecard),
    registry,
  );
}
function renderValidatedScorecardMarkdown(
  scorecard: Scorecard,
  registry: SuiteKindRegistry,
): string {
  const unprobed =
    scorecard.run.guard.unprobed
      .map((item) => `${item.pid}/${item.name}`)
      .join(', ') || 'none';
  const lines = [
    `# MCP benchmark scorecard: ${scorecard.run.id}`,
    '',
    `Host: ${scorecard.run.host}`,
    ...(scorecard.run.smoke === undefined
      ? []
      : [`Mode: ${scorecard.run.smoke ? 'smoke' : 'full'}`]),
    `Corpus: ${scorecard.corpus.commit}, ${scorecard.corpus.eligibleFiles} raw source files (extension count; no gitignore or indexer rules; the indexer census is in the lifecycle rows' coverage blocks)`,
    `Guard mode: ${scorecard.run.guardMode}`,
    `Guard partial: ${scorecard.run.guard.partial ? `yes (${unprobed})` : 'no'}`,
    `Host exit: ${scorecard.run.hostExit.kind}`,
    '',
  ];
  for (const suite of scorecard.suites) {
    lines.push(
      `Claim: ${suite.claim.source} — ${suite.claim.ref}`,
      `Ground truth: ${suite.groundTruth.id} (${suite.groundTruth.method})`,
      ...(suite.arm === undefined ? [] : [`Arm: ${suite.arm}`]),
      '',
      ...(suite.displayLabel === undefined
        ? []
        : [`## ${headingCell(suite.displayLabel)} (${suite.kind})`, '']),
    );
    const renderer = registry.getSuiteKind(suite.kind)?.renderMarkdown;
    lines.push(
      ...(renderer === undefined ? renderGenericSuite(suite) : renderer(suite)),
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
      `| ${cell(item.scenario)} | ${cell(item.tool)} | ${item.na === undefined ? (item.pass ? 'pass' : 'fail') : 'na'} | ${cell(item.na === undefined ? item.detail : `${item.na}${item.detail ? ` (${item.detail})` : ''}`)} |`,
    );
  lines.push(
    '',
    '## Eager selection',
    '',
    '| Mode | Tools | Rule |',
    '| --- | --- | --- |',
    `| Eager | ${cell(scorecard.eagerSelection.eager.join(', '))} | ${cell(scorecard.eagerSelection.rule)} |`,
    `| Deferred | ${cell(scorecard.eagerSelection.deferred.join(', '))} | ${cell(scorecard.eagerSelection.rule)} |`,
    '',
  );
  return `${lines.join('\n')}\n`;
}
function renderGenericSuite(suite: ScorecardSuite): string[] {
  const lines = [
    `## ${suite.kind}`,
    '',
    '| Baseline | Metric | Value | Delta |',
    '| --- | --- | ---: | ---: |',
    `| Suite | claim (${cell(suite.claim.source)}) | ${cell(suite.claim.ref)} | |`,
    `| Suite | ground truth (${cell(suite.groundTruth.method)}) | ${cell(suite.groundTruth.id)} | |`,
  ];
  for (const baseline of suite.baselines)
    for (const [metric, value] of Object.entries(baseline.metrics))
      lines.push(
        `| ${cell(baseline.label)} | ${cell(metric)} | ${formatMetric(value)} | ${formatMetric(suite.deltas[baseline.id]?.[metric])} |`,
      );
  lines.push(
    `| Cost | calls | ${suite.cost.calls} | |`,
    `| Cost | source | ${cell(suite.cost.source)} | |`,
    `| Cost | latency_ms.p50 | ${formatMetric(suite.cost.latency_ms.p50)} | |`,
    `| Cost | latency_ms.p95 | ${formatMetric(suite.cost.latency_ms.p95)} | |`,
    `| Cost | error_rate | ${formatMetric(suite.cost.error_rate)} | |`,
    `| Verdict | ${suite.verdict} | ${cell(suite.naReason ?? '')} | |`,
    '',
  );
  return lines;
}
function formatMetric(value: number | null | undefined): string {
  return value === null || value === undefined ? 'na' : String(value);
}
/** ATX heading text: CR/LF would start a new Markdown line, so they become spaces. */
function headingCell(value: string): string {
  return cell(value.replaceAll(/\r\n|\r|\n/gu, ' '));
}
function cell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll(/\r\n|\r|\n/gu, '<br>');
}
