export type OriginKind = 'skill' | 'agent' | 'command';

/** The three editable roots under `~/.ptah/user/`. */
export interface UserLayerRoots {
  skills: string;
  agents: string;
  commands: string;
}

export interface OriginSidecar {
  kind: OriginKind;
  slug: string;
  pluginId: string | null;
  version: string | null;
  sourceHash: string;
  clonedAt: number;
  diverged: boolean;
  lastEnhancedAt: number | null;
  historyDir: string;
  currentContentHash?: string;
  pendingSourceHash?: string;
  conflictsWith?: string;
  /**
   * The upstream this clone was copied from no longer exists, and the clone was
   * KEPT rather than reaped because it carries local work (`diverged`, or a live
   * content hash that no longer matches `sourceHash`).
   *
   * Absent/`false` is the normal state. It is set by the reaper and cleared the
   * moment the upstream reappears — a plugin re-enabled or re-downloaded heals
   * its own clones without user action.
   *
   * A clone with NO sidecar at all is user-authored and is never classified,
   * reaped or marked; that is the whole reason the reaper keys off this file.
   */
  orphaned?: boolean;
}

/**
 * Plugin-id prefix the harness builder writes under `~/.ptah/plugins/`.
 *
 * Harness-authored skills live at
 * `~/.ptah/plugins/ptah-harness-<slug>/skills/<slug>/` and are mirrored into the
 * user layer exactly like a bundled plugin's skills — same sidecar, same
 * `pluginId`, same divergence tracking.
 */
export const HARNESS_PLUGIN_ID_PREFIX = 'ptah-harness-';

export const ORIGIN_SIDECAR_FILENAME = '.ptah-origin.json';

export const DEFAULT_HISTORY_DIR = '.history';
