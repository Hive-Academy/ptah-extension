/**
 * Smithery session-time override resolver.
 *
 * At chat query-assembly time, reads the Smithery-installed manifest and
 * rebuilds a fresh, secret-bearing `McpHttpServerOverride` from it. The
 * resulting map is merged into `QueryOptionsInput.mcpServersOverride` BEFORE
 * the builder's `mergeMcpOverride` (caller-wins) — so the secret URL lives only
 * in memory for the duration of the query and is never written to any disk
 * config file.
 *
 * TWO SHAPES (TASK_2026_375 B2.4):
 * - Records with `namespace` + `connectionId` are Connections-API records.
 *   They ALL share ONE override, keyed `smithery`, pointing at the namespace
 *   endpoint `https://mcp.smithery.run/<namespace>` with the API key in an
 *   `Authorization` header. Their tools arrive prefixed `<connectionId>.<tool>`.
 *   No per-server override is emitted for them.
 * - Records without a namespace keep the legacy per-server override, one per
 *   `serverKey`, built by `SmitheryConnectionResolver.resolve(...)`.
 *
 * SECURITY:
 * - Never logs the built URL or the API key (delegates URL building to the
 *   resolver which is already secret-safe; logs only counts + server keys).
 * - Contributes nothing (empty map) when the manifest is empty, no key is
 *   configured, or an individual record fails to resolve — never throws into
 *   the chat path.
 */

import type {
  McpHttpServerOverride,
  SmitheryInstalledRecord,
} from '@ptah-extension/shared';
import type { SmitheryConnectionResolver } from './smithery-connection-resolver';
import type { SmitheryInstalledManifestStore } from './smithery-installed-manifest';
import { SmitheryKeyMissingError } from './smithery-errors';

/** Optional logger surface — keeps the resolver DI-light. */
export interface SmitheryOverrideLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

/**
 * Override key for the namespace endpoint. One key for the whole namespace:
 * the CLI reports it as a single MCP server and prefixes each connection's
 * tools with its connection id.
 */
export const SMITHERY_NAMESPACE_OVERRIDE_KEY = 'smithery';

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
    const connectionsApiRecords = records.filter(isConnectionsApiRecord);
    const legacyRecords = records.filter(
      (record) => !isConnectionsApiRecord(record),
    );

    const namespace = this.pickNamespace(connectionsApiRecords);
    if (namespace) {
      await this.addNamespaceOverride(overrides, namespace);
    }

    for (const record of legacyRecords) {
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
        namespace,
        connectionsApiRecords: connectionsApiRecords.length,
        legacyRecords: legacyRecords.length,
        serverKeys: Object.keys(overrides),
      });
    }

    return overrides;
  }

  /**
   * The namespace every Connections-API record shares. Records are written by
   * one account, so a second namespace means the user changed accounts and the
   * older records are stale — take the first and say so rather than emitting
   * two endpoints under one key.
   */
  private pickNamespace(
    records: readonly SmitheryInstalledRecord[],
  ): string | undefined {
    const namespaces = [...new Set(records.map((r) => r.namespace))].filter(
      (value): value is string => typeof value === 'string',
    );
    if (namespaces.length === 0) return undefined;
    if (namespaces.length > 1) {
      this.logger?.warn(
        'Smithery records span more than one namespace — using the first',
        { namespaces },
      );
    }
    return namespaces[0];
  }

  /**
   * Add the single namespace override. A missing API key is the ordinary "not
   * configured yet" state, so it warns and contributes nothing rather than
   * throwing into the chat path.
   */
  private async addNamespaceOverride(
    overrides: Record<string, McpHttpServerOverride>,
    namespace: string,
  ): Promise<void> {
    try {
      const httpConfig = await this.resolver.resolveNamespace(namespace);
      overrides[SMITHERY_NAMESPACE_OVERRIDE_KEY] = {
        type: 'http',
        url: httpConfig.url,
        headers: httpConfig.headers,
      };
    } catch (error: unknown) {
      if (error instanceof SmitheryKeyMissingError) {
        this.logger?.warn(
          'Smithery namespace override skipped — API key not configured',
          { namespace },
        );
        return;
      }
      this.logger?.warn('Smithery namespace override resolution failed', {
        namespace,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** A record reachable through the Connections API namespace endpoint. */
function isConnectionsApiRecord(record: SmitheryInstalledRecord): boolean {
  return Boolean(record.namespace) && Boolean(record.connectionId);
}
