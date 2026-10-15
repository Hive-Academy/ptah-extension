import { z } from 'zod';
import { LaneOutcomeRowSchema } from '../lane-outcome.schema';
import type { OutcomeWriteOp } from './outcome-write-pipeline';

const ReportSchema = z.object({
  reportId: z.string(),
  runId: z.string(),
  payload: z.string(),
  heldAt: z.number().finite(),
  expiresAt: z.number().finite(),
});

export const OutcomeWriteOpSchema: z.ZodType<OutcomeWriteOp> =
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('lane-completion'), row: LaneOutcomeRowSchema }),
    z.object({ kind: z.literal('subagent-stop'), row: LaneOutcomeRowSchema }),
    z.object({ kind: z.literal('budget-stop'), runId: z.string().min(1) }),
    z.object({
      kind: z.literal('deliverables'),
      report: ReportSchema.extend({ kind: z.literal('deliverables') }),
    }),
    z.object({
      kind: z.literal('review'),
      report: ReportSchema.extend({ kind: z.literal('review') }),
    }),
  ]);
