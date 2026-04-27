/**
 * Zod schemas for {@link EnhancedPromptsRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the enhanced-prompts handler validates its params via
 * the static TypeScript types exported from `@ptah-extension/shared` (e.g.
 * `EnhancedPromptsRunWizardParams`) plus inline guards like
 * `!params?.workspacePath`. No `z.object({...})` literals existed in
 * `enhanced-prompts-rpc.handlers.ts` at the time of W0.B6 extraction.
 *
 * This empty export exists so W2.B1 / later batches can stub imports
 * consistently across every handler without branching on "does this file exist
 * yet?". If a future task adds Zod validation to the enhanced-prompts handler,
 * those schemas belong here.
 */

export {};
