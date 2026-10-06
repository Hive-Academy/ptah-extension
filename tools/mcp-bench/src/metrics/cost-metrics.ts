import { encode } from 'gpt-tokenizer';

export interface CallOutcome {
  errored: boolean;
  truncated: boolean;
}

export function resultTokens(result: string): number {
  return encode(result).length;
}

export function p50Latency(latenciesMs: readonly number[]): number {
  return percentile(latenciesMs, 0.5);
}

export function p95Latency(latenciesMs: readonly number[]): number {
  return percentile(latenciesMs, 0.95);
}

export function errorRate(outcomes: readonly CallOutcome[]): number {
  return rate(outcomes, (outcome) => outcome.errored);
}

export function truncationRate(outcomes: readonly CallOutcome[]): number {
  return rate(outcomes, (outcome) => outcome.truncated);
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(percentileValue * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function rate<T>(values: readonly T[], predicate: (value: T) => boolean): number {
  if (values.length === 0) return 0;
  return values.filter(predicate).length / values.length;
}
