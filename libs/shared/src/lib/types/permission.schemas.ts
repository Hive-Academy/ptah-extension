/**
 * Zod schemas for the MCP approval_prompt permission types.
 *
 * Split out of `permission.types.ts` so the permission interfaces and the
 * `UNKNOWN_AGENT_TOOL_CALL_ID` sentinel can be imported without pulling `zod`
 * in. Dependency direction is one-way: schemas → types.
 */

import { z } from 'zod';

import { UUID_REGEX } from './branded.types';

/**
 * Zod schema for PermissionRequest runtime validation
 *
 * Validates incoming permission requests from MCP server.
 */
export const PermissionRequestSchema = z.object({
  id: z.string().uuid(),
  toolName: z.string().min(1),
  toolInput: z.record(z.string(), z.unknown()),
  toolUseId: z.string().optional(),
  agentToolCallId: z.string().optional(),
  timestamp: z.number(),
  description: z.string(),
  timeoutAt: z.number(),
  sessionId: z
    .string()
    .refine((v) => UUID_REGEX.test(v), {
      message: 'sessionId must be a UUID v4',
    })
    .optional(),
  tabId: z
    .string()
    .refine((v) => UUID_REGEX.test(v), { message: 'tabId must be a UUID v4' })
    .optional(),
  surfaceMode: z.boolean().optional(),
});

/**
 * Zod schema for PermissionResponse runtime validation
 *
 * Validates user responses before sending back to MCP server.
 */
export const PermissionResponseSchema = z.object({
  id: z.string(),
  decision: z.enum(['allow', 'deny', 'always_allow', 'deny_with_message']),
  modifiedInput: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().optional(),
});

/**
 * Zod schema for PermissionRule runtime validation
 *
 * Validates permission rules before storing in workspace state.
 */
export const PermissionRuleSchema = z.object({
  id: z.string().uuid(),
  pattern: z.string().min(1),
  toolName: z.string().min(1),
  action: z.enum(['allow', 'deny']),
  createdAt: z.number(),
  description: z.string().optional(),
});

/**
 * Zod schema for AskUserQuestionRequest runtime validation
 *
 * Validates incoming question requests at the frontend receive point.
 */
export const AskUserQuestionRequestSchema = z.object({
  id: z.string().uuid(),
  toolName: z.literal('AskUserQuestion'),
  questions: z.array(z.unknown()),
  toolUseId: z.string().optional(),
  timestamp: z.number(),
  timeoutAt: z.number(),
  sessionId: z
    .string()
    .refine((v) => UUID_REGEX.test(v), {
      message: 'sessionId must be a UUID v4',
    })
    .optional(),
  tabId: z
    .string()
    .refine((v) => UUID_REGEX.test(v), { message: 'tabId must be a UUID v4' })
    .optional(),
  surfaceMode: z.boolean().optional(),
});
