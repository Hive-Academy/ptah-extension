/**
 * OAuth session-time override resolver.
 *
 * At chat query-assembly time, reads the OAuth-connected manifest and, for each
 * record, produces a fresh `McpHttpServerOverride` carrying an
 * `Authorization: Bearer <token>` header (refreshing the token when it is near
 * expiry). The map is merged into `QueryOptionsInput.mcpServersOverride`, so the
 * bearer token lives only in memory for the duration of the query and is never
 * written to any disk config file.
 *
 * SECURITY:
 * - Never logs the token (logs only counts + server keys).
 * - Contributes nothing (empty map) when the manifest is empty or a record's
 *   token is missing/unrefreshable — never throws into the chat path.
 */

import type { McpHttpServerOverride } from '@ptah-extension/shared';
import type { McpOAuthService } from './mcp-oauth.service';
import type { McpOAuthInstalledManifestStore } from './mcp-oauth-installed-manifest';

export interface McpOAuthOverrideLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

export interface McpOAuthOverrideResolverDeps {
  manifest: McpOAuthInstalledManifestStore;
  service: Pick<McpOAuthService, 'getFreshAccessToken'>;
  logger?: McpOAuthOverrideLogger;
}

export class McpOAuthOverrideResolver {
  private readonly manifest: McpOAuthInstalledManifestStore;
  private readonly service: Pick<McpOAuthService, 'getFreshAccessToken'>;
  private readonly logger?: McpOAuthOverrideLogger;

  constructor(deps: McpOAuthOverrideResolverDeps) {
    this.manifest = deps.manifest;
    this.service = deps.service;
    this.logger = deps.logger;
  }

  /**
   * Build the per-session override map from the manifest. Returns an empty
   * object when there is nothing to contribute — the caller spreads it
   * unconditionally.
   */
  async buildOverrides(): Promise<Record<string, McpHttpServerOverride>> {
    const records = this.manifest.list();
    if (records.length === 0) return {};

    const overrides: Record<string, McpHttpServerOverride> = {};

    for (const record of records) {
      try {
        const accessToken = await this.service.getFreshAccessToken(
          record.serverKey,
        );
        if (!accessToken) {
          this.logger?.warn('MCP OAuth override skipped — no valid token', {
            serverKey: record.serverKey,
          });
          continue;
        }
        overrides[record.serverKey] = {
          type: 'http',
          url: record.serverUrl,
          headers: { Authorization: `Bearer ${accessToken}` },
        };
      } catch (error: unknown) {
        this.logger?.warn('MCP OAuth override resolution failed for record', {
          serverKey: record.serverKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (Object.keys(overrides).length > 0) {
      this.logger?.debug('MCP OAuth overrides resolved', {
        serverKeys: Object.keys(overrides),
      });
    }

    return overrides;
  }
}
