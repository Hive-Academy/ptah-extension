import {
  OUTCOME_ROUTING_SOURCES,
  OUTCOME_TASK_KINDS,
} from '@ptah-extension/shared';
import { z } from 'zod';
import type { OutcomeEffectResolver } from '../store/lane-outcome.store';

export const DeliverablesPayloadSchema = z
  .object({
    checks: z
      .array(
        z
          .object({
            exists: z.boolean(),
            bytes: z.number().int().nonnegative(),
            mtimeMs: z.number().finite().nullable(),
          })
          .strict(),
      )
      .max(20),
    taskKind: z.enum(OUTCOME_TASK_KINDS).optional(),
    taskId: z.string().min(1).max(200).optional(),
    routingSource: z.enum(OUTCOME_ROUTING_SOURCES).optional(),
  })
  .strict();

export const ReviewPayloadSchema = z
  .object({
    verdict: z.enum(['approved', 'rejected', 'revise']),
  })
  .strict();

export function deterministicReviewReportId(
  reviewedRunId: string,
  reviewerRunId: string,
): string {
  return `review:${reviewedRunId}|${reviewerRunId}`;
}

type DeliverableCheck = z.infer<
  typeof DeliverablesPayloadSchema
>['checks'][number];

export function deliverablesVerdictOf(
  checks: readonly DeliverableCheck[],
  startedAt: number | null,
): 'unverified' | 'delivered' | 'no-deliverable' {
  if (checks.length === 0) return 'unverified';
  return checks.every(
    (check) =>
      check.exists &&
      check.bytes > 0 &&
      (check.mtimeMs === null ||
        startedAt === null ||
        check.mtimeMs >= startedAt),
  )
    ? 'delivered'
    : 'no-deliverable';
}

export const reportEffectOf: OutcomeEffectResolver = (row, report) => {
  let payload: unknown;
  try {
    payload = JSON.parse(report.payload);
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error;
    // A malformed report is returned as invalid; the pipeline logs its report ID.
    return null;
  }
  if (report.kind === 'deliverables') {
    const parsed = DeliverablesPayloadSchema.safeParse(payload);
    if (!parsed.success) return null;
    return {
      kind: 'deliverables',
      verdict: deliverablesVerdictOf(parsed.data.checks, row.startedAt),
      declaredAt: report.heldAt,
      taskKind: parsed.data.taskKind,
      taskId: parsed.data.taskId,
      routingSource: parsed.data.routingSource,
    };
  }
  if (report.kind === 'review') {
    const parsed = ReviewPayloadSchema.safeParse(payload);
    return parsed.success
      ? { kind: 'review', verdict: parsed.data.verdict }
      : null;
  }
  return null;
};
