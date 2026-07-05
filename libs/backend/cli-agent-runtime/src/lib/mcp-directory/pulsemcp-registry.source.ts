/**
 * PulseMCP registry source.
 *
 * Discovery against the PulseMCP directory (https://www.pulsemcp.com) — a
 * trusted online catalogue of vendor/community MCP servers (Autodesk, IFC,
 * Procore, …) that are NOT in the official MCP registry or Smithery. The public
 * list/search API requires NO API key.
 *
 * Mirrors `McpRegistryProvider` / `SmitheryRegistrySource`: raw `globalThis.fetch`
 * + 15s AbortController timeout + 10-min popular cache + permissive Zod
 * `.passthrough()`. Pagination is offset-based; the opaque `cursor` carries the
 * next offset (mirroring how Smithery encodes the next page).
 *
 * There are no secrets on this source, but we keep the no-key-in-logs
 * discipline: nothing beyond field names / counts is logged.
 */

import { z } from 'zod';
import type {
  McpRegistryEntry,
  McpRegistryListResponse,
} from '@ptah-extension/shared';
import type { IMcpRegistrySource } from './mcp-registry-source.interface';
import {
  PULSEMCP_CACHE_TTL_MS,
  PULSEMCP_DEFAULT_PAGE_SIZE,
  PULSEMCP_DEFAULT_REGISTRY_BASE,
  PULSEMCP_FIRST_OFFSET,
  PULSEMCP_REQUEST_TIMEOUT_MS,
} from './pulsemcp-wire.constants';

/** Optional logger surface — keeps this source DI-free for legacy call sites. */
export interface PulseMcpLogger {
  warn(message: string, context?: Record<string, unknown>): void;
}

export interface PulseMcpRegistrySourceOptions {
  /** Override the registry base URL (for tests). */
  registryBase?: string;
  logger?: PulseMcpLogger;
}

interface CachedResponse<T> {
  data: T;
  cachedAt: number;
}

/**
 * Minimal Zod schema for a PulseMCP server. PulseMCP is third-party, so we
 * validate defensively: `name` must be a non-empty string, everything else is
 * optional + permissive (`.passthrough()`) so future fields pass through and we
 * drop only entries missing a usable name.
 */
const PulseMcpServerSchema = z
  .object({
    name: z.string().min(1),
    url: z.string().optional(),
    external_url: z.string().nullish(),
    short_description: z.string().nullish(),
    EXPERIMENTAL_ai_generated_description: z.string().nullish(),
    source_code_url: z.string().nullish(),
    github_stars: z.number().nullish(),
    package_registry: z.string().nullish(),
    package_name: z.string().nullish(),
  })
  .passthrough();

export class PulseMcpRegistrySource implements IMcpRegistrySource {
  readonly id = 'pulsemcp' as const;

  /** PulseMCP's public list/search API needs no authentication. */
  readonly requiresApiKey = false;

  private readonly registryBase: string;
  private readonly logger?: PulseMcpLogger;
  private popularCache: CachedResponse<McpRegistryEntry[]> | null = null;

  constructor(options: PulseMcpRegistrySourceOptions = {}) {
    this.registryBase = trimTrailingSlash(
      options.registryBase ?? PULSEMCP_DEFAULT_REGISTRY_BASE,
    );
    this.logger = options.logger;
  }

  async listServers(options?: {
    query?: string;
    limit?: number;
    cursor?: string;
  }): Promise<McpRegistryListResponse> {
    const offset = decodeOffsetCursor(options?.cursor);
    const pageSize = options?.limit ?? PULSEMCP_DEFAULT_PAGE_SIZE;

    const params = new URLSearchParams();
    if (options?.query) {
      params.set('query', options.query);
    }
    params.set('count_per_page', String(pageSize));
    params.set('offset', String(offset));

    const url = `${this.registryBase}/servers?${params.toString()}`;
    const response = await this.fetch(url);

    if (response.status === 429) {
      this.logger?.warn('PulseMCP registry rate-limited (429) on list', {
        offset,
      });
      return { servers: [] };
    }

    const body = (await response.json()) as Record<string, unknown>;

    const servers: McpRegistryEntry[] = Array.isArray(body['servers'])
      ? (body['servers'] as unknown[])
          .map((item) => this.mapListEntry(item))
          .filter((entry): entry is McpRegistryEntry => entry !== null)
      : [];

    const nextCursor = this.computeNextCursor(
      body,
      offset,
      pageSize,
      servers.length,
    );

    return { servers, next_cursor: nextCursor };
  }

