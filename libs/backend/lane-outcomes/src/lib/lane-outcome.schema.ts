import { z } from 'zod';
import {
  LANE_FAILURE_CLASSES,
  OUTCOME_ROUTING_SOURCES,
  OUTCOME_TASK_KIND_SOURCES,
  OUTCOME_TASK_KINDS,
} from '@ptah-extension/shared';

export const OutcomeTargetSchema = z.union([
  z.object({ runId: z.string().min(1).max(200) }).strict(),
  z.object({ agentId: z.string().min(1).max(200) }).strict(),
]);

export const OutcomeReportArgsSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('deliverables'),
      target: OutcomeTargetSchema,
      paths: z.array(z.string().min(1).max(1024)).max(20),
      taskKind: z.enum(OUTCOME_TASK_KINDS).optional(),
      taskId: z.string().min(1).max(200).optional(),
      routingSource: z.enum(OUTCOME_ROUTING_SOURCES).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('review'),
      target: OutcomeTargetSchema,
      verdict: z.enum(['approved', 'rejected', 'revise']),
      reviewerRunId: z.string().min(1).max(200).optional(),
    })
    .strict(),
]);

const nonnegative = z.number().finite().nonnegative();
export const LaneOutcomeRowSchema = z.object({
  runId: z.string().min(1),
  executorKind: z.enum(['cli', 'ptah-cli', 'subagent']),
  laneId: z.string().min(1),
  agentId: z.string().min(1),
  subagentSessionId: z.string().min(1).nullable().optional(),
  parentSessionId: z.string().min(1).nullable().optional(),
  workspaceRoot: z.string().min(1).nullable().optional(),
  family: z.string().min(1),
  provider: z.string().nullable(),
  model: z.string().min(1),
  role: z.string().nullable(),
  taskKind: z.enum(OUTCOME_TASK_KINDS).nullable(),
  taskKindSource: z.enum(OUTCOME_TASK_KIND_SOURCES).nullable().default(null),
  taskId: z.string().nullable(),
  verdict: z.enum(['delivered', 'no-deliverable', 'unverified', 'failed']),
  failureClass: z.enum(LANE_FAILURE_CLASSES).nullable(),
  startedAt: nonnegative.nullable(),
  endedAt: nonnegative,
  durationMs: nonnegative.nullable(),
  inputTokens: nonnegative.nullable(),
  outputTokens: nonnegative.nullable(),
  costUsd: nonnegative.nullable(),
  routingSource: z.enum(OUTCOME_ROUTING_SOURCES),
  reviseRounds: nonnegative.int(),
  finalReview: z.enum(['approved', 'rejected']).nullable(),
  deliverablesDeclaredAt: nonnegative.nullable(),
  telemetryJoin: z.enum([
    'matched',
    'unmatched',
    'ambiguous',
    'unavailable',
    'not-applicable',
  ]),
  skillsLoaded: z.array(z.string()).nullable(),
  sessionEvidenceClass: z.string().nullable(),
});
