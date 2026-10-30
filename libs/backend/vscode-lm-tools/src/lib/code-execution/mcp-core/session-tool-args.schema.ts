/**
 * `ptah_session_*` arguments (TASK_2026_584, plan Component 7).
 *
 * One zod schema per tool, shared by the tool definition (its `inputSchema`
 * is generated from it in `session-tools.ts`) and the handler that validates
 * the call, so the advertised and the accepted keys cannot drift (pattern
 * `agent-spawn-args.schema.ts` + its parity spec).
 *
 * Every schema is `strict()`: there is deliberately no caller, parent,
 * permission or session path key (`handoffPath` names the file the caller
 * wrote, not where a session runs). The caller is the session the MCP transport names
 * (`/session/{id}`); an agent that adds such a key is told so instead of the
 * key being dropped.
 */
import * as path from 'node:path';
import { z } from 'zod';
import { SESSION_READ_MAX_TAIL_KIB } from '@ptah-extension/cli-agent-runtime';
import { TaskIdSchema } from '@ptah-extension/shared/schemas';
import { MAX_AGENT_MESSAGE_LENGTH } from './tool-description.builder';

/** Deliverable paths one child may declare (same bound as `ptah_agent_spawn`). */
export const MAX_SESSION_DELIVERABLES = 20;

/** A relative path that never climbs out of the worktree. */
function isRelativeWithoutParent(value: string): boolean {
  if (/^([a-zA-Z]:|[\\/])/.test(value)) return false;
  return !value.split(/[\\/]/).includes('..');
}

/** Absolute on either platform: a host on one OS may serve agents writing the other's paths. */
function isAbsolutePath(value: string): boolean {
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

const sessionId = z.string().min(1).max(200);

export const SessionStartArgsSchema = z
  .object({
    task: z.string().min(1).max(MAX_AGENT_MESSAGE_LENGTH),
    branch: z.string().min(1).max(200),
    baseRef: z.string().min(1).max(200).optional(),
    label: z.string().min(1).max(60).optional(),
    // The shared task-id grammar (TASK_2026_854 RR1-8): the host auto-link
    // rules accept exactly the same ids.
    taskId: TaskIdSchema.optional(),
    taskFolder: z
      .string()
      .min(1)
      .max(500)
      .refine(isRelativeWithoutParent, {
        message: 'must be a path relative to the worktree, without ".."',
      })
      .optional(),
    deliverables: z
      .array(z.string().min(1).max(500))
      .max(MAX_SESSION_DELIVERABLES)
      .optional(),
    model: z.string().min(1).max(200).optional(),
  })
  .strict();

export const SessionSendArgsSchema = z
  .object({
    sessionId,
    message: z.string().min(1).max(MAX_AGENT_MESSAGE_LENGTH),
    mode: z.enum(['queue', 'steer', 'if-idle']).optional(),
  })
  .strict();

export const SessionStatusArgsSchema = z
  .object({ sessionId: sessionId.optional() })
  .strict();

export const SessionReadArgsSchema = z
  .object({
    sessionId,
    tailKiB: z.number().int().min(1).max(SESSION_READ_MAX_TAIL_KIB).optional(),
  })
  .strict();

export const SessionStopArgsSchema = z.object({ sessionId }).strict();

/**
 * `ptah_session_handoff` (TASK_2026_655). The prompt is required and
 * non-empty here because the handoff service does not re-check it. The file
 * path is only shape-checked: the service checks that it is an existing file
 * inside an open workspace folder.
 */
export const SessionHandoffArgsSchema = z
  .object({
    handoffPath: z
      .string()
      .min(1)
      .max(1000)
      .refine(isAbsolutePath, { message: 'must be an absolute path' }),
    prompt: z.string().min(1).max(MAX_AGENT_MESSAGE_LENGTH),
    label: z.string().min(1).max(60).optional(),
  })
  .strict();

export type SessionStartArgs = z.infer<typeof SessionStartArgsSchema>;
export type SessionSendArgs = z.infer<typeof SessionSendArgsSchema>;
export type SessionStatusArgs = z.infer<typeof SessionStatusArgsSchema>;
export type SessionReadArgs = z.infer<typeof SessionReadArgsSchema>;
export type SessionStopArgs = z.infer<typeof SessionStopArgsSchema>;
export type SessionHandoffArgs = z.infer<typeof SessionHandoffArgsSchema>;
