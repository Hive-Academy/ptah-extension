import { z } from 'zod';
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
  lines.push(
    `| latency_ms.p50 | ${formatMetric(suite.cost.latency_ms.p50)} |  |  |`,
    `| latency_ms.p95 | ${formatMetric(suite.cost.latency_ms.p95)} |  |  |`,
    `| cost.source | ${cell(suite.cost.source)} |  |  |`,
    `| error_rate | ${formatMetric(suite.cost.error_rate)} |  |  |`,
    `| Verdict | ${suite.verdict} | ${suite.naReason ?? ''} |  |`,
    '',
  );
  return lines;
});
function formatMetric(value: number | null | undefined): string {
  return value === null || value === undefined ? 'na' : String(value);
}

function cell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll(/\r?\n/gu, '<br>');
}
