/**
 * `@ptah-extension/shared/schemas` — the zod-bearing half of the shared lib.
 *
 * WHY THIS FILE EXISTS (TASK_2026_187 Unit 10): the main barrel
 * (`@ptah-extension/shared`) is `export *`-based, so its reach alone pulled
 * EVERY zod-bearing module into the Angular webview's eager bundle — even
 * modules with zero frontend references — costing ~304 kB. Keeping every
 * `zod` import behind this secondary entry point leaves the main barrel
 * zod-free.
 *
 * Consequence: anything that imports from `@ptah-extension/shared/schemas`
 * pulls the zod runtime into its bundle. Import the plain types from
 * `@ptah-extension/shared` and reach here only for the schema values you
 * actually parse with.
 *
 * Rule: only modules that import `zod` belong here. Never re-export a
 * `*.types.ts` module from this file.
 */

export * from './lib/types/branded.schemas';
export * from './lib/types/permission.schemas';
export * from './lib/types/sdk-hook.schemas';
export * from './lib/types/task-view.schemas';
export * from './lib/types/task-filter.schemas';
export * from './lib/types/task-saved-view.schemas';
export * from './lib/types/claude-domain.schemas';
export * from './lib/types/provider-profile.schemas';
export * from './lib/types/rpc/rpc-harness.schemas';
export * from './lib/types/execution/schemas';
export * from './lib/types/messages/schemas';
