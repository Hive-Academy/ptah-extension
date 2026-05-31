/**
 * Smithery session-time override resolver.
 *
 * At chat query-assembly time, reads the Smithery-installed manifest and
 * rebuilds a fresh, secret-bearing `McpHttpServerOverride` for each installed
 * record by calling `SmitheryConnectionResolver.resolve(...)`. The resulting
 * map is merged into `QueryOptionsInput.mcpServersOverride` BEFORE the builder's
 * `mergeMcpOverride` (caller-wins) — so the secret URL lives only in memory for
 * the duration of the query and is never written to any disk config file.
 *
 * SECURITY:
 * - Never logs the built URL or the API key (delegates URL building to the
 *   resolver which is already secret-safe; logs only counts + server keys).
 * - Contributes nothing (empty map) when the manifest is empty, no key is
 *   configured, or an individual record fails to resolve — never throws into
 *   the chat path.
 */

import type { McpHttpServerOverride } from '@ptah-extension/shared';
import type { SmitheryConnectionResolver } from './smithery-connection-resolver';
import type { SmitheryInstalledManifestStore } from './smithery-installed-manifest';
import { SmitheryKeyMissingError } from './smithery-errors';

/** Optional logger surface — keeps the resolver DI-light. */
export interface SmitheryOverrideLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

export interface SmitheryOverrideResolverDeps {
  manifest: SmitheryInstalledManifestStore;
  resolver: SmitheryConnectionResolver;
  logger?: SmitheryOverrideLogger;
}

export class SmitheryOverrideResolver {
  private readonly manifest: SmitheryInstalledManifestStore;
  private readonly resolver: SmitheryConnectionResolver;
  private readonly logger?: SmitheryOverrideLogger;

  constructor(deps: SmitheryOverrideResolverDeps) {
    this.manifest = deps.manifest;
    this.resolver = deps.resolver;
    this.logger = deps.logger;
  }

  /**
   * Build the per-session override map from the manifest. Returns an empty
   * object when there is nothing to contribute (empty manifest, missing key, or
   * all records failed) — the caller can spread it unconditionally.
   */
  async buildOverrides(): Promise<Record<string, McpHttpServerOverride>> {
    const records = this.manifest.list();
    if (records.length === 0) {
      return {};
    }

    const overrides: Record<string, McpHttpServerOverride> = {};

    for (const record of records) {
      try {
        const config = await this.manifest.getConfig(record.serverKey);
        const httpConfig = await this.resolver.resolve({
          qualifiedName: record.qualifiedName,
          config,
          profile: record.profile,
        });
        overrides[record.serverKey] = {
          type: 'http',
          url: httpConfig.url,
          headers: httpConfig.headers,
        };
      } catch (error: unknown) {
        if (error instanceof SmitheryKeyMissingError) {
          this.logger?.warn(
            'Smithery override skipped — API key not configured',
            { serverKey: record.serverKey },
          );
          continue;
        }
        this.logger?.warn('Smithery override resolution failed for record', {
          serverKey: record.serverKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (Object.keys(overrides).length > 0) {
      this.logger?.debug('Smithery overrides resolved', {
        serverKeys: Object.keys(overrides),
      });
    }

    return overrides;
  }
}
