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

const SUBAGENT_RUN_PREFIX = 'subagent:';
/** The `:${completedAt}` suffix of a lane run id (`${agentId}:${completedAt}`). */
const LANE_RUN_ENDING = /:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

/**
 * The agent behind a run id: a lane run id loses its ending timestamp, a
 * subagent run id its `subagent:` prefix, and a bare agent id stays as is.
 * Host capture knows the reviewer's run id and a reviewer reporting through
 * `ptah_outcome_report` knows at most its agent id, so both reduce to this.
 */
export function reviewerIdentity(runOrAgentId: string): string {
  const id = runOrAgentId.startsWith(SUBAGENT_RUN_PREFIX)
    ? runOrAgentId.slice(SUBAGENT_RUN_PREFIX.length)
    : runOrAgentId;
  return id.replace(LANE_RUN_ENDING, '');
}

/** A reviewer that reviews a run of its own agent. */
export function isSelfReview(
  reviewedRunId: string,
  reviewerRunId: string,
): boolean {
  return reviewerIdentity(reviewedRunId) === reviewerIdentity(reviewerRunId);
}

/**
 * One review per (reviewed run, reviewer agent). The reviewer is reduced to
 * its agent so the host capture path and the reviewer's own
 * `ptah_outcome_report` call, and a continuation lane that ends twice over the
 * same review, all share one report id and one store receipt.
 */
export function deterministicReviewReportId(
  reviewedRunId: string,
  reviewerRunId: string,
): string {
  return `review:${reviewedRunId}|${reviewerIdentity(reviewerRunId)}`;
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
