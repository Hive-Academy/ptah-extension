/**
 * Zod schemas for {@link HarnessRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the harness handler validates its params via the static
 * TypeScript types exported from `@ptah-extension/shared` (e.g.
 * `HarnessInitializeParams`, `HarnessApplyParams`, `HarnessConverseParams`)
 * plus inline guards such as the minimum-length check in `registerAnalyzeIntent`
 * (`params.input.trim().length < 10`) and the JSON Schema literal used as an
 * LLM `outputFormat` in `registerConverse`. The `outputSchema` object there is
 * a JSON Schema descriptor consumed by `InternalQueryService.execute`, not a
 * Zod validator, so it stays inline with its call site.
 *
 * No `z.object({...})` literals existed in `harness-rpc.handlers.ts` at the
 * time of W2.B3 extraction.
 *
 * This empty export is kept so downstream batches can stub imports consistently
 * across every handler without branching on "does this file exist yet?". If a
 * future task moves the `analyze-intent` input validation (or any other inline
 * check) to Zod, those schemas belong here.
 */

export {};
