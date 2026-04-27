/**
 * Zod schemas for {@link WizardGenerationRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the wizard-generation handler validates its params via
 * the static TypeScript types exported from `@ptah-extension/shared` (e.g.
 * `WizardSubmitSelectionParams`, `WizardCancelParams`, `WizardRetryItemParams`)
 * plus inline guards like `if (!params?.selectedAgentIds?.length)` and
 * `if (!params?.itemId)`. No `z.object({...})` literals existed in
 * `wizard-generation-rpc.handlers.ts` at the time of TASK_2025_294 W2.B6
 * extraction.
 *
 * This empty export exists so every handler has a consistent `*.schema.ts`
 * sibling, and so future tasks can add Zod validation here without having to
 * create the file (and its spec) from scratch.
 */

export {};
