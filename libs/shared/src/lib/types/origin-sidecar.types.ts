/**
 * The user-layer provenance sidecar: `.ptah-origin.json`.
 *
 * `UserLayerMirrorService` (`agent-generation`) writes one beside every clone it
 * publishes into `~/.ptah/user/{skills,commands,agents}`, recording which plugin
 * the clone came from and whether the user has since edited it. It is the ONLY
 * record of a clone's origin — the clone itself is a plain copy of markdown.
 *
 * ## Why the format lives in `shared` and not next to its writer
 *
 * It has two readers on opposite sides of a forbidden dependency edge:
 *
 * - `agent-generation` WRITES it and reaps against it
 *   (`user-layer/user-layer-orphan-reaper.ts`).
 * - `harness-sync` READS it to answer "which plugin does this user-layer clone
 *   belong to?", which is what makes unchecking a bundled plugin remove its
 *   skills from a workspace again (TASK_2026_316 Batch 1).
 *
 * `harness-sync` must never import `agent-generation` — the reconciler is a leaf
 * and that lib is upstream of it. The alternative was for `harness-sync` to
 * re-declare the filename and the `pluginId` field for itself, and there is
 * standing evidence that copies of these constants drift: `ptah-harness-` was
 * already spelled twice, once here and once in `agent-sdk`'s
 * `plugin-loader.service.ts`. A third copy was not worth saving a file, so the
 * format moved to the one place both libs may depend on.
 *
 * It is a WIRE TYPE that is not on any wire. Nothing here crosses to the
 * webview; `shared` is simply the only module both backends are allowed to see.
 */

import { z } from 'zod';

/** The three editable artifact kinds the user layer holds. */
export const OriginKindSchema = z.enum(['skill', 'agent', 'command']);

export type OriginKind = z.infer<typeof OriginKindSchema>;

/** The sidecar's filename, inside a skill clone dir or beside a `.md` clone. */
export const ORIGIN_SIDECAR_FILENAME = '.ptah-origin.json';

/**
 * Plugin-id prefix the harness builder writes under `~/.ptah/plugins/`.
 *
 * Harness-authored skills live at
 * `~/.ptah/plugins/ptah-harness-<slug>/skills/<slug>/` and are mirrored into the
 * user layer exactly like a bundled plugin's skills — same sidecar, same
 * `pluginId`, same divergence tracking.
 *
 * OPT-OUT: such a plugin is never listed in `enabledPluginIds`, so absence from
 * the enabled set says nothing about it. Only `disabledPluginIds` turns one off.
 */
export const HARNESS_PLUGIN_ID_PREFIX = 'ptah-harness-';

/**
 * Plugin-id prefix `skillsSh:install` writes under `~/.ptah/plugins/`.
 *
 * Deliberately the same shape as a harness plugin — that shape is already a
 * first-class overlay source — and OPT-OUT for the same reason: the user asked
 * for this specific skill by clicking Install, so it is active on discovery and
 * stays active until its id lands in `disabledPluginIds`.
 */
export const SKILLS_SH_PLUGIN_ID_PREFIX = 'ptah-skillssh-';

/**
 * Directory segments of the WORKSPACE-scoped plugin root, relative to the
 * workspace folder: `{ws}/.ptah/plugins`.
 *
 * A harness plugin written here is scoped to one project. It is deliberately
 * the same `ptah-harness-*` shape as a user-global one, because that shape is
 * already a first-class overlay source and needs no new concept to reach every
 * CLI — only a second root to scan.
 *
 * It sits under `.ptah/` alongside `specs/`, so a skill that only makes sense
 * for this codebase can be committed with it and travels to the whole team.
 */
export const WORKSPACE_PLUGINS_DIR_SEGMENTS = ['.ptah', 'plugins'] as const;

