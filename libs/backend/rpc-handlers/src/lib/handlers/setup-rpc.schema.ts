/**
 * Zod schemas for {@link SetupRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the setup handler does run Zod validation against
 * `ProjectAnalysisZodSchema`, but that schema lives in
 * `@ptah-extension/agent-generation` (not inline in this file) and is
 * reused across the multi-phase analysis pipeline. The handler's other
 * params are validated via the static TypeScript types exported from
 * `@ptah-extension/shared` (e.g. `WizardListAgentPacksParams`,
 * `WizardNewProjectSelectTypeParams`) plus inline guards.
 *
 * No inline `z.object({...})` literals existed in `setup-rpc.handlers.ts`
 * at the time of W0.B6 extraction.
 *
 * This empty export is kept so downstream batches can stub imports
 * consistently across every handler. If a future task adds setup-specific
 * Zod validation (e.g. a stricter source-URL schema for
 * `wizard:install-pack-agents`), those schemas belong here.
 */

export {};
