/**
 * Zod schemas for {@link QualityRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the quality handler validates its params via the
 * static TypeScript types exported from `@ptah-extension/shared` (e.g.
 * `QualityGetAssessmentParams`, `QualityExportParams`) plus an inline allow-list
 * check for the `format` field. No `z.object({...})` literals existed in
 * `quality-rpc.handlers.ts` at the time of TASK_2025_294 W2.B6 extraction.
 *
 * This empty export exists so every handler has a consistent `*.schema.ts`
 * sibling, and so future tasks can add Zod validation here without having to
 * create the file (and its spec) from scratch.
 */

export {};
