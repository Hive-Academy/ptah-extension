/**
 * Zod schemas for {@link SubagentRpcHandlers}.
 *
 * Every method registered by `SubagentRpcHandlers` validates its params here,
 * but `chat:subagent-query` validates them DIFFERENTLY, and the difference is
 * load-bearing.
 *
 * The five command schemas below require a non-empty `sessionId`: they act on
 * a named session, so an unnameable one is an error. {@link SubagentQuerySchema}
 * must NOT — `chat:subagent-query` has a deliberate answer for a
 * present-but-empty `sessionId` (return nothing), and Zod taking that decision
 * over would either turn a deliberate empty result into an error or, worse,
 * normalize `''` away and drop the query into the UNSCOPED branch, handing one
 * session the chance to resume another session's interrupted subagents.
 * See the comment on {@link SubagentQuerySchema} and
 * `subagent-rpc.handlers.ts`.
 */

import { z } from 'zod';

/**
 * `chat:subagent-query` params — SHAPE ONLY.
 *
 * Zod's whole job here is to reject a non-object param bag and non-string ids.
 * It must not decide what an empty id MEANS, because this method already has a
 * documented answer for that and the answer is not "error":
 * `subagent-rpc.handlers.ts` returns `{ subagents: [] }` for a present-but-empty
 * `sessionId` — a scoped query whose scope cannot be resolved is answered with
 * nothing.
 *
 * Two changes to this schema would each reintroduce a fixed defect, so neither
 * is available:
 *
 * - **No `.min(1)`.** It would convert that deliberate empty RESULT into an
 *   ERROR, changing a behaviour chosen on purpose.
 * - **No `.transform()`, no `.trim()`.** Normalizing `''` to `undefined` makes
 *   the query fall through to the UNSCOPED all-resumable branch, which is
 *   precisely the cross-session resume leak this guard exists to close.
 *
 * The five command schemas below are `.min(1)` and correctly so — they have no
 * "empty means empty result" rule. Do not harmonise them with this one in
 * either direction.
 *
 * `.passthrough()` matches the `chat-rpc.schema.ts` house rule so an outdated
 * webview sending an extra field is not rejected outright.
 */
export const SubagentQuerySchema = z
  .object({
    toolCallId: z.string({ error: 'toolCallId must be a string' }).optional(),
    sessionId: z.string({ error: 'sessionId must be a string' }).optional(),
  })
  .passthrough();

export type SubagentQueryInput = z.infer<typeof SubagentQuerySchema>;

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
