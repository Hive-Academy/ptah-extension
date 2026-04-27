/**
 * Zod schemas for {@link ChatRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the chat handler validates its params via the static
 * TypeScript types exported from `@ptah-extension/shared` (e.g.
 * `ChatStartParams`, `ChatContinueParams`, `ChatAbortParams`) plus inline
 * guards like `if (!workspacePath)` / `if (!params?.ptahCliId)`. No
 * `z.object({...})` literals existed in `chat-rpc.handlers.ts` at the time of
 * TASK_2025_294 W2.B6 extraction.
 *
 * This empty export exists so every handler has a consistent `*.schema.ts`
 * sibling, and so future tasks can add Zod validation here without having to
 * create the file (and its spec) from scratch.
 */

export {};
