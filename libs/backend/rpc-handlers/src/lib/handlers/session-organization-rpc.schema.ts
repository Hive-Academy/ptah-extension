/**
 * Zod request schemas for session organization (TASK_2026_580).
 *
 * `SessionListQueryParamsSchema` covers the organization query fields of
 * `session:list`. The pre-existing `session:list` fields (`workspacePath`,
 * `limit`, `offset`, `since`) keep their current handling in
 * `SessionRpcHandlers`, so a request without query fields behaves exactly as
 * before. Every enum is validated against the shared vocabulary tuples, so a
 * malformed filter is rejected instead of silently ignored.
 *
 * The remaining schemas are the params of the six
 * `SessionOrganizationRpcHandlers` methods. They are the RPC boundary: the
 * handler parses with them before any service call.
 */
import { z } from 'zod';
import {
  SESSION_LIST_GROUPS,
  SESSION_LIST_SORTS,
  SESSION_PRIORITIES,
  SESSION_PR_STATES,
  SESSION_TASK_LINK_ROLES,
  SESSION_WORKFLOW_STATUSES,
  UUID_REGEX,
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

/** Longest accepted PR URL (plan L14; `parsePrUrl` enforces the same cap). */
export const SESSION_PR_URL_MAX_LENGTH = 2048;

/** Most task ids one `session:listForTasks` call may name. */
export const SESSION_LIST_FOR_TASKS_MAX_IDS = 1000;

/**
 * An SDK session UUID. `session:list` only ever returns UUID ids
 * (`SessionId.from`), so the webview has no other id to send.
 */
const SessionIdParamSchema = z.string().regex(UUID_REGEX);

const PrUrlParamSchema = z.string().min(1).max(SESSION_PR_URL_MAX_LENGTH);

/**
 * The task-link sources the webview may claim. `agent` links come only from
 * the MCP tool, so the RPC rejects it.
 */
const WEBVIEW_TASK_LINK_SOURCES = ['user', 'board-start'] as const;

/** `session:setOrganization`: at least one of priority, status, pinned. */
export const SessionSetOrganizationParamsSchema = z
  .object({
    sessionId: SessionIdParamSchema,
    priority: z.enum(SESSION_PRIORITIES).optional(),
    status: z.enum(SESSION_WORKFLOW_STATUSES).optional(),
    pinned: z.boolean().optional(),
  })
  .refine(
    (params) =>
      params.priority !== undefined ||
      params.status !== undefined ||
      params.pinned !== undefined,
    { message: 'at least one of priority, status or pinned is required' },
  );

/** `session:linkTask`; `source` defaults to `user`. */
export const SessionLinkTaskParamsSchema = z.object({
  sessionId: SessionIdParamSchema,
  taskId: TaskIdRefSchema,
  role: z.enum(SESSION_TASK_LINK_ROLES),
  source: z.enum(WEBVIEW_TASK_LINK_SOURCES).default('user'),
});

/** `session:unlinkTask`. */
export const SessionUnlinkTaskParamsSchema = z.object({
  sessionId: SessionIdParamSchema,
  taskId: TaskIdRefSchema,
});

/** `session:addPrLink`. The URL is canonicalized by the service. */
export const SessionAddPrLinkParamsSchema = z.object({
  sessionId: SessionIdParamSchema,
  url: PrUrlParamSchema,
  state: z.enum(SESSION_PR_STATES).optional(),
});

/** `session:removePrLink`. */
export const SessionRemovePrLinkParamsSchema = z.object({
  sessionId: SessionIdParamSchema,
  url: PrUrlParamSchema,
});

/** `session:listForTasks`; absent `taskIds` means every linked task. */
export const SessionListForTasksParamsSchema = z.object({
  workspacePath: z.string().min(1),
  taskIds: z
    .array(TaskIdRefSchema)
    .max(SESSION_LIST_FOR_TASKS_MAX_IDS)
    .optional(),
});