/**
 * Absolute path of a workspace's plugin root.
 *
 * Spelled once, here, because the plugin loader SCANS it and the harness
 * namespace WRITES into it. Two hand-rolled joins is how those two drift and a
 * created skill lands somewhere nothing discovers.
 *
 * Returns null for an absent or blank workspace root, which is the honest
 * answer for a host with no folder open — the caller must then refuse a
 * workspace-scoped write rather than invent a path.
 */
export function workspacePluginsDir(
  workspaceRoot: string | undefined | null,
): string | null {
  const trimmed = workspaceRoot?.trim() ?? '';
  if (trimmed.length === 0) return null;
  // Plain join — no `path` import, so this stays usable from the frontend half
  // of the bridge. Separator choice is irrelevant on Windows, which accepts
  // both, and every consumer feeds the result back through `path.join`.
  return [
    trimmed.replace(/[\\/]+$/, ''),
    ...WORKSPACE_PLUGINS_DIR_SEGMENTS,
  ].join('/');
}

/**
 * True for a plugin id that is active on discovery rather than by enrolment.
 *
 * The distinction matters to any consumer filtering on `enabledPluginIds`:
 * a bundled or external plugin is absent from that list because it is OFF,
 * while a harness or skills.sh plugin is absent from it because it was never
 * eligible to be in it. Treating the two the same silently deletes every
 * hand-authored and skills.sh-installed skill.
 */
export function isOptOutPluginId(pluginId: string): boolean {
  return (
    pluginId.startsWith(HARNESS_PLUGIN_ID_PREFIX) ||
    pluginId.startsWith(SKILLS_SH_PLUGIN_ID_PREFIX)
  );
}

// ---------------------------------------------------------------------------
// Retired skills.sh roots (TASK_2026_853 D-2)
//
// A legacy user-global skills.sh root that Ptah cannot prove it wrote is
// RETIRED rather than deleted (decision #10): it stays on disk, but nothing
// loads, mirrors or syncs it any more. The registry below is the one record of
// that, read by the plugin loader (skip the root), the harness manifest builder
// (skip user-layer clones whose sidecar `sourceRef` names it) and the
// reconciler (removal policy). It lives here, beside `isOptOutPluginId`, for
// the same two-readers reason as the sidecar itself.
// ---------------------------------------------------------------------------

/**
 * Filename of the retired-root registry, inside the user plugin root
 * (`~/.ptah/plugins/.ptah-skillssh-retired.json`). The leading dot keeps it
 * out of every `ptah-skillssh-*` directory scan.
 */
export const SKILLS_SH_RETIRED_FILE = '.ptah-skillssh-retired.json';

/**
 * Owner marker a v2 skills.sh root's metadata carries as `ownerMarker`, next to
 * `owner: 'ptah'` and per-file hashes (D-D8). Only a root with this exact
 * marker AND matching hashes is proven Ptah-written and may be deleted; every
 * other root is retired and kept.
 */
export const SKILLS_SH_OWNER_MARKER = 'ptah.skills-sh.root.v2';

/**
 * `sourceRef` prefix of a clone copied from a skills.sh root:
 * `skills-sh:<root dir basename>`, e.g. `skills-sh:ptah-skillssh-acme-skills`.
 * The text after the prefix is the root id the registry is keyed by.
 */
export const SKILLS_SH_SOURCE_REF_PREFIX = 'skills-sh:';

/** One retired root. `retiredAt` is ISO-8601, like the stores beside it. */
export const SkillsShRetiredRootSchema = z.object({
  retiredAt: z.string(),
});

/**
 * The registry file: `{version: 1, roots: {[rootId]: {retiredAt}}}`, where
 * `rootId` is the root directory's basename (`ptah-skillssh-<owner>-<repo>`).
 */
export const SkillsShRetiredRegistrySchema = z.object({
  version: z.literal(1),
  roots: z.record(z.string(), SkillsShRetiredRootSchema),
});

export type SkillsShRetiredRegistry = z.infer<
  typeof SkillsShRetiredRegistrySchema
>;

/**
 * Parse the registry at its file boundary. Returns `null` for anything that is
 * not a well-formed v1 registry; the reader decides what an unreadable registry
 * means (an absent file is simply "nothing retired").
 */
