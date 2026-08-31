/**
 * TRANSITIONAL RE-EXPORT — delete this file once TASK_2026_365 has landed.
 *
 * `normalizeWorkspaceRoot` moved to `@ptah-extension/shared` in TASK_2026_364,
 * because three consumers now need the same key: the Electron boot latch, the
 * user-layer coalescer, and `AgentProcessManager`'s workspace-scoped agent
 * registry. A second definition would let two of them disagree about whether
 * two strings name the same open folder, which is precisely the class of bug
 * TASK_2026_364 exists to remove.
 *
 * The module is kept ONLY because `plugin-activation.ts` still imports from
 * here at HEAD, and that file carries in-flight work from TASK_2026_365 that is
 * not this task's to commit. Deleting the module while that import stands would
 * leave `main` uncompilable. `boot-heavy-services.ts` has already moved to the
 * shared import.
 *
 * Whoever commits TASK_2026_365: point `plugin-activation.ts` at
 * `@ptah-extension/shared` and delete this file in the same change.
 */

export {
  NO_WORKSPACE_KEY,
  normalizeWorkspaceRoot,
} from '@ptah-extension/shared';
