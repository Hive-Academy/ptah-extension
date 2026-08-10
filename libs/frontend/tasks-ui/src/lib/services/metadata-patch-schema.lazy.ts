/**
 * Deferred access to the shared task-metadata write schema.
 *
 * `TasksStore` is registered in `MESSAGE_HANDLERS` at webview bootstrap, so it
 * is eager. `TaskMetadataPatchSchema` is a Zod schema, and a static import of
 * it from an eager service pulls the whole 304 kB Zod runtime into the initial
 * bundle — for a check that only ever runs when a user edits task metadata on
 * the lazily-loaded board (TASK_2026_187 Unit 10).
 *
 * This module exists purely as a dynamic-import boundary. It is reachable ONLY
 * via `await import('./metadata-patch-schema.lazy')` in
 * `tasks-store.service.ts`, so the bundler places it — and Zod — in a lazy
 * chunk shared with the board's own components, which import the same schema
 * statically.
 *
 * ## Why a local module rather than `await import('@ptah-extension/shared/schemas')`
 *
 * Dynamically importing the shared library directly makes Nx's
 * `@nx/enforce-module-boundaries` rule classify **`@ptah-extension/shared` as a
 * whole** as lazy-loaded from this lib, which then rejects every ordinary
 * static `@ptah-extension/shared` import across `tasks-ui` — around fifteen of
 * them. That classification is wrong: the shared library's main entry point is
 * statically imported and eager by design, and only its separate `./schemas`
 * entry point is deferred. The rule models projects, not entry points, so it
 * cannot express that distinction.
 *
 * Routing the deferral through a relative module keeps the cross-project edge
 * static and honest, gives the bundler exactly the same split, and needs no
 * lint suppression.
 *
 * Measured, not assumed: with a freshly reset Nx project graph, a direct
 * `import('@ptah-extension/shared/schemas')` here yields 22
 * `@nx/enforce-module-boundaries` errors across `tasks-ui`; routing through
 * this module yields none, and the emitted chunks are identical. If you are
 * tempted to inline this away, re-run `nx reset && nx lint tasks-ui` first.
 */

export { TaskMetadataPatchSchema } from '@ptah-extension/shared/schemas';
