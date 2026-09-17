/**
 * Zod schemas for {@link SessionRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the session handler validates its params via the
 * static TypeScript types exported from `@ptah-extension/shared` (e.g.
 * `SessionListParams`, `SessionLoadParams`, `SessionRenameParams`,
 * `SessionStatsBatchParams`) plus inline guards like the 1-200 character
 * name-length check and `isAuthorizedWorkspace()`. No `z.object({...})`
 * literals existed in `session-rpc.handlers.ts` at the time of W0.B6
 * extraction.
 *
 * This empty export is kept so downstream batches can stub imports
 * consistently across every handler. If a future task adds Zod validation
 * to the session handler (e.g. to share the name-length rule between the
 * handler and tests), those schemas belong here.
 */

import { z } from 'zod';
import {
  SESSION_STATS_BATCH_MAX_IDS,
  UUID_REGEX,
} from '@ptah-extension/shared';

const StatsSessionIds = z
  .array(z.string().regex(UUID_REGEX))
  .max(SESSION_STATS_BATCH_MAX_IDS);

const EpochMs = z.number().int().nonnegative();

/**
 * `session:stats-batch` params (TASK_2026_411 B4).
 *
 * At most {@link SESSION_STATS_BATCH_MAX_IDS} UUID session ids per request.
 * `scope` defaults to `'current-context'`, which takes no range; `'range'`
 * requires `since <= until` (epoch ms, `[since, until)`). Unknown keys are
 * rejected so a misspelled `untill` cannot silently widen a range.
 */
export const SessionStatsBatchParamsSchema = z.union([
  z
    .object({
      sessionIds: StatsSessionIds,
      workspacePath: z.string().min(1),
      scope: z.literal('current-context').optional(),
    })
    .strict(),
  z
    .object({
      sessionIds: StatsSessionIds,
      workspacePath: z.string().min(1),
      scope: z.literal('range'),
      since: EpochMs,
      until: EpochMs,
    })
    .strict()
    .refine((params) => params.since <= params.until, {
      message: 'since must not be after until',
      path: ['until'],
    }),
]);

export const SessionCliSessionsParamsSchema = z
  .object({ sessionId: z.string().min(1) })
  .strict();

export const SessionCliOutputPageParamsSchema = z
  .object({
    sessionId: z.string().min(1),
    agentId: z.string().trim().min(1).max(4096),
    cursor: z.string().min(1).max(4096).optional(),
    maxBytes: z.number().int().min(1024).max(256 * 1024).optional(),
  })
  .strict();
