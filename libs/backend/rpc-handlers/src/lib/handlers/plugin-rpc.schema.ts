/**
 * Zod schemas for {@link PluginRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the plugin handler validates its params via static
 * TypeScript types from `@ptah-extension/shared` (e.g. `PluginInfo`,
 * `PluginConfigState`, `PluginSkillEntry`) combined with inline runtime
 * sanitisation: both `registerSaveConfig` and `registerListSkills` defend
 * against malformed input by `Array.isArray` checks, `typeof id === 'string'`
 * filters, and cross-referencing IDs against the registry
 * (`knownPluginIds`, `knownSkillIds`). No `z.object({...})` literals existed
 * in `plugin-rpc.handlers.ts` at the time of W2.B3 extraction.
 *
 * This empty export is kept so downstream batches can stub imports
 * consistently across every handler without branching on "does this file exist
 * yet?". If a future task moves the plugin-ID / skill-ID allowlisting to Zod
 * (e.g. to share the filter logic between handler and tests), those schemas
 * belong here.
 */

export {};
