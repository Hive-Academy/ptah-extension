import { z } from 'zod';
import { defineSetting } from './definition';

/**
 * Output-style setting definitions (TASK_2026_197, plan §6 / F4).
 *
 * ## Why Ptah stores a selection at all
 *
 * Activation no longer works by writing `outputStyle` into a `.claude/
 * settings.json` file — it is computed per session and handed to the SDK
 * through the flag tier. That removes the file Ptah used to read the user's
 * choice back out of, so the choice needs a home Ptah actually owns. This is
 * it: `~/.ptah/settings.json`, which is exactly what `settings-core` is for.
 * The distinction matters — `settings-core` owns PTAH's files, never a foreign
 * tool's, and nothing here reads or writes anything under `.claude/`.
 *
 * ## Why a string, and why `''` rather than an optional key
 *
 * The stored value is the frontmatter `name` of the chosen style — never a
 * filename, never a path (E1). `''` is a deliberate "no style chosen" sentinel
 * rather than an absent key, for the same reason as
 * `TASKS_ACTIVE_VIEW_ID_DEF`: {@link defineSetting} defaults are total, so
 * every read hands back a `string` and no consumer has to invent a meaning for
 * `undefined`. The RPC boundary maps `''` onto `null` for the wire, which is
 * also the shape `ActiveOutputStyleState.name` uses.
 *
 * ## Scope
 *
 * `scope: 'global'` names the STORAGE TIER (the settings file), not the
 * resolution scope. Per-workspace resolution is layered on top by
 * `WorkspaceScopeResolver`, exactly as the provider settings do it, so two
 * projects open side by side can run different styles. Hosts that have not
 * bound an `IActiveWorkspaceSource` simply fall back to the unprefixed key.
 */
export const OUTPUT_STYLE_SELECTED_NAME_DEF = defineSetting({
  key: 'outputStyle.selectedName',
  scope: 'global',
  sensitivity: 'plain',
  schema: z.string(),
  default: '',
  sinceVersion: 1,
});
