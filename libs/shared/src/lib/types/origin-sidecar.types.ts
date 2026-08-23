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