export function parseSkillsShRetiredRegistry(
  raw: unknown,
): SkillsShRetiredRegistry | null {
  const result = SkillsShRetiredRegistrySchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * True when the skills.sh root with this directory basename is retired.
 *
 * Own-property lookup only, so a root id such as `constructor` or `__proto__`
 * never matches through the prototype chain.
 */
export function isRetiredSkillsShRoot(
  rootId: string,
  registry: SkillsShRetiredRegistry | null | undefined,
): boolean {
  if (!registry || rootId.length === 0) return false;
  return Object.prototype.hasOwnProperty.call(registry.roots, rootId);
}

/**
 * True when a clone's `sourceRef` names a retired skills.sh root.
 *
 * Every other ref family (`ptah:`, `external:`, `harness:`), an absent ref and
 * an absent registry are never retired by this registry.
 */
export function isRetiredSourceRef(
  sourceRef: string | null | undefined,
  registry: SkillsShRetiredRegistry | null | undefined,
): boolean {
  if (!sourceRef?.startsWith(SKILLS_SH_SOURCE_REF_PREFIX)) return false;
  return isRetiredSkillsShRoot(
    sourceRef.slice(SKILLS_SH_SOURCE_REF_PREFIX.length),
    registry,
  );
}

/**
 * The sidecar payload.
 *
 * `pluginId: null` is meaningful and is NOT "unknown": it marks a clone with no
 * plugin above it — a synthesized skill, or a workspace-authored agent. A clone
 * with NO sidecar at all is user-authored and is never classified, reaped or
 * filtered; that is the whole reason the reaper and the manifest builder both
 * key off this file's presence rather than off a directory listing.
 */
export const OriginSidecarSchema = z.object({
  kind: OriginKindSchema,
  slug: z.string(),
  pluginId: z.string().nullable(),
  version: z.string().nullable(),
  sourceHash: z.string(),
  clonedAt: z.number(),
  diverged: z.boolean(),
  lastEnhancedAt: z.number().nullable(),
  historyDir: z.string(),
  currentContentHash: z.string().optional(),
  pendingSourceHash: z.string().optional(),
  conflictsWith: z.string().optional(),
  /**
   * The upstream this clone was copied from no longer exists, and the clone was
   * KEPT rather than reaped because it carries local work (`diverged`, or a live
   * content hash that no longer matches `sourceHash`).
   *
   * Absent/`false` is the normal state. It is set by the reaper and cleared the
   * moment the upstream reappears — a plugin re-enabled or re-downloaded heals
   * its own clones without user action.
   */
  orphaned: z.boolean().optional(),
  /**
   * Durable identity of the source this clone was copied from (A28):
   * `ptah:<id>`, `external:<owner>/<repo>/<plugin>`, `skills-sh:<root dir>` or
   * `harness:<dir>`. Unlike `pluginId`, two external plugins that share a
   * directory basename never share a `sourceRef`. Absent on sidecars written
   * before it existed; those still parse.
   */
  sourceRef: z.string().optional(),
  /**
   * Display name of the source at the last create/reconcile. Kept after the
   * source is removed, so an orphaned clone still shows its former name.
   */
  sourceLabel: z.string().optional(),
});

export type OriginSidecar = z.infer<typeof OriginSidecarSchema>;

/**
 * Parse sidecar JSON at a file boundary. Returns `null` for anything that is not
 * a well-formed sidecar.
 *
 * The `null` return is deliberately the SAME answer a missing file gives, and
 * every caller must treat it that way. A malformed sidecar must read as "no
 * sidecar" — meaning "user-authored, hands off" — rather than as a record whose
 * `pluginId` happens to be `undefined`, because every consumer of this format
 * decides whether to DELETE something based on that field.
 */
export function parseOriginSidecar(raw: unknown): OriginSidecar | null {
  const result = OriginSidecarSchema.safeParse(raw);
  return result.success ? result.data : null;
}
