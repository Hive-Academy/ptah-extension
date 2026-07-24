/**
 * Zod schemas for {@link SubagentRpcHandlers}.
 *
 * The original `chat:subagent-query` handler uses static TypeScript types
 * and trivial presence checks (no Zod). The remaining methods
 * (`subagent:send-message`, `subagent:stop`, `subagent:interrupt`,
 * `subagent:background`, `subagent:transcript`) each validate their params
 * with Zod schemas defined here.
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

export const SubagentTranscriptSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  agentId: z.string().min(1, 'agentId is required'),
  // Cap the page size so one call can't pull an unbounded transcript into
  // memory / over the wire (matches the paginated sibling schemas' convention).
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
});

export type SubagentTranscriptInput = z.infer<typeof SubagentTranscriptSchema>;
