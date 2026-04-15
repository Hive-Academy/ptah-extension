/**
 * Official MCP Registry API Client
 *
 * Fetches MCP server metadata from registry.modelcontextprotocol.io
 * No authentication required for read operations.
 */

import type {
  McpRegistryEntry,
  McpRegistryListResponse,
} from '@ptah-extension/shared';

const REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io/v0.1';

/** Default page size for listing servers */
const DEFAULT_PAGE_SIZE = 20;

/** Cache TTL for popular servers (10 minutes) */
const POPULAR_CACHE_TTL_MS = 10 * 60 * 1000;

/** HTTP request timeout (15 seconds) */
const REQUEST_TIMEOUT_MS = 15_000;

interface CachedResponse<T> {
  data: T;
  cachedAt: number;
}

export class McpRegistryProvider {
  private popularCache: CachedResponse<McpRegistryEntry[]> | null = null;

  /**
   * Search/list servers from the Official MCP Registry.
   * When query is empty, returns all servers paginated.
   */
  async listServers(options?: {
    query?: string;
    limit?: number;
    cursor?: string;
  }): Promise<McpRegistryListResponse> {
    const params = new URLSearchParams();
    params.set('limit', String(options?.limit ?? DEFAULT_PAGE_SIZE));

    if (options?.cursor) {
      params.set('cursor', options.cursor);
    }

    // The official registry supports text search via a query param
    // (specific parameter name may be 'q' or embedded in cursor-based pagination)
    if (options?.query) {
      params.set('q', options.query);
    }

    const url = `${REGISTRY_BASE_URL}/servers?${params.toString()}`;
    const response = await this.fetch(url);

    // The API returns { servers: [...], next_cursor?: "..." }
    // Handle both the standard response shape and potential variations
    const body = (await response.json()) as Record<string, unknown>;

    const servers: McpRegistryEntry[] = Array.isArray(body['servers'])
      ? (body['servers'] as McpRegistryEntry[])
      : [];

    const nextCursor =
      typeof body['next_cursor'] === 'string'
        ? (body['next_cursor'] as string)
        : undefined;

    return { servers, next_cursor: nextCursor };
  }

  /**
   * Get detailed information for a specific server by its fully qualified name.
   * e.g., "io.github.user/server-name"
   */
  async getServerDetails(name: string): Promise<McpRegistryEntry | null> {
    const url = `${REGISTRY_BASE_URL}/servers/${encodeURIComponent(name)}`;

    try {
      const response = await this.fetch(url);
      if (response.status === 404) return null;

      const body = (await response.json()) as Record<string, unknown>;

      // The detail endpoint wraps in { server: { ... } } or returns flat
      const server = (body['server'] ?? body) as McpRegistryEntry;
      return server;
    } catch {
      return null;
    }
  }

  /**
   * Get popular/trending servers. Results are cached for 10 minutes.
   */
  async getPopular(): Promise<McpRegistryEntry[]> {
    if (
      this.popularCache &&
      Date.now() - this.popularCache.cachedAt < POPULAR_CACHE_TTL_MS
    ) {
      return this.popularCache.data;
    }

    // Fetch the first page of servers (default sort is by popularity/activity)
    const result = await this.listServers({ limit: 50 });

    this.popularCache = {
      data: result.servers,
      cachedAt: Date.now(),
    };

    return result.servers;
  }

  /** Clear the popular servers cache */
  clearCache(): void {
    this.popularCache = null;
  }

  private async fetch(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ptah-extension/1.0',
        },
        signal: controller.signal,
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(
          `MCP Registry request failed: ${response.status} ${response.statusText}`,
        );
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}
