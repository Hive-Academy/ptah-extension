import { z } from 'zod';
import { AttentionNoticeSchema } from '@ptah-extension/shared';

/** The renderer sends no filters; unexpected fields are rejected. */
export const AttentionGetSnapshotParamsSchema = z.object({}).strict();

/** Reuse the strict push notice schema so snapshots cannot expose source data. */
export const AttentionGetSnapshotResultSchema = z.object({
  notices: z.array(AttentionNoticeSchema),
}).strict();
