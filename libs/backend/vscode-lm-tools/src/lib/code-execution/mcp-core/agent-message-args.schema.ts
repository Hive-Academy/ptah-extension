/**
 * Argument schemas of the agent message tools, shared by the HTTP dispatcher
 * and the stdio agent tools so a call accepted on one surface is accepted on
 * the other.
 *
 * Every schema is `strict()`. The retired `ptah_agent_steer` took an
 * `instruction` key, so a model working from stale guidance sends one; and a
 * `sender` key must be refused, never read: the sender comes from the MCP
 * transport (URL attribution in Phase 1), not from tool arguments.
 */

import { z } from 'zod';
import { MAX_AGENT_MESSAGE_LENGTH } from './tool-description.builder';

/** Caller-chosen dedupe key; the same rule as the renderer RPC. */
export const AgentMessageIdempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{1,128}$/);

/** `ptah_agent_message` / stdio `agent_message`. */
export const AgentMessageArgsSchema = z
  .object({
    agentId: z.string().min(1),
    message: z.string().min(1).max(MAX_AGENT_MESSAGE_LENGTH),
    delivery: z.enum(['queue', 'now', 'steer']).optional(),
    allowPartialTurnLoss: z.boolean().optional(),
    idempotencyKey: AgentMessageIdempotencyKeySchema.optional(),
  })
  .strict();

/** `ptah_agent_message_status` / stdio `agent_message_status`. */
export const AgentMessageStatusArgsSchema = z
  .object({ agentId: z.string().min(1), messageId: z.string().uuid() })
  .strict();

/** `ptah_agent_message_control`: retry or cancel a message the caller sent. */
export const AgentMessageControlArgsSchema = z
  .object({
    agentId: z.string().min(1),
    messageId: z.string().uuid(),
    action: z.enum(['retry', 'cancel']),
    confirmDuplicateRisk: z.boolean().optional(),
  })
  .strict();
