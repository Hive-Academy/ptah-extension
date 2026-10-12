/**
 * `ptah_session_*` arguments (TASK_2026_584, plan Component 7).
 *
 * One zod schema per tool, shared by the tool definition (its `inputSchema`
 * is generated from it in `session-tools.ts`) and the handler that validates
 * the call, so the advertised and the accepted keys cannot drift (pattern
 * `agent-spawn-args.schema.ts` + its parity spec).
 *
 * Every schema is `strict()`: there is deliberately no caller, parent,
 * permission or path key. The caller is the session the MCP transport names
 * (`/session/{id}`); an agent that adds such a key is told so instead of the
 * key being dropped.
 */
import { z } from 'zod';
import { SESSION_READ_MAX_TAIL_KIB } from '@ptah-extension/cli-agent-runtime';
import { MAX_AGENT_MESSAGE_LENGTH } from './tool-description.builder';

/** Deliverable paths one child may declare (same bound as `ptah_agent_spawn`). */
export const MAX_SESSION_DELIVERABLES = 20;

/** `TASK_YYYY_NNN`, optionally with the 4-hex suffix this repository's task folders carry. */
export const SESSION_TASK_ID_PATTERN = /^TASK_\d{4}_\d{3}(_[0-9a-f]{4})?$/;

/** A relative path that never climbs out of the worktree. */
function isRelativeWithoutParent(value: string): boolean {
  if (/^([a-zA-Z]:|[\\/])/.test(value)) return false;
  return !value.split(/[\\/]/).includes('..');
}

const sessionId = z.string().min(1).max(200);

const SessionChildStartArgsSchema = z
  .object({
    mode: z.literal('child'),
    task: z.string().min(1).max(MAX_AGENT_MESSAGE_LENGTH),
    branch: z.string().min(1).max(200),
    baseRef: z.string().min(1).max(200).optional(),
    label: z.string().min(1).max(60).optional(),
    taskId: z.string().regex(SESSION_TASK_ID_PATTERN).optional(),
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

const SessionSuccessorStartArgsSchema = z
  .object({
    mode: z.literal('successor'),
    handoff: z.string().min(1).max(MAX_AGENT_MESSAGE_LENGTH).optional(),
  })
  .strict();

/**
 * Flat, permissive-at-the-JSON-level schema for MCP tool publication.
 * Runtime validation remains the exclusive child/successor union below.
 */
export const SessionStartToolInputSchema = z
  .object({
    mode: z.enum(['child', 'successor']).optional(),
    task: z.string().min(1).max(MAX_AGENT_MESSAGE_LENGTH).optional(),
    branch: z.string().min(1).max(200).optional(),
    baseRef: z.string().min(1).max(200).optional(),
    label: z.string().min(1).max(60).optional(),
    taskId: z.string().regex(SESSION_TASK_ID_PATTERN).optional(),
    taskFolder: z.string().min(1).max(500).optional(),
    deliverables: z
      .array(z.string().min(1).max(500))
      .max(MAX_SESSION_DELIVERABLES)
      .optional(),
    model: z.string().min(1).max(200).optional(),
    handoff: z.string().min(1).max(MAX_AGENT_MESSAGE_LENGTH).optional(),
  })
  .strict();

/**
 * A successor replaces its caller; it never accepts child provisioning fields.
 * An omitted mode is "child", so field errors name the field of that branch.
 */
export const SessionStartArgsSchema = z.preprocess(
  (value) =>
    value && typeof value === 'object' && !('mode' in value)
      ? { ...value, mode: 'child' }
      : value,
  z.discriminatedUnion('mode', [
    SessionChildStartArgsSchema,
    SessionSuccessorStartArgsSchema,
  ]),
);

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

export type SessionStartArgs = z.infer<typeof SessionStartArgsSchema>;
export type SessionSendArgs = z.infer<typeof SessionSendArgsSchema>;
export type SessionStatusArgs = z.infer<typeof SessionStatusArgsSchema>;
export type SessionReadArgs = z.infer<typeof SessionReadArgsSchema>;
export type SessionStopArgs = z.infer<typeof SessionStopArgsSchema>;
