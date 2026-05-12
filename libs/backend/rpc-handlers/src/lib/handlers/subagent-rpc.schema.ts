/**
 * Zod schemas for {@link SubagentRpcHandlers} — Phase 2 additions.
 *
 * The original `chat:subagent-query` handler uses static TypeScript types
 * and trivial presence checks (no Zod). The three new Phase 2 methods
 * (`subagent:send-message`, `subagent:stop`, `subagent:interrupt`) each
 * validate their params with Zod schemas defined here.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// subagent:send-message
// ---------------------------------------------------------------------------

export const SubagentSendMessageSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  parentToolUseId: z.string().min(1, 'parentToolUseId is required'),
  text: z.string().min(1, 'text is required'),
});

export type SubagentSendMessageInput = z.infer<
  typeof SubagentSendMessageSchema
>;

// ---------------------------------------------------------------------------
// subagent:stop
// ---------------------------------------------------------------------------

export const SubagentStopSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  taskId: z.string().min(1, 'taskId is required'),
});

export type SubagentStopInput = z.infer<typeof SubagentStopSchema>;

// ---------------------------------------------------------------------------
// subagent:interrupt
// ---------------------------------------------------------------------------

export const SubagentInterruptSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
});

export type SubagentInterruptInput = z.infer<typeof SubagentInterruptSchema>;
