/**
 * Zod schemas for {@link ConfigRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the config handler validates its params via the static
 * TypeScript types exported from `@ptah-extension/shared` (e.g.
 * `ConfigModelSwitchParams`, `ConfigAutopilotToggleParams`) plus inline guards
 * (the `validLevels` check in `registerAutopilotToggle` and the tier-override
 * lookup in `getTierOverrides`). No `z.object({...})` literals existed in
 * `config-rpc.handlers.ts` at the time of W2.B3 extraction.
 *
 * This empty export is kept so downstream batches can stub imports consistently
 * across every handler without branching on "does this file exist yet?". If a
 * future task moves the `validLevels` permission-level check (or any other
 * inline validation) to Zod, those schemas belong here.
 */

export {};
