/**
 * Zod schemas for {@link ContextRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the context handler validates its params via the
 * static TypeScript types exported from `@ptah-extension/shared`
 * (`ContextGetAllFilesParams`, `ContextGetFileSuggestionsParams`) and defers
 * actual validation to the downstream `ContextOrchestrationService`. No
 * `z.object({...})` literals existed in `context-rpc.handlers.ts` at the time
 * of W2.B5 extraction.
 *
 * This empty export exists so later batches can stub imports consistently
 * across every handler. If a future task adds Zod validation to the context
 * handler (e.g. to bound `limit` or reject path-traversal patterns in
 * `query`), those schemas belong here.
 */

export {};