  /**
   * PulseMCP exposes no per-server detail endpoint, so we best-effort resolve
   * the entry from a list query keyed on the name and return the match (or
   * `null` when nothing matches).
   */
  async getServerDetails(name: string): Promise<McpRegistryEntry | null> {
    try {
      const result = await this.listServers({
        query: name,
        limit: PULSEMCP_DEFAULT_PAGE_SIZE,
      });
      return result.servers.find((entry) => entry.name === name) ?? null;
    } catch (error: unknown) {
      this.logger?.warn('PulseMCP getServerDetails failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async getPopular(): Promise<McpRegistryEntry[]> {
    if (
      this.popularCache &&
      Date.now() - this.popularCache.cachedAt < PULSEMCP_CACHE_TTL_MS
    ) {
      return this.popularCache.data;
    }
    const result = await this.listServers({ limit: 50 });
    this.popularCache = { data: result.servers, cachedAt: Date.now() };
    return result.servers;
  }

  clearCache(): void {
    this.popularCache = null;
  }

  private mapListEntry(item: unknown): McpRegistryEntry | null {
    const parsed = PulseMcpServerSchema.safeParse(item);
    if (!parsed.success) {
      this.logger?.warn('PulseMCP: dropping malformed list entry', {
        issues: parsed.error.issues.map(
          (i) => `${i.path.join('.')}: ${i.message}`,
        ),
      });
      return null;
    }
    const s = parsed.data;

    const description =
      s.short_description ??
      s.EXPERIMENTAL_ai_generated_description ??
      undefined;

    // Light "trust" heuristic: a server is treated as verified when it ships a
    // known package on a registry AND has a public source repository. PulseMCP
    // does not expose a first-class verified flag, so we derive a conservative
    // signal from provenance rather than fabricate one.
    const verified = Boolean(s.package_registry && s.source_code_url);

    const entry: McpRegistryEntry = {
      name: s.name,
      description: description ?? undefined,
      source: 'pulsemcp',
      verified,
    };

    const repoUrl = s.source_code_url ?? undefined;
    if (repoUrl) {
      entry.repository = { url: repoUrl, source: 'github' };
    }

    return entry;
  }

  private computeNextCursor(
    body: Record<string, unknown>,
    offset: number,
    pageSize: number,
    pageItemCount: number,
  ): string | undefined {
    // Prefer the server-provided `next` (PulseMCP returns a next-page URL or
    // truthy marker when more results exist).
    if (body['next']) {
      return encodeOffsetCursor(offset + pageSize);
    }

    const totalCount =
      typeof body['total_count'] === 'number'
        ? (body['total_count'] as number)
        : undefined;
    if (totalCount !== undefined) {
      return offset + pageSize < totalCount
        ? encodeOffsetCursor(offset + pageSize)
        : undefined;
    }

    // Fall back to "a full page implies there may be more".
    return pageItemCount >= pageSize
      ? encodeOffsetCursor(offset + pageSize)
      : undefined;
  }

  private async fetch(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      PULSEMCP_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await globalThis.fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ptah-extension/1.0',
        },
        signal: controller.signal,
      });

      if (!response.ok && response.status !== 404 && response.status !== 429) {
        throw new Error(
          `PulseMCP registry request failed: ${response.status} ${response.statusText}`,
        );
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/** PulseMCP pagination is offset-based; the shared cursor carries the offset. */
function encodeOffsetCursor(offset: number): string {
  return String(offset);
}

function decodeOffsetCursor(cursor: string | undefined): number {
  if (!cursor) return PULSEMCP_FIRST_OFFSET;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed >= PULSEMCP_FIRST_OFFSET
    ? parsed
    : PULSEMCP_FIRST_OFFSET;
}
