/**
 * The identity of an externally-installed plugin.
 *
 * Format: `external:<owner>/<repo>/<plugin>` — e.g.
 * `external:dotnet/skills/dotnet-test`.
 *
 * Why a structured id rather than a flattened directory name: bundled and
 * harness plugin ids ARE directory names, so `join(pluginsBasePath, id)`
 * resolves them. External plugins live three levels down, so their id has to
 * carry the whole coordinate. Flattening it (`dotnet__skills__dotnet-test`)
 * would be ambiguous — `_` is legal in GitHub owner and repo names, so two
 * different coordinates can flatten to the same string. Keeping the separators
 * makes the mapping injective, and the id never reaches `path.join` unparsed.
 */

import * as path from 'path';
import { isSafePathToken } from '@ptah-extension/shared';

/** Prefix that marks an id as external. */
export const EXTERNAL_PLUGIN_ID_PREFIX = 'external:';

/**
 * Directory under `~/.ptah/plugins/` that holds externally-installed plugins.
 *
 * `ContentDownloadService.pruneStaleFiles` declares the same name as a reserved
 * root it never owns. The two constants are deliberately separate: `platform-core`
 * is a leaf that imports nothing, so it cannot reference this one. If you rename
 * either, rename both — `content-download.service.ts` says so too.
 */
export const EXTERNAL_PLUGINS_DIRNAME = 'external';

/** The three coordinates that identify an external plugin. */
export interface ExternalPluginCoordinate {
  owner: string;
  repo: string;
  plugin: string;
}

/** `owner/repo` slug for a coordinate. */
export function coordinateSource(coord: ExternalPluginCoordinate): string {
  return `${coord.owner}/${coord.repo}`;
}

/** Build the canonical id for a coordinate. */
export function buildExternalPluginId(coord: ExternalPluginCoordinate): string {
  return `${EXTERNAL_PLUGIN_ID_PREFIX}${coord.owner}/${coord.repo}/${coord.plugin}`;
}

/** True when `id` looks like an external plugin id (shape only). */
export function isExternalPluginId(id: string): boolean {
  return id.startsWith(EXTERNAL_PLUGIN_ID_PREFIX);
}

/**
 * Parse an external plugin id, or return null when it is not one.
 *
 * Every segment is re-validated with {@link isSafePathToken} even though the
 * writer validated it too. This function is called on ids read back from
 * persisted state and from RPC params, so it is the last gate before the
 * segments become path components — and a gate that trusts its input is not one.
 */
export function parseExternalPluginId(
  id: string,
): ExternalPluginCoordinate | null {
  if (!isExternalPluginId(id)) return null;

  const rest = id.slice(EXTERNAL_PLUGIN_ID_PREFIX.length);
  const segments = rest.split('/');
  if (segments.length !== 3) return null;

  const [owner, repo, plugin] = segments;
  if (![owner, repo, plugin].every(isSafePathToken)) return null;

  return { owner, repo, plugin };
}

/**
 * Absolute directory an external plugin installs into.
 *
 * @param pluginsBasePath absolute `~/.ptah/plugins`
 */
export function externalPluginDir(
  pluginsBasePath: string,
  coord: ExternalPluginCoordinate,
): string {
  return path.join(
    pluginsBasePath,
    EXTERNAL_PLUGINS_DIRNAME,
    coord.owner,
    coord.repo,
    coord.plugin,
  );
}

/** Absolute `~/.ptah/plugins/external`. */
export function externalRootDir(pluginsBasePath: string): string {
  return path.join(pluginsBasePath, EXTERNAL_PLUGINS_DIRNAME);
}
