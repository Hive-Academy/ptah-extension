/**
 * Zod schemas for {@link SubagentRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the subagent handler validates its params via the
 * static TypeScript types exported from `@ptah-extension/shared`
 * (`SubagentQueryParams`) with only trivial presence checks for the
 * optional `toolCallId` / `sessionId` fields. No `z.object({...})`
 * literals existed in `subagent-rpc.handlers.ts` at the time of W0.B6
 * extraction.
 *
 * This empty export is kept so downstream batches can stub imports
 * consistently across every handler. If a future task adds Zod validation
 * to the subagent handler (e.g. toolCallId format constraints), those
 * schemas belong here.
 */

export {};
