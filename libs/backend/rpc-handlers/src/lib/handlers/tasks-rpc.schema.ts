/**
 * Zod request schemas for the `tasks:` RPC namespace (NFR-9).
 *
 * Every handler parses its params through the matching schema at the trust
 * boundary before touching the index/writer. `workspaceRoot` is always
 * optional (resolved to the active workspace when omitted); status/type
 * enums are validated against the shared canonical lists so a malformed
 * filter is rejected structurally rather than silently ignored.
 */
import { z } from 'zod';
import { TASK_STATUSES, TASK_TYPES } from '@ptah-extension/shared';

const workspaceRoot = z.string().min(1).optional();
const statusEnum = z.enum(TASK_STATUSES);
const typeEnum = z.enum(TASK_TYPES);

export const TasksListParamsSchema = z.object({
  workspaceRoot,
  status: z.array(statusEnum).optional(),
  type: z.array(typeEnum).optional(),
});

export const TasksGetParamsSchema = z.object({
  workspaceRoot,
  taskId: z.string().min(1),
});

export const TasksCreateParamsSchema = z.object({
  workspaceRoot,
  title: z.string().min(1),
  type: typeEnum,
  description: z.string().optional(),
  dependsOn: z.array(z.string().min(1)).optional(),
  executor: z.string().optional(),
});

export const TasksUpdateStatusParamsSchema = z.object({
  workspaceRoot,
  taskId: z.string().min(1),
  status: statusEnum,
});

export const TasksGenerateRegistryParamsSchema = z.object({
  workspaceRoot,
});

export const TasksBoardParamsSchema = z.object({
  workspaceRoot,
});

export const TasksReindexParamsSchema = z.object({
  workspaceRoot,
});

export type TasksListParamsParsed = z.infer<typeof TasksListParamsSchema>;
export type TasksGetParamsParsed = z.infer<typeof TasksGetParamsSchema>;
export type TasksCreateParamsParsed = z.infer<typeof TasksCreateParamsSchema>;
export type TasksUpdateStatusParamsParsed = z.infer<
  typeof TasksUpdateStatusParamsSchema
>;
