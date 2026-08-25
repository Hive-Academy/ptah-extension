/**
 * The user-layer origin sidecar, re-exported.
 *
 * The FORMAT moved to `@ptah-extension/shared` in TASK_2026_316: `harness-sync`
 * has to read `pluginId` to know which plugin a user-layer clone came from, and
 * it may never import this lib. See `shared/lib/types/origin-sidecar.types.ts`
 * for the reasoning. This file stays as the module the user-layer services
 * already import from, so the move is invisible to them, and keeps the two names
 * that are genuinely local to the mirror.
 */

export type { OriginKind, OriginSidecar } from '@ptah-extension/shared';
export {
  HARNESS_PLUGIN_ID_PREFIX,
  ORIGIN_SIDECAR_FILENAME,
  OriginSidecarSchema,
  SKILLS_SH_PLUGIN_ID_PREFIX,
  isOptOutPluginId,
  parseOriginSidecar,
} from '@ptah-extension/shared';

/** The three editable roots under `~/.ptah/user/`. */
export interface UserLayerRoots {
  skills: string;
  agents: string;
  commands: string;
}

/**
 * Snapshot directory name, relative to a clone root. Local to the mirror: it is
 * the enhancement history store, not part of the sidecar format.
 */
export const DEFAULT_HISTORY_DIR = '.history';
