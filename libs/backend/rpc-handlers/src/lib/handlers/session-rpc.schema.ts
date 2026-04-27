/**
 * Zod schemas for {@link SessionRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the session handler validates its params via the
 * static TypeScript types exported from `@ptah-extension/shared` (e.g.
 * `SessionListParams`, `SessionLoadParams`, `SessionRenameParams`,
 * `SessionStatsBatchParams`) plus inline guards like the 1-200 character
 * name-length check and `isAuthorizedWorkspace()`. No `z.object({...})`
 * literals existed in `session-rpc.handlers.ts` at the time of W0.B6
 * extraction.
 *
 * This empty export is kept so downstream batches can stub imports
 * consistently across every handler. If a future task adds Zod validation
 * to the session handler (e.g. to share the name-length rule between the
 * handler and tests), those schemas belong here.
 */

export {};
