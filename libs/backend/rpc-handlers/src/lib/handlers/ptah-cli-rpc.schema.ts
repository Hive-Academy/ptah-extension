/**
 * Zod schemas for {@link PtahCliRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the Ptah CLI handler validates its params via the
 * static TypeScript types exported from `@ptah-extension/shared` (e.g.
 * `PtahCliCreateParams`, `PtahCliUpdateParams`) and the downstream registry
 * throws for unknown providers/agents. No `z.object({...})` literals existed
 * in `ptah-cli-rpc.handlers.ts` at the time of W2.B2 extraction.
 *
 * This empty export is kept so downstream batches can stub imports
 * consistently across every handler. If a future task adds Zod validation
 * (e.g. a tierMappings schema shared between handler and tests), those
 * schemas belong here.
 */

export {};
