/**
 * Plugin enablement as an outer gate over the USER-LAYER base (TASK_2026_316).
 *
 * ## The defect this closes
 *
 * `~/.ptah/user/skills` is one directory per MACHINE, and the mirror is
 * create-if-absent: enable `ptah-angular` once, in one workspace, and its skills
 * are cloned there permanently. `disabledPluginIds` was tested only inside the
 * OVERLAY loop, and the base loop had no plugin-id concept at all — so
 * unchecking a bundled plugin dropped it from `enabledPluginIds`, dropped it
 * from the overlay, and changed nothing, because the clone underneath was still
 * the base. The Configure modal's plugin checkbox was, for skills, a no-op after
 * first enable, and `skill-toggles.md`'s "plugin enablement is the outer gate"
 * row had been false since TASK_2026_278.
 *
 * A user-layer clone does carry its origin: `UserLayerMirrorService` writes a
 * `.ptah-origin.json` beside it naming the plugin it came from. This module is
 * the builder reading that file.
 *
 * ## Four rules, and every one of them is a refusal to delete
 *
 * 1. **No sidecar ⇒ never filtered.** The clone is user-authored. It has no
 *    plugin above it, so no plugin toggle can speak for it. Same rule the
 *    user-layer reaper keys off, for the same reason.
 * 2. **`pluginId: null` ⇒ never filtered.** A synthesized skill or a
 *    workspace-authored agent. `null` is a real answer here ("no plugin"), not
 *    a missing one.
 * 3. **An OPT-OUT plugin (`ptah-harness-*`, `ptah-skillssh-*`) is filtered only
 *    by `disabledPluginIds`.** Such a plugin is never listed in
 *    `enabledPluginIds` in the first place — it is active on discovery, because
 *    the user authored it with the harness wizard or asked for it by clicking
 *    Install. Reading its absence from the overlay as "disabled" would delete
 *    every hand-authored skill on the machine.
 * 4. **A bundled or external plugin is filtered when its id is not among the
 *    overlay basenames — and only when the overlay is KNOWN.**
 *
 * Rule 4 keys off `overlayPluginPaths` rather than off a hardcoded list of
 * bundled ids, which is what makes an EXTERNAL marketplace plugin fall out
 * correctly with no extra branch: enabled means present in the overlay,
 * disabled or uninstalled means absent from it.
 *
 * ## Why "and only when the overlay is KNOWN" is not a detail
 *
 * Skills are manifest-owned, so a slug leaving the desired state is a DELETE,
 * not a skip. `PluginConfigSourceResolver` has three failure paths that all
 * return `overlayPluginPaths: []`, and under rule 4 taken literally an empty
 * overlay asserts that every plugin on the machine is disabled — which would
 * empty `.claude/skills`, `.agents/skills`, `.github/skills` and
 * `.cursor/skills` in one silent pass reported as clean. So the flag gates the
 * rule, absent means unfiltered, and only the resolver path that genuinely
 * asked the plugin loader sets it. See `HarnessSourceState.overlayPluginPathsKnown`.
 *
 * `disabledPluginIds` is checked BEFORE the overlay is consulted and regardless
 * of whether it is known, because it is affirmative data rather than an
 * inference from an absent list: a non-empty denylist can only have come from a
 * successful read, and an empty one filters nothing either way.
 */

import { readFileSync } from 'fs';
import { basename, join } from 'path';
import {
  isOptOutPluginId,
  ORIGIN_SIDECAR_FILENAME,
  parseOriginSidecar,
} from '@ptah-extension/shared';
import type { HarnessSourceState } from '../sources/harness-source.port';

/** Where a user-layer clone came from, as far as its sidecar can say. */
export type UserLayerOrigin =
  /** No sidecar, or one that did not parse. The clone is the user's own. */
  | { readonly kind: 'user-authored' }
  /** A sidecar naming no plugin: a synthesized skill or authored agent. */
  | { readonly kind: 'no-plugin' }
  | { readonly kind: 'plugin'; readonly pluginId: string };

const USER_AUTHORED: UserLayerOrigin = { kind: 'user-authored' };
const NO_PLUGIN: UserLayerOrigin = { kind: 'no-plugin' };

/**
 * Read `<cloneDir>/.ptah-origin.json`.
 *
 * Validated with zod at the file boundary, and a malformed sidecar collapses to
 * `user-authored` — the same answer a missing one gives. That collapse is the
 * point: this function's result decides whether a directory is deleted from
 * four harness dirs, so a half-parsed record whose `pluginId` happened to be
 * `undefined` must never reach the gate as if it were an origin claim. An
 * unreadable file is likewise not evidence of a plugin.
 */
export function readUserLayerOrigin(cloneDir: string): UserLayerOrigin {
  let raw: string;
  try {
    raw = readFileSync(join(cloneDir, ORIGIN_SIDECAR_FILENAME), 'utf-8');
  } catch {
    // ENOENT is the overwhelmingly common case and means user-authored; a
    // permission or IO error is indistinguishable from it here, and the safe
    // answer to both is the one that filters nothing.
    return USER_AUTHORED;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return USER_AUTHORED;
  }

  const sidecar = parseOriginSidecar(parsed);
  if (sidecar === null) return USER_AUTHORED;
  return sidecar.pluginId === null
    ? NO_PLUGIN
    : { kind: 'plugin', pluginId: sidecar.pluginId };
}

/** Decides whether a user-layer clone survives this workspace's plugin state. */
export type PluginOriginGate = (cloneDir: string) => boolean;

/**
 * Build the gate for one pass.
 *
 * The enabled set and the denylist are computed once and closed over, so the
 * per-slug cost is one sidecar read and two set lookups.
 */
export function createPluginOriginGate(
  sources: HarnessSourceState,
): PluginOriginGate {
  const disabledPluginIds = new Set(sources.disabledPluginIds);
  const overlayKnown = sources.overlayPluginPathsKnown === true;
  const enabledPluginIds = new Set(
    sources.overlayPluginPaths.map((pluginPath) => basename(pluginPath)),
  );

  return (cloneDir: string): boolean => {
    // Rules 1 and 2: nothing that lacks a plugin origin can be spoken for by a
    // plugin toggle. Checked first so neither costs a set lookup.
    const origin = readUserLayerOrigin(cloneDir);
    if (origin.kind !== 'plugin') return true;

    // Affirmative denial, and the ONLY filter that applies to an opt-out plugin.
    if (disabledPluginIds.has(origin.pluginId)) return false;
    if (isOptOutPluginId(origin.pluginId)) return true;

    // Rule 4, fail-open. Absence from an overlay we cannot vouch for is not
    // evidence of anything.
    if (!overlayKnown) return true;
    return enabledPluginIds.has(origin.pluginId);
  };
}
