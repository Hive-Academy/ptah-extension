/**
 * The one thing `harness-sync` needs from the rest of the backend: where the
 * editable sources are, and which of them the user turned off.
 *
 * This is a PORT, deliberately. The obvious alternative — injecting
 * `PluginLoaderService` — would make `harness-sync` depend on `agent-sdk`, the
 * lib whose junction service this replaces. That direction is not circular
 * today, but it puts the reconciler downstream of a 10-concern monolith for the
 * sake of three method calls, and Batch 2 moves rival-CLI sync in here too. A
 * three-method port keeps the reconciler a leaf.
 */

import type { HarnessTargetId } from '@ptah-extension/shared';
import type { HarnessMcpIntent } from './mcp-intent-store';

/** Absolute roots of the user layer (`~/.ptah/user/` by default). */
export interface HarnessSourceLayout {
  skillsRoot: string;
  commandsRoot: string;
  agentsRoot: string;
  /**
   * Extra absolute directories a LEGACY junction was allowed to point into,
   * beyond the three roots above and the enabled plugin overlay.
   *
   * `SkillJunctionService` linked `{ws}/.claude/skills/<slug>` at whichever
   * source held the skill, and over its lifetime that was three different
   * places: the user layer, `~/.ptah/plugins/<id>` (including plugins that are
   * DISABLED today and therefore absent from `overlayPluginPaths`), and — in its
   * earliest form — the synthesized-skill root `~/.ptah/skills`. The Claude
   * target will only unlink a symlink whose target resolves inside one of these
   * roots; anything else is the user's own link and is reported `foreign`.
   *
   * Optional so a resolver built by hand (every spec, and any host with no
   * legacy install to migrate) opts into the STRICT behaviour by saying nothing.
   * `defaultHarnessSourceLayout` fills it in for real installs.
   */
  legacyLinkRoots?: readonly string[];
}

/** Everything the manifest builder needs to compute a desired state. */
export interface HarnessSourceState {
  layout: HarnessSourceLayout;
  /**
   * MCP servers the user asked Ptah to install, from
   * `~/.ptah/mcp-installed.json` (see `mcp-intent-store.ts`). Empty is the
   * normal state and means "no Ptah-managed MCP servers" — never "remove the
   * user's own", which are not in the manifest and so are never touched.
   *
   * Optional, and absent means empty, so a resolver that predates the MCP facet
   * (or a spec that only cares about skills) is a valid source state rather
   * than a compile error.
   */
  mcpIntents?: HarnessMcpIntent[];
  /**
   * Plugin directories overlaid ON TOP of the user layer, additively. This is
   * how harness-authored `~/.ptah/plugins/ptah-harness-*` directories — which
   * are not in `enabledPluginIds` and so are never mirrored — still reach the
   * workspace. The user layer wins every collision.
   */
  overlayPluginPaths: string[];
  /**
   * Whether {@link overlayPluginPaths} is a TRUTHFUL picture of what this
   * workspace has enabled — as opposed to whatever a failed read left behind.
   *
   * **Absent is NOT an empty enabled set.** Absent means "I have no opinion
   * about the plugin overlay", and the manifest builder answers that by
   * filtering NOTHING. Only `true` licenses the builder to read an id's absence
   * from the overlay as "that plugin is off here".
   *
   * The distinction did not matter while the overlay was purely ADDITIVE: an
   * empty one cost nothing the user layer did not already carry. Since
   * TASK_2026_316 the overlay is also the plugin FILTER over the user-layer
   * base, so an empty one asserts "every clone with a plugin origin is
   * disabled". Skills are manifest-owned, which makes that assertion a
   * REAP — `.claude/skills/*`, `.agents/skills/*`, `.github/skills/*` and
   * `.cursor/skills/*` deleted wholesale, silently, and reported as an ordinary
   * clean pass. `PluginConfigSourceResolver` has three separate failure paths
   * that all return an empty overlay, so that is a live transient, not a
   * hypothetical.
   *
   * Optional in the same spirit as {@link HarnessSourceLayout.legacyLinkRoots},
   * with the safe direction reversed: there, a resolver built by hand opts into
   * STRICT behaviour by saying nothing; here it opts into UNFILTERED behaviour,
   * because here the strict answer is the one that deletes files. A spec, a
   * preflight assembled by hand, or a host that has not been taught about the
   * gate all get the pre-gate behaviour rather than an accidental reap.
   */
  overlayPluginPathsKnown?: boolean;
  /** Skill slugs the user (or the residency budget) switched off. */
  disabledSkillIds: string[];
  /** Plugin ids whose overlay directories must be ignored entirely. */
  disabledPluginIds: string[];
  /**
   * Agent slugs the user switched off — `backend-developer` for
   * `~/.ptah/user/agents/backend-developer.md`. The per-agent half of the
   * consent story; `state.json`'s `agentSyncEnabled` is the workspace-level
   * half, and either one dropping an agent reaps it from every target.
   *
   * Optional, and absent means "none disabled", for the same reason
   * {@link mcpIntents} is optional: a resolver built by hand and every spec that
   * predates this field stays a valid source state rather than a compile error.
   */
  disabledAgentIds?: string[];
}

/** Resolves the current source state. Must never throw — degrade to empty. */
export interface IHarnessSourceResolver {
  resolve(): HarnessSourceState;
}

/**
 * Whether a rival CLI is installed on this machine.
 *
 * A PORT rather than a direct dependency on `CliDetectionService`, for the same
 * reason as `IHarnessSourceResolver`: that service lives in `cli-agent-runtime`,
 * which is allowed to depend on `harness-sync` (its MCP install surface now
 * does) and must therefore never be depended on FROM here. Hosts adapt their
 * detector in one lambda at registration.
 *
 * A host that supplies no detector gets `detected: false` for every rival
 * target — reported as `target-absent`, never as a silent skip (E17).
 */
export interface IHarnessCliDetector {
  isInstalled(target: HarnessTargetId): Promise<boolean>;
}

/** A detector that reports nothing installed. The default for bare containers. */
export const NO_CLI_DETECTOR: IHarnessCliDetector = {
  isInstalled: () => Promise.resolve(false),
};
