/**
 * Zod schemas for {@link LlmRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the LLM handler validates its params via the static
 * TypeScript types exported from `@ptah-extension/shared` plus inline guards
 * such as `if (!params?.provider || !params?.apiKey)`. No `z.object({...})`
 * literals existed in `llm-rpc-app.handlers.ts` at the time of W2.B2
 * extraction.
 *
 * This empty export is kept so downstream batches can stub imports
 * consistently across every handler. If a future task adds Zod validation
 * (e.g. a richer provider/api-key schema shared between handler and tests),
 * those schemas belong here.
 */

export {};
