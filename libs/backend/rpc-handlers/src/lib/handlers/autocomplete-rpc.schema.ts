/**
 * Zod schemas for {@link AutocompleteRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the autocomplete handler validates its params via the
 * static TypeScript types exported from `@ptah-extension/shared`
 * (`AutocompleteAgentsParams`, `AutocompleteCommandsParams`) plus the inline
 * `params.query || ''` fallback. No `z.object({...})` literals existed in
 * `autocomplete-rpc.handlers.ts` at the time of W2.B5 extraction.
 *
 * This empty export exists so later batches can stub imports consistently
 * across every handler without branching on "does this file exist yet?". If a
 * future task adds Zod validation to the autocomplete handler (e.g. to guard
 * against negative `maxResults` or non-string `query`), those schemas belong
 * here.
 */

export {};
