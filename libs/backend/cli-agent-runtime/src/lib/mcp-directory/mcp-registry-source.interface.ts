/**
 * MCP Registry Source abstraction.
 *
 * A registry source provides MCP server discovery for a single backend
 * (the Official MCP Registry, Smithery, etc.). The official source requires
 * no authentication; secret-bearing sources (Smithery) set `requiresApiKey`.
 *
 * The shape intentionally mirrors the existing `McpRegistryProvider`
 * (`listServers` / `getServerDetails`) so the official provider adopts this
 * interface with zero behavior change.
 */

import type {
  McpRegistryEntry,
  McpRegistryListResponse,
} from '@ptah-extension/shared';

/** Stable identifier for a registry source. */
export type McpRegistrySourceId = 'official' | 'smithery';

export interface IMcpRegistrySource {
  /** Stable identifier used to select this source at the RPC boundary. */
  readonly id: McpRegistrySourceId;

  /** Whether this source needs an API key to be usable. */
  readonly requiresApiKey: boolean;

  /**
   * List/search servers. When `query` is empty, returns all servers paginated.
   * `cursor` is opaque to callers (each source encodes its own pagination).
   */
  listServers(opts?: {
    query?: string;
    limit?: number;
    cursor?: string;
  }): Promise<McpRegistryListResponse>;

  /**
   * Fetch a single server's details by its fully qualified id/name.
   * Returns `null` when the server does not exist.
   */
  getServerDetails(id: string): Promise<McpRegistryEntry | null>;
}
