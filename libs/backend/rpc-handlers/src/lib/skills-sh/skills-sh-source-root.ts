/**
 * Where a skills.sh skill LIVES once Ptah owns it.
 *
 * Before TASK_2026_288 a skills.sh install shelled `npx skills add --agent
 * claude-code`, which writes straight into `{ws}/.claude/skills` (or
 * `~/.claude/skills` with `-g`). That had three consequences and all of them
 * were defects:
 *
 *   1. `.claude/skills` is the ONLY place the bytes landed, so the skill
 *      reached Claude and nothing else — not `.agents/skills` (codex,
 *      antigravity), not `.github/skills` (copilot), not `.cursor/skills`.
 *   2. `.claude/skills` is a MANAGED directory. A path there that no manifest
 *      owns and no desired state names is `foreign` by rule
 *      (`claude-target.ts`), so every skills.sh skill was a permanent,
 *      unclearable finding in `ptah harness doctor`.
 *   3. `-g` wrote outside the workspace entirely, where the workspace-scoped
 *      reconciler cannot see it at all.
 *
 * The fix is not a fourth writer. It is to land the content in a Ptah-owned
 * SOURCE ROOT and let the existing pipeline do the rest:
 *
 *     ~/.ptah/plugins/ptah-skillssh-<owner>-<repo>/
 *       .ptah-skillssh.json      <- this module's metadata record
 *       skills/<slug>/SKILL.md
 *
 * That shape is deliberately the `ptah-harness-*` shape. A directory under
 * `~/.ptah/plugins` holding a `skills/` tree is already a first-class overlay
 * source: `PluginLoaderService.resolveCurrentPluginPaths()` yields it,
 * `PluginConfigSourceResolver` hands it to the manifest builder as
 * `overlayPluginPaths`, and `HarnessManifestBuilder.buildSkills` claims every
 * slug under it. From there the skill is ordinary desired state — copied into
 * all six targets, hash-gated, manifest-owned, reaped when the root goes away,
 * and never `foreign` again. No new concept, no new writer, no new manifest.
 *
 * Two things this module deliberately does NOT do:
 *
 * - **It does not mirror into `~/.ptah/user/skills`.** The user layer is the
 *   BASE and it wins every collision, and `UserLayerMirrorService` clones
 *   create-if-absent. A clone would therefore SURVIVE uninstall: deleting the
 *   source root would leave the user-layer copy in the desired state, and the
 *   skill would keep propagating into every target forever. Overlay-only is
 *   what makes `skillsSh:uninstall` actually reap.
 * - **It does not decide scope.** There is no project-scoped source root in the
 *   reconciler's model — the desired state is `~/.ptah/user` plus the plugin
 *   overlay, both user-global by construction. See `SKILLS_SH_SCOPE` below.
 */

import { z } from 'zod';
import { parseSourceSlug } from '@ptah-extension/shared';

/**
 * Directory-name prefix for a skills.sh source root.
 *
 * Sibling of `ptah-harness-` (`plugin-loader.service.ts`), and distinct from it
 * on purpose: the two have different provenance (a third-party repo vs. the
 * user's own wizard run) and the marketplace shows them differently.
 */
export const SKILLS_SH_PLUGIN_PREFIX = 'ptah-skillssh-';

/** Metadata filename at the root of a skills.sh source root. */
export const SKILLS_SH_METADATA_FILE = '.ptah-skillssh.json';

/**
 * The one scope a skills.sh skill can have now, and why it is not a parameter.
 *
 * The old `scope: 'project' | 'global'` selected between `{ws}/.claude/skills`
 * and `~/.claude/skills`. The reconciler reconciles NEITHER, so neither value
 * survived the fix. What replaced them is a single user-global source root —
 * which is not a compromise but the only thing the model can express: the
 * desired state is `~/.ptah/user` plus `~/.ptah/plugins/*`, and both are
 * user-global.
 *
 * Per-workspace control did not disappear with the parameter; it moved to the
 * control that already existed and is strictly better than an install-time
 * flag, because it is reversible: `disabledPluginIds` (the whole source root)
 * and `disabledSkillIds` (one slug) in the Plugins panel, the same two toggles
 * a harness-authored skill uses.
 */
export const SKILLS_SH_SCOPE = 'global' as const;

/**
 * On-disk record of what a source root holds.
 *
 * It exists because the directory NAME is lossy: `ptah-skillssh-a-b-c` could
 * have come from `a/b-c` or from `a-b/c`, and `listInstalled` has to report the
 * exact `owner/repo` back to the marketplace so its install badges match. The
 * slug list is here for the same reason — a whole-repo install writes N skills,
 * and uninstall has to know which slugs it is removing without inferring them
 * from a directory that may have been edited.
 */
export const SkillsShRootMetadataSchema = z.object({
  version: z.literal(1),
  /** `owner/repo`, exactly as the user requested it. */
  source: z.string(),
  /** Slugs written under `skills/`. */
  skillIds: z.array(z.string()),
  /** ISO-8601. Reporting only. */
  installedAt: z.string(),
});

export type SkillsShRootMetadata = z.infer<typeof SkillsShRootMetadataSchema>;

/**
 * Directory name for a source root, or `null` when `source` is not a safe
 * `owner/repo`.
 *
 * `parseSourceSlug` (shared) is the guard, not a fresh regex: it applies
 * `SAFE_SOURCE_PATTERN` **and** `isSafePathToken` to each half, and the second
 * half is the load-bearing one here. `SAFE_SOURCE_PATTERN` alone accepts `../..`
 * — `..` matches `[a-zA-Z0-9_.-]+` — and this value becomes a filesystem path.
 * Prefixing would defuse that particular string, but a guard that is only safe
 * because of what is concatenated in front of it is not a guard.
 *
 * The `/` becomes `-`, which is why the mapping is not reversible and why
 * {@link SkillsShRootMetadataSchema} records the original.
 */
export function skillsShRootId(source: string): string | null {
  const slug = parseSourceSlug(source);
  if (slug === null) return null;
  return `${SKILLS_SH_PLUGIN_PREFIX}${slug.owner}-${slug.repo}`;
}

/** True when `id` names a skills.sh source root. */
export function isSkillsShRootId(id: string): boolean {
  return id.startsWith(SKILLS_SH_PLUGIN_PREFIX);
}
