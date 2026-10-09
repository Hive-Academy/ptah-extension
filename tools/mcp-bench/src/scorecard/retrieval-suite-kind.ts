import { z } from 'zod';
import {
  CODE_INDEX_SETTLE_ABORT_CONSECUTIVE_ERRORS,
  CODE_INDEX_SETTLE_TIMEOUT_MS,
} from '../lifecycle/index-settle';
import { registerSuiteKind } from './suite-kinds';
const metricValueSchema = z.number().finite().nullable();
export const retrievalDetailsSchema = z.object({
  tool: z.string().min(1),
  questions: z.number().int().nonnegative(),
  /** The metric and native baseline that decide the verdict (read by the gate and the noise measurement). */
  primaryMetric: z
    .enum([
      'hit@1',
      'hit@5',
      'mrr',
      'recall@10',
      'recall_all',
      'precision',
      'acc_at_k',
      'ndcg_at_k',
    ])
    .optional(),
  decidingBaseline: z.string().min(1).optional(),
  metrics: z.object({
    'hit@1': metricValueSchema.optional(),
    'hit@5': metricValueSchema.optional(),
    mrr: metricValueSchema.optional(),
    'recall@10': metricValueSchema.optional(),
    recall_all: metricValueSchema.optional(),
    precision: metricValueSchema.optional(),
    acc_at_k: metricValueSchema.optional(),
    ndcg_at_k: metricValueSchema.optional(),
    truncation_rate: metricValueSchema.optional(),
  }),
  /** Absent on scorecards written before index-settle measurement existed. */
  indexSettle: z
    .object({
      settled: z.boolean(),
      aborted: z.boolean().optional(),
      abortKind: z
        .enum(['transport', 'rpc', 'tool-error', 'unavailable'])
        .nullable()
        .optional(),
      elapsedMs: z.number().finite().nonnegative(),
      symbolCount: z.number().int().nonnegative().nullable(),
      coverage: z.string(),
      states: z.array(z.string()),
      lastState: z.string().optional(),
    })
    .optional(),
  failures: z
    .array(
      z.object({
        question: z.string(),
        expected: z.array(z.string()),
        got: z.array(z.string()),
      }),
    )
    .default([]),
});
registerSuiteKind('retrieval', retrievalDetailsSchema, (suite) => {
  const lines = [
    `## ${suite.details.tool}`,
    '',
    '| Metric | Tool | Baseline | Delta |',
    '| --- | ---: | ---: | ---: |',
  ];
  for (const [metric, toolValue] of Object.entries(suite.details.metrics)) {
    if (suite.baselines.length === 0)
      lines.push(`| ${cell(metric)} | ${formatMetric(toolValue)} |  |  |`);
    for (const baseline of suite.baselines)
      lines.push(
        `| ${cell(metric)} | ${formatMetric(toolValue)} | ${formatMetric(baseline.metrics[metric])} | ${formatMetric(suite.deltas[baseline.id]?.[metric])} |`,
      );
  }
  if (suite.baselines.length === 0)
    lines.push(`| error_rate | ${formatMetric(suite.cost.error_rate)} |  |  |`);
  for (const baseline of suite.baselines)
    lines.push(
      `| error_rate | ${formatMetric(suite.cost.error_rate)} | ${formatMetric(baseline.metrics['error_rate'])} |  |`,
    );
  lines.push(
    `| latency_ms.p50 | ${formatMetric(suite.cost.latency_ms.p50)} |  |  |`,
    `| latency_ms.p95 | ${formatMetric(suite.cost.latency_ms.p95)} |  |  |`,
    `| cost.source | ${cell(suite.cost.source)} |  |  |`,
    `| Verdict | ${suite.verdict} | ${suite.naReason ?? ''} |  |`,
    ...(suite.details.indexSettle === undefined
      ? []
      : [
          indexSettleLine(suite.details.indexSettle),
        ]),
    '',
  );
  return lines;
});

function indexSettleLine(indexSettle: {
  readonly settled: boolean;
  readonly aborted?: boolean;
  readonly abortKind?: 'transport' | 'rpc' | 'tool-error' | 'unavailable' | null;
  readonly elapsedMs: number;
  readonly symbolCount: number | null;
  readonly coverage: string;
  readonly lastState?: string;
}): string {
  if (indexSettle.settled)
    return `Index settled after ${Math.round(indexSettle.elapsedMs / 1000)} s (${indexSettle.symbolCount ?? 'unknown'} symbols, coverage ${indexSettle.coverage}) before scoring`;
  if (indexSettle.aborted)
    return `Index wait aborted after ${CODE_INDEX_SETTLE_ABORT_CONSECUTIVE_ERRORS} consecutive ${indexSettle.abortKind ?? 'unknown'} replies (~${Math.round(indexSettle.elapsedMs / 1000)} s)`;
  return `Index did not settle within ${CODE_INDEX_SETTLE_TIMEOUT_MS / 1000} s; last state: ${indexSettle.lastState ?? 'unknown'}`;
}
function formatMetric(value: number | null | undefined): string {
  return value === null || value === undefined ? 'na' : String(value);
}

function cell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll(/\r?\n/gu, '<br>');
}
