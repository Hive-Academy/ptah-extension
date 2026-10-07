/**
 * What the Batch 19 memory suites (`read-side.suite.ts`, `scope-write.suite.ts`)
 * share: per-case recording under the safety cap, the `cost` block, exact
 * `num/den` rate metrics, fixture paths in the isolated home and the JSONL
 * readers.
 *
 * Imports only Node, zod and modules the host may load (`case-runner.ts`,
 * `suite-result.ts`, 619's `cost-metrics.ts`); never a host-only module.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { z } from 'zod';

import { p50Latency, p95Latency } from '../../../metrics/cost-metrics';
import type { TimestampedTranscriptMessage } from '../../baselines/read-side-baselines';
import type { Rate } from '../../metrics/curation-metrics';
import {
  runCaseWithSafetyCap,
  SAFETY_CAP_ERROR,
} from '../../runner/case-runner';
import type { CaseRecord, SuiteResultInput } from '../../runner/suite-result';

/** sha256 of a case's stable input (never a run path or a generated id). */
export function inputSha256(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

/** A home-relative fixture path, resolved and kept inside the isolated home. */
export function resolveHomeFile(home: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw new Error(`fixture path must be home-relative: ${relativePath}`);
  }
  const absolute = resolve(join(home, relativePath));
  const inside = relative(resolve(home), absolute);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error(`fixture path leaves the isolated home: ${relativePath}`);
  }
  return absolute;
}

/** The non-blank lines of a JSONL file, parsed. Throws naming the bad line. */
export function parseJsonLines(path: string): unknown[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, index }) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (error: unknown) {
        throw new Error(`${path}:${index + 1} is not JSON`, { cause: error });
      }
    });
}

const sessionLineSchema = z.object({
  timestamp: z.string().min(1),
  message: z.object({
    role: z.enum(['user', 'assistant']),
    content: z.union([
      z.string(),
      z.array(z.object({ type: z.string(), text: z.string().optional() })),
    ]),
  }),
});

/**
 * An SDK-shaped session JSONL (`session-jsonl-writer.ts`) as timestamped text
 * messages: user and assistant lines only, text blocks joined by a newline.
 * Lines of any other shape (tool results, summaries) are skipped.
 */
export function readSessionMessages(
  path: string,
): TimestampedTranscriptMessage[] {
  const messages: TimestampedTranscriptMessage[] = [];
  for (const raw of parseJsonLines(path)) {
    const parsed = sessionLineSchema.safeParse(raw);
    if (!parsed.success) continue;
    const { content, role } = parsed.data.message;
    const text =
      typeof content === 'string'
        ? content
        : content
            .filter((block) => block.type === 'text' && block.text)
            .map((block) => block.text)
            .join('\n');
    if (text.length > 0) {
      messages.push({ timestamp: parsed.data.timestamp, role, text });
    }
  }
  return messages;
}

/** What one case evaluation reports back to {@link recordCase}. */
export interface CaseVerdict {
  readonly expected: string;
  readonly observed: string;
  readonly outcome: 'pass' | 'fail';
  readonly baselineOutcomes?: Record<string, 'pass' | 'fail'>;
}

/** A recorded case plus the evaluation value, `null` when the case errored. */
export interface RecordedCase<T> {
  readonly record: CaseRecord;
  readonly value: T | null;
}

/**
 * Run one case under the safety cap (`case-runner.ts`) and turn it into a
 * {@link CaseRecord}. A thrown error or a second cap is recorded as a failing
 * case with its `error`, never dropped; `value` is then `null` so the suite
 * leaves the case out of its rate denominators and counts it in `error_rate`.
 */
export async function recordCase<T>(
  caseId: string,
  input: unknown,
  expected: string,
  evaluate: (
    signal: AbortSignal,
  ) => Promise<{ value: T; verdict: CaseVerdict }>,
  capMs?: number,
): Promise<RecordedCase<T>> {
  const base = { caseId, inputSha256: inputSha256(input), expected };
  try {
    const run = await runCaseWithSafetyCap(evaluate, { capMs });
    if (run.outcome !== 'completed') {
      return {
        value: null,
        record: {
          ...base,
          observed: 'error: safety-cap',
          outcome: 'fail',
          latencyMs: run.latencyMs,
          attempts: run.attempts,
          error: SAFETY_CAP_ERROR,
        },
      };
    }
    const { verdict } = run.value;
    return {
      value: run.value.value,
      record: {
        ...base,
        expected: verdict.expected,
        observed: verdict.observed,
        outcome: verdict.outcome,
        ...(verdict.baselineOutcomes === undefined
          ? {}
          : { baselineOutcomes: verdict.baselineOutcomes }),
        latencyMs: run.latencyMs,
        attempts: run.attempts,
        error: null,
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      value: null,
      record: {
        ...base,
        observed: 'error',
        outcome: 'fail',
        latencyMs: 0,
        attempts: 1,
        error: message.length > 0 ? message : 'error',
      },
    };
  }
}

/**
 * A rate as three metric keys: the value and its exact `num` and `den`, so a
 * reader can check `value === num / den` (`null` when `den` is 0).
 */
export function rateMetrics(
  name: string,
  value: Rate,
): Record<string, number | null> {
  return {
    [name]: value.value,
    [`${name}.num`]: value.num,
    [`${name}.den`]: value.den,
  };
}

/**
 * The suite `cost` block: `calls` are the product operations the suite made,
 * latencies are per case, `error_rate` is errored cases over cases. `source`
 * is set by the runner from `modelCalls` and the cassette mode.
 */
export function costOf(
  cases: readonly CaseRecord[],
  calls: number,
): SuiteResultInput['cost'] {
  const latencies = cases.map((record) => record.latencyMs);
  const errored = cases.filter((record) => record.error != null).length;
  return {
    calls,
    latency_ms: {
      p50: p50Latency(latencies) ?? null,
      p95: p95Latency(latencies) ?? null,
    },
    error_rate: cases.length === 0 ? null : errored / cases.length,
    tokens: {},
  };
}

/** `left - right` per shared key; `null` when either side is `null`. */
export function deltaOf(
  product: Record<string, number | null>,
  baseline: Record<string, number | null>,
): Record<string, number | null> {
  const delta: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(baseline)) {
    const mine = product[key];
    if (mine === undefined) continue;
    delta[key] = mine === null || value === null ? null : mine - value;
  }
  return delta;
}
