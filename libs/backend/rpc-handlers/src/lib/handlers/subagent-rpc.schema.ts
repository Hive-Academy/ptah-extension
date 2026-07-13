/**
 * Zod schemas for {@link SubagentRpcHandlers}.
 *
 * The original `chat:subagent-query` handler uses static TypeScript types
 * and trivial presence checks (no Zod). The three methods
 * (`subagent:send-message`, `subagent:stop`, `subagent:interrupt`) each
 * validate their params with Zod schemas defined here.
 */

import { z } from 'zod';

export const SubagentSendMessageSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  parentToolUseId: z.string().min(1, 'parentToolUseId is required'),
  text: z.string().min(1, 'text is required'),
});

export type SubagentSendMessageInput = z.infer<
  typeof SubagentSendMessageSchema
>;

export const SubagentStopSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  taskId: z.string().min(1, 'taskId is required'),
});

export type SubagentStopInput = z.infer<typeof SubagentStopSchema>;

export const SubagentInterruptSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
});

export type SubagentInterruptInput = z.infer<typeof SubagentInterruptSchema>;

export const SubagentBackgroundSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  toolUseId: z.string().min(1).optional(),
});

export type SubagentBackgroundInput = z.infer<typeof SubagentBackgroundSchema>;
