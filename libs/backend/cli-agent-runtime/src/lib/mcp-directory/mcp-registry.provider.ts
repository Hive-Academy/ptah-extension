/**
 * Official MCP Registry API Client
 *
 * Fetches MCP server metadata from registry.modelcontextprotocol.io
 * No authentication required for read operations.
 */

import { z } from 'zod';
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

/**
 * Minimal Zod schema for a registry entry. The registry server is third-
 * party, so we validate the boundary defensively: `name` must be a non-empty
 * string, everything else is optional + permissive. Schema is intentionally
 * loose (`.passthrough()`) — we drop entries that are obviously malformed
 * (missing `name`) but pass through unknown fields so the downstream
 * `McpRegistryEntry` consumers still see new schema additions.
 */
const McpRegistryEntrySchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    repository: z.unknown().optional(),
    icons: z.unknown().optional(),
    version_detail: z.unknown().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

/** Optional logger surface — keeps this provider DI-free for legacy call sites. */
export interface RegistryLogger {
  warn(message: string, context?: Record<string, unknown>): void;
}

/**
 * Unwrap a registry entry, tolerating both the legacy flat shape
 * (`{ name, description, ... }`) and the current envelope shape
 * (`{ server: { ... }, _meta: { ... } }`) defined by the
 * MCP Registry 2025-09 schema. Returns null if the entry fails schema
 * validation (no usable `name` after unwrapping or wrong field types).
 *
 * Why: the registry schema gained a `_meta` envelope which silently
 * caused all list rows to render blank. Future schema additions that
 * keep wrapping the payload under `server` will continue to work.
 *
 * When `logger` is supplied, malformed entries are audited with a warn
 * line — including the extracted `name` if available — so we can spot
 * upstream schema drift in production logs.
 */
function unwrapRegistryEntry(
  item: unknown,
  logger?: RegistryLogger,
): McpRegistryEntry | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  const inner =
    obj['server'] && typeof obj['server'] === 'object'
      ? (obj['server'] as Record<string, unknown>)
      : obj;

  const parsed = McpRegistryEntrySchema.safeParse(inner);
  if (!parsed.success) {
    const maybeName =
      typeof inner['name'] === 'string' ? (inner['name'] as string) : undefined;
    logger?.warn('MCP registry: dropping malformed entry', {
      name: maybeName,
      issues: parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`,
      ),
    });
    return null;
  }

  return parsed.data as unknown as McpRegistryEntry;
}

export class McpRegistryProvider {
  private popularCache: CachedResponse<McpRegistryEntry[]> | null = null;

  /**
   * @param logger Optional audit logger for malformed registry entries. When
   *   supplied (e.g. by the RPC handler), entries that fail Zod validation
   *   are emitted as `warn` lines instead of being silently dropped.
   */
  constructor(private readonly logger?: RegistryLogger) {}

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
    if (options?.query) {
      params.set('q', options.query);
    }

    const url = `${REGISTRY_BASE_URL}/servers?${params.toString()}`;
    const response = await this.fetch(url);

    const body = (await response.json()) as Record<string, unknown>;

    const servers: McpRegistryEntry[] = Array.isArray(body['servers'])
      ? (body['servers'] as unknown[])
          .map((item) => unwrapRegistryEntry(item, this.logger))
          .filter((entry): entry is McpRegistryEntry => entry !== null)
      : [];

    const nextCursor =
      typeof body['next_cursor'] === 'string'
        ? (body['next_cursor'] as string)
        : typeof (body['metadata'] as Record<string, unknown> | undefined)?.[
              'next_cursor'
            ] === 'string'
          ? ((body['metadata'] as Record<string, unknown>)[
              'next_cursor'
            ] as string)
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

      return unwrapRegistryEntry(body, this.logger);
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
