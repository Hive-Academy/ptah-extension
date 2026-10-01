/**
 * Zod request schemas for session organization (TASK_2026_580).
 *
 * `SessionListQueryParamsSchema` covers the organization query fields of
 * `session:list`. The pre-existing `session:list` fields (`workspacePath`,
 * `limit`, `offset`, `since`) keep their current handling in
 * `SessionRpcHandlers`, so a request without query fields behaves exactly as
 * before. Every enum is validated against the shared vocabulary tuples, so a
 * malformed filter is rejected instead of silently ignored.
 */
import { z } from 'zod';
import {
  SESSION_LIST_GROUPS,
  SESSION_LIST_SORTS,
  SESSION_PRIORITIES,
  SESSION_WORKFLOW_STATUSES,
} from '@ptah-extension/shared';
import { TaskIdRefSchema } from '@ptah-extension/shared/schemas';

/** Longest accepted `text` search; a session name is capped at 200 chars. */
export const SESSION_LIST_TEXT_MAX_LENGTH = 200;

/**
 * Organization query fields of `session:list`. Unknown keys are stripped, so
 * the result carries only the query fields.
 */
export const SessionListQueryParamsSchema = z.object({
  status: z
    .array(z.enum(SESSION_WORKFLOW_STATUSES))
    .max(SESSION_WORKFLOW_STATUSES.length)
    .optional(),
  priority: z
    .array(z.enum(SESSION_PRIORITIES))
    .max(SESSION_PRIORITIES.length)
    .optional(),
  taskId: TaskIdRefSchema.optional(),
  pinned: z.boolean().optional(),
  hasPr: z.boolean().optional(),
  text: z.string().max(SESSION_LIST_TEXT_MAX_LENGTH).optional(),
  sort: z.enum(SESSION_LIST_SORTS).optional(),
  groupBy: z.enum(SESSION_LIST_GROUPS).optional(),
});

export type SessionListQueryParams = z.infer<
  typeof SessionListQueryParamsSchema
>;
